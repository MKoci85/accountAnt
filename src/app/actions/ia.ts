"use server";

import {
  leerApiKeyIA,
  leerModeloIA,
  leerProveedorIA,
  leerTpmEfectivo,
} from "@/lib/config-server";
import { llamar, type ImagenAdjunta } from "@/lib/ia-cliente";
import {
  estadoCuota,
  mensajeEspera,
  registrarUso,
} from "@/lib/limitador-ia";
import {
  configDe,
  esProveedorValido,
  estimarTokensEntrada,
  presupuestoRespuesta,
  type ProveedorIA,
} from "@/lib/proveedores-ia";
import { redactarDatosPersonales } from "@/lib/pdf";
import type { MovimientoEstadoCuenta } from "@/lib/estado-cuenta";
import type { usoIA } from "@/db/schema";

export type { ImagenAdjunta };

/**
 * Prueba la conexión con un proveedor de IA con un prompt trivial.
 * @param override Proveedor/API key a probar en vez de los guardados.
 * @returns Si la conexión funcionó, con un mensaje descriptivo.
 */
export async function probarConexionIA(override?: {
  proveedor: ProveedorIA;
  apiKey?: string;
}): Promise<{ ok: boolean; mensaje: string }> {
  if (override && !esProveedorValido(override.proveedor)) {
    return { ok: false, mensaje: "Proveedor de IA desconocido" };
  }
  const proveedor = override?.proveedor ?? (await leerProveedorIA());
  const apiKey = override?.apiKey?.trim() || (await leerApiKeyIA(proveedor));
  if (!apiKey) return { ok: false, mensaje: "No hay API key configurada" };

  const modelo = await leerModeloIA(proveedor);

  await registrarUso(proveedor, modelo, 256, "test");

  const r = await llamar(
    proveedor,
    apiKey,
    modelo,
    { mensajes: [{ rol: "user", contenido: "Respondé solamente: OK" }] },
    256,
  );
  return r.ok
    ? { ok: true, mensaje: `Conexión correcta con ${modelo}` }
    : { ok: false, mensaje: r.error };
}

export type FuenteIA =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagen"; base64: string; mimeType: string };

const PROMPT_EXTRACCION = `Extraé los movimientos de consumo de este estado de cuenta de tarjeta uruguayo.
Devolvé SOLO un array JSON, sin texto alrededor, con objetos:
{"fecha":"YYYY-MM-DD","descripcion":"...","monto":1234.56,"moneda":"UYU"|"USD"}

Reglas:
- Ignorá saldos, pagos, seguros y totales: solo compras.
- El año viene en 2 dígitos: asumí 20XX.
- No redondees los montos, respetá los decimales.
- Si no podés determinar la moneda, usá UYU.`;

const PROMPT_EXTRACCION_TICKET = `Extraé el detalle de este ticket o nota de pedido de un comercio uruguayo.
Devolvé SOLO un objeto JSON, sin texto alrededor, con esta forma:
{"comercio":"...","fecha":"YYYY-MM-DD","items":[{"nombre":"...","cantidad":1,"precio":1234.56}]}

Reglas:
- Es UNA sola compra: todos los productos van en "items".
- "precio" es el importe TOTAL de esa línea, no el precio unitario.
- "cantidad" es cuántas unidades: si el ticket no la aclara, usá 1.
- Transcribí el nombre del producto tal como está escrito, sin corregirlo ni expandirlo.
- Ignorá subtotales, totales y descuentos: solo los productos.
- Si el ticket no dice el comercio, usá "" (string vacío).
- Si el ticket no tiene fecha, usá "" (string vacío).
- El año puede venir en 2 dígitos: asumí 20XX.
- No redondees los importes, respetá los decimales.`;

