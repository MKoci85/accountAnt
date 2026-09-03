"use server";

import { db } from "@/db";
import {
  gastos,
  gastoItems,
  emisores,
  categorias,
  itemsCatalogo,
  emisorAlias,
} from "@/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { extraerFilasPdf } from "@/lib/pdf";
import {
  parsearEstadoCuenta,
  type MovimientoEstadoCuenta,
} from "@/lib/estado-cuenta";
import {
  clasificarLinea,
  sugerirCategoriaComercio,
  ITEM_PAGO_TARJETA,
  CATEGORIA_FALLBACK,
} from "@/lib/clasificacion-comercios";
import { obtenerCotizacionCacheada } from "@/lib/bcu";
import { interpretarEstadoCuentaConIA, type FuenteIA } from "./ia";
import type { ProveedorIA } from "@/lib/proveedores-ia";

const TOLERANCIA_MONTO = 2;

const TOLERANCIA_DIAS = 1;

export type EstadoLinea = "directo" | "ya_registrada" | "faltante" | "sin_cotizacion";

export type LineaAnalizada = {
  indice: number;
  fecha: string;
  descripcion: string;
  montoOriginal: number;
  moneda: "UYU" | "USD";
  montoPesos: number | null;
  cotizacion: number | null;
  estado: EstadoLinea;
  emisorSugerido: string;
  emisorId: number | null;
  categoriaSugerida: string;
  categoriaId: number | null;
  emisorDesdeTexto: boolean;
  rubro: string | null;
  gastoExistenteId: number | null;
};

export type AnalisisEstadoCuenta = {
  lineas: LineaAnalizada[];
  resumen: {
    total: number;
    directos: number;
    yaRegistradas: number;
    faltantes: number;
    sinCotizacion: number;
    totalPesos: number;
  };
  desde: string | null;
  hasta: string | null;
  gastosEnRango: number;
};

function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function totalesDeGastos(desde: string, hasta: string) {
  const filas = await db
    .select({
      id: gastos.id,
      fecha: gastos.fecha,
      montoTotal: gastos.montoTotal,
      sumaLineas: sql<number>`coalesce(sum(${gastoItems.precio} * ${gastoItems.cantidad}), 0)`,
    })
    .from(gastos)
    .leftJoin(gastoItems, eq(gastoItems.gastoId, gastos.id))
    .where(
      and(
        gte(gastos.fecha, sumarDias(desde, -TOLERANCIA_DIAS)),
        lte(gastos.fecha, sumarDias(hasta, TOLERANCIA_DIAS))
      )
    )
    .groupBy(gastos.id);

  return filas.map((f) => ({
    id: f.id,
    fecha: f.fecha,
    total: f.montoTotal ?? f.sumaLineas,
  }));
}

export async function analizarEstadoCuenta(
  buffer: ArrayBuffer
): Promise<AnalisisEstadoCuenta> {
  const filas = await extraerFilasPdf(buffer);
  return cotejarMovimientos(parsearEstadoCuenta(filas));
}

/**
 * Interpreta un PDF de estado de cuenta con IA (vía para layouts que el
 * parser por coordenadas no entiende) y coteja los movimientos resultantes
 * contra los gastos ya cargados.
 * @param fuente Buffer del PDF.
 * @param proveedor Proveedor de IA elegido; sin esto, el activo.
 * @returns El mismo análisis que `analizarEstadoCuenta`, más `errorIA` si la IA falló.
 */
