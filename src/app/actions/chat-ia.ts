"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  categorias,
  conversacionesIA,
  emisores,
  mensajesIA,
  reportesAdjuntos,
} from "@/db/schema";
import {
  exportarReporteJSON,
  type FiltrosReporte,
} from "@/app/actions/reportes";
import {
  leerApiKeyIA,
  leerModeloIA,
  leerProveedorIA,
  leerTimeoutIaChatMs,
  leerTpmEfectivo,
} from "@/lib/config-server";
import { llamar, type MensajeIA } from "@/lib/ia-cliente";
import {
  estadoCuota,
  mensajeEspera,
  registrarUso,
  type EstadoCuota,
} from "@/lib/limitador-ia";
import {
  configDe,
  esProveedorValido,
  MIN_TOKENS_RESPUESTA_CHAT,
  presupuestoRespuesta,
  techoRespuestaChat,
  type ProveedorIA,
} from "@/lib/proveedores-ia";
import {
  ENCABEZADO_REPORTE,
  estimarTokensMensaje,
  LIMITE_CARACTERES_MENSAJE,
  limiteContexto,
  limpiarRespuestaChat,
  MARCA_RESPUESTA_CORTADA,
  podarHistorial,
  PROMPT_SISTEMA_CHAT,
} from "@/lib/chat-ia";

const TITULO_POR_DEFECTO = "Nueva conversación";
const LARGO_MAX_TITULO = 80;

export type ResumenConversacion = {
  id: number;
  titulo: string;
  proveedor: string;
  modelo: string;
  actualizadaEn: string;
};

export type MensajeChat = {
  id: number;
  rol: "user" | "assistant";
  contenido: string;
  tokensEstimados: number;
  esResumen: boolean;
  creadoEn: string;
};

export type ConversacionCompleta = {
  id: number;
  titulo: string;
  proveedor: ProveedorIA;
  modelo: string;
  creadaEn: string;
  actualizadaEn: string;
  mensajes: MensajeChat[];
  tokensContexto: number;
  limiteContexto: number;
  avisoChat?: string;
  cuota: EstadoCuota;
  adjuntoPendiente: ResumenAdjunto | null;
  adjuntosPrevios: ResumenAdjunto[];
};

export type ResumenAdjunto = {
  id: number;
  etiqueta: string;
  tokensEstimados: number;
  creadoEn: string;
  usadoEn: string | null;
  excedeContexto: boolean;
};

export async function listarConversaciones(): Promise<ResumenConversacion[]> {
  return db
    .select({
      id: conversacionesIA.id,
      titulo: conversacionesIA.titulo,
      proveedor: conversacionesIA.proveedor,
      modelo: conversacionesIA.modelo,
      actualizadaEn: conversacionesIA.actualizadaEn,
    })
    .from(conversacionesIA)
    .orderBy(desc(conversacionesIA.actualizadaEn));
}

/**
 * @param id Id de la conversación.
 * @returns La conversación completa con mensajes, cuota y adjuntos, o null si no existe.
 */
export async function obtenerConversacion(
  id: number,
): Promise<ConversacionCompleta | null> {
  if (!Number.isInteger(id)) return null;

  const [conv] = await db
    .select()
    .from(conversacionesIA)
    .where(eq(conversacionesIA.id, id))
    .limit(1);
  if (!conv) return null;

  const mensajes = await mensajesVivos(id);

  const proveedor: ProveedorIA = esProveedorValido(conv.proveedor)
    ? conv.proveedor
    : await leerProveedorIA();

  const limite = limiteContexto(
    proveedor,
    await leerTpmEfectivo(proveedor, conv.modelo),
  );
  const adjuntos = await listarAdjuntos(id, limite);

  return {
    id: conv.id,
    titulo: conv.titulo,
    proveedor,
    modelo: conv.modelo,
    creadaEn: conv.creadaEn,
    actualizadaEn: conv.actualizadaEn,
    mensajes,
    tokensContexto: mensajes.reduce((acc, m) => acc + m.tokensEstimados, 0),
    limiteContexto: limite,
    avisoChat: configDe(proveedor).avisoChat,
    cuota: await estadoCuota(proveedor, conv.modelo, 0),
    adjuntoPendiente: adjuntos.find((a) => a.pendiente)?.resumen ?? null,
    adjuntosPrevios: adjuntos
      .filter((a) => !a.pendiente)
      .map((a) => a.resumen),
  };
}