function extraerJSON(
  texto: string,
  delimitadores: readonly [string, string] = ["[", "]"],
): unknown {
  const sinRazonamiento = texto
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");

  const fence = sinRazonamiento.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidatos = fence ? [fence[1]] : [];

  const [abre, cierra] = delimitadores;
  const inicio = sinRazonamiento.indexOf(abre);
  const fin = sinRazonamiento.lastIndexOf(cierra);
  if (inicio !== -1 && fin > inicio) {
    candidatos.push(sinRazonamiento.slice(inicio, fin + 1));
  }
  candidatos.push(sinRazonamiento);

  for (const c of candidatos) {
    try {
      return JSON.parse(c.trim());
    } catch {
      // continue
    }
  }
  return undefined;
}

function mensajeSinJSON(texto: string): string {
  const limpio = texto.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!limpio) {
    return "El modelo devolvió una respuesta vacía. Puede que el modelo elegido no acepte imágenes: revisalo en Ajustes.";
  }
  const muestra = limpio.length > 150 ? `${limpio.slice(0, 150)}…` : limpio;
  return `El modelo no devolvió un JSON válido. Respondió: "${muestra}"`;
}

function validarMovimientos(crudo: unknown): MovimientoEstadoCuenta[] | null {
  if (!Array.isArray(crudo)) return null;

  const movimientos: MovimientoEstadoCuenta[] = [];
  for (const item of crudo) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;

    const fecha = typeof o.fecha === "string" ? o.fecha : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;

    const monto =
      typeof o.monto === "number"
        ? o.monto
        : Number(
            String(o.monto ?? "")
              .replace(/\./g, "")
              .replace(",", "."),
          );
    if (!Number.isFinite(monto) || monto <= 0) continue;

    const descripcion = String(o.descripcion ?? "").trim();
    if (!descripcion) continue;

    movimientos.push({
      fecha,
      descripcion,
      monto,
      moneda: o.moneda === "USD" ? "USD" : "UYU",
    });
  }

  return movimientos.length ? movimientos : null;
}

async function extraerConIA(
  fuente: FuenteIA,
  prompt: string,
  origen: (typeof usoIA.$inferInsert)["origen"],
  proveedorElegido?: ProveedorIA,
): Promise<
  | { ok: true; texto: string }
  | { ok: false; error: string }
> {
  if (proveedorElegido !== undefined && !esProveedorValido(proveedorElegido)) {
    return { ok: false, error: "Proveedor de IA desconocido" };
  }
  const proveedor = proveedorElegido ?? (await leerProveedorIA());
  const apiKey = await leerApiKeyIA(proveedor);
  if (!apiKey) {
    return {
      ok: false,
      error: `No hay API key configurada para ${configDe(proveedor).nombre}`,
    };
  }
  const modelo = await leerModeloIA(proveedor);

  let promptFinal = prompt;
  let imagen: ImagenAdjunta | undefined;

  if (fuente.tipo === "texto") {
    promptFinal = `${prompt}\n\nContenido:\n${redactarDatosPersonales(fuente.texto)}`;
  } else {
    imagen = { base64: fuente.base64, mimeType: fuente.mimeType };
  }

  const tokensEntrada = estimarTokensEntrada(
    proveedor,
    promptFinal,
    imagen !== undefined,
  );
  const tpm = await leerTpmEfectivo(proveedor, modelo);
  const maxTokens = presupuestoRespuesta(
    proveedor,
    tokensEntrada,
    undefined,
    tpm,
  );
  if (maxTokens === null) {
    const { nombre } = configDe(proveedor);
    return {
      ok: false,
      error: `La consulta no entra en la cuota por minuto de ${nombre} (${tpm} tokens). ${
        imagen
          ? "Las fotos cuestan un extra fijo en este proveedor: probá con otro desde el selector."
          : "Probá con un archivo más corto o cambiá de proveedor en el selector."
      }`,
    };
  }

  const cuota = await estadoCuota(proveedor, modelo, tokensEntrada + maxTokens);
  if (cuota.esperaMs > 0) {
    return {
      ok: false,
      error: mensajeEspera(cuota, configDe(proveedor).nombre, modelo),
    };
  }

  await registrarUso(proveedor, modelo, tokensEntrada + maxTokens, origen);

  const r = await llamar(
    proveedor,
    apiKey,
    modelo,
    { mensajes: [{ rol: "user", contenido: promptFinal, imagen }] },
    maxTokens,
  );
  if (!r.ok) return { ok: false, error: r.error };

  return { ok: true, texto: r.texto };
}

