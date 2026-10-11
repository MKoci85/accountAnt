const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export function formatearMonto(monto: number, opciones?: { decimales?: number }) {
  const redondeado = Number(monto.toFixed(2));
  const decimales = opciones?.decimales;
  const numero =
    decimales === undefined
      ? redondeado.toLocaleString("es-UY", { maximumFractionDigits: 2 })
      : redondeado.toLocaleString("es-UY", {
          minimumFractionDigits: decimales,
          maximumFractionDigits: decimales,
        });
  return `$ ${numero}`;
}

/**
 * Inverso de `formatearMonto`, para texto tipeado por el usuario.
 * @param texto texto a interpretar (formato es-UY: miles con punto, decimales con coma)
 * @returns el número, o null si no se puede interpretar
 */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.trim().replace(/[$\s\u00a0]/g, "");
  if (!limpio) return null;

  let normalizado: string;
  if (limpio.includes(",")) {
    normalizado = limpio.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = limpio.split(".");
    normalizado =
      partes.length > 2 || (partes.length === 2 && partes[1].length === 3)
        ? partes.join("")
        : limpio;
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function desdeISO(fechaISO: string) {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

/**
 * Si el texto es una fecha `aaaa-mm-dd` que existe en el calendario. El
 * formato solo no alcanza: `2026-02-31` lo cumple, y guardada así ordena y
 * filtra como una fecha que nunca ocurrió.
 */
export function esFechaISOValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [anio, mes, dia] = texto.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

export function formatearFechaCorta(fechaISO: string) {
  const [, mes, dia] = fechaISO.split("-");
  return `${dia} ${MESES_CORTOS[Number(mes) - 1]}`;
}

export function formatearFechaLarga(fecha: string | Date) {
  const d = typeof fecha === "string" ? desdeISO(fecha) : fecha;
  return d.toLocaleDateString("es-UY", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function nombreMes(fecha: Date = new Date()) {
  return fecha.toLocaleDateString("es-UY", { month: "long" });
}

export function aISO(fecha: Date) {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

export function hoyISO() {
  return aISO(new Date());
}

/**
 * @returns el período del primer día del mes hasta hoy, en fechas ISO.
 */
export function mesEnCurso(hoy: Date = new Date()) {
  return {
    desde: aISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: aISO(hoy),
  };
}