async function listarAdjuntos(
  conversacionId: number,
  limiteContextoConversacion: number,
): Promise<{ pendiente: boolean; resumen: ResumenAdjunto }[]> {
  const filas = await db
    .select({
      id: reportesAdjuntos.id,
      etiqueta: reportesAdjuntos.etiqueta,
      tokensEstimados: reportesAdjuntos.tokensEstimados,
      creadoEn: reportesAdjuntos.creadoEn,
      usadoEn: reportesAdjuntos.usadoEn,
      pendiente: reportesAdjuntos.pendiente,
    })
    .from(reportesAdjuntos)
    .where(eq(reportesAdjuntos.conversacionId, conversacionId))
    .orderBy(desc(reportesAdjuntos.id));

  return filas.map(({ pendiente, ...fila }) => ({
    pendiente,
    resumen: {
      ...fila,
      excedeContexto: fila.tokensEstimados > limiteContextoConversacion,
    },
  }));
}

async function mensajesVivos(conversacionId: number): Promise<MensajeChat[]> {
  return db
    .select({
      id: mensajesIA.id,
      rol: mensajesIA.rol,
      contenido: mensajesIA.contenido,
      tokensEstimados: mensajesIA.tokensEstimados,
      esResumen: mensajesIA.esResumen,
      creadoEn: mensajesIA.creadoEn,
    })
    .from(mensajesIA)
    .where(
      and(
        eq(mensajesIA.conversacionId, conversacionId),
        isNull(mensajesIA.archivadoEn),
      ),
    )
    .orderBy(asc(mensajesIA.id));
}

/**
 * Crea una conversación nueva con el proveedor y modelo elegidos (o los
 * configurados en Ajustes por defecto).
 * @param opciones Proveedor/modelo a fijar para esta conversación.
 * @returns El id de la conversación creada.
 */
export async function crearConversacion(opciones?: {
  proveedor?: string;
  modelo?: string;
}): Promise<number> {
  const { proveedor, modelo } = await resolverProveedorYModelo(opciones);
  const ahora = new Date().toISOString();

  const [fila] = await db
    .insert(conversacionesIA)
    .values({
      titulo: TITULO_POR_DEFECTO,
      proveedor,
      modelo,
      creadaEn: ahora,
      actualizadaEn: ahora,
    })
    .returning({ id: conversacionesIA.id });

  revalidatePath("/reportes/asistente");
  return fila.id;
}

async function resolverProveedorYModelo(opciones?: {
  proveedor?: string;
  modelo?: string;
}): Promise<{ proveedor: ProveedorIA; modelo: string }> {
  const pedido = opciones?.proveedor?.trim();
  let proveedor: ProveedorIA;
  if (pedido) {
    if (!esProveedorValido(pedido)) {
      throw new Error(`El proveedor "${pedido}" no existe`);
    }
    proveedor = pedido;
  } else {
    proveedor = await leerProveedorIA();
  }
  if (!(await leerApiKeyIA(proveedor))) {
    throw new Error(
      `No hay API key configurada para ${configDe(proveedor).nombre}. Configurala en Ajustes.`,
    );
  }
  const modelo = opciones?.modelo?.trim();
  return { proveedor, modelo: modelo || (await leerModeloIA(proveedor)) };
}

/**
 * Cuota del proveedor de una conversación, o del proveedor activo si no se
 * pasa `conversacionId` (para mostrarla antes de crear una conversación nueva).
 * @param conversacionId Conversación cuyo proveedor consultar.
 * @returns El estado de cuota de ese proveedor.
 */
export async function estadoCuotaChat(
  conversacionId?: number,
): Promise<EstadoCuota> {
  if (conversacionId !== undefined && Number.isInteger(conversacionId)) {
    const [conv] = await db
      .select({
        proveedor: conversacionesIA.proveedor,
        modelo: conversacionesIA.modelo,
      })
      .from(conversacionesIA)
      .where(eq(conversacionesIA.id, conversacionId))
      .limit(1);
    if (conv && esProveedorValido(conv.proveedor)) {
      return estadoCuota(conv.proveedor, conv.modelo, 0);
    }
  }

  const proveedor = await leerProveedorIA();
  return estadoCuota(proveedor, await leerModeloIA(proveedor), 0);
}

