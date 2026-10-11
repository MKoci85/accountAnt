import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categorias, emisores, gastos, gastosEntrantes } from "@/db/schema";
import { montoDesdeQR, parsearQR } from "@/lib/cfe";
import { leerAjustesBandeja } from "@/lib/config-server";
import { esFechaISOValida } from "@/lib/formato";
import {
  claveComprobante,
  motivoDeRevision,
  parsearItemsEntrante,
  type ItemEntrante,
} from "@/lib/entrantes";
import {
  guardarImagenEntrante,
  leerImagenEntrante,
} from "@/lib/entrantes-server";
import { buscarQREnImagen, imagenParaIA } from "@/lib/imagen-servidor";
import {
  lineasDesdeTicket,
  montoDeLinea,
  normalizarLineasDeServicio,
} from "@/lib/lineas-gasto";
import {
  consultarCFE,
  interpretarTicket,
  resolverItemContraCatalogo,
  type ItemTicket,
} from "@/app/actions/cfe";
import { guardarGasto, obtenerHormigaHeredada } from "@/app/actions/gastos";
import { interpretarLinkCfeConIA } from "@/app/actions/ia";

// Lectura de un comprobante recibido y decisión de adónde va: a la bandeja o
// directo a gasto. Sin "use server": recibe un Buffer, y todo lo que exporta
// un módulo "use server" queda invocable desde el navegador. Lo llaman las
// acciones de `actions/entrantes.ts` y el webhook.

type Entrante = typeof gastosEntrantes.$inferSelect;
type CanalEntrante = Entrante["canal"];
type Lectura = Pick<
  Entrante,
  | "estado"
  | "lectura"
  | "qrTexto"
  | "claveComprobante"
  | "emisorId"
  | "comercio"
  | "fecha"
  | "total"
  | "itemsJson"
  | "aviso"
  | "error"
>;

const LECTURA_VACIA: Lectura = {
  estado: "error",
  lectura: null,
  qrTexto: null,
  claveComprobante: null,
  emisorId: null,
  comercio: null,
  fecha: null,
  total: null,
  itemsJson: "[]",
  aviso: null,
  error: null,
};

function itemsCrudos(items: ItemTicket[]): string {
  const crudos: ItemEntrante[] = items.map((item) => ({
    nombre: item.nombreTicket,
    precio: item.precio,
    tamano: item.tamanoTicket,
    unidades: item.unidadesTicket,
    pesoTicket: item.pesoTicket,
    precioPorKiloTicket: item.precioPorKiloTicket,
  }));
  return JSON.stringify(crudos);
}

function unirAvisos(...avisos: (string | null | undefined)[]): string | null {
  const presentes = avisos.filter((a): a is string => Boolean(a));
  return presentes.length ? presentes.join(" ") : null;
}

/**
 * Resuelve un QR (o el link de DGI equivalente) con el mismo `consultarCFE` del
 * escáner. Un comprobante que DGI no confirma queda en error pero conserva el
 * texto: reintentar no tiene que volver a leer la foto.
 */
async function leerDesdeQR(
  qrTexto: string,
  lectura: "qr" | "link",
  avisoPrevio: string | null = null
): Promise<Lectura> {
  const r = await consultarCFE(qrTexto);
  if (!r.ok) {
    return { ...LECTURA_VACIA, lectura, qrTexto, error: r.error };
  }

  const { resultado } = r;
  return {
    estado: "pendiente",
    lectura,
    qrTexto,
    claveComprobante: claveComprobante(resultado.datosQR),
    emisorId: resultado.emisor.id,
    comercio: null,
    fecha: resultado.fechaISO,
    // Con aviso de moneda el total quedó sin convertir: no es un monto en pesos.
    // Sin detalle del proveedor queda el monto del propio QR, que es contra lo
    // que se cotejan los ítems que se carguen a mano o lea la IA.
    total: resultado.avisoMoneda
      ? null
      : (resultado.total ?? montoDesdeQR(resultado.datosQR.monto)),
    itemsJson: itemsCrudos(resultado.items),
    aviso: unirAvisos(
      avisoPrevio,
      resultado.errorProveedor,
      resultado.avisoMoneda,
      lectura === "link"
        ? "El link se leyó de la foto con IA: revisá fecha y total contra el papel."
        : null
    ),
    error: null,
  };
}