/**
 * Interpreta un estado de cuenta (texto o imagen) con IA.
 * @param fuente Texto o imagen del estado de cuenta.
 * @param proveedorElegido Proveedor a usar solo para este análisis; sin esto, el activo.
 * @returns Los movimientos extraídos, o el error si la IA no pudo interpretarlo.
 */
export async function interpretarEstadoCuentaConIA(
  fuente: FuenteIA,
  proveedorElegido?: ProveedorIA,
): Promise<{
  ok: boolean;
  movimientos?: MovimientoEstadoCuenta[];
  error?: string;
}> {
  const r = await extraerConIA(
    fuente,
    PROMPT_EXTRACCION,
    "estado-cuenta",
    proveedorElegido,
  );
  if (!r.ok) return { ok: false, error: r.error };

  const crudo = extraerJSON(r.texto);
  if (crudo === undefined) {
    return { ok: false, error: mensajeSinJSON(r.texto) };
  }

  const movimientos = validarMovimientos(crudo);
  if (!movimientos) {
    return { ok: false, error: "El modelo no encontró movimientos legibles" };
  }

  return { ok: true, movimientos };
}

export type TicketCrudo = {
  comercio: string;
  fecha: string;
  items: { nombre: string; cantidad: number; precio: number }[];
};

function validarTicket(crudo: unknown): TicketCrudo | null {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const o = crudo as Record<string, unknown>;

  if (!Array.isArray(o.items)) return null;

  const items: TicketCrudo["items"] = [];
  for (const item of o.items) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;

    const nombre = String(i.nombre ?? "").trim();
    if (!nombre) continue;

    const precio =
      typeof i.precio === "number"
        ? i.precio
        : Number(
            String(i.precio ?? "")
              .replace(/\./g, "")
              .replace(",", "."),
          );
    if (!Number.isFinite(precio) || precio <= 0) continue;

    const cantidadCruda =
      typeof i.cantidad === "number"
        ? i.cantidad
        : Number(String(i.cantidad ?? "").replace(",", "."));
    const cantidad =
      Number.isFinite(cantidadCruda) && cantidadCruda > 0 ? cantidadCruda : 1;

    items.push({ nombre, cantidad, precio });
  }

  if (!items.length) return null;

  const fecha = typeof o.fecha === "string" ? o.fecha : "";
  return {
    comercio: String(o.comercio ?? "").trim(),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "",
    items,
  };
}

/**
 * Interpreta una foto de ticket o nota de pedido con IA: una compra con N ítems.
 * @param fuente Imagen del ticket.
 * @param proveedorElegido Proveedor a usar solo para este análisis; sin esto, el activo.
 * @returns El ticket extraído, o el error si la IA no pudo interpretarlo.
 */
export async function interpretarTicketConIA(
  fuente: FuenteIA,
  proveedorElegido?: ProveedorIA,
): Promise<{ ok: boolean; ticket?: TicketCrudo; error?: string }> {
  const r = await extraerConIA(
    fuente,
    PROMPT_EXTRACCION_TICKET,
    "ticket",
    proveedorElegido,
  );
  if (!r.ok) return { ok: false, error: r.error };

  const crudo = extraerJSON(r.texto, ["{", "}"]);
  if (crudo === undefined) {
    return { ok: false, error: mensajeSinJSON(r.texto) };
  }

  const ticket = validarTicket(crudo);
  if (!ticket) {
    return { ok: false, error: "El modelo no encontró ítems legibles en el ticket" };
  }

  return { ok: true, ticket };
}