export async function renombrarConversacion(id: number, titulo: string) {
  const limpio = titulo.trim().slice(0, LARGO_MAX_TITULO);
  if (!limpio) throw new Error("El título no puede estar vacío");

  await db
    .update(conversacionesIA)
    .set({ titulo: limpio })
    .where(eq(conversacionesIA.id, id));
  revalidatePath("/reportes/asistente");
}

export async function borrarConversacion(id: number) {
  await db.delete(conversacionesIA).where(eq(conversacionesIA.id, id));
  revalidatePath("/reportes/asistente");
}

const MAX_ADJUNTOS_USADOS = 5;

export type DestinoAnalisis =
  | { tipo: "nueva"; proveedor?: string; modelo?: string }
  | { tipo: "existente"; conversacionId: number };

export type DestinoPosible = {
  id: number;
  titulo: string;
  modelo: string;
  proveedorNombre: string;
  actualizadaEn: string;
  tokensReporte: number;
  entra: boolean;
};

/**
 * Calcula, para el reporte que se está por exportar desde /reportes, cuánto
 * ocuparía en cada conversación existente.
 * @param filtros Filtros del reporte a exportar.
 * @returns La etiqueta del recorte, su tamaño en caracteres y en qué conversaciones entra.
 */
export async function destinosParaReporte(filtros: FiltrosReporte): Promise<{
  etiqueta: string;
  caracteresReporte: number;
  conversaciones: DestinoPosible[];
}> {
  const json = await exportarReporteJSON(filtros);
  const filas = await db
    .select()
    .from(conversacionesIA)
    .orderBy(desc(conversacionesIA.actualizadaEn));

  const conversaciones = await Promise.all(
    filas.map(async (c): Promise<DestinoPosible> => {
      const proveedor: ProveedorIA = esProveedorValido(c.proveedor)
        ? c.proveedor
        : await leerProveedorIA();
      const tokensReporte = estimarTokensMensaje(proveedor, json);
      const limite = limiteContexto(
        proveedor,
        await leerTpmEfectivo(proveedor, c.modelo),
      );
      return {
        id: c.id,
        titulo: c.titulo,
        modelo: c.modelo,
        proveedorNombre: configDe(proveedor).nombre,
        actualizadaEn: c.actualizadaEn,
        tokensReporte,
        entra: tokensReporte <= limite,
      };
    }),
  );

  return {
    etiqueta: await describirRecorte(filtros),
    caracteresReporte: json.length,
    conversaciones,
  };
}

/**
 * Genera el reporte y lo deja como adjunto pendiente en una conversación,
 * nueva o existente.
 * @param filtros Filtros del reporte a exportar.
 * @param destino Conversación nueva o existente donde adjuntarlo.
 * @returns El id de la conversación y el resumen del adjunto creado.
 */
export async function prepararReporteParaChat(
  filtros: FiltrosReporte,
  destino: DestinoAnalisis,
): Promise<{ conversacionId: number; adjunto: ResumenAdjunto }> {
  const conversacionId =
    destino.tipo === "nueva"
      ? await crearConversacion({
          proveedor: destino.proveedor,
          modelo: destino.modelo,
        })
      : destino.conversacionId;

  const [conv] = await db
    .select()
    .from(conversacionesIA)
    .where(eq(conversacionesIA.id, conversacionId))
    .limit(1);
  if (!conv) throw new Error("La conversación no existe");

  const proveedor: ProveedorIA = esProveedorValido(conv.proveedor)
    ? conv.proveedor
    : await leerProveedorIA();

  const json = await exportarReporteJSON(filtros);
  const ahora = new Date().toISOString();

  await descartarPendiente(conversacionId);

  const [fila] = await db
    .insert(reportesAdjuntos)
    .values({
      conversacionId,
      json,
      etiqueta: await describirRecorte(filtros),
      filtros: JSON.stringify(filtros),
      tokensEstimados: estimarTokensMensaje(proveedor, json),
      pendiente: true,
      creadoEn: ahora,
    })
    .returning();

  await podarAdjuntos(conversacionId);
  revalidatePath("/reportes/asistente");

  return {
    conversacionId,
    adjunto: {
      id: fila.id,
      etiqueta: fila.etiqueta,
      tokensEstimados: fila.tokensEstimados,
      creadoEn: fila.creadoEn,
      usadoEn: null,
      excedeContexto:
        fila.tokensEstimados >
        limiteContexto(
          proveedor,
          await leerTpmEfectivo(proveedor, conv.modelo),
        ),
    },
  };
}

