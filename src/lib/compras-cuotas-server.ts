import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categorias,
  comprasEnCuotas,
  cuotasCompra,
  emisores,
  gastoItems,
  gastos,
  movimientosEstadoCuenta,
} from "@/db/schema";
import { CATEGORIA_BANCARIO } from "@/lib/clasificacion-comercios";
import {
  ajustarPlan,
  gruposDeCompra,
  planDeCuotas,
  recalcularPendientes,
  repartoDeCuota,
  TOLERANCIA_CUOTA,
  type CompraParaCruce,
} from "@/lib/cuotas";
import { formatearFechaCorta } from "@/lib/formato";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Condición para las consultas que suman plata: una compra en cuotas no es
 * plata gastada, lo son sus cuotas. Las que leen ítems y precios no la usan.
 */
export const noEsCompraEnCuotas = sql`not exists (select 1 from ${comprasEnCuotas} where ${comprasEnCuotas.gastoId} = ${gastos.id})`;

/** Los gastos que no se ofrecen para combinar: compras en cuotas y sus cuotas. */
export function gastosDeCuotas(): Set<number> {
  const compras = db.select({ id: comprasEnCuotas.gastoId }).from(comprasEnCuotas).all();
  const cuotas = db
    .select({ id: cuotasCompra.gastoId })
    .from(cuotasCompra)
    .where(isNotNull(cuotasCompra.gastoId))
    .all();
  return new Set(
    [...compras, ...cuotas].flatMap((f) => (f.id === null ? [] : [f.id]))
  );
}

export type DatosPlan = { total: number; cantidad: number; interesPct: number };

/** Valida lo que se pide para armar un plan de cuotas. */
export function validarPlan(datos: DatosPlan) {
  if (!Number.isFinite(datos.total) || datos.total <= 0) {
    throw new Error("El total tiene que ser mayor que cero");
  }
  if (!Number.isInteger(datos.cantidad) || datos.cantidad < 2 || datos.cantidad > 60) {
    throw new Error("La cantidad de cuotas tiene que ser un número entre 2 y 60");
  }
  if (!Number.isFinite(datos.interesPct) || datos.interesPct < 0) {
    throw new Error("El interés no puede ser negativo");
  }
}

/** Da de alta la compra en cuotas de un gasto, con el importe calculado de cada cuota. */
export function crearPlan(tx: Tx, gastoId: number, datos: DatosPlan): number {
  validarPlan(datos);
  const compra = tx
    .insert(comprasEnCuotas)
    .values({
      gastoId,
      cantidadCuotas: datos.cantidad,
      interesPct: datos.interesPct,
      total: datos.total,
      creadoEn: new Date().toISOString(),
    })
    .returning({ id: comprasEnCuotas.id })
    .get();
  tx.insert(cuotasCompra)
    .values(
      planDeCuotas(datos.total, datos.cantidad, datos.interesPct).map((importe, i) => ({
        compraId: compra.id,
        numero: i + 1,
        importeCalculado: importe,
      }))
    )
    .run();
  return compra.id;
}

/**
 * Cambia el total, la cantidad o el recargo de una compra ya dada de alta. Las
 * cuotas pagadas no se tocan; las que faltan se recalculan.
 */
export function actualizarPlan(tx: Tx, compraId: number, datos: DatosPlan) {
  validarPlan(datos);
  const actuales = tx
    .select()
    .from(cuotasCompra)
    .where(eq(cuotasCompra.compraId, compraId))
    .all();
  const ultimaPagada = Math.max(0, ...actuales.filter((c) => c.pagada).map((c) => c.numero));
  if (datos.cantidad < ultimaPagada) {
    throw new Error(`Ya está pagada la cuota ${ultimaPagada}: no pueden ser menos cuotas`);
  }

  tx.update(comprasEnCuotas)
    .set({ cantidadCuotas: datos.cantidad, interesPct: datos.interesPct, total: datos.total })
    .where(eq(comprasEnCuotas.id, compraId))
    .run();
  const sobrantes = actuales.filter((c) => c.numero > datos.cantidad).map((c) => c.id);
  if (sobrantes.length) {
    tx.delete(cuotasCompra).where(inArray(cuotasCompra.id, sobrantes)).run();
  }
  const numeros = new Set(actuales.map((c) => c.numero));
  const nuevas = Array.from({ length: datos.cantidad }, (_, i) => i + 1).filter(
    (n) => !numeros.has(n)
  );
  if (nuevas.length) {
    tx.insert(cuotasCompra)
      .values(nuevas.map((numero) => ({ compraId, numero, importeCalculado: 0 })))
      .run();
  }
  guardarImportes(
    tx,
    recalcularPendientes(
      datos.total,
      datos.interesPct,
      tx.select().from(cuotasCompra).where(eq(cuotasCompra.compraId, compraId)).all()
    )
  );
}

