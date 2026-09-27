import { parsearTamano } from "@/lib/precios-referencia";

/**
 * Qué trae un envase: cuántas piezas y, si se sabe, cuánto pesa o mide cada
 * una. "6 x 330ml" es `{ unidades: 6, contenido: 0.33 L }`; "x12" y "12 un"
 * son el mismo `{ unidades: 12, contenido: null }`; "1.5L" es una pieza de
 * 1,5 L. Existe para comparar ítems del catálogo, no para cargar líneas:
 * `parsearTamano` sigue siendo el que decide cantidad y unidad de un ticket.
 */
export type Presentacion = {
  unidades: number;
  contenido: { cantidad: number; unidad: "kg" | "L" } | null;
};

const PALABRAS_UNIDAD =
  "un|u|und|unid|unids|unidad|unidades|uds|pack|packs|pzs|pz|piezas|sobres|rollos|fetas|bolsitas|capsulas|saquitos";
const PALABRAS_ENVASE = "pack|paquete|paq|caja|bolsa|blister|display";
const PALABRAS_VACIAS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "e",
  "en",
  "para",
  "a",
  "al",
  "x",
]);

const PALABRAS_VARIANTE = new Set([
  "sin",
  "light",
  "diet",
  "zero",
  "integral",
  "entera",
  "descremada",
  "semidescremada",
  "deslactosada",
]);

const RE_CONTENIDO =
  /(?<![a-wyz0-9.,])(\d+(?:[.,]\d+)?|[.,]\d+)\s*(kgs|kg|k|grs|gr|g|lts|lt|l|ml|cc)(?![a-z0-9])/g;
const RE_UNIDADES_PALABRA = new RegExp(
  `(?<![a-z0-9.,])(\\d+)\\s*(?:${PALABRAS_UNIDAD})(?![a-z0-9])`
);
const RE_ENVASE = new RegExp(
  `(?<![a-z0-9])(?:${PALABRAS_ENVASE})\\s*(?:de\\s*)?(?:x\\s*)?(\\d+)(?![a-z0-9.,])`
);
const RE_X_ANTES = /(?<![a-z0-9])x\s*(\d+)(?![a-z0-9.,])/;
const RE_X_DESPUES = /(?<![a-z0-9.,])(\d+)\s*x(?![a-z0-9])/;

/**
 * Minúsculas, sin tildes, con todo lo que no sea letra, dígito, punto o coma
 * convertido en espacio. Punto y coma sobreviven porque son el separador
 * decimal de "1,5 LT".
 */
export function normalizarTextoComparable(texto: string | null | undefined) {
  if (!texto) return "";
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.,]+/g, " ")
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Saca de un texto los fragmentos que describen la presentación ("1,5 LT",
 * "x12", "6 x 330ml", "pack 6", "docena") y devuelve por separado lo que
 * queda. Sirve tanto para el campo tamaño como para un nombre que trae el
 * tamaño adentro ("COCA COLA 1,5 LT RET"), que es como llegan los ítems
 * creados desde un ticket.
 * @param numeroSueltoEsUnidades si un número sin nada al lado cuenta como
 * cantidad de piezas: sí en el campo tamaño ("6"), no en un nombre ("7 UP").
 */
export function separarPresentacion(
  texto: string | null | undefined,
  numeroSueltoEsUnidades = false
): { presentacion: Presentacion | null; resto: string } {
  let resto = ` ${normalizarTextoComparable(texto)} `;
  let contenido: Presentacion["contenido"] = null;
  let unidades: number | null = null;

  resto = resto.replace(RE_CONTENIDO, (fragmento) => {
    const parseado = parsearTamano(fragmento.replace(/\s+/g, ""));
    if (parseado && parseado.unidad !== "un" && !contenido) {
      contenido = { cantidad: parseado.cantidad, unidad: parseado.unidad };
    }
    return " ";
  });

  if (/(?<![a-z])media docena(?![a-z])/.test(resto)) {
    unidades = 6;
    resto = resto.replace(/media docena/, " ");
  } else if (/(?<![a-z])docena(?![a-z])/.test(resto)) {
    unidades = 12;
    resto = resto.replace(/docena/, " ");
  }

  for (const patron of [RE_ENVASE, RE_UNIDADES_PALABRA, RE_X_ANTES, RE_X_DESPUES]) {
    if (unidades !== null) break;
    const encontrado = resto.match(patron);
    if (!encontrado) continue;
    const valor = Number(encontrado[1]);
    if (valor > 0) unidades = valor;
    resto = resto.replace(encontrado[0], " ");
  }

  resto = resto.replace(/\s+/g, " ").trim();

  if (unidades === null && numeroSueltoEsUnidades && /^\d+$/.test(resto)) {
    const valor = Number(resto);
    if (valor > 0) {
      unidades = valor;
      resto = "";
    }
  }

  if (unidades === null && contenido === null) {
    return { presentacion: null, resto };
  }
  return { presentacion: { unidades: unidades ?? 1, contenido }, resto };
}

