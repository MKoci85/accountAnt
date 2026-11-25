import { unstable_rethrow } from "next/navigation";
import type { Resultado } from "@/lib/resultado";

const REPETIDO_POR_TABLA: Record<string, string> = {
  emisores: "Ya hay un comercio con ese RUC.",
  categorias: "Ya existe una categoría con ese nombre.",
  proveedores_cfe: "Ya existe un proveedor de CFE con ese nombre.",
  gastos: "Ese comprobante ya está cargado para este comercio.",
  emisor_alias: "Ese nombre ya está asociado a un comercio.",
  cuotas_compra: "Esa cuota ya está registrada.",
};

function codigoSqlite(e: unknown): { code: string; message: string } | null {
  for (let actual = e, vueltas = 0; actual && vueltas < 5; vueltas++) {
    const { code, message, cause } = actual as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof code === "string" && code.startsWith("SQLITE_")) {
      return { code, message: typeof message === "string" ? message : "" };
    }
    actual = cause;
  }
  return null;
}

/**
 * Traduce un error a un texto que el usuario pueda leer. Los errores de
 * SQLite salen en inglés y nombrando columnas (`UNIQUE constraint failed:
 * emisores.ruc`); los que lanza el código de la app ya están escritos para el
 * usuario y pasan tal cual.
 */
export function mensajeDeError(e: unknown): string {
  const sqlite = codigoSqlite(e);
  if (sqlite) {
    if (sqlite.code === "SQLITE_CONSTRAINT_UNIQUE" || sqlite.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      const tabla = sqlite.message.match(/failed: (\w+)\./)?.[1];
      return (tabla && REPETIDO_POR_TABLA[tabla]) ?? "Ya existe un registro con esos mismos datos.";
    }
    if (sqlite.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return "No se puede: hay otros datos que dependen de este (por ejemplo, gastos cargados con él).";
    }
    if (sqlite.code === "SQLITE_BUSY" || sqlite.code === "SQLITE_LOCKED") {
      return "La base de datos está ocupada con otra operación. Probá de nuevo en unos segundos.";
    }
    return `Error de la base de datos: ${sqlite.message || sqlite.code}`;
  }
  if (e instanceof Error && e.message) return e.message;
  return "Ocurrió un error inesperado.";
}

/**
 * Envuelve un server action para que un error vuelva al navegador como
 * `{ ok: false, error }` con su mensaje legible, en vez de lanzarse y llegar
 * vacío en producción. `redirect()` y `notFound()` también se implementan
 * lanzando, y esos se dejan pasar. Del lado del cliente el resultado se abre
 * con `desenvolver`.
 */
export function accion<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>
): (...args: A) => Promise<Resultado<T>> {
  return async (...args) => {
    try {
      return { ok: true, valor: await fn(...args) };
    } catch (e) {
      unstable_rethrow(e);
      if (!(e instanceof Error) || e.name !== "Error") console.error(e);
      return { ok: false, error: mensajeDeError(e) };
    }
  };
}