/**
 * Un comprobante validado que llegó sin ítems (el comercio no tiene proveedor
 * de CFE mapeado, o el proveedor no contestó) los toma de la foto, leídos por
 * IA. El encabezado sigue siendo el del QR: emisor, fecha, número y total no
 * se pisan con lo que lea el modelo. Si la IA tampoco puede, queda como estaba
 * — sin ítems, para cargarlos a mano — y el aviso dice por qué.
 *
 * Es opcional (`bandeja_items_con_ia`, apagado salvo que se prenda): la foto
 * queda guardada y se puede abrir, así que mandarla a un tercero es decisión
 * del usuario y no algo que pase solo.
 */
async function completarItemsConIA(lectura: Lectura, imagen: Buffer): Promise<Lectura> {
  if (lectura.estado !== "pendiente" || parsearItemsEntrante(lectura.itemsJson).length) {
    return lectura;
  }
  if (!(await leerAjustesBandeja()).itemsConIA) return lectura;

  const ticket = await interpretarTicket({
    tipo: "imagen",
    ...(await imagenParaIA(imagen)),
  }).catch((e): Awaited<ReturnType<typeof interpretarTicket>> => ({
    ok: false,
    error: e instanceof Error ? e.message : "error desconocido",
  }));
  if (!ticket.ok || !ticket.ticket?.items.length) {
    const motivo = ticket.ok ? "no encontró ninguno" : (ticket.error ?? "sin detalle");
    return {
      ...lectura,
      aviso: unirAvisos(
        lectura.aviso,
        `No se pudieron leer los ítems de la foto con IA (${motivo}): cargalos a mano o volvé a leer.`
      ),
    };
  }

  return {
    ...lectura,
    itemsJson: itemsCrudos(ticket.ticket.items),
    aviso: unirAvisos(
      lectura.aviso,
      ticket.aviso,
      "Los ítems se leyeron de la foto con IA: revisalos contra el papel."
    ),
  };
}

/**
 * Lee una foto de comprobante en el orden en que cada camino es más confiable:
 * QR, link de DGI impreso (leído por IA y validado igual que un QR), y recién
 * al final el ticket entero leído por IA.
 */
async function leerImagen(imagen: Buffer): Promise<Lectura> {
  const qr = await buscarQREnImagen(imagen).catch(() => null);
  if (qr) return completarItemsConIA(await leerDesdeQR(qr, "qr"), imagen);

  const fuente = { tipo: "imagen" as const, ...(await imagenParaIA(imagen)) };

  const link = await interpretarLinkCfeConIA(fuente);
  if (link.ok && link.link) {
    const desdeLink = await leerDesdeQR(link.link, "link", link.aviso ?? null);
    if (desdeLink.estado === "pendiente") return completarItemsConIA(desdeLink, imagen);
  }

  const ticket = await interpretarTicket(fuente);
  if (!ticket.ok || !ticket.ticket) {
    return {
      ...LECTURA_VACIA,
      error: ticket.error ?? "No se pudo leer el comprobante de la foto.",
    };
  }

  return {
    ...LECTURA_VACIA,
    estado: "pendiente",
    lectura: "ticket",
    comercio: ticket.ticket.comercio || null,
    fecha: esFechaISOValida(ticket.ticket.fecha) ? ticket.ticket.fecha : null,
    itemsJson: itemsCrudos(ticket.ticket.items),
    aviso: unirAvisos(
      ticket.aviso,
      "Leído de la foto con IA, sin comprobante validado: revisá ítems y precios contra el papel."
    ),
  };
}

