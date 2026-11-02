import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { gastos } from "./gastos";

/**
 * Un gasto pagado en cuotas con tarjeta. El gasto (el ticket, con sus ítems)
 * sigue en `gastos` para todo lo que lee ítems y precios, pero no suma como
 * plata gastada: suman sus cuotas, cada una en el mes en que la cobra el banco.
 * `total` es el precio que se financió e `interesPct` el recargo sobre él; el
 * recargo se corrige con lo que de verdad cobra el banco. `tarjeta` son los
 * últimos 4 dígitos de la tarjeta, aprendidos con la primera cuota que llega
 * por un estado de cuenta.
 */
export const comprasEnCuotas = sqliteTable("compras_en_cuotas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gastoId: integer("gasto_id")
    .notNull()
    .unique()
    .references(() => gastos.id, { onDelete: "cascade" }),
  cantidadCuotas: integer("cantidad_cuotas").notNull(),
  interesPct: real("interes_pct").notNull().default(0),
  total: real("total").notNull(),
  tarjeta: text("tarjeta"),
  creadoEn: text("creado_en").notNull(),
});

/**
 * Cada cuota de una compra: lo que se calculó, lo que cobró el banco y el gasto
 * que la representa. Una cuota pagada siempre tiene su gasto, que es lo que la
 * hace sumar en los reportes; si ese gasto se borra, un trigger la vuelve a
 * dejar sin pagar (migración `0038`).
 */
export const cuotasCompra = sqliteTable(
  "cuotas_compra",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    compraId: integer("compra_id")
      .notNull()
      .references(() => comprasEnCuotas.id, { onDelete: "cascade" }),
    numero: integer("numero").notNull(),
    importeCalculado: real("importe_calculado").notNull(),
    importePagado: real("importe_pagado"),
    pagada: integer("pagada", { mode: "boolean" }).notNull().default(false),
    gastoId: integer("gasto_id").references(() => gastos.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("cuotas_compra_numero_unico").on(table.compraId, table.numero),
    uniqueIndex("cuotas_compra_gasto_unico")
      .on(table.gastoId)
      .where(sql`${table.gastoId} is not null`),
  ]
);
