import { emisores } from "./catalogos";
import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const configuracion = sqliteTable("configuracion", {
  clave: text("clave").primaryKey(),
  valor: text("valor").notNull(),
});

export const cotizaciones = sqliteTable("cotizaciones", {
  fecha: text("fecha").primaryKey(), // ISO 8601 (YYYY-MM-DD)
  fechaCotizacion: text("fecha_cotizacion").notNull(),
  compra: real("compra").notNull(),
  venta: real("venta").notNull(),
});

export const emisorAlias = sqliteTable("emisor_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  emisorId: integer("emisor_id")
    .notNull()
    .references(() => emisores.id, { onDelete: "cascade" }),
  alias: text("alias").notNull().unique(),
});