export type ResultadoRecepcion =
  | {
      ok: true;
      destino: "bandeja";
      id: number;
      estado: Entrante["estado"];
      error: string | null;
      /** Por qué no se guardó solo; null si el guardado automático está apagado. */
      pendientePor: string | null;
    }
  | { ok: true; destino: "gasto"; gastoId: number; comercio: string; total: number }
  | { ok: false; motivo: "en-bandeja" | "ya-cargado"; mensaje: string };

/**
 * Si el comprobante ya está en la bandeja o ya es un gasto. El índice único de
 * `gastos` frenaría el segundo caso recién al guardar, después de haber hecho
 * revisar al usuario un comprobante que ya tenía.
 */
async function comprobanteRepetido(
  lectura: Lectura,
  ignorarEntranteId?: number
): Promise<Extract<ResultadoRecepcion, { ok: false }> | null> {
  if (!lectura.claveComprobante || !lectura.qrTexto) return null;

  const enBandeja = await db
    .select({ id: gastosEntrantes.id })
    .from(gastosEntrantes)
    .where(eq(gastosEntrantes.claveComprobante, lectura.claveComprobante));
  if (enBandeja.some((e) => e.id !== ignorarEntranteId)) {
    return {
      ok: false,
      motivo: "en-bandeja",
      mensaje: "Ese comprobante ya está en la bandeja de entrada.",
    };
  }

  if (lectura.emisorId !== null) {
    const datos = parsearQR(lectura.qrTexto);
    const cargado = await db
      .select({ id: gastos.id })
      .from(gastos)
      .where(
        and(
          eq(gastos.emisorId, lectura.emisorId),
          eq(gastos.tipoCfe, datos.tipoCfe),
          eq(gastos.serie, datos.serie),
          eq(gastos.numero, datos.numero)
        )
      )
      .limit(1);
    if (cargado.length) {
      return {
        ok: false,
        motivo: "ya-cargado",
        mensaje: "Ese comprobante ya está cargado como gasto.",
      };
    }
  }

  return null;
}

/**
 * Intenta guardar el comprobante directo como gasto. Sólo pasa el que no deja
 * nada por decidir (ver `motivoDeRevision`); la marca hormiga se hereda por
 * ítem + comercio, igual que en el formulario.
 * @returns El gasto creado, o el motivo por el que tiene que revisarse a mano.
 */
async function guardarSiNoHayNadaQueRevisar(
  lectura: Lectura
): Promise<
  | { guardado: true; gastoId: number; comercio: string; total: number }
  | { guardado: false; motivo: string }
> {
  const resueltos = await Promise.all(
    parsearItemsEntrante(lectura.itemsJson).map((item) =>
      resolverItemContraCatalogo(item)
    )
  );
  const { lineas } = normalizarLineasDeServicio(
    lineasDesdeTicket(
      resueltos.map((item) => ({ ...item, bloqueada: item.itemCatalogo !== null }))
    ),
    await db.select().from(categorias)
  );

  const motivo = motivoDeRevision({
    lectura: lectura.lectura,
    aviso: lectura.aviso,
    total: lectura.total,
    lineas: lineas.map((l) => ({
      catalogada: l.item.id > 0,
      cantidad: l.cantidad,
      precio: montoDeLinea(l.precio),
    })),
  });
  if (motivo !== null) return { guardado: false, motivo };
  if (
    lectura.emisorId === null ||
    lectura.fecha === null ||
    lectura.total === null ||
    lectura.qrTexto === null
  ) {
    return { guardado: false, motivo: "Al comprobante le faltan datos." };
  }

  const hormigas = new Set(
    await obtenerHormigaHeredada(
      lectura.emisorId,
      lineas.map((l) => l.item.id)
    )
  );
  const { tipoCfe, serie, numero } = parsearQR(lectura.qrTexto);

  const { id } = await guardarGasto({
    emisorId: lectura.emisorId,
    fecha: lectura.fecha,
    tipoCfe,
    serie,
    numero,
    montoTotal: lectura.total,
    sinRevisar: true,
    items: lineas.map((l) => ({
      itemCatalogoId: l.item.id,
      categoriaId: l.categoriaId,
      cantidad: l.cantidad,
      unidad: l.unidad,
      precio: montoDeLinea(l.precio),
      esHormiga: hormigas.has(l.item.id),
    })),
  });

  const emisor = db
    .select({ nombre: emisores.nombre })
    .from(emisores)
    .where(eq(emisores.id, lectura.emisorId))
    .get();
  return {
    guardado: true,
    gastoId: id,
    comercio: emisor?.nombre ?? "",
    total: lectura.total,
  };
}

