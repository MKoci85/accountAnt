"use server";

import { db } from "@/db";
import {
  gastos,
  gastoItems,
  emisores,
  categorias,
  itemsCatalogo,
  emisorAlias,
  gastosEntrantes,
  estadoCuentaBorrador,
} from "@/db/schema";
import {
  entrantesEnConflicto,
  parsearItemsEntrante,
} from "@/lib/entrantes";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { extraerFilasPdf } from "@/lib/pdf";
import {
  parsearEstadoCuenta,
  separarDescuentos,
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
  /**
   * Los importes negativos del resumen (reducción de IVA, bonificaciones,
   * devoluciones), sólo como suma: no son líneas a revisar ni se importan.
   */
  descuentos: DescuentosEstadoCuenta;
  /**
   * Comprobantes de la bandeja que podrían ser alguno de estos movimientos.
   * Mientras haya alguno la importación no sigue: los movimientos quedan en
   * borrador hasta que se confirmen o descarten.
   */
  conflictosBandeja: ConflictoConBandeja[];
};

export type DescuentosEstadoCuenta = {
  cantidad: number;
  /** En pesos, con los de USD convertidos a la cotización de su fecha. */
  pesos: number;
  /** Los de USD para los que el BCU no dio cotización: quedan sin convertir. */
  usdSinCotizacion: number;
};

export type ConflictoConBandeja = {
  entranteId: number;
  comercio: string | null;
  fecha: string | null;
  total: number | null;
  /** Se puede abrir en el formulario (false = todavía no se pudo leer). */
  revisable: boolean;
  /** Descripciones de los movimientos con los que coincide; vacío si choca por faltarle datos. */
  movimientos: string[];
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
  return cotejarYGuardarBorrador(parsearEstadoCuenta(filas), false);
}

/**
 * Coteja los movimientos de un PDF recién leído. Si chocan con la bandeja
 * quedan en borrador para retomarlos sin volver a subir (ni a pagar con cuota
 * de IA) el PDF; si no, el borrador que hubiera se descarta: subir un estado
 * de cuenta nuevo reemplaza al anterior.
 */
async function cotejarYGuardarBorrador(
  movimientos: MovimientoEstadoCuenta[],
  conIA: boolean
): Promise<AnalisisEstadoCuenta> {
  const analisis = await cotejarMovimientos(movimientos);
  if (analisis.conflictosBandeja.length) {
    const valores = {
      creadoEn: new Date().toISOString(),
      movimientosJson: JSON.stringify(movimientos),
      conIA,
    };
    db.insert(estadoCuentaBorrador)
      .values({ id: 1, ...valores })
      .onConflictDoUpdate({ target: estadoCuentaBorrador.id, set: valores })
      .run();
  } else {
    db.delete(estadoCuentaBorrador).run();
  }
  return analisis;
}

function leerMovimientosBorrador(json: string): MovimientoEstadoCuenta[] {
  try {
    const crudo: unknown = JSON.parse(json);
    if (!Array.isArray(crudo)) return [];
    return crudo.filter(
      (m): m is MovimientoEstadoCuenta =>
        !!m &&
        typeof m === "object" &&
        typeof m.fecha === "string" &&
        typeof m.descripcion === "string" &&
        typeof m.monto === "number" &&
        (m.moneda === "UYU" || m.moneda === "USD")
    );
  } catch {
    return [];
  }
}

export type BorradorEstadoCuenta = { creadoEn: string; movimientos: number };

export async function obtenerBorradorEstadoCuenta(): Promise<BorradorEstadoCuenta | null> {
  const fila = db.select().from(estadoCuentaBorrador).get();
  if (!fila) return null;
  return {
    creadoEn: fila.creadoEn,
    movimientos: leerMovimientosBorrador(fila.movimientosJson).length,
  };
}

/**
 * Vuelve a cruzar los movimientos del borrador contra los gastos y la bandeja
 * de ahora. No lo borra: eso pasa al importar o al descartarlo.
 * @returns null si no hay borrador.
 */
export async function retomarBorradorEstadoCuenta(): Promise<
  (AnalisisEstadoCuenta & { conIA: boolean }) | null
> {
  const fila = db.select().from(estadoCuentaBorrador).get();
  if (!fila) return null;
  const analisis = await cotejarMovimientos(
    leerMovimientosBorrador(fila.movimientosJson)
  );
  return { ...analisis, conIA: fila.conIA };
}

export async function descartarBorradorEstadoCuenta() {
  db.delete(estadoCuentaBorrador).run();
  revalidatePath("/estado-cuenta");
}

/**
 * Interpreta un PDF de estado de cuenta con IA (vía para layouts que el
 * parser por coordenadas no entiende) y coteja los movimientos resultantes
 * contra los gastos ya cargados.
 * @param fuente Buffer del PDF.
 * @param proveedor Proveedor de IA elegido; sin esto, el activo.
 * @returns El mismo análisis que `analizarEstadoCuenta`, más `errorIA` si la IA falló y `avisoIA` si respondió un modelo de respaldo.
 */