/**
 * @returns la presentación del campo tamaño, o null si no dice nada
 * reconocible ("grande", "familiar").
 */
export function parsearPresentacion(tamano: string | null | undefined) {
  return separarPresentacion(tamano, true).presentacion;
}

export function clavePresentacion(p: Presentacion) {
  if (!p.contenido) return `${p.unidades}`;
  const cantidad = Number(p.contenido.cantidad.toFixed(4));
  return `${p.unidades}x${cantidad}${p.contenido.unidad}`;
}

/**
 * Texto legible de una presentación ya interpretada, para mostrarle al
 * usuario cómo se entendió lo que escribió en el campo tamaño.
 */
export function describirPresentacion(p: Presentacion) {
  const piezas = `${p.unidades} ${p.unidades === 1 ? "unidad" : "unidades"}`;
  if (!p.contenido) return piezas;
  const { cantidad, unidad } = p.contenido;
  const medida =
    cantidad < 1
      ? `${Number((cantidad * 1000).toFixed(1)).toLocaleString("es-UY")} ${unidad === "kg" ? "g" : "ml"}`
      : `${Number(cantidad.toFixed(3)).toLocaleString("es-UY")} ${unidad}`;
  return p.unidades === 1 ? medida : `${piezas} de ${medida}`;
}

function bigramas(texto: string) {
  const lista: string[] = [];
  for (let i = 0; i < texto.length - 1; i++) lista.push(texto.slice(i, i + 2));
  return lista;
}

/**
 * Coeficiente de Dice sobre bigramas de caracteres: 1 si son iguales, cerca
 * de 1 si difieren en un error de tipeo ("galletas" / "galletitas").
 */
export function similitudTexto(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const deA = bigramas(a);
  const restantes = new Map<string, number>();
  for (const bigrama of bigramas(b)) {
    restantes.set(bigrama, (restantes.get(bigrama) ?? 0) + 1);
  }
  let comunes = 0;
  for (const bigrama of deA) {
    const disponibles = restantes.get(bigrama) ?? 0;
    if (disponibles > 0) {
      comunes += 1;
      restantes.set(bigrama, disponibles - 1);
    }
  }
  return (2 * comunes) / (deA.length + b.length - 1);
}

function tokensEquivalentes(a: string, b: string) {
  if (a === b) return true;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.length >= 4 && largo.startsWith(corto)) return true;
  return similitudTexto(a, b) >= 0.8;
}

function coincidenciasDeTokens(a: string[], b: string[]) {
  const libres = [...b];
  let coincidencias = 0;
  for (const token of a) {
    const indice = libres.findIndex((otro) => tokensEquivalentes(token, otro));
    if (indice === -1) continue;
    coincidencias += 1;
    libres.splice(indice, 1);
  }
  return coincidencias;
}

/**
 * Decide si dos textos (ya normalizados y partidos en palabras) nombran lo
 * mismo. Tolera abreviaturas de ticket ("desc" / "descremada"), errores de
 * tipeo, palabras pegadas ("cocacola") y que uno sea el otro con alguna
 * palabra de menos (mejor ofrecerlo y que el usuario lo descarte que no
 * mostrarlo nunca). Dos
 * excepciones: una sola palabra contenida en otro nombre más largo no alcanza
 * ("arroz" / "arroz integral"), y una palabra de variante presente en uno
 * solo ("sin sal", "zero", "light") los separa siempre.
 */
