"use server";

import { revalidatePath } from "next/cache";
import {
  MAX_CANTIDAD_RESPALDOS,
  escribirCantidadRespaldos,
  leerAjuste,
  leerApiKeyIA,
  leerCatalogoModelos,
  leerModeloIA,
  leerCantidadRespaldos,
  leerModelosRespaldo,
  leerProveedorIA,
  leerRespaldosSinRecortar,
  leerTpmEfectivo,
} from "@/lib/config-server";
import {
  actualizarModelosProveedor,
  guardarModeloIA,
  guardarModelosRespaldoIA,
} from "@/app/actions/configuracion";
import {
  llamar,
  type ImagenAdjunta,
  type RespuestaIA,
} from "@/lib/ia-cliente";
import {
  estadoCuota,
  mensajeEspera,
  registrarUso,
} from "@/lib/limitador-ia";
import {
  cadenaDeModelos,
  candidatosDeRespaldo,
  configDe,
  convieneOtroModelo,
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

  const r = await consultaMinima(proveedor, apiKey, modelo);
  return r.ok
    ? { ok: true, mensaje: `Conexión correcta con ${modelo}` }
    : { ok: false, mensaje: r.error };
}

const TOKENS_CONSULTA_MINIMA = 256;
const MAX_CANDIDATOS_FALLIDOS = 3;

async function consultaMinima(
  proveedor: ProveedorIA,
  apiKey: string,
  modelo: string,
  timeoutMs?: number,
): Promise<RespuestaIA> {
  await registrarUso(proveedor, modelo, TOKENS_CONSULTA_MINIMA, "test");
  return llamar(
    proveedor,
    apiKey,
    modelo,
    {
      mensajes: [{ rol: "user", contenido: "Respondé solamente: OK" }],
      timeoutMs,
    },
    TOKENS_CONSULTA_MINIMA,
  );
}

type ResultadoRespaldos = { respaldos: string[]; aviso: string | null };

/**
 * Lleva la lista de respaldos de un proveedor a la cantidad elegida. Si sobran
 * no toca nada (la lectura ya recorta); si faltan, prueba candidatos con una
 * consulta mínima y sólo agrega los que responden: primero el preferido, después
 * el catálogo recién actualizado.
 * @param proveedor Proveedor cuya lista completar.
 * @param preferido Modelo a probar antes que el catálogo, y la posición que ocuparía.
 * @returns Los respaldos que quedaron y, si hubo que probar modelos, qué pasó.
 */
async function completarRespaldos(
  proveedor: ProveedorIA,
  preferido?: { modelo: string; lugar: number },
): Promise<ResultadoRespaldos> {
  const cantidad = await leerCantidadRespaldos(proveedor);
  const lista = await leerRespaldosSinRecortar(proveedor);
  if (lista.length >= cantidad) {
    return { respaldos: lista.slice(0, cantidad), aviso: null };
  }

  const faltan = (n: number) =>
    `Quedan ${n} de ${cantidad} modelos de respaldo.`;
  const apiKey = await leerApiKeyIA(proveedor);
  if (!apiKey) {
    return {
      respaldos: lista,
      aviso: `${faltan(lista.length)} Sin API key no se puede probar ninguno más.`,
    };
  }

  const principal = await leerModeloIA(proveedor);
  const timeoutMs = await leerAjuste("iaTimeoutChatMs");
  const agregados: string[] = [];
  const descartados: string[] = [];

  if (
    preferido &&
    preferido.modelo !== principal &&
    !lista.includes(preferido.modelo)
  ) {
    const r = await consultaMinima(
      proveedor,
      apiKey,
      preferido.modelo,
      timeoutMs,
    );
    if (r.ok || (r.status !== undefined && r.status >= 500)) {
      lista.splice(Math.min(preferido.lugar, lista.length), 0, preferido.modelo);
      agregados.push(preferido.modelo);
    } else {
      descartados.push(preferido.modelo);
    }
  }

  if (lista.length < cantidad) {
    const catalogo = await actualizarModelosProveedor(proveedor);
    const modelos = catalogo.ok
      ? catalogo.modelos
      : ((await leerCatalogoModelos(proveedor))?.modelos ?? []);
    const candidatos = candidatosDeRespaldo(modelos, principal, [
      principal,
      ...lista,
      ...descartados,
    ]);

    let fallidos = 0;
    for (const candidato of candidatos) {
      if (lista.length >= cantidad || fallidos >= MAX_CANDIDATOS_FALLIDOS) break;
      const r = await consultaMinima(proveedor, apiKey, candidato, timeoutMs);
      if (r.ok) {
        lista.push(candidato);
        agregados.push(candidato);
      } else {
        descartados.push(candidato);
        fallidos++;
      }
    }
  }

  if (agregados.length > 0) {
    await guardarModelosRespaldoIA(proveedor, lista.join(", "));
  }

  const partes = [
    agregados.length > 0 &&
      `Se sumó como respaldo, tras una consulta de prueba: ${agregados.join(", ")}.`,
    descartados.length > 0 &&
      `No sirvieron como respaldo: ${descartados.join(", ")}.`,
    lista.length < cantidad && faltan(lista.length),
  ].filter(Boolean);
  return { respaldos: lista, aviso: partes.join(" ") || null };
}

