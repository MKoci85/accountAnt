export type EmisorParaFusion = {
  id: number;
  nombre: string;
  ruc: string | null;
  esGenerico: boolean;
  proveedorCfeId: number | null;
};

/**
 * Cuál se conserva por defecto al fusionar: el que tiene RUC, porque el
 * escaneo del QR busca el comercio por RUC; si ninguno lo tiene, el primero.
 */
export function comercioAConservar(emisores: EmisorParaFusion[]): EmisorParaFusion | null {
  return emisores.find((e) => e.ruc !== null) ?? emisores[0] ?? null;
}

/**
 * Por qué no se pueden fusionar estos comercios, o null si se puede. Dos RUC
 * distintos son dos empresas para DGI: fusionarlos haría que el QR de una
 * dejara de encontrar su comercio. El genérico ("Varios") no se fusiona: es
 * el destino de las compras sueltas, no un comercio.
 */
export function problemaParaFusionar(
  conservar: EmisorParaFusion,
  absorber: EmisorParaFusion[]
): string | null {
  if (!absorber.length) return "Elegí al menos otro comercio para fusionar.";
  if (absorber.some((e) => e.id === conservar.id)) {
    return "Un comercio no se puede fusionar consigo mismo.";
  }
  const todos = [conservar, ...absorber];
  const generico = todos.find((e) => e.esGenerico);
  if (generico) return `"${generico.nombre}" es el comercio genérico: no se fusiona.`;
  const conRuc = todos.filter((e) => e.ruc !== null);
  const distinto = conRuc.find((e) => e.ruc !== conRuc[0].ruc);
  if (distinto) {
    return `"${conRuc[0].nombre}" y "${distinto.nombre}" tienen RUC distinto: para DGI son empresas distintas.`;
  }
  return null;
}

/**
 * RUC y proveedor de CFE del comercio que queda: los suyos, y si no tiene,
 * los del primero absorbido que los tenga.
 */
export function datosDelFusionado(
  conservar: EmisorParaFusion,
  absorber: EmisorParaFusion[]
): { ruc: string | null; proveedorCfeId: number | null } {
  return {
    ruc: conservar.ruc ?? absorber.find((e) => e.ruc !== null)?.ruc ?? null,
    proveedorCfeId:
      conservar.proveedorCfeId ??
      absorber.find((e) => e.proveedorCfeId !== null)?.proveedorCfeId ??
      null,
  };
}

/**
 * Los nombres que quedan como alias del comercio que se conserva: el de cada
 * absorbido, que es justamente el texto con que llega en los estados de
 * cuenta. Se omiten los que ya son su nombre o ya son alias.
 */
export function aliasDeFusion(
  conservar: EmisorParaFusion,
  absorber: EmisorParaFusion[],
  aliasExistentes: string[]
): string[] {
  const ya = new Set([conservar.nombre, ...aliasExistentes].map((t) => t.trim().toLowerCase()));
  const nuevos: string[] = [];
  for (const e of absorber) {
    const texto = e.nombre.trim();
    if (!texto || ya.has(texto.toLowerCase())) continue;
    ya.add(texto.toLowerCase());
    nuevos.push(texto);
  }
  return nuevos;
}

/**
 * Los comprobantes que, al juntar los gastos bajo un mismo comercio,
 * quedarían repetidos: el mismo tipo, serie y número cargado en dos de ellos.
 * Es un gasto duplicado de verdad, y el índice único lo rechazaría.
 */
export function comprobantesRepetidos(
  gastos: { tipoCfe: string | null; serie: string | null; numero: string | null }[]
): string[] {
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const g of gastos) {
    if (g.serie === null) continue;
    const clave = [g.tipoCfe ?? "", g.serie, g.numero ?? ""].join(" ").trim();
    if (vistos.has(clave)) repetidos.add(clave);
    vistos.add(clave);
  }
  return [...repetidos];
}