export async function analizarEstadoCuentaConIA(
  fuente: { buffer: ArrayBuffer },
  proveedor?: ProveedorIA
): Promise<AnalisisEstadoCuenta & { errorIA?: string; avisoIA?: string }> {
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
  return { ...(await cotejarYGuardarBorrador(ordenados, true)), avisoIA: r.aviso };
}

const ANALISIS_VACIO: AnalisisEstadoCuenta = {
  lineas: [],
  resumen: { total: 0, directos: 0, yaRegistradas: 0, faltantes: 0, sinCotizacion: 0, totalPesos: 0 },
  desde: null,
  hasta: null,
  gastosEnRango: 0,
  descuentos: { cantidad: 0, pesos: 0, usdSinCotizacion: 0 },
  conflictosBandeja: [],
};

async function sumarDescuentos(
  descuentos: MovimientoEstadoCuenta[]
): Promise<DescuentosEstadoCuenta> {
  let pesos = 0;
  let usdSinCotizacion = 0;
  for (const d of descuentos) {
    const monto = Math.abs(d.monto);
    if (d.moneda === "UYU") {
      pesos += monto;
      continue;
    }
    const cotizacion = await obtenerCotizacionCacheada(d.fecha);
    if (cotizacion === null) usdSinCotizacion += monto;
    else pesos += monto * cotizacion;
  }
  return {
    cantidad: descuentos.length,
    pesos: Number(pesos.toFixed(2)),
    usdSinCotizacion: Number(usdSinCotizacion.toFixed(2)),
  };
}

async function cotejarMovimientos(
  todos: MovimientoEstadoCuenta[]
): Promise<AnalisisEstadoCuenta> {
  const { compras: movimientos, descuentos: negativos } = separarDescuentos(todos);
  const descuentos = await sumarDescuentos(negativos);
  if (!movimientos.length) return { ...ANALISIS_VACIO, descuentos };

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

  return {
    lineas,
    resumen,
    desde,
    hasta,
    gastosEnRango: candidatos.length,
    descuentos,
    conflictosBandeja: await conflictosConBandeja(lineas, emisorPorId),
  };
}

/**
 * Cruza contra la bandeja sólo los movimientos que se importarían: uno que ya
 * matchea un gasto cargado no va a crear nada, así que no puede duplicar.
 */
async function conflictosConBandeja(
  lineas: LineaAnalizada[],
  emisorPorId: Map<number, typeof emisores.$inferSelect>
): Promise<ConflictoConBandeja[]> {
  const entrantes = (await db.select().from(gastosEntrantes)).map((e) => {
    const items = parsearItemsEntrante(e.itemsJson);
    return {
      ...e,
      // Un ticket leído por IA no trae total validado: vale la suma de lo leído.
      total:
        e.total ??
        (items.length
          ? Number(items.reduce((acc, i) => acc + i.precio, 0).toFixed(2))
          : null),
    };
  });
  if (!entrantes.length) return [];

  const importables = lineas.filter(
    (l) => l.estado === "faltante" || l.estado === "directo"
  );
  const conflictos = entrantesEnConflicto(importables, entrantes, {
    dias: TOLERANCIA_DIAS,
    monto: TOLERANCIA_MONTO,
  });

  return conflictos.flatMap((c) => {
    const entrante = entrantes.find((e) => e.id === c.entranteId);
    if (!entrante) return [];
    return [
      {
        entranteId: entrante.id,
        comercio:
          (entrante.emisorId !== null
            ? emisorPorId.get(entrante.emisorId)?.nombre
            : null) ?? entrante.comercio,
        fecha: entrante.fecha,
        total: entrante.total,
        revisable: entrante.estado === "pendiente",
        movimientos: c.movimientos.flatMap((indice) => {
          const linea = lineas.find((l) => l.indice === indice);
          return linea ? [linea.descripcion] : [];
        }),
      },
    ];
  });
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

  const directo = clasificarLinea(
    mov.descripcion,
    mov.moneda === "USD",
    mov.monto
  );
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
  const existentes = await db
    .select({ id: emisores.id, nombre: emisores.nombre })
    .from(emisores)
    .orderBy(asc(emisores.id));
  for (const emisor of existentes) {
    const clave = emisor.nombre.toLowerCase();
    if (!emisorIdPorNombre.has(clave)) emisorIdPorNombre.set(clave, emisor.id);
  }

  for (const linea of seleccion) {
    const clave = linea.emisorNombre.toLowerCase();
    if (emisorIdPorNombre.has(clave)) continue;
    const [creado] = await db
      .insert(emisores)
      .values({ nombre: linea.emisorNombre })
      .returning();
    emisorIdPorNombre.set(clave, creado.id);
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
          creadoEn: new Date().toISOString(),
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

  // Importado: el borrador ya cumplió.
  db.delete(estadoCuentaBorrador).run();

  revalidatePath("/gastos");
  revalidatePath("/reportes");
  revalidatePath("/");
  revalidatePath("/estado-cuenta");

  return { importados: seleccion.length, gastoIds };
}