/**
 * Cambia el modelo principal de un proveedor y, si con eso la lista de
 * respaldos queda corta (el nuevo principal era uno de ellos), la completa
 * probando primero el modelo anterior.
 * @param proveedor Proveedor al que pertenece el modelo.
 * @param modelo Modelo nuevo; vacío vuelve al default del código.
 * @returns Los respaldos que quedaron y, si la lista cambió, qué pasó con ella.
 */
export async function cambiarModeloIA(
  proveedor: ProveedorIA,
  modelo: string,
): Promise<ResultadoRespaldos> {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  const anterior = await leerModeloIA(proveedor);
  const antes = await leerRespaldosSinRecortar(proveedor);
  await guardarModeloIA(proveedor, modelo);
  const principal = await leerModeloIA(proveedor);

  const lugar = antes.indexOf(principal);
  return completarRespaldos(proveedor, {
    modelo: anterior,
    lugar: lugar === -1 ? antes.length : lugar,
  });
}

/**
 * Guarda cuántos modelos de respaldo quiere el usuario para un proveedor y
 * completa la lista si quedó corta.
 * @param proveedor Proveedor al que aplica.
 * @param cantidad Cantidad de respaldos; `null` vuelve al default del código.
 * @returns Los respaldos que quedaron y, si hubo que probar modelos, qué pasó.
 */