function guardarImportes(
  tx: Tx,
  cuotas: { id: number; importeCalculado: number }[]
) {
  for (const c of cuotas) {
    tx.update(cuotasCompra)
      .set({ importeCalculado: c.importeCalculado })
      .where(eq(cuotasCompra.id, c.id))
      .run();
  }
}

/**
 * Corrige el plan con el último cobro: si difiere del cálculo, las cuotas que
 * faltan y el recargo pasan a ser los que surgen de lo cobrado.
 * @returns el recargo nuevo si hubo que ajustar, null si no
 */
export function ajustarConCobro(tx: Tx, compraId: number): number | null {
  const compra = tx
    .select()
    .from(comprasEnCuotas)
    .where(eq(comprasEnCuotas.id, compraId))
    .get();
  if (!compra) return null;
  const r = ajustarPlan(
    compra.total,
    compra.interesPct,
    tx.select().from(cuotasCompra).where(eq(cuotasCompra.compraId, compraId)).all()
  );
  if (!r.ajustado) return null;
  guardarImportes(tx, r.cuotas);
  tx.update(comprasEnCuotas)
    .set({ interesPct: r.interesPct })
    .where(eq(comprasEnCuotas.id, compraId))
    .run();
  return r.interesPct;
}

type ContextoCuota = {
  compra: typeof comprasEnCuotas.$inferSelect;
  cuota: typeof cuotasCompra.$inferSelect;
  gastoCompra: { fecha: string; emisorId: number };
};

function contextoDeCuota(tx: Tx, cuotaId: number): ContextoCuota {
  const fila = tx
    .select({
      cuota: cuotasCompra,
      compra: comprasEnCuotas,
      fecha: gastos.fecha,
      emisorId: gastos.emisorId,
    })
    .from(cuotasCompra)
    .innerJoin(comprasEnCuotas, eq(comprasEnCuotas.id, cuotasCompra.compraId))
    .innerJoin(gastos, eq(gastos.id, comprasEnCuotas.gastoId))
    .where(eq(cuotasCompra.id, cuotaId))
    .get();
  if (!fila) throw new Error("Esa cuota ya no existe");
  return {
    cuota: fila.cuota,
    compra: fila.compra,
    gastoCompra: { fecha: fila.fecha, emisorId: fila.emisorId },
  };
}

/**
 * Las líneas del gasto de una cuota: el capital repartido entre las categorías
 * de la compra y el recargo aparte, en la categoría de los cargos del banco.
 */
function lineasDeCuota(tx: Tx, ctx: ContextoCuota, importe: number) {
  const lineasCompra = tx
    .select({
      categoriaId: gastoItems.categoriaId,
      esHormiga: gastoItems.esHormiga,
      monto: sql<number>`${gastoItems.precio} * ${gastoItems.cantidad}`,
    })
    .from(gastoItems)
    .where(eq(gastoItems.gastoId, ctx.compra.gastoId))
    .all();
  const grupos = gruposDeCompra(lineasCompra);
  const { lineas, recargo } = repartoDeCuota(
    grupos,
    importe,
    ctx.compra.total / ctx.compra.cantidadCuotas
  );
  const etiqueta = `Cuota ${ctx.cuota.numero}/${ctx.compra.cantidadCuotas} de la compra del ${formatearFechaCorta(ctx.gastoCompra.fecha)}`;
  const categoriaRecargo =
    tx
      .select({ id: categorias.id })
      .from(categorias)
      .where(sql`lower(${categorias.nombre}) = lower(${CATEGORIA_BANCARIO})`)
      .get()?.id ?? grupos[0]?.categoriaId;
  const filas = lineas.map((l) => ({
    descripcion: etiqueta,
    categoriaId: l.categoriaId,
    esHormiga: l.esHormiga,
    precio: l.monto,
  }));
  if (recargo > 0 && categoriaRecargo !== undefined) {
    filas.push({
      descripcion: `Recargo de financiación · cuota ${ctx.cuota.numero}/${ctx.compra.cantidadCuotas}`,
      categoriaId: categoriaRecargo,
      esHormiga: false,
      precio: recargo,
    });
  }
  if (!filas.length) throw new Error("La compra no tiene líneas para repartir la cuota");
  return filas;
}