export function nombresParecidos(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return false;
  const varianteHuerfana = (propias: string[], otras: string[]) =>
    propias.some(
      (p) =>
        PALABRAS_VARIANTE.has(p) && !otras.some((o) => tokensEquivalentes(p, o))
    );
  if (varianteHuerfana(a, b) || varianteHuerfana(b, a)) return false;
  if (similitudTexto(a.join(""), b.join("")) >= 0.9) return true;
  const coincidencias = coincidenciasDeTokens(a, b);
  if ((2 * coincidencias) / (a.length + b.length) >= 0.8) return true;
  const menor = Math.min(a.length, b.length);
  return menor >= 2 && coincidencias === menor;
}

function palabras(texto: string) {
  return texto.split(" ").filter((p) => p && !PALABRAS_VACIAS.has(p));
}

export type ItemComparable = {
  id: number;
  nombre: string;
  marca: string | null;
  tamano: string | null;
};

type Firma = {
  id: number;
  palabras: string[];
  marca: string[];
  presentacion: Presentacion | null;
  tamanoLibre: string;
};

function firmaDe(item: ItemComparable): Firma {
  const nombre = separarPresentacion(item.nombre);
  const tamano = separarPresentacion(item.tamano, true);
  const marca = palabras(normalizarTextoComparable(item.marca));
  const delNombre = palabras(nombre.resto);
  return {
    id: item.id,
    palabras: [...delNombre, ...marca.filter((m) => !delNombre.includes(m))],
    marca,
    presentacion: tamano.presentacion ?? nombre.presentacion,
    tamanoLibre: tamano.presentacion ? "" : tamano.resto,
  };
}

function presentacionesCompatibles(a: Firma, b: Firma) {
  if (a.presentacion && b.presentacion) {
    return clavePresentacion(a.presentacion) === clavePresentacion(b.presentacion);
  }
  if (a.presentacion || b.presentacion) return true;
  if (a.tamanoLibre && b.tamanoLibre) return a.tamanoLibre === b.tamanoLibre;
  return true;
}

function marcasCompatibles(a: Firma, b: Firma) {
  if (a.marca.length === 0 || b.marca.length === 0) return true;
  return nombresParecidos(a.marca, b.marca);
}

/**
 * @returns true si los dos ítems parecen ser el mismo producto cargado dos
 * veces. Tres condiciones, todas necesarias: nombre (con la marca sumada, que
 * a veces está en el nombre y a veces en su campo) parecido, marcas que no se
 * contradicen y presentaciones iguales. Que a uno le falte la marca o el
 * tamaño no los separa: completar sólo uno de los dos es justamente el error
 * típico de cargar un duplicado.
 */
export function sonItemsSimilares(a: ItemComparable, b: ItemComparable) {
  return firmasSimilares(firmaDe(a), firmaDe(b));
}

function firmasSimilares(a: Firma, b: Firma) {
  return (
    marcasCompatibles(a, b) &&
    presentacionesCompatibles(a, b) &&
    nombresParecidos(a.palabras, b.palabras)
  );
}

/**
 * Clave de identidad de un ítem: dos ítems con la misma clave son el mismo
 * producto escrito igual, y no se permite crear el segundo. Ignora
 * mayúsculas, tildes, puntuación y espacios, y compara el tamaño por su
 * presentación cuando se entiende ("1.5L" = "1,5 LT" = "1500 ml"). Existe
 * aparte de `sonItemsSimilares` porque esto bloquea, y un bloqueo sólo puede
 * basarse en una igualdad sin margen de duda.
 */
export function claveItemExacta(item: Omit<ItemComparable, "id">) {
  const presentacion = parsearPresentacion(item.tamano);
  return [
    normalizarTextoComparable(item.nombre),
    normalizarTextoComparable(item.marca),
    presentacion
      ? clavePresentacion(presentacion)
      : normalizarTextoComparable(item.tamano),
  ].join("|");
}

/**
 * Clave de un par descartado, independiente del orden: "3|7" para (7, 3).
 */
export function clavePar(a: number, b: number) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * @returns todos los pares (menor, mayor) que se pueden formar con los ids.
 */
export function paresDe(ids: number[]): [number, number][] {
  const unicos = [...new Set(ids)].sort((x, y) => x - y);
  const pares: [number, number][] = [];
  for (let i = 0; i < unicos.length; i++) {
    for (let j = i + 1; j < unicos.length; j++) pares.push([unicos[i], unicos[j]]);
  }
  return pares;
}

