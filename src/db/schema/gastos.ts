import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { emisores, categorias, itemsCatalogo } from "./catalogos";
import { gastosFijos } from "./gastos-fijos";

export const gastos = sqliteTable(
  "gastos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fecha: text("fecha").notNull(), // ISO 8601 (YYYY-MM-DD)
    emisorId: integer("emisor_id")
      .notNull()
      .references(() => emisores.id),

    tipoCfe: text("tipo_cfe"),
    serie: text("serie"),
    numero: text("numero"),

    montoTotal: real("monto_total"),

    gastoFijoId: integer("gasto_fijo_id").references(() => gastosFijos.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("gastos_comprobante_unico")
      .on(table.emisorId, table.serie, table.numero)
      .where(sql`${table.serie} is not null`),
  ]
);

export const gastoItems = sqliteTable("gasto_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gastoId: integer("gasto_id")
    .notNull()
    .references(() => gastos.id, { onDelete: "cascade" }),
  itemCatalogoId: integer("item_catalogo_id").references(() => itemsCatalogo.id),
  categoriaId: integer("categoria_id")
    .notNull()
    .references(() => categorias.id),
  descripcion: text("descripcion"),
  cantidad: real("cantidad").notNull().default(1),
  unidad: text("unidad").notNull().default("un"),
  precio: real("precio").notNull(),
  esHormiga: integer("es_hormiga", { mode: "boolean" }).notNull().default(false),
  esSobreprecio: integer("es_sobreprecio", { mode: "boolean" })
    .notNull()
    .default(false),
  esPrecioBase: integer("es_precio_base", { mode: "boolean" })
    .notNull()
    .default(false),
  esPesoDesconocido: integer("es_peso_desconocido", { mode: "boolean" })
    .notNull()
    .default(false),
});
