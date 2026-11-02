import { promises as fs } from "node:fs";
import path from "node:path";

const DIRECTORIO = path.join(process.cwd(), "data", "estados-cuenta");

function ruta(archivo: string): string {
  return path.join(DIRECTORIO, path.basename(archivo));
}

/**
 * Guarda el PDF de un estado de cuenta. Sin `"use server"`: recibe un Buffer y
 * escribe en disco. En la base va sólo el nombre del archivo, y `basename`
 * impide que un valor alterado apunte fuera del directorio.
 * @returns el nombre del archivo, o null si el disco falló (el registro sigue
 * sirviendo, sin el PDF)
 */
export async function guardarPdfEstadoCuenta(
  id: number,
  pdf: Buffer
): Promise<string | null> {
  try {
    await fs.mkdir(DIRECTORIO, { recursive: true });
    const archivo = `${id}.pdf`;
    await fs.writeFile(ruta(archivo), pdf);
    return archivo;
  } catch {
    return null;
  }
}

export async function leerPdfEstadoCuenta(archivo: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(ruta(archivo));
  } catch {
    return null;
  }
}

export async function borrarPdfEstadoCuenta(archivo: string | null) {
  if (!archivo) return;
  await fs.rm(ruta(archivo), { force: true }).catch(() => undefined);
}
