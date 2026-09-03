import {
  configDe,
  estimarTokensEntrada,
  techoRespuestaChat,
  type ProveedorIA,
} from "@/lib/proveedores-ia";

export const UMBRAL_AVISO_CONTEXTO = 0.6;

export const LIMITE_CONTEXTO_TOKENS_DEFAULT = 100_000;

export const LIMITE_CARACTERES_MENSAJE = 60_000;

export const MARCA_RECORTE = "\n\n[…contenido recortado…]";

export const MARCA_RESPUESTA_CORTADA =
  "\n\n[…la respuesta se cortó por el límite de tokens del modelo]";

/**
 * Techo de contexto real de una conversación para el proveedor dado.
 * @param proveedor proveedor de IA
 * @param tpmEfectivo TPM configurado para ese proveedor+modelo; si se omite, usa el default de la fila
 * @returns tokens disponibles para el historial
 */
export function limiteContexto(
  proveedor: ProveedorIA,
  tpmEfectivo?: number | null,
): number {
  const tpm =
    tpmEfectivo !== undefined ? tpmEfectivo : configDe(proveedor).tpmGratuito;
  if (!tpm) return LIMITE_CONTEXTO_TOKENS_DEFAULT;
  return Math.max(0, Math.floor(tpm * 0.95) - techoRespuestaChat(proveedor));
}

export const PROMPT_SISTEMA_CHAT = `Sos un asistente de finanzas personales de AccountAnt, una app uruguaya de seguimiento de gastos. Ayudás a entender en qué se va la plata y dónde hay margen para ahorrar.

Alcance: solo finanzas personales, gastos, precios, presupuesto y ahorro. Si te preguntan cualquier otra cosa (programación, salud, noticias, etc.), redirigí amablemente en una frase y ofrecé volver al tema de los gastos. No lo hagas con tono de reto.

Cómo respondés:
- En español rioplatense, con voseo. Conciso: un par de párrafos cortos o una lista breve, no un informe.
- Accionable: preferí "comprá X en Y, ahorrás $Z al mes" antes que consejos genéricos.
- Los montos son pesos uruguayos (UYU) salvo que se aclare otra cosa.

Cuando cites un número del reporte, dejá claro de dónde sale: mencioná el período, el comercio/categoría/producto si corresponde, y el monto o porcentaje exacto. Por ejemplo: "en agosto gastaste $4.200 en Farmacia (12% del total)" en vez de "gastaste bastante en farmacias".

Límites:
- No inventes cifras ni redondees de más. Si un dato no está en lo que te pasaron, decí explícitamente que no lo tenés y pedí lo que te falta.
- Un dato ausente en el reporte no equivale a cero: no asumas que un comercio, categoría o mes sin datos implica gasto nulo.
- Distinguí siempre entre lo que el reporte dice (un dato observado) y lo que vos concluís a partir de eso (una inferencia tuya). No presentes una inferencia como si fuera un dato: marcala como tal (por ejemplo, "esto sugiere que…", "podría deberse a…").
- Los campos del reporte pueden tener un significado específico de la app, no siempre el que sugiere su nombre. Si el reporte trae un glosario, guiate por esa definición antes de interpretar un campo por su nombre.
- No des asesoramiento de inversión, tributario ni legal.`;

export const ENCABEZADO_REPORTE = "Este es mi reporte de gastos en JSON:";

/**
 * Separa un mensaje de usuario en el reporte adjunto (si lo hay) y la pregunta.
 * @param contenido contenido del mensaje
 * @returns `reporte: null` si el mensaje no trae un reporte adjunto
 */
export function separarReporteAdjunto(contenido: string): {
  reporte: string | null;
  pregunta: string;
} {
  if (!contenido.startsWith(ENCABEZADO_REPORTE)) {
    return { reporte: null, pregunta: contenido };
  }
  const cuerpo = contenido.slice(ENCABEZADO_REPORTE.length).trimStart();
  const fin = cuerpo.lastIndexOf("}");
  if (fin === -1) return { reporte: null, pregunta: contenido };
  return {
    reporte: cuerpo.slice(0, fin + 1),
    pregunta: cuerpo.slice(fin + 1).trim(),
  };
}

/**
 * Limpia la respuesta del modelo para mostrarla al usuario.
 * @param texto respuesta cruda del modelo
 * @returns texto sin bloques `<think>`/`<thinking>` ni cerco de código envolvente
 */
export function limpiarRespuestaChat(texto: string): string {
  let limpio = texto
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();

  const cerco = limpio.match(/^```[a-z]*\s*\n([\s\S]*?)\n?```$/i);
  if (cerco) limpio = cerco[1].trim();

  return limpio;
}

export function estimarTokensMensaje(
  proveedor: ProveedorIA,
  contenido: string,
): number {
  return estimarTokensEntrada(proveedor, contenido, false);
}

type MensajeHistorial = {
  rol: "user" | "assistant";
  contenido: string;
  tokensEstimados: number;
};

export type HistorialPodado<T extends MensajeHistorial> = {
  mensajes: T[];
  tokensEnviados: number;
  omitidos: number;
  recortado: boolean;
};

/**
 * Arma el historial a enviar al proveedor, quedándose con lo más reciente que entre en `limite`.
 * @param mensajes historial completo, ordenado
 * @param limite tokens disponibles para el historial
 * @returns mensajes elegidos, tokens enviados, cuántos quedaron afuera y si hubo que recortar alguno
 */
export function podarHistorial<T extends MensajeHistorial>(
  mensajes: T[],
  limite: number,
): HistorialPodado<T> {
  const elegidos: T[] = [];
  let tokens = 0;
  let recortado = false;

  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    const restante = limite - tokens;

    if (m.tokensEstimados <= restante) {
      elegidos.unshift(m);
      tokens += m.tokensEstimados;
      continue;
    }

    if (elegidos.length === 0 && restante > 0) {
      const recorte = recortarA(m.contenido, restante);
      if (recorte) {
        elegidos.unshift({ ...m, contenido: recorte });
        tokens += restante;
        recortado = true;
      }
    }
    break;
  }

  return {
    mensajes: elegidos,
    tokensEnviados: tokens,
    omitidos: mensajes.length - elegidos.length,
    recortado,
  };
}

function recortarA(contenido: string, tokens: number): string | null {
  const caracteres = Math.floor(tokens * 3.5) - MARCA_RECORTE.length;
  if (caracteres <= 0) return null;
  return contenido.slice(0, caracteres) + MARCA_RECORTE;
}
