import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mensajesWhatsapp } from "@/db/schema";
import { borrarConfig, escribirConfig, leerConfig } from "@/lib/config-server";
import { recibirImagen } from "@/lib/entrantes-recepcion";
import {
  MODOS_RESPUESTA,
  parsearNumeros,
  textoRespuesta,
  type DesenlaceMensaje,
  type MensajeEntrante,
  type ModoRespuesta,
} from "@/lib/whatsapp";

// Configuración y llamadas a la API de WhatsApp (Cloud API de Meta). Sin "use
// server": acá se leen el token y el secreto de la app completos, y todo lo
// que exporta un módulo "use server" es invocable desde el navegador.

export const CLAVES_WHATSAPP = {
  activo: "whatsapp_activo",
  token: "whatsapp_token",
  appSecret: "whatsapp_app_secret",
  verifyToken: "whatsapp_verify_token",
  phoneNumberId: "whatsapp_phone_number_id",
  numeros: "whatsapp_numeros_autorizados",
  respuesta: "whatsapp_respuesta",
  urlBase: "whatsapp_url_base",
  timeoutMs: "whatsapp_timeout_ms",
} as const;

// Sin versión en la ruta: Meta usa la versión por defecto de la app, y una
// versión fija acá vencería sola con el tiempo. Se puede fijar desde ajustes.
export const URL_BASE_WHATSAPP = "https://graph.facebook.com";
export const TIMEOUT_WHATSAPP_MS = 30_000;
// WhatsApp comprime las fotos muy por debajo de esto; es un tope de cordura.
const MAXIMO_IMAGEN_BYTES = 16 * 1024 * 1024;

export type ConfigWhatsapp = {
  activo: boolean;
  token: string | null;
  appSecret: string | null;
  verifyToken: string;
  phoneNumberId: string;
  numeros: string[];
  respuesta: ModoRespuesta;
  urlBase: string;
  timeoutMs: number;
};

export async function leerConfigWhatsapp(): Promise<ConfigWhatsapp> {
  const leer = (clave: keyof typeof CLAVES_WHATSAPP) =>
    leerConfig(CLAVES_WHATSAPP[clave]);

  // El token de verificación se genera la primera vez y queda fijo: es lo que
  // se pega en Meta, y cambiarlo solo rompería la suscripción.
  let verifyToken = await leer("verifyToken");
  if (!verifyToken) {
    verifyToken = randomBytes(24).toString("hex");
    await escribirConfig(CLAVES_WHATSAPP.verifyToken, verifyToken);
  }

  const respuesta = await leer("respuesta");
  const timeout = Number(await leer("timeoutMs"));
  return {
    activo: (await leer("activo")) === "1",
    token: await leer("token"),
    appSecret: await leer("appSecret"),
    verifyToken,
    phoneNumberId: (await leer("phoneNumberId")) ?? "",
    numeros: parsearNumeros((await leer("numeros")) ?? ""),
    respuesta: MODOS_RESPUESTA.find((m) => m === respuesta) ?? "problemas",
    urlBase: ((await leer("urlBase")) ?? URL_BASE_WHATSAPP).replace(/\/+$/, ""),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : TIMEOUT_WHATSAPP_MS,
  };
}

export async function escribirConfigWhatsapp(
  clave: keyof typeof CLAVES_WHATSAPP,
  valor: string | null
) {
  if (valor === null || valor === "") await borrarConfig(CLAVES_WHATSAPP[clave]);
  else await escribirConfig(CLAVES_WHATSAPP[clave], valor);
}

async function llamarMeta(
  config: ConfigWhatsapp,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!config.token) throw new Error("Falta el token de acceso de WhatsApp.");
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    let detalle = cuerpo.slice(0, 200);
    try {
      detalle = JSON.parse(cuerpo)?.error?.message ?? detalle;
    } catch {
      // no era JSON: va el texto crudo
    }
    throw new Error(`Meta respondió ${res.status}: ${detalle}`);
  }
  return res;
}

/** Baja la foto de un mensaje: Meta da primero una URL temporal y después el archivo. */
async function descargarImagen(config: ConfigWhatsapp, mediaId: string): Promise<Buffer> {
  const meta = await llamarMeta(config, `${config.urlBase}/${mediaId}`);
  const { url } = (await meta.json()) as { url?: string };
  if (!url) throw new Error("Meta no devolvió la dirección de la foto.");

  const archivo = await llamarMeta(config, url);
  const imagen = Buffer.from(await archivo.arrayBuffer());
  if (imagen.byteLength > MAXIMO_IMAGEN_BYTES) {
    throw new Error("La foto es demasiado grande.");
  }
  return imagen;
}

