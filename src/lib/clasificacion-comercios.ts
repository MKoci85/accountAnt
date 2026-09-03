export type RubroDirecto = "combustible" | "telepeaje" | "suscripcion";

export type ClasificacionDirecta = {
  rubro: RubroDirecto;
  emisor: string;
  categoria: string;
};

const MARCAS_COMBUSTIBLE = [
  "ANCAP",
  "DUCSA",
  "AXION",
  "ESSO",
  "DISA",
  "PETROBRAS",
];

function contieneMarca(texto: string, patron: string) {
  return new RegExp(`(?<![A-Z])${patron}(?![A-Z])`).test(texto);
}

const SUSCRIPCIONES_CONOCIDAS: { patron: string; emisor: string }[] = [
  { patron: "APPLE.COM/BILL", emisor: "Apple" },
  { patron: "APPLE.COM", emisor: "Apple" },
  { patron: "ANTHROPIC", emisor: "Anthropic" },
  { patron: "OPENAI", emisor: "OpenAI" },
  { patron: "GOOGLE", emisor: "Google" },
  { patron: "SPOTIFY", emisor: "Spotify" },
  { patron: "NETFLIX", emisor: "Netflix" },
  { patron: "AMAZON", emisor: "Amazon" },
  { patron: "MICROSOFT", emisor: "Microsoft" },
  { patron: "GITHUB", emisor: "GitHub" },
];

export const CATEGORIA_COMBUSTIBLE = "Transporte";
export const CATEGORIA_TELEPEAJE = "Transporte";
export const CATEGORIA_SUSCRIPCION = "Suscripciones";

function normalizar(texto: string) {
  return texto
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Clasifica una línea de estado de cuenta en un rubro directo.
 * @param descripcion descripción de la línea tal como viene del estado de cuenta
 * @param esUSD si el importe está en dólares
 * @returns la clasificación, o null si va por la vía de cotejo contra gastos existentes
 */
export function clasificarLinea(
  descripcion: string,
  esUSD: boolean
): ClasificacionDirecta | null {
  const texto = normalizar(descripcion);

  if (MARCAS_COMBUSTIBLE.some((marca) => contieneMarca(texto, marca))) {
    return {
      rubro: "combustible",
      emisor: descripcion.trim(),
      categoria: CATEGORIA_COMBUSTIBLE,
    };
  }

  if (/\bCVU\b/.test(texto) || texto.includes("TELEPEAJE")) {
    return { rubro: "telepeaje", emisor: "CVU", categoria: CATEGORIA_TELEPEAJE };
  }

  const conocida = SUSCRIPCIONES_CONOCIDAS.find((s) => texto.includes(s.patron));
  if (conocida) {
    return {
      rubro: "suscripcion",
      emisor: conocida.emisor,
      categoria: CATEGORIA_SUSCRIPCION,
    };
  }

  if (esUSD) {
    return {
      rubro: "suscripcion",
      emisor: descripcion.split("*")[0].trim() || descripcion.trim(),
      categoria: CATEGORIA_SUSCRIPCION,
    };
  }

  return null;
}

const CATEGORIA_POR_COMERCIO: { patrones: string[]; categoria: string }[] = [
  {
    patrones: ["SUPERMERCADO", "TIENDA INGLESA", "DISCO", "DEVOTO", "TATA", "MACRO", "FROG", "ESTEFAN"],
    categoria: "Almacén",
  },
  {
    patrones: ["FARMACIA", "SERVICIO MEDICO", "MUTUALISTA", "SANATORIO", "MEDICA", "SALUD", "FARMASHOP", "SMI"],
    categoria: "Salud",
  },
  {
    patrones: ["RESTAURANT", "PIZZA", "BURGER", "CAFE", "BAR ", "PEDIDOSYA", "RAPPI", "MCDONALD"],
    categoria: "Comida fuera de casa",
  },
  { patrones: ["CINE", "TEATRO", "LIBRERIA"], categoria: "Ocio" },
  { patrones: ["UBER", "CABIFY", "TAXI", "CUTCSA", "STM"], categoria: "Transporte" },
];

export const CATEGORIA_FALLBACK = "Almacén";

export const ITEM_PAGO_TARJETA = "Pago con tarjeta";

export function sugerirCategoriaComercio(descripcion: string): string {
  const texto = normalizar(descripcion);
  for (const { patrones, categoria } of CATEGORIA_POR_COMERCIO) {
    if (patrones.some((p) => texto.includes(p))) return categoria;
  }
  return CATEGORIA_FALLBACK;
}
