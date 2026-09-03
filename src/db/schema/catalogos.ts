import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { FORMATOS_PROVEEDOR_CFE } from "../../lib/procesadores";

export const categorias = sqliteTable("categorias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull().unique(),
  color: text("color"),
  descripcion: text("descripcion"),
});

export const proveedoresCfe = sqliteTable("proveedores_cfe", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull().unique(),
  urlConsulta: text("url_consulta").notNull(),
  formato: text("formato", { enum: FORMATOS_PROVEEDOR_CFE })
    .notNull()
    .default("otro"),
});

export const emisores = sqliteTable("emisores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull(),
  ruc: text("ruc").unique(),
  proveedorCfeId: integer("proveedor_cfe_id").references(
    () => proveedoresCfe.id,
    { onDelete: "restrict" }
  ),
  esGenerico: integer("es_generico", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const itemsCatalogo = sqliteTable("items_catalogo", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull(),
  marca: text("marca"),
  tamano: text("tamano"),
  categoriaId: integer("categoria_id")
    .notNull()
    .references(() => categorias.id),
  descripcion: text("descripcion"),
});
