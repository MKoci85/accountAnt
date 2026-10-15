import { promises as fs } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { erroresRecepcion, gastosEntrantes, mensajesWhatsapp } from "@/db/schema";
import { leerAjustesBandeja } from "@/lib/config-server";
import { esDeMesAnterior } from "@/lib/entrantes";

// Almacenamiento de la bandeja: filas y fotos. Deliberadamente sin "use
// server" (escribe en disco y recibe Buffers) y sin importar ninguna acción:
// `actions/gastos.ts` depende de esto, y la lectura de comprobantes
// (`entrantes-recepcion.ts`) depende de `actions/gastos.ts`.

const DIRECTORIO_IMAGENES = path.join(process.cwd(), "data", "entrantes");

// En la base va sólo el nombre del archivo: `basename` evita que un valor
// alterado apunte fuera del directorio.
function rutaImagen(archivo: string): string {
  return path.join(DIRECTORIO_IMAGENES, path.basename(archivo));
}

/**
 * Guarda la foto de un entrante para poder reintentar su lectura (cuota de IA
 * agotada, proveedor caído). Si el disco falla el entrante igual sirve: sólo
 * pierde el reintento desde la imagen.
 */
export async function guardarImagenEntrante(id: number, imagen: Buffer) {
  try {
    await fs.mkdir(DIRECTORIO_IMAGENES, { recursive: true });
    const archivo = `${id}.img`;
    await fs.writeFile(rutaImagen(archivo), imagen);
    db.update(gastosEntrantes)
      .set({ imagenRuta: archivo })
      .where(eq(gastosEntrantes.id, id))
      .run();
  } catch {
    // sin foto guardada
  }
}

export async function leerImagenEntrante(archivo: string): Promise<Buffer | null> {
  return fs.readFile(rutaImagen(archivo)).catch(() => null);
}

/**
 * Cuántos comprobantes esperan, cuántos vienen de un mes anterior, y si eso
 * frena la carga manual (los atrasados bloquean sólo con el ajuste activo).
 */
export async function resumenDeBandeja(): Promise<{
  total: number;
  atrasados: number;
  bloqueada: boolean;
}> {
  const filas = await db
    .select({
      fecha: gastosEntrantes.fecha,
      recibidoEn: gastosEntrantes.recibidoEn,
    })
    .from(gastosEntrantes);
  const atrasados = filas.filter((f) => esDeMesAnterior(f)).length;
  return {
    total: filas.length,
    atrasados,
    bloqueada:
      atrasados > 0 && (await leerAjustesBandeja()).bloqueoPorMes,
  };
}

export const MENSAJE_BLOQUEO_POR_MES =
  "Quedan comprobantes de un mes anterior en la bandeja de entrada. Resolvelos o descartalos antes de cargar gastos nuevos.";

/** Saca un entrante de la bandeja, con su foto. */
export async function borrarEntrante(id: number): Promise<void> {
  const fila = db
    .delete(gastosEntrantes)
    .where(eq(gastosEntrantes.id, id))
    .returning({ imagenRuta: gastosEntrantes.imagenRuta })
    .get();
  if (fila?.imagenRuta) await fs.rm(rutaImagen(fila.imagenRuta), { force: true });
}

export type FallaRecepcion = { paso: string; detalle: string };
type OrigenError = (typeof erroresRecepcion.$inferInsert)["origen"];

/** Deja constancia de las fallas de una recepción. Nunca tira: es un registro. */
export function registrarFallas(
  fallas: FallaRecepcion[],
  origen: OrigenError,
  mensajeWhatsappId: string | null = null
) {
  if (!fallas.length) return;
  try {
    const ocurridoEn = new Date().toISOString();
    db.insert(erroresRecepcion)
      .values(fallas.map((f) => ({ ...f, origen, mensajeWhatsappId, ocurridoEn })))
      .run();
  } catch (e) {
    console.error("No se pudieron registrar las fallas de recepción", e, fallas);
  }
}

export type EventoRecepcion =
  | {
      tipo: "whatsapp";
      id: string;
      fecha: string;
      remitente: string;
      resultado: string | null;
      fallas: FallaRecepcion[];
    }
  | {
      tipo: "falla";
      id: string;
      fecha: string;
      origen: OrigenError;
      falla: FallaRecepcion;
    };

/**
 * Lo que llegó por WhatsApp y cada falla de lectura, en una sola línea de
 * tiempo. Las fallas de un mensaje van dentro de ese mensaje; las de una foto
 * subida a mano o de un "Volver a leer", sueltas.
 */
export async function listarRegistroRecepcion(limite = 30): Promise<EventoRecepcion[]> {
  const mensajes = db
    .select()
    .from(mensajesWhatsapp)
    .orderBy(desc(mensajesWhatsapp.recibidoEn))
    .limit(limite)
    .all();
  const fallas = db
    .select()
    .from(erroresRecepcion)
    .orderBy(desc(erroresRecepcion.id))
    .limit(limite * 4)
    .all();

  const porMensaje = new Map<string, FallaRecepcion[]>();
  const sueltas: EventoRecepcion[] = [];
  for (const f of [...fallas].reverse()) {
    const falla = { paso: f.paso, detalle: f.detalle };
    if (f.mensajeWhatsappId) {
      porMensaje.set(f.mensajeWhatsappId, [
        ...(porMensaje.get(f.mensajeWhatsappId) ?? []),
        falla,
      ]);
    } else {
      sueltas.push({
        tipo: "falla",
        id: `falla-${f.id}`,
        fecha: f.ocurridoEn,
        origen: f.origen,
        falla,
      });
    }
  }

  const eventos: EventoRecepcion[] = [
    ...mensajes.map((m) => ({
      tipo: "whatsapp" as const,
      id: m.id,
      fecha: m.recibidoEn,
      remitente: m.remitente,
      resultado: m.resultado,
      fallas: porMensaje.get(m.id) ?? [],
    })),
    ...sueltas,
  ];
  return eventos.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, limite);
}
