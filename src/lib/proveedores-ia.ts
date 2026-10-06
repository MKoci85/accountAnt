export type ProveedorIA =
  "anthropic" | "gemini" | "openai" | "groq" | "openrouter";

type FormatoIA = "anthropic" | "gemini" | "openai-compatible";

type ModeloCatalogo = {
  id?: unknown;
  pricing?: { prompt?: unknown };
  architecture?: { output_modalities?: unknown };
};

type ModeloGemini = {
  name?: unknown;
  supportedGenerationMethods?: unknown;
};

function filasDe<T>(json: unknown, campo: string): T[] | null {
  if (!json || typeof json !== "object") return null;
  const filas = (json as Record<string, unknown>)[campo];
  return Array.isArray(filas) ? (filas as T[]) : null;
}

function soloIds(ids: unknown[]): string[] {
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Modelos gratuitos de chat del listado público de OpenRouter.
 * @param json respuesta de `/models`.
 * @returns ids de los modelos gratuitos que sólo emiten texto, o `null` si el formato no es el esperado.
 */
export function modelosGratuitosOpenRouter(json: unknown): string[] | null {
  const filas = filasDe<ModeloCatalogo>(json, "data");
  if (!filas) return null;
  return soloIds(
    filas
      .filter((m) => {
        if (m?.pricing?.prompt !== "0") return false;
        const salidas = m.architecture?.output_modalities;
        if (!Array.isArray(salidas)) return true;
        return salidas.length === 1 && salidas[0] === "text";
      })
      .map((m) => m.id),
  );
}

const GEMINI_NO_CONVERSACIONAL =
  /tts|image|audio|live|embedding|robotics|computer-use|transcribe/;

/**
 * Modelos de Gemini que sirven para leer texto e imágenes, del listado de la API.
 * @param json respuesta de `/models`.
 * @returns ids sin el prefijo `models/`, o `null` si el formato no es el esperado.
 */
export function modelosDeGemini(json: unknown): string[] | null {
  const filas = filasDe<ModeloGemini>(json, "models");
  if (!filas) return null;
  return soloIds(
    filas
      .filter(
        (m) =>
          Array.isArray(m?.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes("generateContent"),
      )
      .map((m) =>
        typeof m.name === "string" ? m.name.replace(/^models\//, "") : "",
      ),
  ).filter(
    (id) => id.startsWith("gemini-") && !GEMINI_NO_CONVERSACIONAL.test(id),
  );
}

/**
 * Separa la lista de modelos de respaldo que el usuario escribe en Ajustes.
 * @param texto ids separados por coma, espacio o salto de línea.
 * @returns los ids, sin repetidos y en el orden escrito.
 */
export function parsearModelosRespaldo(texto: string): string[] {
  return [...new Set(texto.split(/[\s,;]+/).filter(Boolean))];
}

/**
 * Orden en que se prueban los modelos de una lectura.
 * @param principal modelo configurado.
 * @param respaldos modelos a los que saltar si el principal no está disponible.
 * @returns el principal seguido de los respaldos, sin repetidos.
 */
export function cadenaDeModelos(
  principal: string,
  respaldos: string[],
): string[] {
  return [...new Set([principal, ...respaldos])];
}

/**
 * Respaldos que efectivamente quedan cuando uno de ellos pasa a ser el modelo principal.
 * @param principal modelo configurado.
 * @param respaldos lista guardada o por defecto.
 * @returns los respaldos sin el principal ni repetidos, en el mismo orden.
 */
export function respaldosSinPrincipal(
  principal: string,
  respaldos: string[],
): string[] {
  return cadenaDeModelos(principal, respaldos).slice(1);
}

/**
 * Orden en que conviene probar el catálogo para cubrir un respaldo que quedó vacante.
 * @param catalogo ids sugeridos del proveedor.
 * @param referencia modelo que ocupaba el lugar a cubrir.
 * @param excluidos modelos que no pueden ocuparlo (el principal, los respaldos que quedan, los ya descartados).
 * @returns los candidatos, primero los que más partes del nombre comparten con la referencia.
 */
export function candidatosDeRespaldo(
  catalogo: string[],
  referencia: string,
  excluidos: string[],
): string[] {
  const partes = (modelo: string) =>
    modelo.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const deReferencia = new Set(partes(referencia));
  const parecido = (modelo: string) =>
    partes(modelo).filter((p) => deReferencia.has(p)).length;

  return [...new Set(catalogo)]
    .filter((m) => !excluidos.includes(m))
    .sort((a, b) => parecido(b) - parecido(a));
}

/**
 * Si el fallo es del modelo y no del pedido: saturado o caído (5xx), o retirado (404).
 * @param status código HTTP del proveedor; `undefined` si no llegó a responder.
 * @returns si vale la pena repetir el pedido con otro modelo.
 */
export function convieneOtroModelo(status: number | undefined): boolean {
  return status !== undefined && (status >= 500 || status === 404);
}

export type ConfigProveedor = {
  id: ProveedorIA;
  nombre: string;
  modelo: string;
  formato: FormatoIA;
  baseUrl?: string;
  headersExtra?: Record<string, string>;
  refererConfigurable?: boolean;
  campoMaxTokens?: "max_tokens" | "max_completion_tokens";
  tpmGratuito?: number;
  rpmGratuito?: number;
  rpdGratuito?: number;
  tokensPorImagen?: number;
  maxTokensChat?: number;
  nivelRazonamiento?: "minimal" | "low" | "medium" | "high";
  soportaCache?: boolean;
  avisoChat?: string;
  avisoPrivacidad?: string;
  modelosRespaldo?: string[];
  catalogo?: {
    url: string;
    urlListado: string;
    headerApiKey?: string;
    calificativo: "gratuito" | "disponible";
    modelos: (json: unknown) => string[] | null;
  };
  urlKeys?: string;
};

export const PROVEEDORES: ConfigProveedor[] = [
  {
    id: "anthropic",
    nombre: "Anthropic (Claude)",
    modelo: "claude-haiku-4-5",
    formato: "anthropic",
    baseUrl: "https://api.anthropic.com/v1/messages",
    soportaCache: true,
    urlKeys: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "gemini",
    nombre: "Google (Gemini)",
    modelo: "gemini-3.6-flash",
    formato: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    rpmGratuito: 10,
    rpdGratuito: 250,
    tpmGratuito: 250_000,
    maxTokensChat: 4096,
    nivelRazonamiento: "low",
    modelosRespaldo: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    catalogo: {
      url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      urlListado: "https://ai.google.dev/gemini-api/docs/models",
      headerApiKey: "x-goog-api-key",
      calificativo: "disponible",
      modelos: modelosDeGemini,
    },
    avisoPrivacidad:
      "En el free tier de Gemini, Google usa el contenido para entrenar y revisores humanos pueden leerlo. Para un estado de cuenta conviene un proveedor de tier pago.",
    avisoChat:
      "Free tier: 250 mensajes por día. El contenido puede usarse para entrenar (ver aviso de privacidad).",
    urlKeys: "https://aistudio.google.com/apikey",
  },
  {
    id: "openai",
    nombre: "OpenAI",
    modelo: "gpt-4o-mini",
    formato: "openai-compatible",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    campoMaxTokens: "max_completion_tokens",
    urlKeys: "https://platform.openai.com/api-keys",
  },
  {
    id: "groq",
    nombre: "Groq",
    modelo: "qwen/qwen3.6-27b",
    formato: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    tpmGratuito: 8000,
    rpmGratuito: 30,
    rpdGratuito: 1000,
    tokensPorImagen: 2048,
    avisoChat:
      "El límite de 8.000 tokens por minuto de Groq no alcanza para conversar con un reporte adjunto. Sirve para consultas cortas. Varía por modelo: si el tuyo admite más, el techo real es mayor que el que muestra la app.",
    urlKeys: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    nombre: "OpenRouter",
    modelo: "google/gemma-4-31b-it:free",
    formato: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    headersExtra: { "X-Title": "control-gastos" },
    refererConfigurable: true,
    rpmGratuito: 20,
    rpdGratuito: 50,
    avisoPrivacidad:
      "Los modelos gratuitos (:free) de OpenRouter pueden enrutarse a proveedores que entrenan con el contenido. Se desactiva en la cuenta de OpenRouter (Settings → Privacy).",
    avisoChat:
      "Los modelos :free permiten 50 mensajes por día (1.000 si comprás US$10 de créditos por única vez). El catálogo gratuito rota seguido: si el modelo deja de existir vas a ver un error 404.",
    catalogo: {
      url: "https://openrouter.ai/api/v1/models",
      urlListado: "https://openrouter.ai/models?max_price=0",
      calificativo: "gratuito",
      modelos: modelosGratuitosOpenRouter,
    },
    urlKeys: "https://openrouter.ai/keys",
  },
];

export const PROVEEDOR_POR_DEFECTO: ProveedorIA = "anthropic";

export const MAX_TOKENS_RESPUESTA = 8192;
export const MIN_TOKENS_RESPUESTA = 2000;

export const MAX_TOKENS_RESPUESTA_CHAT = 1024;
export const MIN_TOKENS_RESPUESTA_CHAT = 300;

/**
 * Techo de respuesta del chat para un proveedor.
 * @param proveedor proveedor de IA activo.
 * @returns máximo de tokens de salida a pedir.
 */
export function techoRespuestaChat(proveedor: ProveedorIA): number {
  return configDe(proveedor).maxTokensChat ?? MAX_TOKENS_RESPUESTA_CHAT;
}

/**
 * Cuánto se puede pedir de respuesta sin pasarse de la cuota por minuto.
 * @param proveedor proveedor de IA activo.
 * @param tokensEntrada tokens estimados de la entrada.
 * @param limites techo y piso de tokens de respuesta a considerar.
 * @param tpmEfectivo TPM configurado a usar en vez del default del proveedor; `null` = sin límite conocido.
 * @returns tokens de respuesta a pedir, o `null` si no entra ni pidiendo el mínimo útil.
 */
export function presupuestoRespuesta(
  proveedor: ProveedorIA,
  tokensEntrada: number,
  limites: { techo: number; piso: number } = {
    techo: MAX_TOKENS_RESPUESTA,
    piso: MIN_TOKENS_RESPUESTA,
  },
  tpmEfectivo?: number | null,
): number | null {
  const tpm =
    tpmEfectivo !== undefined ? tpmEfectivo : configDe(proveedor).tpmGratuito;
  if (!tpm) return limites.techo;

  const disponible = Math.floor(tpm * 0.95) - tokensEntrada;
  if (disponible < limites.piso) return null;
  return Math.min(limites.techo, disponible);
}

/**
 * Estima los tokens de entrada de un mensaje.
 * @param proveedor proveedor de IA activo.
 * @param texto contenido a enviar.
 * @param conImagen si el mensaje incluye una imagen.
 * @returns tokens de entrada estimados.
 */
export function estimarTokensEntrada(
  proveedor: ProveedorIA,
  texto: string,
  conImagen: boolean,
): number {
  const { tokensPorImagen } = configDe(proveedor);
  const textoTokens = Math.ceil(texto.length / 3.5);
  return textoTokens + (conImagen ? (tokensPorImagen ?? 2048) : 0);
}

/**
 * @param valor valor a validar.
 * @returns si `valor` es un `ProveedorIA` soportado.
 */
export function esProveedorValido(valor: unknown): valor is ProveedorIA {
  return PROVEEDORES.some((p) => p.id === valor);
}

/**
 * @param proveedor proveedor de IA.
 * @returns la configuración de ese proveedor.
 */
export function configDe(proveedor: ProveedorIA): ConfigProveedor {
  const config = PROVEEDORES.find((p) => p.id === proveedor);
  if (!config) throw new Error(`Proveedor de IA desconocido: ${proveedor}`);
  return config;
}
