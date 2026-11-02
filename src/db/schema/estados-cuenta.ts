import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { gastos } from "./gastos";

/**
 * Los estados de cuenta subidos, con el PDF guardado en `data/estados-cuenta/`
 * para poder verlo sin ir al banco. La fila nace al analizar el PDF (el mismo
 * archivo, por su hash, es siempre la misma fila) y queda en el registro al
 * confirmar la importación: mientras `importadoEn` es null es un análisis en
 * curso y subir otro PDF lo descarta.
 */
export const estadosCuenta = sqliteTable("estados_cuenta", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hash: text("hash").notNull().unique(),
  nombreArchivo: text("nombre_archivo").notNull(),
  archivo: text("archivo"),
  subidoEn: text("subido_en").notNull(),
  importadoEn: text("importado_en"),
  conIA: integer("con_ia", { mode: "boolean" }).notNull().default(false),
  banco: text("banco"),
  cierre: text("cierre"),
  vencimiento: text("vencimiento"),
  desde: text("desde"),
  hasta: text("hasta"),
  pagoContadoPesos: real("pago_contado_pesos"),
  pagoContadoUsd: real("pago_contado_usd"),
  pagoMinimoPesos: real("pago_minimo_pesos"),
  pagoMinimoUsd: real("pago_minimo_usd"),
  tarjeta: text("tarjeta"),
  movimientosJson: text("movimientos_json").notNull().default("[]"),
});

export const TIPOS_MOVIMIENTO_REGISTRO = [
  "importado",
  "ya_registrado",
  "omitido",
  "descuento",
] as const;

/**
 * Cada línea de un estado de cuenta importado y el gasto que le corresponde:
 * el que se creó al importarla o el que ya estaba cargado. Se reescribe entera
 * cada vez que se importa el mismo estado de cuenta. Cada cuota es su propio
 * gasto, fechado al cierre de su estado de cuenta; esta fila guarda la fecha
 * impresa (la de la compra) y qué cuota es, que es de donde se lee "cuota 2
 * de 4". Un gasto corresponde a una sola línea de un solo estado de cuenta.
 */
export const movimientosEstadoCuenta = sqliteTable("movimientos_estado_cuenta", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estadoCuentaId: integer("estado_cuenta_id")
    .notNull()
    .references(() => estadosCuenta.id, { onDelete: "cascade" }),
  fecha: text("fecha").notNull(),
  descripcion: text("descripcion").notNull(),
  monto: real("monto").notNull(),
  moneda: text("moneda", { enum: ["UYU", "USD"] }).notNull(),
  montoPesos: real("monto_pesos"),
  tipo: text("tipo", { enum: TIPOS_MOVIMIENTO_REGISTRO }).notNull(),
  cuotaNumero: integer("cuota_numero"),
  cuotasTotal: integer("cuotas_total"),
  gastoId: integer("gasto_id").references(() => gastos.id, {
    onDelete: "set null",
  }),
});