/**
 * Traslada al que se conserva los pares descartados de los que se absorben al
 * combinar, para no volver a ofrecer una combinación ya rechazada. Un par
 * entre dos de los que se combinan deja de tener sentido y se pierde.
 * @param descartes pares (menor, mayor) donde aparece alguno de los absorbidos
 * @returns los pares (menor, mayor) que pasan a ser del conservado, sin repetir
 */
export function paresHeredados(
  descartes: [number, number][],
  absorbidos: number[],
  conservado: number
): [number, number][] {
  const heredados = new Map<string, [number, number]>();
  for (const [menor, mayor] of descartes) {
    const absorbeMenor = absorbidos.includes(menor);
    if (!absorbeMenor && !absorbidos.includes(mayor)) continue;
    const otro = absorbeMenor ? mayor : menor;
    if (otro === conservado || absorbidos.includes(otro)) continue;
    heredados.set(clavePar(conservado, otro), [
      Math.min(conservado, otro),
      Math.max(conservado, otro),
    ]);
  }
  return [...heredados.values()];
}

function agruparPares(pares: [number, number][]) {
  const padre = new Map<number, number>();
  const raiz = (id: number): number => {
    const p = padre.get(id) ?? id;
    if (p === id) return id;
    const r = raiz(p);
    padre.set(id, r);
    return r;
  };
  for (const [a, b] of pares) {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) padre.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  const grupos = new Map<number, number[]>();
  for (const id of new Set(pares.flat())) {
    const r = raiz(id);
    grupos.set(r, [...(grupos.get(r) ?? []), id]);
  }
  return [...grupos.values()].map((g) => g.sort((x, y) => x - y));
}

/**
 * Agrupa los ítems del catálogo que parecen duplicados entre sí. Un grupo es
 * transitivo: si A se parece a B y B a C, los tres van juntos aunque A y C no
 * se parezcan directamente — el usuario elige después cuáles combinar.
 * Sólo se comparan pares que comparten el comienzo de alguna palabra, para no
 * hacer n² comparaciones de texto con un catálogo de miles de ítems.
 * @param descartados claves (`clavePar`) de pares que el usuario ya dijo que
 * no son el mismo producto.
 * @returns grupos de ids (cada uno ordenado), sin los pares descartados.
 */
export function agruparItemsSimilares(
  items: ItemComparable[],
  descartados: Set<string>
): number[][] {
  const firmas = items.map(firmaDe);
  const porId = new Map(firmas.map((f) => [f.id, f]));
  const indice = new Map<string, number[]>();
  for (const firma of firmas) {
    for (const prefijo of new Set(firma.palabras.map((p) => p.slice(0, 3)))) {
      indice.set(prefijo, [...(indice.get(prefijo) ?? []), firma.id]);
    }
  }

  const evaluados = new Set<string>();
  const similares: [number, number][] = [];
  for (const ids of indice.values()) {
    for (const [a, b] of paresDe(ids)) {
      const clave = clavePar(a, b);
      if (evaluados.has(clave)) continue;
      evaluados.add(clave);
      if (descartados.has(clave)) continue;
      if (firmasSimilares(porId.get(a)!, porId.get(b)!)) similares.push([a, b]);
    }
  }
  return agruparPares(similares);
}

export type GastoComparable = {
  id: number;
  emisorId: number;
  emisorGenerico: boolean;
  fecha: string;
  sinComprobante: boolean;
};

/**
 * Agrupa los gastos que `combinarGastos` aceptaría juntar: mismo comercio,
 * misma fecha y no más de uno con comprobante propio. El comercio genérico
 * ("Varios") queda afuera: dos compras sueltas del mismo día ahí son, casi
 * siempre, dos compras distintas.
 * @param descartados claves (`clavePar`) de pares que el usuario ya dijo que
 * no son el mismo gasto.
 */
export function agruparGastosCombinables(
  gastos: GastoComparable[],
  descartados: Set<string>
): number[][] {
  const porClave = new Map<string, GastoComparable[]>();
  for (const gasto of gastos) {
    if (gasto.emisorGenerico) continue;
    const clave = `${gasto.emisorId}|${gasto.fecha}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), gasto]);
  }

  const combinables: [number, number][] = [];
  for (const grupo of porClave.values()) {
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const [a, b] = [grupo[i], grupo[j]];
        if (!a.sinComprobante && !b.sinComprobante) continue;
        if (descartados.has(clavePar(a.id, b.id))) continue;
        combinables.push([a.id, b.id]);
      }
    }
  }
  return agruparPares(combinables);
}