async function enviarTexto(config: ConfigWhatsapp, para: string, texto: string) {
  await llamarMeta(config, `${config.urlBase}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "text",
      text: { body: texto },
    }),
  });
}

/**
 * Comprueba token e id del número contra Meta sin mandar ningún mensaje.
 * @returns El número tal como lo muestra Meta.
 */
export async function probarConexionWhatsapp(): Promise<string> {
  const config = await leerConfigWhatsapp();
  if (!config.phoneNumberId) throw new Error("Falta el id del número de WhatsApp.");
  const res = await llamarMeta(
    config,
    `${config.urlBase}/${config.phoneNumberId}?fields=display_phone_number,verified_name`
  );
  const datos = (await res.json()) as {
    display_phone_number?: string;
    verified_name?: string;
  };
  return [datos.display_phone_number, datos.verified_name].filter(Boolean).join(" · ");
}

async function desenlaceDe(
  config: ConfigWhatsapp,
  mensaje: MensajeEntrante
): Promise<DesenlaceMensaje> {
  if (!mensaje.mediaId) {
    return {
      tipo: "problema",
      motivo: "Sólo leo fotos de comprobantes: mandame la foto del ticket.",
    };
  }
  try {
    const imagen = await descargarImagen(config, mensaje.mediaId);
    const r = await recibirImagen(imagen, "whatsapp");
    if (!r.ok) return { tipo: "problema", motivo: r.mensaje };
    if (r.destino === "gasto") {
      return { tipo: "guardado", comercio: r.comercio, total: r.total };
    }
    if (r.estado === "error") {
      return {
        tipo: "problema",
        motivo: `No pude leer el comprobante: ${r.error ?? "sin detalle"} Quedó en la bandeja para reintentar.`,
      };
    }
    return r.pendientePor
      ? { tipo: "pendiente", motivo: r.pendientePor }
      : { tipo: "en-bandeja" };
  } catch (e) {
    return {
      tipo: "problema",
      motivo: `No pude procesar la foto: ${e instanceof Error ? e.message : "error desconocido"}`,
    };
  }
}

function resumenDesenlace(d: DesenlaceMensaje): string {
  switch (d.tipo) {
    case "guardado":
      return `Guardado solo: ${d.comercio}`;
    case "en-bandeja":
      return "En la bandeja";
    case "pendiente":
      return `En la bandeja: ${d.motivo}`;
    case "problema":
      return d.motivo;
  }
}

/**
 * Procesa un mensaje entrante ya autenticado por la firma del webhook. De un
 * número no autorizado se deja registro y nada más: ni se baja la foto ni se
 * contesta.
 */
export async function procesarMensajeWhatsapp(mensaje: MensajeEntrante) {
  const config = await leerConfigWhatsapp();

  // El insert es el candado contra entregas repetidas: si el id ya estaba, otro
  // pedido ya se ocupó (o se está ocupando) de este mensaje.
  const nuevo = db
    .insert(mensajesWhatsapp)
    .values({
      id: mensaje.id,
      recibidoEn: new Date().toISOString(),
      remitente: mensaje.remitente,
    })
    .onConflictDoNothing()
    .returning({ id: mensajesWhatsapp.id })
    .get();
  if (!nuevo) return;

  const anotar = (resultado: string) =>
    db
      .update(mensajesWhatsapp)
      .set({ resultado })
      .where(eq(mensajesWhatsapp.id, mensaje.id))
      .run();

  if (!config.numeros.includes(mensaje.remitente)) {
    anotar("Ignorado: número no autorizado");
    return;
  }

  const desenlace = await desenlaceDe(config, mensaje);
  anotar(resumenDesenlace(desenlace));

  const texto = textoRespuesta(desenlace, config.respuesta);
  if (texto) {
    await enviarTexto(config, mensaje.remitente, texto).catch((e) =>
      anotar(
        `${resumenDesenlace(desenlace)} (no se pudo contestar: ${e instanceof Error ? e.message : "error"})`
      )
    );
  }
}

export async function ultimoMensajeWhatsapp() {
  return (
    db
      .select()
      .from(mensajesWhatsapp)
      .orderBy(desc(mensajesWhatsapp.recibidoEn))
      .limit(1)
      .get() ?? null
  );
}
