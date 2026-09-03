import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const conversacionesIA = sqliteTable("conversaciones_ia", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titulo: text("titulo").notNull(),
  proveedor: text("proveedor").notNull(),
  modelo: text("modelo").notNull(),
  creadaEn: text("creada_en").notNull(),
  actualizadaEn: text("actualizada_en").notNull(),
});

export const mensajesIA = sqliteTable(
  "mensajes_ia",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversacionId: integer("conversacion_id")
      .notNull()
      .references(() => conversacionesIA.id, { onDelete: "cascade" }),
    rol: text("rol", { enum: ["user", "assistant"] }).notNull(),
    contenido: text("contenido").notNull(),
    tokensEstimados: integer("tokens_estimados").notNull(),
    esResumen: integer("es_resumen", { mode: "boolean" })
      .notNull()
      .default(false),
    archivadoEn: text("archivado_en"),
    creadoEn: text("creado_en").notNull(),
  },
  (table) => [
    index("mensajes_ia_conversacion_idx").on(
      table.conversacionId,
      table.archivadoEn,
    ),
  ],
);

export const usoIA = sqliteTable(
  "uso_ia",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proveedor: text("proveedor").notNull(),
    modelo: text("modelo").notNull(),
    enMs: integer("en_ms").notNull(),
    tokensEstimados: integer("tokens_estimados").notNull(),
    origen: text("origen", {
      enum: ["chat", "estado-cuenta", "ticket", "test"],
    }).notNull(),
  },
  (table) => [
    index("uso_ia_ventana_idx").on(table.proveedor, table.modelo, table.enMs),
  ],
);

export const reportesAdjuntos = sqliteTable(
  "reportes_adjuntos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversacionId: integer("conversacion_id")
      .notNull()
      .references(() => conversacionesIA.id, { onDelete: "cascade" }),
    json: text("json").notNull(),
    etiqueta: text("etiqueta").notNull(),
    filtros: text("filtros").notNull(),
    tokensEstimados: integer("tokens_estimados").notNull(),
    pendiente: integer("pendiente", { mode: "boolean" })
      .notNull()
      .default(false),
    usadoEn: text("usado_en"),
    creadoEn: text("creado_en").notNull(),
  },
  (table) => [
    index("reportes_adjuntos_conversacion_idx").on(
      table.conversacionId,
      table.pendiente,
    ),
  ],
);
