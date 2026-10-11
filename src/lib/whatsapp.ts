import { createHmac, timingSafeEqual } from "node:crypto";

export const MODOS_RESPUESTA = ["nunca", "problemas", "siempre"] as const;
export type ModoRespuesta = (typeof MODOS_RESPUESTA)[number];

/**
 * Comprueba la firma con la que Meta acompaña cada webhook
 * (`X-Hub-Signature-256: sha256=<hmac del cuerpo con el secreto de la app>`).
 * El webhook es lo único de la app abierto a internet: sin esto, cualquiera
 * que conozca la URL podría hacerse pasar por Meta.
 * @param cuerpo El cuerpo tal como llegó, sin re-serializar: la firma es sobre esos bytes.
 */
export function firmaValida(
  cuerpo: string,
  cabecera: string | null,
  secreto: string
): boolean {
  if (!cabecera?.startsWith("sha256=") || !secreto) return false;
  const esperada = createHmac("sha256", secreto).update(cuerpo).digest();
  const recibida = Buffer.from(cabecera.slice("sha256=".length), "hex");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

/** Deja sólo los dígitos: "+598 99 123 456" y "59899123456" son el mismo número. */
export function normalizarNumero(numero: string): string {
  return numero.replace(/\D/g, "");
}

/**
 * Lista de números separados por coma, punto y coma o salto de línea. El
 * espacio no separa: "+598 99 123 456" es un solo número.
 */
export function parsearNumeros(texto: string): string[] {
  return Array.from(
    new Set(texto.split(/[,;\n]+/).map(normalizarNumero).filter(Boolean))
  );
}

export type MensajeEntrante = {
  id: string;
  remitente: string;
  /** Id del archivo en Meta cuando el mensaje es una imagen; null si es otra cosa. */
  mediaId: string | null;
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

/**
 * Saca los mensajes entrantes de un webhook de WhatsApp. Sólo los dirigidos al
 * número configurado: el mismo webhook recibe también avisos de estado
 * (entregado, leído), que no traen `messages` y se ignoran solos. Una foto
 * mandada "como documento" cuenta como imagen.
 */
export function mensajesDeWebhook(
  payload: unknown,
  phoneNumberId: string
): MensajeEntrante[] {
  if (!esObjeto(payload) || !Array.isArray(payload.entry)) return [];

  const mensajes: MensajeEntrante[] = [];
  for (const entrada of payload.entry) {
    if (!esObjeto(entrada) || !Array.isArray(entrada.changes)) continue;
    for (const cambio of entrada.changes) {
      const valor = esObjeto(cambio) ? cambio.value : null;
      if (!esObjeto(valor) || !Array.isArray(valor.messages)) continue;
      const destino = esObjeto(valor.metadata) ? valor.metadata.phone_number_id : null;
      if (destino !== phoneNumberId) continue;

      for (const m of valor.messages) {
        if (!esObjeto(m) || typeof m.id !== "string" || typeof m.from !== "string") {
          continue;
        }
        let mediaId: string | null = null;
        if (esObjeto(m.image) && typeof m.image.id === "string") {
          mediaId = m.image.id;
        } else if (
          esObjeto(m.document) &&
          typeof m.document.id === "string" &&
          typeof m.document.mime_type === "string" &&
          m.document.mime_type.startsWith("image/")
        ) {
          mediaId = m.document.id;
        }
        mensajes.push({ id: m.id, remitente: normalizarNumero(m.from), mediaId });
      }
    }
  }
  return mensajes;
}

/** Lo que pasó con un mensaje, en los términos que le importan a la respuesta. */
export type DesenlaceMensaje =
  | { tipo: "guardado"; comercio: string; total: number }
  /** En la bandeja sin nada raro: el guardado automático está apagado. */
  | { tipo: "en-bandeja" }
  | { tipo: "pendiente"; motivo: string }
  | { tipo: "problema"; motivo: string };

/**
 * El texto a contestar por WhatsApp, o null si no corresponde contestar. No es
 * un chat: a lo sumo una respuesta por foto. En modo "problemas" sólo se
 * contesta cuando hay algo para hacer (no se pudo leer, quedó para revisar).
 */
export function textoRespuesta(
  desenlace: DesenlaceMensaje,
  modo: ModoRespuesta
): string | null {
  if (modo === "nunca") return null;
  switch (desenlace.tipo) {
    case "problema":
      return desenlace.motivo;
    case "pendiente":
      return `Quedó en la bandeja para revisar. ${desenlace.motivo}`;
    case "en-bandeja":
      return modo === "siempre" ? "Recibido: quedó en la bandeja para revisar." : null;
    case "guardado":
      return modo === "siempre"
        ? `Guardado: ${desenlace.comercio}, $ ${desenlace.total.toLocaleString("es-UY")}.`
        : null;
  }
}
