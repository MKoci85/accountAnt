/**
 * Lo que devuelve un server action que puede fallar por algo que el usuario
 * tiene que leer. Existe porque un build de producción reemplaza el mensaje
 * de un error lanzado dentro de un server action por uno genérico: lanzar
 * "Ya existe un comercio llamado X" llega al navegador como "An error
 * occurred in the Server Components render". Devuelto como valor, el texto
 * viaja entero.
 */
export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

/**
 * Del lado del cliente, vuelve a convertir un `Resultado` fallido en un error
 * lanzado, con su mensaje intacto, para que el `try/catch` que lo muestra no
 * tenga que cambiar.
 * @throws Error con el mensaje que armó el servidor.
 */
export function desenvolver<T>(resultado: Resultado<T>): T {
  if (!resultado.ok) throw new Error(resultado.error);
  return resultado.valor;
}
