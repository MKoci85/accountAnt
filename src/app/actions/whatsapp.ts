"use server";

import { revalidatePath } from "next/cache";
import {
  MODOS_RESPUESTA,
  parsearNumeros,
  type ModoRespuesta,
} from "@/lib/whatsapp";
import {
  TIMEOUT_WHATSAPP_MS,
  URL_BASE_WHATSAPP,
  contarMensajesInterrumpidos,
  escribirConfigWhatsapp,
  leerConfigWhatsapp,
  probarConexionWhatsapp,
  reintentarMensajesInterrumpidos,
  ultimoMensajeWhatsapp,
} from "@/lib/whatsapp-server";

function enmascarar(secreto: string | null): string | null {
  if (!secreto) return null;
  return `${"•".repeat(12)}${secreto.slice(-4)}`;
}

export type EstadoWhatsapp = {
  activo: boolean;
  /** El token y el secreto nunca vuelven completos al navegador. */
  tokenEnmascarado: string | null;
  appSecretEnmascarado: string | null;
  verifyToken: string;
  phoneNumberId: string;
  numeros: string;
  respuesta: ModoRespuesta;
  urlBase: string;
  urlBasePorDefecto: string;
  timeoutMs: number;
  timeoutPorDefecto: number;
  ultimoMensaje: { recibidoEn: string; resultado: string | null } | null;
  /** Mensajes que un reinicio dejó a medio procesar. */
  interrumpidos: number;
};

export async function obtenerEstadoWhatsapp(): Promise<EstadoWhatsapp> {
  const [config, ultimo] = await Promise.all([
    leerConfigWhatsapp(),
    ultimoMensajeWhatsapp(),
  ]);
  return {
    activo: config.activo,
    tokenEnmascarado: enmascarar(config.token),
    appSecretEnmascarado: enmascarar(config.appSecret),
    verifyToken: config.verifyToken,
    phoneNumberId: config.phoneNumberId,
    numeros: config.numeros.join(", "),
    respuesta: config.respuesta,
    urlBase: config.urlBase,
    urlBasePorDefecto: URL_BASE_WHATSAPP,
    timeoutMs: config.timeoutMs,
    timeoutPorDefecto: TIMEOUT_WHATSAPP_MS,
    ultimoMensaje: ultimo
      ? { recibidoEn: ultimo.recibidoEn, resultado: ultimo.resultado }
      : null,
    interrumpidos: contarMensajesInterrumpidos(),
  };
}

export type CampoWhatsapp =
  | "token"
  | "appSecret"
  | "phoneNumberId"
  | "numeros"
  | "urlBase"
  | "timeoutMs";

/** Guarda un campo de texto de WhatsApp. Vacío = volver al default (o borrar). */
export async function guardarCampoWhatsapp(campo: CampoWhatsapp, valor: string) {
  const limpio = valor.trim();
  switch (campo) {
    case "token":
    case "appSecret":
      if (!limpio) throw new Error("No puede estar vacío");
      await escribirConfigWhatsapp(campo, limpio);
      break;
    case "phoneNumberId":
      if (limpio && !/^\d+$/.test(limpio)) {
        throw new Error("El id del número son sólo dígitos (no es el teléfono).");
      }
      await escribirConfigWhatsapp(campo, limpio);
      break;
    case "numeros":
      await escribirConfigWhatsapp(campo, parsearNumeros(limpio).join(","));
      break;
    case "urlBase":
      if (limpio && !/^https:\/\//.test(limpio)) {
        throw new Error("La URL tiene que empezar con https://");
      }
      await escribirConfigWhatsapp(campo, limpio);
      break;
    case "timeoutMs": {
      const n = Number(limpio);
      if (limpio && !(Number.isFinite(n) && n > 0)) {
        throw new Error("El timeout tiene que ser un número positivo");
      }
      await escribirConfigWhatsapp(campo, limpio);
      break;
    }
    default:
      throw new Error("Campo de WhatsApp desconocido");
  }
  revalidatePath("/ajustes");
}

export async function borrarSecretoWhatsapp(campo: "token" | "appSecret") {
  if (campo !== "token" && campo !== "appSecret") {
    throw new Error("Campo de WhatsApp desconocido");
  }
  await escribirConfigWhatsapp(campo, null);
  revalidatePath("/ajustes");
}

export async function guardarActivoWhatsapp(activo: boolean) {
  await escribirConfigWhatsapp("activo", activo ? "1" : null);
  revalidatePath("/ajustes");
}

export async function guardarRespuestaWhatsapp(modo: ModoRespuesta) {
  if (!MODOS_RESPUESTA.includes(modo)) {
    throw new Error("Modo de respuesta desconocido");
  }
  await escribirConfigWhatsapp("respuesta", modo);
  revalidatePath("/ajustes");
}

/**
 * Devuelve el resultado en vez de tirar: una build de producción le borra el
 * mensaje a un error tirado desde una acción, y acá el mensaje de Meta es
 * justo lo que hay que leer.
 */
export async function probarWhatsapp(): Promise<{ ok: boolean; texto: string }> {
  try {
    const numero = await probarConexionWhatsapp();
    return { ok: true, texto: `Conectado: ${numero || "número verificado"}.` };
  } catch (e) {
    return {
      ok: false,
      texto: e instanceof Error ? e.message : "No se pudo conectar con Meta",
    };
  }
}

/** Retoma los mensajes que quedaron a medio procesar, incluso los ya reintentados. */
export async function reintentarMensajesWhatsapp(): Promise<{
  ok: boolean;
  texto: string;
}> {
  try {
    const n = await reintentarMensajesInterrumpidos({ incluirReintentados: true });
    revalidatePath("/", "layout");
    return {
      ok: true,
      texto:
        n === 0
          ? "No había mensajes para reintentar."
          : n === 1
            ? "Se reintentó 1 mensaje."
            : `Se reintentaron ${n} mensajes.`,
    };
  } catch (e) {
    return {
      ok: false,
      texto: e instanceof Error ? e.message : "No se pudo reintentar",
    };
  }
}
