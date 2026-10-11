import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gastosEntrantes } from "@/db/schema";
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
