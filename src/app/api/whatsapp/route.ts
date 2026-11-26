import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { firmaValida, mensajesDeWebhook } from "@/lib/whatsapp";
import {
  leerConfigWhatsapp,
  procesarMensajeRegistrado,
  registrarMensaje,
  reintentarMensajesInterrumpidos,
} from "@/lib/whatsapp-server";

export const dynamic = "force-dynamic";

const NO_EXISTE = () => new Response(null, { status: 404 });

/**
 * Verificación de la suscripción: Meta la hace una vez, al guardar la URL. Con
 * WhatsApp apagado en ajustes responde 404, como si la ruta no existiera.
 */
export async function GET(request: Request) {
  const config = await leerConfigWhatsapp();
  if (!config.activo) return NO_EXISTE();

  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge");
  if (
    params.get("hub.mode") !== "subscribe" ||
    params.get("hub.verify_token") !== config.verifyToken ||
    !challenge
  ) {
    return new Response(null, { status: 403 });
  }
  return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
}

/**
 * Mensajes entrantes. Es la única ruta de la app pensada para estar abierta a
 * internet (el resto vive dentro de la tailnet), así que no confía en nada de lo
 * que llega hasta comprobar la firma de Meta, y con WhatsApp apagado responde
 * 404. La firma es sobre los bytes recibidos: el cuerpo se lee como texto y
 * recién después se parsea.
 *
 * Cada mensaje se registra antes de contestar: después del 200 Meta no lo
 * vuelve a entregar, y lo que sigue puede cortarse si el proceso se reinicia (si
 * el insert falla, el 500 hace que Meta reintente). La lectura va en `after()`
 * porque Meta reintenta un webhook que tarda en contestar, y ahí mismo se
 * retoman los mensajes que un reinicio dejó a medias — cualquier webhook
 * firmado sirve de ocasión, incluido un aviso de "entregado" —, después de los
 * nuevos para no demorarlos. La revalidación sólo refresca lo que ya está
 * abierto en el navegador: si falla, el próximo pedido igual lee la base.
 */
export async function POST(request: Request) {
  const config = await leerConfigWhatsapp();
  if (!config.activo || !config.appSecret) return NO_EXISTE();

  const cuerpo = await request.text();
  if (!firmaValida(cuerpo, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    return new Response(null, { status: 400 });
  }

  const nuevos = mensajesDeWebhook(payload, config.phoneNumberId).filter(
    registrarMensaje
  );

  after(async () => {
    for (const mensaje of nuevos) {
      await procesarMensajeRegistrado(mensaje).catch((e) =>
        console.error("WhatsApp: no se pudo procesar el mensaje", e)
      );
    }
    const retomados = await reintentarMensajesInterrumpidos().catch((e) => {
      console.error("WhatsApp: no se pudieron retomar los mensajes interrumpidos", e);
      return 0;
    });
    if (!nuevos.length && !retomados) return;
    try {
      revalidatePath("/", "layout");
    } catch {}
  });

  return new Response("OK");
}
