import type { FilaPdf, FragmentoPdf } from "./pdf";

export type MovimientoEstadoCuenta = {
  fecha: string;
  descripcion: string;
  monto: number;
  moneda: "UYU" | "USD";
};

const PREFIJOS_NO_CONSUMO = [
  "SALDO",
  "PAGOS",
  "PAGO ",
  "SEGURO SALDO DEUDOR",
  "TOTAL TARJETA",
  "TOTAL ",
  "TARJETA No",
  "TARJETA N",
  "SU PAGO",
  "INTERESES",
];

const UMBRAL_USD_FALLBACK = 500;

const RE_FECHA = /^(\d{2})\/(\d{2})\/(\d{2})\b/;

const RE_MONTO = /^-?[\d,]+\.\d{2}$/;

/**
 * Busca la X del encabezado de la columna de dólares para separar monedas.
 * @param filas filas del PDF
 * @returns la coordenada X umbral: a la derecha es USD, a la izquierda UYU
 */
export function detectarUmbralUSD(filas: FilaPdf[]): number {
  for (const fila of filas) {
    const usd = fila.fragmentos.find((f) => /^(USD|U\$S|DOLARES?|US\$)$/i.test(f.texto));
    if (!usd) continue;

    const pesos = fila.fragmentos.find(
      (f) => /^(\$|UYU|PESOS?|\$U)$/i.test(f.texto) && f.x < usd.x
    );
    return pesos ? (pesos.x + usd.x) / 2 : usd.x - 30;
  }
  return UMBRAL_USD_FALLBACK;
}

function esNoConsumo(texto: string): boolean {
  const t = texto.toUpperCase().trimStart();
  return PREFIJOS_NO_CONSUMO.some((p) => t.startsWith(p.toUpperCase()));
}

export function parsearMonto(texto: string): number | null {
  if (!RE_MONTO.test(texto)) return null;
  const n = Number(texto.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function fechaISO(dd: string, mm: string, aa: string): string {
  return `20${aa}-${mm}-${dd}`;
}

export function parsearEstadoCuenta(filas: FilaPdf[]): MovimientoEstadoCuenta[] {
  const umbralUSD = detectarUmbralUSD(filas);
  const movimientos: MovimientoEstadoCuenta[] = [];

  for (const fila of filas) {
    const coincidencia = RE_FECHA.exec(fila.texto);
    if (!coincidencia) continue;

    const resto = fila.texto.slice(coincidencia[0].length).trim();
    if (esNoConsumo(resto)) continue;

    let fragmentoMonto: FragmentoPdf | null = null;
    let monto: number | null = null;
    for (const fragmento of fila.fragmentos) {
      const valor = parsearMonto(fragmento.texto);
      if (valor === null) continue;
      if (!fragmentoMonto || fragmento.x > fragmentoMonto.x) {
        fragmentoMonto = fragmento;
        monto = valor;
      }
    }
    if (!fragmentoMonto || monto === null) continue;

    const descripcion = fila.fragmentos
      .filter((f) => f.x < fragmentoMonto.x)
      .map((f) => f.texto)
      .join(" ")
      .replace(RE_FECHA, "")
      .trim();

    if (!descripcion) continue;
    if (esNoConsumo(descripcion)) continue;

    movimientos.push({
      fecha: fechaISO(coincidencia[1], coincidencia[2], coincidencia[3]),
      descripcion,
      monto,
      moneda: fragmentoMonto.x >= umbralUSD ? "USD" : "UYU",
    });
  }

  return movimientos;
}
