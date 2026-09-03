export type ProveedorIA =
  "anthropic" | "gemini" | "openai" | "groq" | "openrouter" | "opencode-zen";

type FormatoIA = "anthropic" | "gemini" | "openai-compatible";

export type ModeloCatalogo = {
  id?: unknown;
  pricing?: { prompt?: unknown };
  architecture?: { output_modalities?: unknown };
};

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
  catalogo?: {
    url: string;
    urlListado: string;
    esGratuito: (modelo: ModeloCatalogo) => boolean;
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
      esGratuito: (m) => {
        if (m.pricing?.prompt !== "0") return false;
        const salidas = m.architecture?.output_modalities;
        if (!Array.isArray(salidas)) return true;
        return salidas.length === 1 && salidas[0] === "text";
      },
    },
    urlKeys: "https://openrouter.ai/keys",
  },
  {
    id: "opencode-zen",
    nombre: "OpenCode Zen",
    modelo: "big-pickle",
    formato: "openai-compatible",
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    avisoPrivacidad:
      "La cuenta de OpenCode Zen exige auto-recarga con tarjeta habilitada por defecto (recarga US$20 al bajar de US$5). Si el modelo gratuito deja de serlo, el proveedor puede cobrar automáticamente: conviene revisar esa configuración en opencode.ai antes de usarlo.",
    avisoChat:
      "Los modelos gratuitos de Zen son de disponibilidad temporal y no tienen soporte de imagen confirmado: usalo solo para chat de texto, no para el flujo de foto de ticket.",
    catalogo: {
      url: "https://opencode.ai/zen/v1/models",
      urlListado: "https://opencode.ai/docs/zen/",
      esGratuito: (m) => typeof m.id === "string" && m.id.endsWith("-free"),
    },
    urlKeys: "https://opencode.ai/auth",
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