export async function guardarCantidadRespaldosIA(
  proveedor: ProveedorIA,
  cantidad: number | null,
): Promise<ResultadoRespaldos> {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  if (
    cantidad !== null &&
    (!Number.isInteger(cantidad) ||
      cantidad < 0 ||
      cantidad > MAX_CANTIDAD_RESPALDOS)
  ) {
    throw new Error(
      `La cantidad de respaldos tiene que ser un número entre 0 y ${MAX_CANTIDAD_RESPALDOS}`,
    );
  }
  await escribirCantidadRespaldos(proveedor, cantidad);
  revalidatePath("/ajustes");
  return completarRespaldos(proveedor);
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
{"comercio":"...","fecha":"YYYY-MM-DD","items":[{"nombre":"...","cantidad":1,"peso":null,"precioPorKilo":null,"precio":1234.56}]}

Reglas:
- Es UNA sola compra: todos los productos van en "items".
- "precio" es el importe TOTAL de esa línea, no el precio unitario.
- "cantidad" es cuántas unidades: si el ticket no la aclara, usá 1.
- "peso" es el peso en KILOS de una línea vendida por balanza (fiambre, quesos, verdura, carne, pan por peso). Convertilo a kilos: "320 g" es 0.32, "1/2 kg" es 0.5, "1,250" de balanza es 1.25. Si la línea no es por peso o el ticket no dice el peso, usá null.
- "precioPorKilo" es el precio por kilo cuando el ticket lo muestra, en general al lado del peso ("0,320 x 650"). Si no aparece, usá null.
- En una línea por peso, "cantidad" es 1: el peso va en "peso", nunca en "cantidad".
- Transcribí el nombre del producto tal como está escrito, sin corregirlo ni expandirlo.
- Ignorá subtotales, totales y descuentos: solo los productos.
- Si el ticket no dice el comercio, usá "" (string vacío).
- Si el ticket no tiene fecha, usá "" (string vacío).
- El año puede venir en 2 dígitos: asumí 20XX.
- No redondees los importes, respetá los decimales.`;

const PROMPT_EXTRACCION_LINK = `En esta foto de un ticket uruguayo hay impreso un link de consulta de DGI, con esta forma:
https://www.efactura.dgi.gub.uy/consultaQR/cfe?RUC,tipo,serie,numero,monto,fecha,hash
Devolvé SOLO un objeto JSON, sin texto alrededor: {"link":"..."}

Reglas:
- El link suele ocupar varios renglones: unilos en uno solo, sin espacios.
- Transcribilo carácter por carácter, respetando mayúsculas y minúsculas. No corrijas ni completes nada.
- Conservá los escapes tal como están impresos (%2b, %2f, %3d).
- Si el ticket imprime aparte el RUC y el "Código de seguridad" (los primeros 6 caracteres del último campo), usalos para resolver caracteres dudosos, como 0 y O.
- Si la foto no tiene ese link, devolvé {"link":null}.`;

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
  | { ok: true; texto: string; aviso?: string }
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
  const principal = await leerModeloIA(proveedor);
  const modelos = cadenaDeModelos(
    principal,
    await leerModelosRespaldo(proveedor),
  );

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
  let errorPrincipal: string | null = null;
  const sinRespuesta: string[] = [];

  for (const modelo of modelos) {
    const tpm = await leerTpmEfectivo(proveedor, modelo);
    const maxTokens = presupuestoRespuesta(
      proveedor,
      tokensEntrada,
      undefined,
      tpm,
    );
    if (maxTokens === null) {
      if (errorPrincipal !== null) continue;
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

    const cuota = await estadoCuota(
      proveedor,
      modelo,
      tokensEntrada + maxTokens,
    );
    if (cuota.esperaMs > 0) {
      if (errorPrincipal !== null) continue;
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
    if (r.ok) {
      return {
        ok: true,
        texto: r.texto,
        aviso:
          modelo === principal
            ? undefined
            : `Respondió ${modelo} porque ${principal} no estaba disponible. Puede leer con menos precisión: revisá el resultado.`,
      };
    }

    errorPrincipal ??= r.error;
    if (!convieneOtroModelo(r.status)) {
      return { ok: false, error: modelo === principal ? r.error : errorPrincipal };
    }
    sinRespuesta.push(modelo);
  }

  const respaldos = sinRespuesta.filter((m) => m !== principal);
  return {
    ok: false,
    error:
      respaldos.length > 0
        ? `${errorPrincipal} Tampoco respondieron los modelos de respaldo (${respaldos.join(", ")}).`
        : (errorPrincipal ?? "El proveedor no respondió"),
  };
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
  aviso?: string;
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

  return { ok: true, movimientos, aviso: r.aviso };
}

export type TicketCrudo = {
  comercio: string;
  fecha: string;
  items: {
    nombre: string;
    cantidad: number;
    peso: number | null;
    precioPorKilo: number | null;
    precio: number;
  }[];
};

function pesoOpcional(valor: unknown): number | null {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  }
  const texto = String(valor ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!texto) return null;

  const fraccion = texto.match(/^(\d+)\/(\d+)$/);
  if (fraccion) {
    const dividido = Number(fraccion[1]) / Number(fraccion[2]);
    return Number.isFinite(dividido) && dividido > 0 ? dividido : null;
  }

  const numero = Number(texto.replace(",", "."));
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function importeOpcional(valor: unknown): number | null {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  }
  const texto = String(valor ?? "").trim();
  if (!texto) return null;

  const numero = Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

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

    items.push({
      nombre,
      cantidad,
      peso: pesoOpcional(i.peso),
      precioPorKilo: importeOpcional(i.precioPorKilo),
      precio,
    });
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
): Promise<{ ok: boolean; ticket?: TicketCrudo; error?: string; aviso?: string }> {
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

  return { ok: true, ticket, aviso: r.aviso };
}

/**
 * Lee con IA el link de consulta de DGI impreso en un ticket que no trae QR.
 * @param fuente Imagen del ticket.
 * @param proveedorElegido Proveedor a usar solo para esta lectura; sin esto, el activo.
 * @returns El link tal como lo transcribió el modelo, o el error si no lo encontró.
 */
export async function interpretarLinkCfeConIA(
  fuente: FuenteIA,
  proveedorElegido?: ProveedorIA,
): Promise<{ ok: boolean; link?: string; error?: string; aviso?: string }> {
  const r = await extraerConIA(
    fuente,
    PROMPT_EXTRACCION_LINK,
    "ticket",
    proveedorElegido,
  );
  if (!r.ok) return { ok: false, error: r.error };

  const crudo = extraerJSON(r.texto, ["{", "}"]);
  if (crudo === undefined) {
    return { ok: false, error: mensajeSinJSON(r.texto) };
  }

  const link =
    crudo && typeof crudo === "object"
      ? (crudo as Record<string, unknown>).link
      : null;
  if (typeof link !== "string" || !link.trim()) {
    return {
      ok: false,
      error: "La IA no encontró un link de consulta de DGI en la foto",
    };
  }

  return { ok: true, link: link.trim(), aviso: r.aviso };
}