export async function analizarEstadoCuentaConIA(
  fuente: { buffer: ArrayBuffer },
  proveedor?: ProveedorIA
): Promise<AnalisisEstadoCuenta & { errorIA?: string }> {
  const entrada: FuenteIA = {
    tipo: "texto",
    texto: (await extraerFilasPdf(fuente.buffer))
      .map((f) => f.texto)
      .join("\n"),
  };

  const r = await interpretarEstadoCuentaConIA(entrada, proveedor);
  if (!r.ok || !r.movimientos) {
    return { ...ANALISIS_VACIO, errorIA: r.error ?? "La IA no pudo interpretar el PDF" };
  }
  const ordenados = [...r.movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return cotejarMovimientos(ordenados);
}

const ANALISIS_VACIO: AnalisisEstadoCuenta = {
  lineas: [],
  resumen: { total: 0, directos: 0, yaRegistradas: 0, faltantes: 0, sinCotizacion: 0, totalPesos: 0 },
  desde: null,
  hasta: null,
  gastosEnRango: 0,
};

async function cotejarMovimientos(
  movimientos: MovimientoEstadoCuenta[]
): Promise<AnalisisEstadoCuenta> {
  if (!movimientos.length) return ANALISIS_VACIO;

  const fechas = movimientos.map((m) => m.fecha).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];

  const [todasCategorias, todosEmisores, alias, candidatos] = await Promise.all([
    db.select().from(categorias),
    db.select().from(emisores),
    db.select().from(emisorAlias),
    totalesDeGastos(desde, hasta),
  ]);

  const categoriaPorNombre = new Map(
    todasCategorias.map((c) => [c.nombre.toLowerCase(), c])
  );
  const emisorPorNombre = new Map(
    todosEmisores.map((e) => [e.nombre.toLowerCase(), e])
  );
  const emisorPorId = new Map(todosEmisores.map((e) => [e.id, e]));
  const emisorPorAlias = new Map(
    alias.flatMap((a) => {
      const emisor = emisorPorId.get(a.emisorId);
      return emisor ? [[a.alias.toLowerCase(), emisor] as const] : [];
    })
  );

  const usados = new Set<number>();

  const lineas: LineaAnalizada[] = [];

  for (const [indice, mov] of movimientos.entries()) {
    const linea = await analizarMovimiento(mov, indice, {
      categoriaPorNombre,
      emisorPorNombre,
      emisorPorAlias,
      candidatos,
      usados,
    });
    lineas.push(linea);
  }

  const resumen = {
    total: lineas.length,
    directos: lineas.filter((l) => l.estado === "directo").length,
    yaRegistradas: lineas.filter((l) => l.estado === "ya_registrada").length,
    faltantes: lineas.filter((l) => l.estado === "faltante").length,
    sinCotizacion: lineas.filter((l) => l.estado === "sin_cotizacion").length,
    totalPesos: lineas.reduce((acc, l) => acc + (l.montoPesos ?? 0), 0),
  };

  return { lineas, resumen, desde, hasta, gastosEnRango: candidatos.length };
}

