import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { emisores } from "./catalogos";

export const CANALES_ENTRANTE = ["manual", "whatsapp"] as const;
export const ESTADOS_ENTRANTE = ["pendiente", "error"] as const;
export const LECTURAS_ENTRANTE = ["qr", "link", "ticket"] as const;

/**
 * Bandeja de entrada: comprobantes recibidos que todavía no son un gasto. Viven
 * en su propia tabla y no en `gastos` con un flag, para que reportes, precios de
 * referencia, duplicados y el cruce con el estado de cuenta no tengan que
 * acordarse de excluirlos.
 */
export const gastosEntrantes = sqliteTable("gastos_entrantes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recibidoEn: text("recibido_en").notNull(), // ISO 8601
  canal: text("canal", { enum: CANALES_ENTRANTE }).notNull().default("manual"),
  // "error" = no se pudo leer nada útil todavía; se puede reintentar o descartar.
  estado: text("estado", { enum: ESTADOS_ENTRANTE }).notNull(),
  // Cómo se leyó: QR, link de DGI leído por IA, o el ticket entero leído por IA.
  lectura: text("lectura", { enum: LECTURAS_ENTRANTE }),
  imagenRuta: text("imagen_ruta"),
  qrTexto: text("qr_texto"),
  // RUC|tipo|serie|número: la misma foto mandada dos veces no entra dos veces.
  claveComprobante: text("clave_comprobante").unique(),
  emisorId: integer("emisor_id").references(() => emisores.id, {
    onDelete: "set null",
  }),
  // Nombre del comercio tal como lo leyó la IA, cuando no hay RUC que lo resuelva.
  comercio: text("comercio"),
  fecha: text("fecha"), // ISO 8601 (YYYY-MM-DD)
  total: real("total"),
  // Ítems tal como vinieron del comprobante, sin resolver contra el catálogo:
  // eso se hace al abrir la revisión, con el catálogo de ese momento.
  itemsJson: text("items_json").notNull().default("[]"),
  aviso: text("aviso"),
  error: text("error"),
});

/**
 * El estado de cuenta que quedó a medio importar porque chocaba con un
 * comprobante de la bandeja. Una sola fila (id 1): es un borrador, no un
 * historial. Guarda los movimientos leídos del PDF y no el resultado del
 * cruce: al retomar se cruza de nuevo, y el comprobante que mientras tanto se
 * confirmó aparece solo como "ya registrado".
 */
export const estadoCuentaBorrador = sqliteTable("estado_cuenta_borrador", {
  id: integer("id").primaryKey(),
  creadoEn: text("creado_en").notNull(), // ISO 8601
  movimientosJson: text("movimientos_json").notNull(),
  // Si el PDF se leyó con IA: la revisión posterior abre el detalle de ítems.
  conIA: integer("con_ia", { mode: "boolean" }).notNull().default(false),
});

/**
 * Mensajes de WhatsApp ya recibidos. Meta reintenta un webhook que no contestó
 * a tiempo y puede entregar el mismo mensaje dos veces: el id es lo que evita
 * procesar la misma foto dos veces. De paso es el registro de qué pasó con cada
 * uno, incluidos los que no dejan rastro en la bandeja (guardados solos,
 * rechazados).
 */
export const mensajesWhatsapp = sqliteTable("mensajes_whatsapp", {
  id: text("id").primaryKey(), // wamid de Meta
  recibidoEn: text("recibido_en").notNull(), // ISO 8601
  remitente: text("remitente").notNull(),
  // Lo que hace falta para volver a bajar la foto si el proceso se cortó antes
  // de terminar de leerla. Null cuando el mensaje no era una imagen.
  mediaId: text("media_id"),
  resultado: text("resultado"), // null = todavía procesando (o interrumpido)
});

export const ORIGENES_ERROR_RECEPCION = ["whatsapp", "subida", "reintento"] as const;

/**
 * Cada falla al recibir o leer un comprobante, aunque la lectura después se
 * haya recuperado por otro camino: un modelo de IA que no contestó y otro que
 * sí deja un comprobante bien leído y ningún rastro de por qué. Es un registro
 * para diagnosticar, no estado: nada lo lee para decidir. Sin FK al mensaje de
 * WhatsApp, para que sobreviva a todo.
 */
export const erroresRecepcion = sqliteTable("errores_recepcion", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ocurridoEn: text("ocurrido_en").notNull(),
  origen: text("origen", { enum: ORIGENES_ERROR_RECEPCION }).notNull(),
  mensajeWhatsappId: text("mensaje_whatsapp_id"),
  paso: text("paso").notNull(),
  detalle: text("detalle").notNull(),
});
