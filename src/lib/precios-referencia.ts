export const MESES_VENTANA_PRECIO_REFERENCIA_DEFAULT = 4;

export function fechaLimiteVentanaPrecio(
  fechaReferencia: string,
  mesesVentana: number
) {
  const fecha = new Date(fechaReferencia);
  fecha.setMonth(fecha.getMonth() - mesesVentana);
  return fecha.toISOString().slice(0, 10);
}

export type UnidadMedida = "un" | "kg" | "L";

export const UNIDADES: UnidadMedida[] = ["un", "kg", "L"];

export function esUnidadMedida(valor: string): valor is UnidadMedida {
  return (UNIDADES as string[]).includes(valor);
}

export function normalizarUnidad(valor: string | null | undefined): UnidadMedida {
  if (!valor) return "un";
  const texto = valor.trim();
  if (esUnidadMedida(texto)) return texto;
  const minuscula = texto.toLowerCase();
  if (minuscula === "kg") return "kg";
  if (minuscula === "l") return "L";
  return "un";
}

export function etiquetaUnidad(unidad: UnidadMedida) {
  return unidad === "un" ? "por unidad" : `por ${unidad}`;
}

export function formatearCantidadConUnidad(
  cantidad: number,
  unidad: UnidadMedida
) {
  const numero = Number(cantidad.toFixed(3)).toLocaleString("es-UY");
  return `${numero} ${unidad}`;
}

const FACTORES: Record<string, { factor: number; unidad: UnidadMedida }> = {
  kg: { factor: 1, unidad: "kg" },
  kgs: { factor: 1, unidad: "kg" },
  k: { factor: 1, unidad: "kg" },
  g: { factor: 0.001, unidad: "kg" },
  gr: { factor: 0.001, unidad: "kg" },
  grs: { factor: 0.001, unidad: "kg" },
  l: { factor: 1, unidad: "L" },
  lt: { factor: 1, unidad: "L" },
  lts: { factor: 1, unidad: "L" },
  ml: { factor: 0.001, unidad: "L" },
  cc: { factor: 0.001, unidad: "L" },
  un: { factor: 1, unidad: "un" },
  uns: { factor: 1, unidad: "un" },
  und: { factor: 1, unidad: "un" },
  unid: { factor: 1, unidad: "un" },
  unidad: { factor: 1, unidad: "un" },
  unidades: { factor: 1, unidad: "un" },
  u: { factor: 1, unidad: "un" },
};

/**
 * Parsea un tamaño en texto libre ("0.400 kg", "1.5L", "500ml", "6 un") a cantidad + unidad.
 * @param tamano texto a interpretar
 * @returns cantidad normalizada y unidad, o null si no matchea ningún formato conocido
 */
export function parsearTamano(
  tamano: string | null
): { cantidad: number; unidad: UnidadMedida } | null {
  if (!tamano) return null;
  const texto = tamano.trim().toLowerCase().replace(/\s+/g, " ");
  if (!texto) return null;

  const match = texto.match(
    /^((?:\d+(?:[.,]\d+)?)|(?:[.,]\d+))\s*([a-zá-ú]*)\.?$/i
  );
  if (!match) return null;

  const cantidad = Number(match[1].replace(",", "."));
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;

  const sufijo = match[2];
  if (!sufijo) return { cantidad, unidad: "un" };

  const factor = FACTORES[sufijo];
  if (!factor) return null;

  return { cantidad: cantidad * factor.factor, unidad: factor.unidad };
}

export const MARGEN_SOBREPRECIO_POR_PESO_DEFAULT = 0.03;

export function claveReferencia(itemCatalogoId: number, unidad: UnidadMedida) {
  return `${itemCatalogoId}|${unidad}`;
}

export type CompraParaReferencia = {
  gastoItemId: number;
  itemCatalogoId: number | null;
  unidad: string | null;
  precio: number;
  fecha: string;
  esPrecioBase: boolean;
  esOferta: boolean;
  esPesoDesconocido: boolean;
};

function esPosterior(a: CompraParaReferencia, b: CompraParaReferencia) {
  return a.fecha > b.fecha || (a.fecha === b.fecha && a.gastoItemId > b.gastoItemId);
}

/**
 * Elige, por ítem y unidad, la compra que hace de precio de referencia: la más
 * barata desde la última marcada como "subió de precio", o de toda la ventana
 * si no hay ninguna. Una suba confirmada reinicia el historial (lo anterior ya
 * no describe el precio vigente), pero una compra más barata posterior vuelve a
 * ser la referencia. Nunca cuentan las ofertas, las líneas sin peso ni las de
 * precio no positivo; una oferta que además tenga la marca de suba tampoco
 * reinicia nada mientras siga siendo oferta, así desmarcarla la restituye.
 * @param compras líneas de gasto candidatas, en cualquier orden
 * @param fechaLimite primera fecha que entra en la ventana de comparación
 * @returns la compra de referencia de cada `claveReferencia`
 */
export function referenciasDePrecio<T extends CompraParaReferencia>(
  compras: T[],
  fechaLimite: string
): Map<string, T> {
  const porClave = new Map<string, T[]>();
  for (const compra of compras) {
    if (compra.itemCatalogoId == null) continue;
    if (compra.esOferta || compra.esPesoDesconocido) continue;
    if (compra.precio <= 0 || compra.fecha < fechaLimite) continue;
    const clave = claveReferencia(
      compra.itemCatalogoId,
      normalizarUnidad(compra.unidad)
    );
    const candidatas = porClave.get(clave);
    if (candidatas) candidatas.push(compra);
    else porClave.set(clave, [compra]);
  }

  const referencias = new Map<string, T>();
  for (const [clave, candidatas] of porClave) {
    const ultimaBase = candidatas
      .filter((c) => c.esPrecioBase)
      .reduce<T | null>(
        (ultima, c) => (ultima === null || esPosterior(c, ultima) ? c : ultima),
        null
      );

    let referencia: T | null = null;
    for (const compra of candidatas) {
      if (ultimaBase && esPosterior(ultimaBase, compra)) continue;
      if (
        referencia === null ||
        compra.precio < referencia.precio ||
        (compra.precio === referencia.precio && esPosterior(compra, referencia))
      ) {
        referencia = compra;
      }
    }
    if (referencia) referencias.set(clave, referencia);
  }
  return referencias;
}

export const MARGEN_OFERTA_DEFAULT = 0.15;

/**
 * @returns true si el precio está tan por debajo de la referencia que lo más
 * probable es que sea una oferta o promoción, no el precio habitual del ítem.
 * La referencia es el mínimo conocido: pagar menos que eso ya es sospechoso,
 * y el margen evita ofrecer la marca por una diferencia de centavos.
 */
export function pareceOferta(
  precio: number,
  referencia: number,
  margen: number
) {
  return precio > 0 && precio < referencia * (1 - margen);
}

export function superaReferencia(
  precio: number,
  referencia: number,
  unidad: UnidadMedida,
  margen: number
) {
  const umbral = unidad === "un" ? referencia : referencia * (1 + margen);
  return precio > umbral;
}
