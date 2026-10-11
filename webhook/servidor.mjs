import { createServer } from "node:http";

// Lo único que se publica a internet (Tailscale Funnel apunta acá, no a la
// app). Funnel abre un puerto entero, y si ese puerto fuera el de Next quedaría
// expuesto todo lo que Next atiende antes de llegar a nuestra ruta: server
// actions (cabecera `Next-Action`), RSC, páginas de error. Este proceso deja
// pasar una sola forma de pedido y la arma de cero hacia la app, así que de lo
// que llegó de afuera sólo sobreviven el cuerpo y la firma.
//
// A propósito no tiene dependencias, no abre la base y no conoce ningún
// secreto: la firma de Meta la sigue comprobando la app (`/api/whatsapp`), que
// es la que tiene la clave. Comprometer este proceso no da acceso a ningún dato.

const PUERTO = Number(process.env.WEBHOOK_PUERTO) || 8787;
const DESTINO = process.env.WEBHOOK_DESTINO || "http://127.0.0.1:3000/api/whatsapp";
const RUTA = "/api/whatsapp";

// Un webhook de mensajes pesa unos pocos KB (la foto no viaja: viaja su id).
const MAXIMO_CUERPO_BYTES = 1024 * 1024;
const TIMEOUT_DESTINO_MS = 10_000;
const MAXIMO_EN_CURSO = 20;
const FIRMA = /^sha256=[0-9a-f]{64}$/;
const PARAMETROS_VERIFICACION = ["hub.mode", "hub.verify_token", "hub.challenge"];
// Lo que la app puede contestar y tiene sentido que Meta vea. Cualquier otra
// cosa (un 500 con detalle, una redirección) se tapa con un 502.
const ESTADOS_QUE_PASAN = new Set([200, 400, 401, 403, 404]);

let enCurso = 0;

function responder(res, estado, cuerpo = "") {
  res.writeHead(estado, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(cuerpo),
    Connection: "close",
  });
  res.end(cuerpo);
}

/** Lee el cuerpo sin pasarse del tope; null si se pasa. */
async function leerCuerpo(req) {
  if (Number(req.headers["content-length"]) > MAXIMO_CUERPO_BYTES) return null;
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > MAXIMO_CUERPO_BYTES) return null;
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

async function reenviar(url, init) {
  const r = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_DESTINO_MS),
  });
  return { estado: r.status, texto: (await r.text()).slice(0, 1024) };
}

async function atender(req, res) {
  const url = new URL(req.url ?? "/", "http://webhook");
  if (url.pathname !== RUTA) return responder(res, 404);

  if (req.method === "GET") {
    // Verificación de la suscripción: sólo los tres parámetros de Meta.
    const destino = new URL(DESTINO);
    for (const nombre of PARAMETROS_VERIFICACION) {
      const valor = url.searchParams.get(nombre);
      if (!valor || valor.length > 256) return responder(res, 403);
      destino.searchParams.set(nombre, valor);
    }
    const r = await reenviar(destino, { method: "GET" });
    if (!ESTADOS_QUE_PASAN.has(r.estado)) return responder(res, 502);
    return responder(res, r.estado, r.estado === 200 ? r.texto : "");
  }

  if (req.method === "POST") {
    const firma = req.headers["x-hub-signature-256"];
    if (typeof firma !== "string" || !FIRMA.test(firma)) return responder(res, 401);

    const cuerpo = await leerCuerpo(req);
    if (cuerpo === null) return responder(res, 413);

    // Los bytes van tal cual llegaron: la firma es sobre ellos.
    const r = await reenviar(DESTINO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": firma,
      },
      body: cuerpo,
    });
    if (!ESTADOS_QUE_PASAN.has(r.estado)) return responder(res, 502);
    return responder(res, r.estado);
  }

  return responder(res, 404);
}

const servidor = createServer(async (req, res) => {
  if (enCurso >= MAXIMO_EN_CURSO) return responder(res, 503);
  enCurso++;
  try {
    await atender(req, res);
  } catch (e) {
    // Con la app caída o colgada, un 502 hace que Meta reintente la entrega.
    console.error("Webhook: no se pudo reenviar a la app:", e instanceof Error ? e.message : e);
    if (!res.headersSent) responder(res, 502);
    else res.destroy();
  } finally {
    enCurso--;
  }
});

servidor.headersTimeout = 10_000;
servidor.requestTimeout = 15_000;
servidor.maxHeadersCount = 50;

// Sólo loopback: desde afuera se llega únicamente por Funnel.
servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`Webhook de WhatsApp en http://127.0.0.1:${PUERTO}${RUTA} → ${DESTINO}`);
});
