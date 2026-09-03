import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { categorias, emisores } from "./catalogos";

export const gastosFijos = sqliteTable("gastos_fijos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull(),
  categoriaId: integer("categoria_id")
    .notNull()
    .references(() => categorias.id),
  emisorId: integer("emisor_id").references(() => emisores.id),
  importe: real("importe"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
});