async function analizarMovimiento(
  mov: MovimientoEstadoCuenta,
  indice: number,
  ctx: {
    categoriaPorNombre: Map<string, typeof categorias.$inferSelect>;
    emisorPorNombre: Map<string, typeof emisores.$inferSelect>;
    emisorPorAlias: Map<string, typeof emisores.$inferSelect>;
    candidatos: { id: number; fecha: string; total: number }[];
    usados: Set<number>;
  }
): Promise<LineaAnalizada> {
  let montoPesos: number | null = mov.monto;
  let cotizacion: number | null = null;
  if (mov.moneda === "USD") {
    cotizacion = await obtenerCotizacionCacheada(mov.fecha);
    montoPesos = cotizacion === null ? null : mov.monto * cotizacion;
  }

  const directo = clasificarLinea(mov.descripcion, mov.moneda === "USD");
  const nombreCategoria = directo
    ? directo.categoria
    : sugerirCategoriaComercio(mov.descripcion);
  const categoria =
    ctx.categoriaPorNombre.get(nombreCategoria.toLowerCase()) ??
    ctx.categoriaPorNombre.get(CATEGORIA_FALLBACK.toLowerCase()) ??
    null;

  const textoPos = mov.descripcion.trim();
  const porAlias = ctx.emisorPorAlias.get(mov.descripcion.toLowerCase());
  const nombreEmisor = porAlias?.nombre ?? directo?.emisor ?? textoPos;
  const emisorId =
    porAlias?.id ?? ctx.emisorPorNombre.get(nombreEmisor.toLowerCase())?.id ?? null;

  const base = {
    indice,
    fecha: mov.fecha,
    descripcion: mov.descripcion,
    montoOriginal: mov.monto,
    moneda: mov.moneda,
    montoPesos,
    cotizacion,
    emisorSugerido: nombreEmisor,
    emisorId,
    emisorDesdeTexto: !porAlias && nombreEmisor === textoPos,
    categoriaSugerida: categoria?.nombre ?? nombreCategoria,
    categoriaId: categoria?.id ?? null,
    rubro: directo?.rubro ?? null,
  };

  if (montoPesos === null) {
    return { ...base, estado: "sin_cotizacion", gastoExistenteId: null };
  }

  const matchea = (c: { id: number; fecha: string; total: number }) =>
    !ctx.usados.has(c.id) &&
    Math.abs(Number(c.total) - montoPesos) <= TOLERANCIA_MONTO;

  const match =
    ctx.candidatos.find((c) => matchea(c) && c.fecha === mov.fecha) ??
    ctx.candidatos.find(
      (c) =>
        matchea(c) &&
        c.fecha >= sumarDias(mov.fecha, -TOLERANCIA_DIAS) &&
        c.fecha <= sumarDias(mov.fecha, TOLERANCIA_DIAS)
    );

  if (match) {
    ctx.usados.add(match.id);
    return { ...base, estado: "ya_registrada", gastoExistenteId: match.id };
  }

  if (directo) {
    return { ...base, estado: "directo", gastoExistenteId: null };
  }

  return { ...base, estado: "faltante", gastoExistenteId: null };
}

export type SeleccionImportacion = {
  indice: number;
  fecha: string;
  descripcion: string;
  montoPesos: number;
  emisorNombre: string;
  categoriaId: number;
  aliasOriginal?: string;
};

export async function importarMovimientos(seleccion: SeleccionImportacion[]) {
  if (!seleccion.length) return { importados: 0, gastoIds: [] as number[] };

  const [itemGenerico] = await db
    .select()
    .from(itemsCatalogo)
    .where(sql`lower(${itemsCatalogo.nombre}) = lower(${ITEM_PAGO_TARJETA})`)
    .limit(1);

  const emisorIdPorNombre = new Map<string, number>();
  for (const linea of seleccion) {
    const clave = linea.emisorNombre.toLowerCase();
    if (emisorIdPorNombre.has(clave)) continue;

    const [existente] = await db
      .select()
      .from(emisores)
      .where(sql`lower(${emisores.nombre}) = ${clave}`)
      .limit(1);

    if (existente) {
      emisorIdPorNombre.set(clave, existente.id);
    } else {
      const [creado] = await db
        .insert(emisores)
        .values({ nombre: linea.emisorNombre })
        .returning();
      emisorIdPorNombre.set(clave, creado.id);
    }
  }

  const gastoIds: number[] = [];

  db.transaction((tx) => {
    for (const linea of seleccion) {
      const emisorId = emisorIdPorNombre.get(linea.emisorNombre.toLowerCase())!;

      const gasto = tx
        .insert(gastos)
        .values({
          fecha: linea.fecha,
          emisorId,
          montoTotal: linea.montoPesos,
        })
        .returning()
        .get();

      gastoIds.push(gasto.id);

      tx.insert(gastoItems)
        .values({
          gastoId: gasto.id,
          itemCatalogoId: itemGenerico?.id ?? null,
          descripcion: linea.descripcion,
          categoriaId: linea.categoriaId,
          cantidad: 1,
          precio: linea.montoPesos,
          esHormiga: false,
          esSobreprecio: false,
        })
        .run();

      if (linea.aliasOriginal) {
        tx.insert(emisorAlias)
          .values({ emisorId, alias: linea.aliasOriginal })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  revalidatePath("/gastos");
  revalidatePath("/reportes");
  revalidatePath("/");

  return { importados: seleccion.length, gastoIds };
}