function escribirLineasDeCuota(
  tx: Tx,
  gastoId: number,
  filas: ReturnType<typeof lineasDeCuota>
) {
  tx.insert(gastoItems)
    .values(
      filas.map((f) => ({
        gastoId,
        itemCatalogoId: null,
        descripcion: f.descripcion,
        categoriaId: f.categoriaId,
        cantidad: 1,
        unidad: "un",
        precio: f.precio,
        esHormiga: f.esHormiga,
        esSobreprecio: false,
      }))
    )
    .run();
}

/**
 * Crea el gasto de una cuota y la marca pagada. El gasto sale a nombre del
 * comercio de la compra, con sus categorías.
 * @returns el gasto creado y el recargo nuevo si el cobro corrigió el plan
 */
export function pagarCuotaEnTx(
  tx: Tx,
  cuotaId: number,
  pago: { importe: number; fecha: string }
): {
  gastoId: number;
  compraId: number;
  emisorId: number;
  emisorNombre: string;
  numero: number;
  cantidad: number;
  interesAjustado: number | null;
} {
  const ctx = contextoDeCuota(tx, cuotaId);
  if (ctx.cuota.pagada) {
    throw new Error(`La cuota ${ctx.cuota.numero} ya está pagada`);
  }
  if (!Number.isFinite(pago.importe) || pago.importe <= 0) {
    throw new Error("El importe de la cuota tiene que ser mayor que cero");
  }
  const filas = lineasDeCuota(tx, ctx, pago.importe);
  const gasto = tx
    .insert(gastos)
    .values({
      fecha: pago.fecha,
      emisorId: ctx.gastoCompra.emisorId,
      montoTotal: pago.importe,
      creadoEn: new Date().toISOString(),
    })
    .returning({ id: gastos.id })
    .get();
  escribirLineasDeCuota(tx, gasto.id, filas);
  tx.update(cuotasCompra)
    .set({ pagada: true, importePagado: pago.importe, gastoId: gasto.id })
    .where(eq(cuotasCompra.id, cuotaId))
    .run();
  const emisor = tx
    .select({ nombre: emisores.nombre })
    .from(emisores)
    .where(eq(emisores.id, ctx.gastoCompra.emisorId))
    .get();
  return {
    gastoId: gasto.id,
    compraId: ctx.compra.id,
    emisorId: ctx.gastoCompra.emisorId,
    emisorNombre: emisor?.nombre ?? "La compra",
    numero: ctx.cuota.numero,
    cantidad: ctx.compra.cantidadCuotas,
    interesAjustado: ajustarConCobro(tx, ctx.compra.id),
  };
}

/**
 * Marca una cuota como pagada por un gasto que ya existía (una cuota importada
 * antes de que la compra estuviera registrada). Si ese gasto es la línea
 * genérica que deja la importación, pasa a tener el comercio y las categorías
 * de la compra; uno que se editó a mano no se toca.
 */
function vincularGastoExistente(tx: Tx, cuotaId: number, gastoId: number, importe: number) {
  const ctx = contextoDeCuota(tx, cuotaId);
  const lineas = tx
    .select({ id: gastoItems.id })
    .from(gastoItems)
    .where(eq(gastoItems.gastoId, gastoId))
    .all();
  if (lineas.length <= 1) {
    const filas = lineasDeCuota(tx, ctx, importe);
    tx.delete(gastoItems).where(eq(gastoItems.gastoId, gastoId)).run();
    escribirLineasDeCuota(tx, gastoId, filas);
    tx.update(gastos)
      .set({ emisorId: ctx.gastoCompra.emisorId, montoTotal: importe })
      .where(eq(gastos.id, gastoId))
      .run();
  }
  tx.update(cuotasCompra)
    .set({ pagada: true, importePagado: importe, gastoId })
    .where(eq(cuotasCompra.id, cuotaId))
    .run();
}