/**
 * Recibe la foto de un comprobante y la lee. Si no deja nada por decidir y el
 * guardado automático está activo, se guarda como gasto; si no, queda en la
 * bandeja hasta que el usuario lo revise.
 */
export async function recibirImagen(
  imagen: Buffer,
  canal: CanalEntrante
): Promise<ResultadoRecepcion> {
  const lectura = await leerImagen(imagen);

  const repetido = await comprobanteRepetido(lectura);
  if (repetido) return repetido;

  let pendientePor: string | null = null;
  if (
    lectura.estado === "pendiente" &&
    (await leerAjustesBandeja()).guardadoAutomatico
  ) {
    // Si el guardado falla por lo que sea, el comprobante no se pierde: cae a
    // la bandeja como cualquier otro.
    const intento = await guardarSiNoHayNadaQueRevisar(lectura).catch(
      (e): { guardado: false; motivo: string } => ({
        guardado: false,
        motivo: e instanceof Error ? e.message : "No se pudo guardar solo.",
      })
    );
    if (intento.guardado) {
      return {
        ok: true,
        destino: "gasto",
        gastoId: intento.gastoId,
        comercio: intento.comercio,
        total: intento.total,
      };
    }
    pendientePor = intento.motivo;
  }

  const fila = db
    .insert(gastosEntrantes)
    .values({ ...lectura, canal, recibidoEn: new Date().toISOString() })
    .returning({ id: gastosEntrantes.id })
    .get();
  await guardarImagenEntrante(fila.id, imagen);

  return {
    ok: true,
    destino: "bandeja",
    id: fila.id,
    estado: lectura.estado,
    error: lectura.error,
    pendientePor,
  };
}

/**
 * Vuelve a leer un entrante: desde su QR si ya lo tenía (alcanza con repetir la
 * consulta, por ejemplo después de mapear el proveedor del comercio) o desde la
 * foto guardada si nunca se llegó a leer.
 */
export async function reprocesarEntrante(
  id: number
): Promise<{ ok: boolean; error?: string }> {
  const entrante = db
    .select()
    .from(gastosEntrantes)
    .where(eq(gastosEntrantes.id, id))
    .get();
  if (!entrante) return { ok: false, error: "Ese comprobante ya no está en la bandeja." };

  const imagen = entrante.imagenRuta
    ? await leerImagenEntrante(entrante.imagenRuta)
    : null;

  let lectura: Lectura;
  if (entrante.qrTexto) {
    lectura = await leerDesdeQR(
      entrante.qrTexto,
      entrante.lectura === "link" ? "link" : "qr"
    );
    if (imagen) lectura = await completarItemsConIA(lectura, imagen);
  } else if (entrante.imagenRuta) {
    if (!imagen) return { ok: false, error: "No se encontró la foto guardada." };
    lectura = await leerImagen(imagen);
  } else {
    return { ok: false, error: "No hay foto ni QR para volver a leer." };
  }

  const repetido = await comprobanteRepetido(lectura, id);
  if (repetido) return { ok: false, error: repetido.mensaje };

  db.update(gastosEntrantes).set(lectura).where(eq(gastosEntrantes.id, id)).run();
  return lectura.estado === "pendiente"
    ? { ok: true }
    : { ok: false, error: lectura.error ?? "No se pudo leer el comprobante." };
}