/**
 * Vuelve a poner como pendiente un reporte ya usado en el hilo, sin regenerarlo.
 * @param adjuntoId Id del adjunto a reutilizar.
 * @returns El resumen del adjunto, ahora marcado como pendiente.
 */
export async function reutilizarAdjunto(
  adjuntoId: number,
): Promise<ResumenAdjunto> {
  const [fila] = await db
    .select({
      id: reportesAdjuntos.id,
      conversacionId: reportesAdjuntos.conversacionId,
      etiqueta: reportesAdjuntos.etiqueta,
      tokensEstimados: reportesAdjuntos.tokensEstimados,
      creadoEn: reportesAdjuntos.creadoEn,
      usadoEn: reportesAdjuntos.usadoEn,
    })
    .from(reportesAdjuntos)
    .where(eq(reportesAdjuntos.id, adjuntoId))
    .limit(1);
  if (!fila) throw new Error("El reporte adjunto ya no existe");

  await descartarPendiente(fila.conversacionId);
  await db
    .update(reportesAdjuntos)
    .set({ pendiente: true })
    .where(eq(reportesAdjuntos.id, adjuntoId));
  revalidatePath("/reportes/asistente");

  const [conv] = await db
    .select({
      proveedor: conversacionesIA.proveedor,
      modelo: conversacionesIA.modelo,
    })
    .from(conversacionesIA)
    .where(eq(conversacionesIA.id, fila.conversacionId))
    .limit(1);
  const proveedor: ProveedorIA =
    conv && esProveedorValido(conv.proveedor)
      ? conv.proveedor
      : await leerProveedorIA();

  return {
    id: fila.id,
    etiqueta: fila.etiqueta,
    tokensEstimados: fila.tokensEstimados,
    creadoEn: fila.creadoEn,
    usadoEn: fila.usadoEn,
    excedeContexto:
      fila.tokensEstimados >
      limiteContexto(
        proveedor,
        await leerTpmEfectivo(proveedor, conv?.modelo ?? ""),
      ),
  };
}

export async function descartarAdjuntoPendiente(conversacionId: number) {
  await descartarPendiente(conversacionId);
  revalidatePath("/reportes/asistente");
}

async function descartarPendiente(conversacionId: number) {
  const pendientes = and(
    eq(reportesAdjuntos.conversacionId, conversacionId),
    eq(reportesAdjuntos.pendiente, true),
  );
  await db
    .delete(reportesAdjuntos)
    .where(and(pendientes, isNull(reportesAdjuntos.usadoEn)));
  await db.update(reportesAdjuntos).set({ pendiente: false }).where(pendientes);
}

async function podarAdjuntos(conversacionId: number) {
  const usados = await db
    .select({ id: reportesAdjuntos.id })
    .from(reportesAdjuntos)
    .where(
      and(
        eq(reportesAdjuntos.conversacionId, conversacionId),
        isNotNull(reportesAdjuntos.usadoEn),
      ),
    )
    .orderBy(desc(reportesAdjuntos.id));

  const sobrantes = usados.slice(MAX_ADJUNTOS_USADOS).map((f) => f.id);
  if (sobrantes.length) {
    await db
      .delete(reportesAdjuntos)
      .where(inArray(reportesAdjuntos.id, sobrantes));
  }
}

const FECHA_ABIERTA = "1900-01-01";

async function describirRecorte(filtros: FiltrosReporte): Promise<string> {
  const fecha = (iso: string) => {
    const [anio, mes, dia] = iso.split("-");
    return `${dia}/${mes}/${anio.slice(2)}`;
  };
  const partes = [
    filtros.desde <= FECHA_ABIERTA
      ? `Todo hasta ${fecha(filtros.hasta)}`
      : `${fecha(filtros.desde)} – ${fecha(filtros.hasta)}`,
  ];

  if (filtros.categoriaIds?.length) {
    const filas = await db
      .select({ nombre: categorias.nombre })
      .from(categorias)
      .where(inArray(categorias.id, filtros.categoriaIds));
    partes.push(
      filas.length === 1 ? filas[0].nombre : `${filas.length} categorías`,
    );
  }
  if (filtros.emisorIds?.length) {
    const filas = await db
      .select({ nombre: emisores.nombre })
      .from(emisores)
      .where(inArray(emisores.id, filtros.emisorIds));
    partes.push(
      filas.length === 1 ? filas[0].nombre : `${filas.length} comercios`,
    );
  }

  return partes.join(" · ");
}