function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
}

/**
 * Busca en el registro de estados de cuenta las cuotas de esta compra que se
 * importaron como gastos sueltos (antes de que la compra estuviera marcada) y
 * las vincula: misma fecha de compra (±1 día), misma cantidad de cuotas, y el
 * mismo comercio o un importe cercano al calculado.
 * @returns cuántas cuotas se vincularon
 */
export function vincularCuotasImportadas(tx: Tx, compraId: number): number {
  const compra = tx
    .select({
      cantidad: comprasEnCuotas.cantidadCuotas,
      fecha: gastos.fecha,
      emisorId: gastos.emisorId,
    })
    .from(comprasEnCuotas)
    .innerJoin(gastos, eq(gastos.id, comprasEnCuotas.gastoId))
    .where(eq(comprasEnCuotas.id, compraId))
    .get();
  if (!compra) return 0;

  const cuotas = tx
    .select()
    .from(cuotasCompra)
    .where(eq(cuotasCompra.compraId, compraId))
    .orderBy(asc(cuotasCompra.numero))
    .all();
  const yaCuotas = new Set(
    tx
      .select({ id: cuotasCompra.gastoId })
      .from(cuotasCompra)
      .where(isNotNull(cuotasCompra.gastoId))
      .all()
      .map((f) => f.id)
  );
  const movimientos = tx
    .select({
      numero: movimientosEstadoCuenta.cuotaNumero,
      fecha: movimientosEstadoCuenta.fecha,
      montoPesos: movimientosEstadoCuenta.montoPesos,
      gastoId: movimientosEstadoCuenta.gastoId,
      emisorId: gastos.emisorId,
    })
    .from(movimientosEstadoCuenta)
    .innerJoin(gastos, eq(gastos.id, movimientosEstadoCuenta.gastoId))
    .where(eq(movimientosEstadoCuenta.cuotasTotal, compra.cantidad))
    .all();

  let vinculadas = 0;
  for (const m of movimientos) {
    if (m.gastoId === null || m.numero === null || m.montoPesos === null) continue;
    if (yaCuotas.has(m.gastoId) || diasEntre(m.fecha, compra.fecha) > 1) continue;
    const cuota = cuotas.find((c) => c.numero === m.numero && !c.pagada);
    if (!cuota) continue;
    const cerca =
      Math.abs(m.montoPesos - cuota.importeCalculado) <=
      Math.max(TOLERANCIA_CUOTA, cuota.importeCalculado * 0.25);
    if (m.emisorId !== compra.emisorId && !cerca) continue;
    vincularGastoExistente(tx, cuota.id, m.gastoId, m.montoPesos);
    cuota.pagada = true;
    yaCuotas.add(m.gastoId);
    vinculadas += 1;
  }
  if (vinculadas) ajustarConCobro(tx, compraId);
  return vinculadas;
}

/** Las compras con alguna cuota sin pagar, con lo necesario para cruzarlas. */
export function comprasParaCruce(): CompraParaCruce[] {
  const filas = db
    .select({
      compra: comprasEnCuotas,
      fecha: gastos.fecha,
      emisorId: gastos.emisorId,
      emisorNombre: emisores.nombre,
    })
    .from(comprasEnCuotas)
    .innerJoin(gastos, eq(gastos.id, comprasEnCuotas.gastoId))
    .innerJoin(emisores, eq(emisores.id, gastos.emisorId))
    .where(
      sql`exists (select 1 from ${cuotasCompra} where ${cuotasCompra.compraId} = ${comprasEnCuotas.id} and ${cuotasCompra.pagada} = 0)`
    )
    .all();
  if (!filas.length) return [];

  const cuotas = db
    .select({ cuota: cuotasCompra, fechaPago: gastos.fecha })
    .from(cuotasCompra)
    .leftJoin(gastos, eq(gastos.id, cuotasCompra.gastoId))
    .where(
      inArray(
        cuotasCompra.compraId,
        filas.map((f) => f.compra.id)
      )
    )
    .orderBy(asc(cuotasCompra.numero))
    .all();

  return filas.map((f) => ({
    compraId: f.compra.id,
    gastoId: f.compra.gastoId,
    fecha: f.fecha,
    emisorId: f.emisorId,
    emisorNombre: f.emisorNombre,
    cantidad: f.compra.cantidadCuotas,
    total: f.compra.total,
    tarjeta: f.compra.tarjeta,
    cuotas: cuotas
      .filter((c) => c.cuota.compraId === f.compra.id)
      .map((c) => ({
        id: c.cuota.id,
        numero: c.cuota.numero,
        importeCalculado: c.cuota.importeCalculado,
        importePagado: c.cuota.importePagado,
        pagada: c.cuota.pagada,
        gastoId: c.cuota.gastoId,
        fechaPago: c.cuota.gastoId === null ? null : c.fechaPago,
      })),
  }));
}

