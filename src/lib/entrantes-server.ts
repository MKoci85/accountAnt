import { promises as fs } from "node:fs";
import path from "node:path";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  notLike,
  or,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { erroresRecepcion, gastosEntrantes, mensajesWhatsapp } from "@/db/schema";
import { leerAjustesBandeja } from "@/lib/config-server";
import {
  esDeMesAnterior,
  eventoCoincide,
  type EventoRecepcion,
  type FallaRecepcion,
  type OrigenFallaRecepcion,
} from "@/lib/entrantes";
import { PREFIJO_REINTENTO } from "@/lib/whatsapp";

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

type OrigenError = OrigenFallaRecepcion;

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

export type FiltrosRegistro = {
  busqueda?: string;
  /** Fecha local `aaaa-mm-dd`, inclusive. */
  desde?: string;
  /** Fecha local `aaaa-mm-dd`, inclusive. */
  hasta?: string;
};

export type RegistroRecepcion = { eventos: EventoRecepcion[]; total: number };

function inicioDelDia(fecha: string, diasDespues = 0): string | null {
  const d = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + diasDespues);
  return d.toISOString();
}

function condicionesDeFecha(columna: AnySQLiteColumn, filtros: FiltrosRegistro) {
  const desde = filtros.desde ? inicioDelDia(filtros.desde) : null;
  const hasta = filtros.hasta ? inicioDelDia(filtros.hasta, 1) : null;
  return and(
    desde ? gte(columna, desde) : undefined,
    hasta ? lt(columna, hasta) : undefined
  );
}

/**
 * Lo que llegó por WhatsApp y cada falla de lectura, en una sola línea de
 * tiempo, del más nuevo al más viejo. Las fallas de un mensaje van dentro de
 * ese mensaje; las de una foto subida a mano o de un "Volver a leer", sueltas.
 * Las fechas se filtran en la base (por día local) y el texto acá, sin
 * tildes ni mayúsculas.
 * @returns Hasta `limite` eventos, y cuántos coincidían en total.
 */
export async function listarRegistroRecepcion(
  filtros: FiltrosRegistro = {},
  limite = 200
): Promise<RegistroRecepcion> {
  const mensajes = db
    .select()
    .from(mensajesWhatsapp)
    .where(condicionesDeFecha(mensajesWhatsapp.recibidoEn, filtros))
    .all();
  const deMensajes = mensajes.length
    ? db
        .select()
        .from(erroresRecepcion)
        .where(
          inArray(
            erroresRecepcion.mensajeWhatsappId,
            mensajes.map((m) => m.id)
          )
        )
        .orderBy(asc(erroresRecepcion.id))
        .all()
    : [];
  const sueltas = db
    .select()
    .from(erroresRecepcion)
    .where(
      and(
        isNull(erroresRecepcion.mensajeWhatsappId),
        condicionesDeFecha(erroresRecepcion.ocurridoEn, filtros)
      )
    )
    .all();

  const porMensaje = new Map<string, FallaRecepcion[]>();
  for (const f of deMensajes) {
    const id = f.mensajeWhatsappId!;
    porMensaje.set(id, [...(porMensaje.get(id) ?? []), { paso: f.paso, detalle: f.detalle }]);
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
    ...sueltas.map((f) => ({
      tipo: "falla" as const,
      id: `falla-${f.id}`,
      fecha: f.ocurridoEn,
      origen: f.origen,
      falla: { paso: f.paso, detalle: f.detalle },
    })),
  ]
    .filter((ev) => eventoCoincide(ev, filtros.busqueda ?? ""))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return { eventos: eventos.slice(0, limite), total: eventos.length };
}

/**
 * Vacía el registro de recepción. Quedan sólo los mensajes de WhatsApp sin
 * terminar (y sus fallas): son los que "Reintentar" todavía puede retomar.
 *
 * Borrar un mensaje terminado le quita el candado contra una entrega repetida
 * de Meta, pero eso pasa a los pocos minutos de recibirlo; y un comprobante con
 * QR igual choca contra `claveComprobante` o el índice único de `gastos`.
 * @returns Cuántas filas se borraron entre las dos tablas.
 */
export function limpiarRegistroRecepcion(): number {
  return db.transaction((tx) => {
    const mensajes = tx
      .delete(mensajesWhatsapp)
      .where(
        and(
          isNotNull(mensajesWhatsapp.resultado),
          notLike(mensajesWhatsapp.resultado, `${PREFIJO_REINTENTO}%`)
        )
      )
      .run().changes;
    const fallas = tx
      .delete(erroresRecepcion)
      .where(
        or(
          isNull(erroresRecepcion.mensajeWhatsappId),
          notInArray(
            erroresRecepcion.mensajeWhatsappId,
            tx.select({ id: mensajesWhatsapp.id }).from(mensajesWhatsapp)
          )
        )
      )
      .run().changes;
    return mensajes + fallas;
  });
}
