import {
  configDe,
  type ProveedorIA,
} from "@/lib/proveedores-ia";
import {
  leerOpenRouterReferer,
  leerTimeoutIaMs,
  leerUrlIA,
} from "@/lib/config-server";

export type ImagenAdjunta = { base64: string; mimeType: string };

export type MensajeIA = {
  rol: "user" | "assistant";
  contenido: string;
  imagen?: ImagenAdjunta;
  cortarCache?: boolean;
};

export type OpcionesLlamada = {
  systemPrompt?: string;
  mensajes: MensajeIA[];
  cachear?: boolean;
  timeoutMs?: number;
  reintentos?: number;
};

export type RespuestaIA =
  | {
      ok: true;
      texto: string;
      truncado?: boolean;
      tokensEntrada?: number;
      tokensSalida?: number;
      cacheLeidos?: number;
    }
  | { ok: false; error: string; reintentable: boolean };

const ESPERA_REINTENTO_MS = 2000;

const CACHE_CONTROL = { type: "ephemeral" as const };

/**
 * Llama al proveedor de IA configurado, reintentando ante fallos transitorios.
 * @param proveedor proveedor de IA a usar.
 * @param apiKey API key del proveedor.
 * @param modelo modelo a invocar.
 * @param opciones mensajes y configuración de la llamada.
 * @param maxTokens techo de tokens de salida.
 * @returns la respuesta del proveedor, o el error si falló.
 */
export async function llamar(
  proveedor: ProveedorIA,
  apiKey: string,
  modelo: string,
  opciones: OpcionesLlamada,
  maxTokens: number,
): Promise<RespuestaIA> {
  const reintentos = opciones.reintentos ?? 0;

  for (let intento = 0; ; intento++) {
    const r = await unaLlamada(proveedor, apiKey, modelo, opciones, maxTokens);
    if (r.ok || !r.reintentable || intento >= reintentos) return r;
    await new Promise((resolve) => setTimeout(resolve, ESPERA_REINTENTO_MS));
  }
}

async function unaLlamada(
  proveedor: ProveedorIA,
  apiKey: string,
  modelo: string,
  opciones: OpcionesLlamada,
  maxTokens: number,
): Promise<RespuestaIA> {
  const config = configDe(proveedor);
  const url = await leerUrlIA(proveedor);
  if (!url) {
    return {
      ok: false,
      error: `El proveedor ${config.nombre} no tiene URL configurada`,
      reintentable: false,
    };
  }
  const timeoutMs = opciones.timeoutMs ?? (await leerTimeoutIaMs());
  const cachear = Boolean(opciones.cachear && config.soportaCache);

  try {
    if (config.formato === "anthropic") {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: maxTokens,
          ...(opciones.systemPrompt
            ? {
                system: cachear
                  ? [
                      {
                        type: "text",
                        text: opciones.systemPrompt,
                        cache_control: CACHE_CONTROL,
                      },
                    ]
                  : opciones.systemPrompt,
              }
            : {}),
          messages: opciones.mensajes.map((m) => ({
            role: m.rol,
            content: contenidoAnthropic(m, cachear),
          })),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) return await errorDeRespuesta(r, modelo);
      const json = await r.json();
      const uso = json.usage ?? {};
      return {
        ok: true,
        texto: json.content?.[0]?.text ?? "",
        truncado: json.stop_reason === "max_tokens",
        tokensEntrada: uso.input_tokens,
        tokensSalida: uso.output_tokens,
        cacheLeidos: uso.cache_read_input_tokens,
      };
    }

    if (config.formato === "gemini") {
      const pedir = (nivel: string | undefined) =>
        fetch(`${url}/${modelo}:generateContent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            ...(opciones.systemPrompt
              ? {
                  systemInstruction: {
                    parts: [{ text: opciones.systemPrompt }],
                  },
                }
              : {}),
            contents: opciones.mensajes.map((m) => ({
              role: m.rol === "assistant" ? "model" : "user",
              parts: m.imagen
                ? [
                    {
                      inline_data: {
                        mime_type: m.imagen.mimeType,
                        data: m.imagen.base64,
                      },
                    },
                    { text: m.contenido },
                  ]
                : [{ text: m.contenido }],
            })),
            generationConfig: {
              maxOutputTokens: maxTokens,
              ...(nivel ? { thinkingConfig: { thinkingLevel: nivel } } : {}),
            },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

      let r = await pedir(config.nivelRazonamiento);
      if (
        !r.ok &&
        r.status === 400 &&
        config.nivelRazonamiento &&
        (await mencionaRazonamiento(r.clone()))
      ) {
        r = await pedir(undefined);
      }
      if (!r.ok) return await errorDeRespuesta(r, modelo);
      const json = await r.json();
      const candidato = json.candidates?.[0];
      const texto = (candidato?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "")
        .join("");
      const cortado = candidato?.finishReason === "MAX_TOKENS";
      if (!texto && cortado) {
        return {
          ok: false,
          error: "El modelo agotó el límite de tokens sin responder",
          reintentable: false,
        };
      }
      const uso = json.usageMetadata ?? {};
      return {
        ok: true,
        texto,
        truncado: cortado,
        tokensEntrada: uso.promptTokenCount,
        tokensSalida:
          uso.candidatesTokenCount !== undefined
            ? uso.candidatesTokenCount + (uso.thoughtsTokenCount ?? 0)
            : undefined,
      };
    }

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...config.headersExtra,
        ...(config.refererConfigurable
          ? { "HTTP-Referer": await leerOpenRouterReferer() }
          : {}),
      },
      body: JSON.stringify({
        model: modelo,
        [config.campoMaxTokens ?? "max_tokens"]: maxTokens,
        messages: [
          ...(opciones.systemPrompt
            ? [{ role: "system", content: opciones.systemPrompt }]
            : []),
          ...opciones.mensajes.map((m) => ({
            role: m.rol,
            content: m.imagen
              ? [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${m.imagen.mimeType};base64,${m.imagen.base64}`,
                    },
                  },
                  { type: "text", text: m.contenido },
                ]
              : m.contenido,
          })),
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return await errorDeRespuesta(r, modelo);
    const json = await r.json();
    if (json.error) {
      return {
        ok: false,
        error: String(json.error.message ?? "El proveedor rechazó la consulta"),
        reintentable: false,
      };
    }
    const uso = json.usage ?? {};
    return {
      ok: true,
      texto: json.choices?.[0]?.message?.content ?? "",
      truncado: json.choices?.[0]?.finish_reason === "length",
      tokensEntrada: uso.prompt_tokens,
      tokensSalida: uso.completion_tokens,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return {
        ok: false,
        error: "El proveedor no respondió a tiempo",
        reintentable: true,
      };
    }
    return {
      ok: false,
      error: "No se pudo conectar con el proveedor",
      reintentable: true,
    };
  }
}

