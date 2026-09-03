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