export type ResultadoMensaje =
  | {
      ok: true;
      mensajeUsuario: MensajeChat;
      respuesta: MensajeChat;
      tokensContexto: number;
      limiteContexto: number;
      omitidos: number;
      cuota: EstadoCuota;
    }
  | {
      ok: false;
      error: string;
      textoDevuelto?: string;
      cuota?: EstadoCuota;
    };

/**
 * Envía un mensaje del usuario a la conversación y guarda la respuesta del modelo.
 * @param conversacionId Conversación destino.
 * @param contenido Texto del mensaje.
 * @param adjuntoId Id del reporte preparado a concatenar antes de la pregunta.
 * @returns El mensaje y la respuesta guardados, o el error si algo falló.
 */
export async function enviarMensaje(
  conversacionId: number,
  contenido: string,
  adjuntoId?: number,
): Promise<ResultadoMensaje> {
  const pregunta = contenido.trim();
  if (!pregunta) return { ok: false, error: "El mensaje está vacío" };

  const adjunto =
    adjuntoId === undefined
      ? null
      : ((
          await db
            .select()
            .from(reportesAdjuntos)
            .where(
              and(
                eq(reportesAdjuntos.id, adjuntoId),
                eq(reportesAdjuntos.conversacionId, conversacionId),
              ),
            )
            .limit(1)
        )[0] ?? null);
  if (adjuntoId !== undefined && !adjunto) {
    return {
      ok: false,
      error: "El reporte adjunto ya no está disponible. Volvé a adjuntarlo.",
      textoDevuelto: pregunta,
    };
  }

  const textoFinal = adjunto
    ? `${ENCABEZADO_REPORTE}\n\n${adjunto.json.trim()}\n\n${pregunta}`
    : pregunta;

  if (textoFinal.length > LIMITE_CARACTERES_MENSAJE) {
    return {
      ok: false,
      error: `El mensaje es demasiado largo (${textoFinal.length.toLocaleString("es-UY")} caracteres, el máximo es ${LIMITE_CARACTERES_MENSAJE.toLocaleString("es-UY")}). ${
        adjunto
          ? "Probá con un período más corto en el reporte adjunto."
          : "Probá con un mensaje más corto."
      }`,
      textoDevuelto: pregunta,
    };
  }

  const [conv] = await db
    .select()
    .from(conversacionesIA)
    .where(eq(conversacionesIA.id, conversacionId))
    .limit(1);
  if (!conv) {
    return { ok: false, error: "La conversación no existe", textoDevuelto: pregunta };
  }
  if (!esProveedorValido(conv.proveedor)) {
    return {
      ok: false,
      error: "La conversación quedó atada a un proveedor que ya no existe. Creá una nueva.",
      textoDevuelto: pregunta,
    };
  }
  const proveedor: ProveedorIA = conv.proveedor;
  const config = configDe(proveedor);

  const apiKey = await leerApiKeyIA(proveedor);
  if (!apiKey) {
    return {
      ok: false,
      error: `No hay API key configurada para ${config.nombre}. Configurala en Ajustes.`,
      textoDevuelto: pregunta,
    };
  }

  const tokensMensaje = estimarTokensMensaje(proveedor, textoFinal);
  const historial = await mensajesVivos(conversacionId);

  const tpm = await leerTpmEfectivo(proveedor, conv.modelo);
  const limite = limiteContexto(proveedor, tpm);

  const podado = podarHistorial(
    [
      ...historial,
      { rol: "user" as const, contenido: textoFinal, tokensEstimados: tokensMensaje },
    ],
    limite,
  );

  const tokensEntrada =
    podado.tokensEnviados + estimarTokensMensaje(proveedor, PROMPT_SISTEMA_CHAT);

  const maxTokens = presupuestoRespuesta(
    proveedor,
    tokensEntrada,
    { techo: techoRespuestaChat(proveedor), piso: MIN_TOKENS_RESPUESTA_CHAT },
    tpm,
  );
  if (maxTokens === null) {
    return {
      ok: false,
      error: `La consulta no entra en la cuota por minuto de ${config.nombre} (${tpm} tokens). Probá con un mensaje más corto, sin reporte adjunto, o cambiá de proveedor en Ajustes y empezá una conversación nueva.`,
      textoDevuelto: pregunta,
    };
  }

  const cuota = await estadoCuota(
    proveedor,
    conv.modelo,
    tokensEntrada + maxTokens,
  );
  if (cuota.esperaMs > 0) {
    return {
      ok: false,
      error: mensajeEspera(cuota, config.nombre, conv.modelo),
      textoDevuelto: pregunta,
      cuota,
    };
  }

  const ahora = new Date().toISOString();
  const [insertado] = await db
    .insert(mensajesIA)
    .values({
      conversacionId,
      rol: "user",
      contenido: textoFinal,
      tokensEstimados: tokensMensaje,
      creadoEn: ahora,
    })
    .returning();

  await registrarUso(proveedor, conv.modelo, tokensEntrada + maxTokens, "chat");

  const r = await llamar(
    proveedor,
    apiKey,
    conv.modelo,
    {
      systemPrompt: PROMPT_SISTEMA_CHAT,
      mensajes: marcarCorteDeCache(podado.mensajes),
      cachear: true,
      timeoutMs: await leerTimeoutIaChatMs(),
      reintentos: 1,
    },
    maxTokens,
  );

  if (!r.ok) {
    await db.delete(mensajesIA).where(eq(mensajesIA.id, insertado.id));
    return { ok: false, error: r.error, textoDevuelto: pregunta };
  }

  const limpio = marcarSiCortada(limpiarRespuestaChat(r.texto), r.truncado);
  if (!limpio) {
    await db.delete(mensajesIA).where(eq(mensajesIA.id, insertado.id));
    return {
      ok: false,
      error: "El modelo devolvió una respuesta vacía. Probá de nuevo o cambiá de modelo en Ajustes.",
      textoDevuelto: pregunta,
    };
  }

  const respondidoEn = new Date().toISOString();
  const [respuesta] = await db
    .insert(mensajesIA)
    .values({
      conversacionId,
      rol: "assistant",
      contenido: limpio,
      tokensEstimados: estimarTokensMensaje(proveedor, limpio),
      creadoEn: respondidoEn,
    })
    .returning();

  await db
    .update(conversacionesIA)
    .set({
      actualizadaEn: respondidoEn,
      ...(conv.titulo === TITULO_POR_DEFECTO
        ? { titulo: tituloDesde(pregunta) }
        : {}),
    })
    .where(eq(conversacionesIA.id, conversacionId));

  if (adjunto) {
    await db
      .update(reportesAdjuntos)
      .set({ pendiente: false, usadoEn: adjunto.usadoEn ?? respondidoEn })
      .where(eq(reportesAdjuntos.id, adjunto.id));
    await podarAdjuntos(conversacionId);
  }

  revalidatePath("/reportes/asistente");

  const mensajeUsuario: MensajeChat = {
    id: insertado.id,
    rol: "user",
    contenido: insertado.contenido,
    tokensEstimados: insertado.tokensEstimados,
    esResumen: insertado.esResumen,
    creadoEn: insertado.creadoEn,
  };

  return {
    ok: true,
    mensajeUsuario,
    respuesta: {
      id: respuesta.id,
      rol: "assistant",
      contenido: respuesta.contenido,
      tokensEstimados: respuesta.tokensEstimados,
      esResumen: respuesta.esResumen,
      creadoEn: respuesta.creadoEn,
    },
    tokensContexto:
      historial.reduce((acc, m) => acc + m.tokensEstimados, 0) +
      mensajeUsuario.tokensEstimados +
      respuesta.tokensEstimados,
    limiteContexto: limite,
    omitidos: podado.omitidos,
    cuota: await estadoCuota(proveedor, conv.modelo, 0),
  };
}

function marcarSiCortada(texto: string, truncado: boolean | undefined): string {
  return texto && truncado ? texto + MARCA_RESPUESTA_CORTADA : texto;
}

function marcarCorteDeCache(
  mensajes: { rol: "user" | "assistant"; contenido: string }[],
): MensajeIA[] {
  const corte = mensajes.length - 2;
  return mensajes.map((m, i) => ({
    rol: m.rol,
    contenido: m.contenido,
    ...(i === corte ? { cortarCache: true } : {}),
  }));
}

function tituloDesde(pregunta: string): string {
  const primeraLinea = pregunta.split("\n")[0].trim();
  if (primeraLinea.length <= LARGO_MAX_TITULO) {
    return primeraLinea || TITULO_POR_DEFECTO;
  }
  return `${primeraLinea.slice(0, LARGO_MAX_TITULO - 1).trimEnd()}…`;
}