function contenidoAnthropic(m: MensajeIA, cachear: boolean) {
  const marcar = cachear && m.cortarCache;

  if (m.imagen) {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: m.imagen.mimeType,
          data: m.imagen.base64,
        },
      },
      {
        type: "text",
        text: m.contenido,
        ...(marcar ? { cache_control: CACHE_CONTROL } : {}),
      },
    ];
  }

  if (cachear) {
    return [
      {
        type: "text",
        text: m.contenido,
        ...(marcar ? { cache_control: CACHE_CONTROL } : {}),
      },
    ];
  }
  return m.contenido;
}

async function errorDeRespuesta(
  r: Response,
  modelo: string,
): Promise<{ ok: false; error: string; reintentable: boolean }> {
  if (r.status === 401 || r.status === 403) {
    return { ok: false, error: "La API key no es válida", reintentable: false };
  }
  if (r.status >= 500) {
    return {
      ok: false,
      error: "El proveedor está caído o con problemas",
      reintentable: true,
    };
  }

  if (
    r.status === 413 ||
    (r.status === 429 && (await esLimitePorTamano(r.clone())))
  ) {
    const cuota = await limitesDelCuerpo(r.clone());
    return {
      ok: false,
      error: `Superaste la cuota por minuto del proveedor${cuota}. Se cuenta todo lo enviado en el último minuto, así que si reintentaste hace poco esperá un minuto y probá de nuevo. Si vuelve a pasar, cambiá de proveedor en el selector.`,
      reintentable: false,
    };
  }
  if (r.status === 429) {
    return {
      ok: false,
      error: "Límite de uso alcanzado en el proveedor",
      reintentable: false,
    };
  }
  if (r.status === 404) {
    return {
      ok: false,
      error: `El proveedor no reconoce el modelo "${modelo}". Revisá el modelo en Ajustes.`,
      reintentable: false,
    };
  }
  const detalle = await motivoDelCuerpo(r);
  return {
    ok: false,
    error: detalle
      ? `El proveedor rechazó la consulta: ${detalle}`
      : `El proveedor rechazó la consulta (HTTP ${r.status})`,
    reintentable: false,
  };
}

async function motivoDelCuerpo(r: Response): Promise<string | null> {
  try {
    const json = await r.json();
    const msg = json?.error?.message ?? json?.message;
    if (typeof msg !== "string" || !msg.trim()) return null;
    const limpio = msg.trim().replace(/\s+/g, " ");
    return limpio.length > 400 ? `${limpio.slice(0, 400)}…` : limpio;
  } catch {
    return null;
  }
}

async function mencionaRazonamiento(r: Response): Promise<boolean> {
  try {
    const json = await r.json();
    const msg = String(json?.error?.message ?? "");
    return /thinking/i.test(msg);
  } catch {
    return false;
  }
}

async function esLimitePorTamano(r: Response): Promise<boolean> {
  try {
    const json = await r.json();
    const msg = String(json?.error?.message ?? "");
    return /too large|reduce your message|tokens per minute|TPM/i.test(msg);
  } catch {
    return false;
  }
}

async function limitesDelCuerpo(r: Response): Promise<string> {
  try {
    const json = await r.json();
    const msg = String(json?.error?.message ?? "");
    const m = msg.match(/Limit (\d+), Requested (\d+)/i);
    return m
      ? ` (límite ${m[1]} tokens por minuto, la consulta pedía ${m[2]})`
      : "";
  } catch {
    return "";
  }
}