/** Aprende la tarjeta de una compra con su primera cuota cobrada por un estado de cuenta. */
export function aprenderTarjeta(tx: Tx, compraId: number, tarjeta: string | null) {
  if (!tarjeta) return;
  tx.update(comprasEnCuotas)
    .set({ tarjeta })
    .where(and(eq(comprasEnCuotas.id, compraId), sql`${comprasEnCuotas.tarjeta} is null`))
    .run();
}

export type CompraEnCuotasDetalle = {
  compraId: number;
  cantidad: number;
  interesPct: number;
  total: number;
  tarjeta: string | null;
  cuotas: {
    id: number;
    numero: number;
    importeCalculado: number;
    importePagado: number | null;
    pagada: boolean;
    gastoId: number | null;
    fechaPago: string | null;
  }[];
};

export type CuotaDeCompraDetalle = {
  numero: number;
  cantidad: number;
  compraGastoId: number;
  fechaCompra: string;
};

/**
 * Lo que la ficha de un gasto necesita saber de las cuotas: si es una compra
 * en cuotas (con su plan) o si es la cuota de una.
 */
export function cuotasDeGasto(gastoId: number): {
  compraEnCuotas: CompraEnCuotasDetalle | null;
  cuotaDeCompra: CuotaDeCompraDetalle | null;
} {
  const compra = db
    .select()
    .from(comprasEnCuotas)
    .where(eq(comprasEnCuotas.gastoId, gastoId))
    .get();
  const cuotaDeCompra =
    db
      .select({
        numero: cuotasCompra.numero,
        cantidad: comprasEnCuotas.cantidadCuotas,
        compraGastoId: comprasEnCuotas.gastoId,
        fechaCompra: gastos.fecha,
      })
      .from(cuotasCompra)
      .innerJoin(comprasEnCuotas, eq(comprasEnCuotas.id, cuotasCompra.compraId))
      .innerJoin(gastos, eq(gastos.id, comprasEnCuotas.gastoId))
      .where(eq(cuotasCompra.gastoId, gastoId))
      .get() ?? null;
  if (!compra) return { compraEnCuotas: null, cuotaDeCompra };

  const cuotas = db
    .select({ cuota: cuotasCompra, fechaPago: gastos.fecha })
    .from(cuotasCompra)
    .leftJoin(gastos, eq(gastos.id, cuotasCompra.gastoId))
    .where(eq(cuotasCompra.compraId, compra.id))
    .orderBy(asc(cuotasCompra.numero))
    .all()
    .map(({ cuota, fechaPago }) => ({
      id: cuota.id,
      numero: cuota.numero,
      importeCalculado: cuota.importeCalculado,
      importePagado: cuota.importePagado,
      pagada: cuota.pagada,
      gastoId: cuota.gastoId,
      fechaPago: cuota.gastoId === null ? null : fechaPago,
    }));
  return {
    compraEnCuotas: {
      compraId: compra.id,
      cantidad: compra.cantidadCuotas,
      interesPct: compra.interesPct,
      total: compra.total,
      tarjeta: compra.tarjeta,
      cuotas,
    },
    cuotaDeCompra,
  };
}

/** Lo que falta pagar de todas las compras en cuotas, según el plan de cada una. */
export function totalCuotasPorPagar(): { cuotas: number; pesos: number } {
  const fila = db
    .select({
      cuotas: sql<number>`count(*)`,
      pesos: sql<number>`coalesce(sum(${cuotasCompra.importeCalculado}), 0)`,
    })
    .from(cuotasCompra)
    .where(eq(cuotasCompra.pagada, false))
    .get();
  return { cuotas: fila?.cuotas ?? 0, pesos: Number((fila?.pesos ?? 0).toFixed(2)) };
}
