import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { firmaValida, mensajesDeWebhook } from "@/lib/whatsapp";
import {
  leerConfigWhatsapp,
  procesarMensajeWhatsapp,
} from "@/lib/whatsapp-server";

// Webhook de WhatsApp: la única ruta de la app pensada para estar abierta a
// internet (el resto vive dentro de la tailnet). Por eso no confía en nada de
// lo que llega hasta comprobar la firma de Meta, y con WhatsApp apagado en
// ajustes responde como si no existiera.

export const dynamic = "force-dynamic";

const NO_EXISTE = () => new Response(null, { status: 404 });

/** Verificación de la suscripción: Meta la hace una vez, al guardar la URL. */
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

export async function POST(request: Request) {
  const config = await leerConfigWhatsapp();
  if (!config.activo || !config.appSecret) return NO_EXISTE();

  // La firma es sobre los bytes recibidos: se lee como texto y recién después
  // se parsea.
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

  const mensajes = mensajesDeWebhook(payload, config.phoneNumberId);
  if (mensajes.length) {
    // Meta espera el 200 enseguida y reintenta si tarda; leer una foto con IA
    // puede llevar mucho más que eso, así que el trabajo va después de
    // contestar.
    after(async () => {
      for (const mensaje of mensajes) {
        await procesarMensajeWhatsapp(mensaje).catch((e) =>
          console.error("WhatsApp: no se pudo procesar el mensaje", e)
        );
      }
      // Sólo refresca lo que ya está abierto en el navegador; si acá no se
      // puede revalidar, el próximo pedido igual lee la base.
      try {
        revalidatePath("/", "layout");
      } catch {}
    });
  }

  return new Response("OK");
}
