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
  estadosCuenta,
  movimientosEstadoCuenta,
  cuotasCompra,
} from "@/db/schema";
import { createHash } from "node:crypto";
import {
  entrantesEnConflicto,
  parsearItemsEntrante,
} from "@/lib/entrantes";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { extraerFilasPdf, type FilaPdf } from "@/lib/pdf";
import {
  cuotaCompatible,
  cuotaDe,
  fecharCuotas,
  movimientosDelRegistro,
  sinCuota,
  parsearCabeceraEstadoCuenta,
  parsearEstadoCuenta,
  separarDescuentos,
  type Cuota,
  type MovimientoEstadoCuenta,
} from "@/lib/estado-cuenta";
import {
  borrarPdfEstadoCuenta,
  guardarPdfEstadoCuenta,
} from "@/lib/estados-cuenta-server";
import {
  aprenderTarjeta,
  comprasParaCruce,
  crearPlan,
  gastosDeCuotas,
  noEsCompraEnCuotas,
  pagarCuotaEnTx,
  vincularCuotasImportadas,
} from "@/lib/compras-cuotas-server";
import {
  cuotaParaLinea,
  cuotasEsperadas,
  pareceCompraEntera,
  type CompraParaCruce,
  type CuotaEsperada,
} from "@/lib/cuotas";
import {
  clasificarLinea,
  sugerirCategoriaComercio,
  ITEM_PAGO_TARJETA,
  CATEGORIA_FALLBACK,
} from "@/lib/clasificacion-comercios";
import { obtenerCotizacionCacheada } from "@/lib/bcu";
import { formatearMonto } from "@/lib/formato";
import { interpretarEstadoCuentaConIA, type FuenteIA } from "./ia";
import type { ProveedorIA } from "@/lib/proveedores-ia";

const TOLERANCIA_MONTO = 2;

const TOLERANCIA_DIAS = 1;

export type EstadoLinea =
  | "directo"
  | "ya_registrada"
  | "faltante"
  | "sin_cotizacion"
  | "cuota_compra";

/**
 * La cuota de una compra en cuotas que es una línea. Con `nueva`, la compra
 * todavía es un gasto común que parece ser la compra entera: al importar se
 * convierte en compra en cuotas, con el recargo que se deduce de la línea.
 */
export type CuotaDeCompraEnLinea = {
  cuotaId: number | null;
  compraGastoId: number;
  emisorId: number;
  emisorNombre: string;
  fechaCompra: string;
  numero: number;
  cantidad: number;
  importeCalculado: number | null;
  nueva: { total: number; interesPct: number } | null;
};

export type LineaAnalizada = {
  indice: number;
  fecha: string;
  /** La fecha de compra impresa, cuando la línea es una cuota fechada al cierre. */
  fechaCompra: string | null;
  descripcion: string;
  montoOriginal: number;
  moneda: "UYU" | "USD";
  montoPesos: number | null;
  /** La cuota que es la línea; null si es una compra al contado. */
  cuota: Cuota | null;
  /** La compra en cuotas registrada de la que es cuota, si se encontró. */
  cuotaCompra: CuotaDeCompraEnLinea | null;
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
    cuotasDeCompras: number;
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
  /**
   * Cuotas de compras registradas que tendrían que estar en este estado de
   * cuenta y no se cruzaron con ninguna línea: o se calcularon mal, o el
   * banco las marca de una forma que no se reconoce.
   */
  cuotasEsperadas: CuotaEsperada[];
  /** La fila del registro de estados de cuenta; null si no se registró. */
  estadoCuentaId: number | null;
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
      emisor: emisores.nombre,
      emisorId: gastos.emisorId,
      descripciones: sql<string | null>`group_concat(${gastoItems.descripcion}, ' | ')`,
    })
    .from(gastos)
    .innerJoin(emisores, eq(emisores.id, gastos.emisorId))
    .leftJoin(gastoItems, eq(gastoItems.gastoId, gastos.id))
    .where(
      and(
        gte(gastos.fecha, sumarDias(desde, -TOLERANCIA_DIAS)),
        lte(gastos.fecha, sumarDias(hasta, TOLERANCIA_DIAS)),
        noEsCompraEnCuotas
      )
    )
    .groupBy(gastos.id);

  return filas.map((f) => ({
    id: f.id,
    fecha: f.fecha,
    total: f.montoTotal ?? f.sumaLineas,
    emisorId: f.emisorId,
    textos: [f.emisor, f.descripciones ?? ""],
  }));
}

type CandidatoCruce = Awaited<ReturnType<typeof totalesDeGastos>>[number];

/**
 * Los gastos que ya corresponden a una línea de otro estado de cuenta: un
 * cobro aparece en un solo estado de cuenta, así que no pueden ser una línea
 * de este. El mismo estado de cuenta subido de nuevo sí los vuelve a cruzar.
 * Es lo que impide tomar la segunda cuota de una compra por la primera.
 */
function gastosDeOtrosEstadosCuenta(estadoCuentaId: number | null): Set<number> {
  const filas = db
    .selectDistinct({ gastoId: movimientosEstadoCuenta.gastoId })
    .from(movimientosEstadoCuenta)
    .where(
      and(
        isNotNull(movimientosEstadoCuenta.gastoId),
        estadoCuentaId === null
          ? undefined
          : ne(movimientosEstadoCuenta.estadoCuentaId, estadoCuentaId)
      )
    )
    .all();
  return new Set(filas.flatMap((f) => (f.gastoId === null ? [] : [f.gastoId])));
}

function cabeceraDe(estadoCuentaId: number | null): {
  cierre: string | null;
  tarjeta: string | null;
} {
  if (estadoCuentaId === null) return { cierre: null, tarjeta: null };
  return (
    db
      .select({ cierre: estadosCuenta.cierre, tarjeta: estadosCuenta.tarjeta })
      .from(estadosCuenta)
      .where(eq(estadosCuenta.id, estadoCuentaId))
      .get() ?? { cierre: null, tarjeta: null }
  );
}

/**
 * Un análisis recién hecho: con qué se leyó y, si corresponde, qué avisar
 * (un modelo de respaldo, o que se usó la lectura ya registrada).
 */
export type ResultadoAnalisisEstadoCuenta = AnalisisEstadoCuenta & {
  conIA: boolean;
  errorIA?: string;
  aviso?: string;
};

type LecturaPdf =
  | { movimientos: MovimientoEstadoCuenta[]; aviso?: string }
  | { error: string };

/**
 * Lee un PDF, lo registra y lo coteja. Un PDF del que no sale ninguna compra
 * no toca nada: ni el registro ni el borrador que hubiera, igual que una
 * lectura con IA que falló. Un PDF que ya se importó no se vuelve a leer: se
 * coteja la lectura con la que se importó, para que el registro no cambie por
 * una lectura que quizás nunca se importe (y no se pague de nuevo la IA).
 * @param leer la lectura propiamente dicha, sobre las filas del PDF
 */
async function analizarPdf(
  buffer: ArrayBuffer,
  nombreArchivo: string,
  conIA: boolean,
  leer: (filas: FilaPdf[]) => Promise<LecturaPdf>
): Promise<ResultadoAnalisisEstadoCuenta> {
  const pdf = Buffer.from(buffer.slice(0));
  const hash = createHash("sha256").update(pdf).digest("hex");

  const importado = db
    .select({
      id: estadosCuenta.id,
      archivo: estadosCuenta.archivo,
      conIA: estadosCuenta.conIA,
      movimientosJson: estadosCuenta.movimientosJson,
    })
    .from(estadosCuenta)
    .where(and(eq(estadosCuenta.hash, hash), isNotNull(estadosCuenta.importadoEn)))
    .get();
  if (importado) {
    await asegurarPdf(importado.id, importado.archivo, pdf);
    return {
      ...(await cotejarYGuardarBorrador(
        leerMovimientosBorrador(importado.movimientosJson),
        importado.conIA,
        importado.id
      )),
      conIA: importado.conIA,
      aviso:
        "Este estado de cuenta ya estaba en el registro: se usó la lectura con la que se importó. Para leerlo de nuevo, quitalo del registro y volvé a subirlo.",
    };
  }

  const filas = await extraerFilasPdf(buffer);
  const lectura = await leer(filas);
  if ("error" in lectura) {
    return { ...ANALISIS_VACIO, conIA, errorIA: lectura.error };
  }
  if (!separarDescuentos(lectura.movimientos).compras.length) {
    return { ...ANALISIS_VACIO, conIA, aviso: lectura.aviso };
  }
  const estadoCuentaId = await registrarEstadoCuenta({
    pdf,
    hash,
    nombreArchivo,
    filas,
    movimientos: lectura.movimientos,
    conIA,
  });
  return {
    ...(await cotejarYGuardarBorrador(lectura.movimientos, conIA, estadoCuentaId)),
    conIA,
    aviso: lectura.aviso,
  };
}

export async function analizarEstadoCuenta(
  buffer: ArrayBuffer,
  nombreArchivo = "estado-de-cuenta.pdf"
): Promise<ResultadoAnalisisEstadoCuenta> {
  return analizarPdf(buffer, nombreArchivo, false, async (filas) => ({
    movimientos: parsearEstadoCuenta(filas),
  }));
}

/** Guarda el PDF de una fila del registro que todavía no lo tiene en disco. */
async function asegurarPdf(id: number, archivo: string | null, pdf: Buffer) {
  if (archivo) return;
  const guardado = await guardarPdfEstadoCuenta(id, pdf);
  if (guardado) {
    db.update(estadosCuenta)
      .set({ archivo: guardado })
      .where(eq(estadosCuenta.id, id))
      .run();
  }
}

/**
 * Da de alta (o actualiza, si es el mismo archivo todavía sin importar) la
 * fila del registro y guarda el PDF.
 * @param datos.pdf una copia del archivo tomada antes de leerlo: pdf.js
 * transfiere el ArrayBuffer que recibe y lo deja vacío
 * @returns el id de la fila
 */
async function registrarEstadoCuenta(datos: {
  pdf: Buffer;
  hash: string;
  nombreArchivo: string;
  filas: FilaPdf[];
  movimientos: MovimientoEstadoCuenta[];
  conIA: boolean;
}): Promise<number> {
  const { pdf } = datos;
  const cabecera = parsearCabeceraEstadoCuenta(datos.filas);
  const fechas = datos.movimientos.map((m) => m.fecha).sort();
  const valores = {
    nombreArchivo: datos.nombreArchivo,
    conIA: datos.conIA,
    banco: cabecera.banco,
    cierre: cabecera.cierre,
    vencimiento: cabecera.vencimiento,
    desde: fechas[0],
    hasta: fechas[fechas.length - 1],
    pagoContadoPesos: cabecera.pagoContado.pesos,
    pagoContadoUsd: cabecera.pagoContado.usd,
    pagoMinimoPesos: cabecera.pagoMinimo.pesos,
    pagoMinimoUsd: cabecera.pagoMinimo.usd,
    tarjeta: cabecera.tarjeta,
    movimientosJson: JSON.stringify(datos.movimientos),
  };
  const fila = db
    .insert(estadosCuenta)
    .values({
      hash: datos.hash,
      subidoEn: new Date().toISOString(),
      ...valores,
    })
    .onConflictDoUpdate({ target: estadosCuenta.hash, set: valores })
    .returning()
    .get();

  await asegurarPdf(fila.id, fila.archivo, pdf);
  return fila.id;
}

/**
 * Borra los análisis que nunca se importaron, salvo el indicado: subir un
 * estado de cuenta nuevo reemplaza al que quedó a medio revisar.
 */
async function descartarSinImportar(salvo: number | null) {
  const sobrantes = db
    .select({ id: estadosCuenta.id, archivo: estadosCuenta.archivo })
    .from(estadosCuenta)
    .where(
      and(
        isNull(estadosCuenta.importadoEn),
        salvo === null ? undefined : ne(estadosCuenta.id, salvo)
      )
    )
    .all();
  for (const fila of sobrantes) {
    db.delete(estadosCuenta).where(eq(estadosCuenta.id, fila.id)).run();
    await borrarPdfEstadoCuenta(fila.archivo);
  }
}

/**
 * Coteja los movimientos de un PDF recién leído. Si chocan con la bandeja
 * quedan en borrador para retomarlos sin volver a subir (ni a pagar con cuota
 * de IA) el PDF; si no, el borrador que hubiera se descarta: subir un estado
 * de cuenta nuevo reemplaza al anterior.
 */
async function cotejarYGuardarBorrador(
  movimientos: MovimientoEstadoCuenta[],
  conIA: boolean,
  estadoCuentaId: number
): Promise<AnalisisEstadoCuenta> {
  await descartarSinImportar(estadoCuentaId);
  const analisis = {
    ...(await cotejarMovimientos(movimientos, estadoCuentaId)),
    estadoCuentaId,
  };
  if (analisis.conflictosBandeja.length) {
    const valores = {
      creadoEn: new Date().toISOString(),
      movimientosJson: JSON.stringify(movimientos),
      conIA,
      estadoCuentaId,
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
    leerMovimientosBorrador(fila.movimientosJson),
    fila.estadoCuentaId
  );
  return { ...analisis, estadoCuentaId: fila.estadoCuentaId, conIA: fila.conIA };
}

export async function descartarBorradorEstadoCuenta() {
  db.delete(estadoCuentaBorrador).run();
  await descartarSinImportar(null);
  revalidatePath("/estado-cuenta");
}

/**
 * Interpreta un PDF de estado de cuenta con IA (vía para layouts que el
 * parser por coordenadas no entiende) y coteja los movimientos resultantes
 * contra los gastos ya cargados.
 * @param fuente Buffer del PDF.
 * @param proveedor Proveedor de IA elegido; sin esto, el activo.
 * @returns El mismo análisis que `analizarEstadoCuenta`, más `errorIA` si la IA falló y `aviso` si respondió un modelo de respaldo.
 */
export async function analizarEstadoCuentaConIA(
  fuente: { buffer: ArrayBuffer; nombreArchivo?: string },
  proveedor?: ProveedorIA
): Promise<ResultadoAnalisisEstadoCuenta> {
  return analizarPdf(
    fuente.buffer,
    fuente.nombreArchivo ?? "estado-de-cuenta.pdf",
    true,
    async (filas) => {
      const entrada: FuenteIA = {
        tipo: "texto",
        texto: filas.map((f) => f.texto).join("\n"),
      };
      const r = await interpretarEstadoCuentaConIA(entrada, proveedor);
      if (!r.ok || !r.movimientos) {
        return { error: r.error ?? "La IA no pudo interpretar el PDF" };
      }
      return {
        movimientos: [...r.movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha)),
        aviso: r.aviso,
      };
    }
  );
}

const ANALISIS_VACIO: AnalisisEstadoCuenta = {
  lineas: [],
  resumen: {
    total: 0,
    directos: 0,
    yaRegistradas: 0,
    faltantes: 0,
    sinCotizacion: 0,
    cuotasDeCompras: 0,
    totalPesos: 0,
  },
  desde: null,
  hasta: null,
  gastosEnRango: 0,
  descuentos: { cantidad: 0, pesos: 0, usdSinCotizacion: 0 },
  conflictosBandeja: [],
  cuotasEsperadas: [],
  estadoCuentaId: null,
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
  leidos: MovimientoEstadoCuenta[],
  estadoCuentaId: number | null
): Promise<Omit<AnalisisEstadoCuenta, "estadoCuentaId">> {
  const cabecera = cabeceraDe(estadoCuentaId);
  const todos = fecharCuotas(leidos, cabecera.cierre);
  const { compras: movimientos, descuentos: negativos } = separarDescuentos(todos);
  const descuentos = await sumarDescuentos(negativos);
  if (!movimientos.length) return { ...ANALISIS_VACIO, descuentos };

  const fechas = movimientos.map((m) => m.fecha).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];
  const fechasCruce = movimientos
    .flatMap((m) => (m.fechaCompra ? [m.fecha, m.fechaCompra] : [m.fecha]))
    .sort();

  const yaAtribuidos = gastosDeOtrosEstadosCuenta(estadoCuentaId);
  const [todasCategorias, todosEmisores, alias, enRango] = await Promise.all([
    db.select().from(categorias),
    db.select().from(emisores),
    db.select().from(emisorAlias),
    totalesDeGastos(fechasCruce[0], fechasCruce[fechasCruce.length - 1]),
  ]);
  const candidatos = enRango.filter((c) => !yaAtribuidos.has(c.id));
  const compras = comprasParaCruce();
  const deCuotas = gastosDeCuotas();

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
  const cuotasTomadas = new Set<number>();

  const lineas: LineaAnalizada[] = [];

  for (const [indice, mov] of movimientos.entries()) {
    const linea = await analizarMovimiento(mov, indice, {
      categoriaPorNombre,
      emisorPorNombre,
      emisorPorAlias,
      candidatos,
      usados,
      compras,
      deCuotas,
      cuotasTomadas,
      tarjeta: cabecera.tarjeta,
    });
    lineas.push(linea);
  }

  const resumen = {
    total: lineas.length,
    directos: lineas.filter((l) => l.estado === "directo").length,
    yaRegistradas: lineas.filter((l) => l.estado === "ya_registrada").length,
    faltantes: lineas.filter((l) => l.estado === "faltante").length,
    sinCotizacion: lineas.filter((l) => l.estado === "sin_cotizacion").length,
    cuotasDeCompras: lineas.filter((l) => l.estado === "cuota_compra").length,
    totalPesos: lineas.reduce((acc, l) => acc + (l.montoPesos ?? 0), 0),
  };

  return {
    lineas,
    resumen,
    desde,
    hasta,
    gastosEnRango: candidatos.filter(
      (c) =>
        c.fecha >= sumarDias(desde, -TOLERANCIA_DIAS) &&
        c.fecha <= sumarDias(hasta, TOLERANCIA_DIAS)
    ).length,
    descuentos,
    conflictosBandeja: await conflictosConBandeja(lineas, emisorPorId),
    cuotasEsperadas: cuotasEsperadas(
      compras,
      { corte: cabecera.cierre ?? hasta, tarjeta: cabecera.tarjeta },
      lineas.map((l) => ({
        indice: l.indice,
        descripcion: l.descripcion,
        fechaCompra: l.fechaCompra ?? l.fecha,
        montoPesos: l.montoPesos,
        cuota: l.cuota,
        cuotaAsignadaId: l.cuotaCompra?.cuotaId ?? null,
        gastoExistenteId: l.gastoExistenteId,
        ocupada: l.cuotaCompra !== null,
      }))
    ),
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
    candidatos: CandidatoCruce[];
    usados: Set<number>;
    compras: CompraParaCruce[];
    deCuotas: Set<number>;
    cuotasTomadas: Set<number>;
    tarjeta: string | null;
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

  const textoPos = sinCuota(mov.descripcion);
  const porAlias =
    ctx.emisorPorAlias.get(mov.descripcion.toLowerCase()) ??
    ctx.emisorPorAlias.get(textoPos.toLowerCase());
  const nombreEmisor = porAlias?.nombre ?? directo?.emisor ?? textoPos;
  const emisorId =
    porAlias?.id ?? ctx.emisorPorNombre.get(nombreEmisor.toLowerCase())?.id ?? null;

  const base = {
    indice,
    fecha: mov.fecha,
    fechaCompra: mov.fechaCompra ?? null,
    descripcion: mov.descripcion,
    montoOriginal: mov.monto,
    moneda: mov.moneda,
    montoPesos,
    cuota: cuotaDe(mov.descripcion),
    cuotaCompra: null,
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

  const matchea = (c: CandidatoCruce) =>
    !ctx.usados.has(c.id) &&
    Math.abs(Number(c.total) - montoPesos) <= TOLERANCIA_MONTO &&
    cuotaCompatible(mov.descripcion, c.textos);
  const fechas = mov.fechaCompra ? [mov.fecha, mov.fechaCompra] : [mov.fecha];

  const match =
    ctx.candidatos.find((c) => matchea(c) && fechas.includes(c.fecha)) ??
    ctx.candidatos.find(
      (c) =>
        matchea(c) &&
        fechas.some(
          (f) =>
            c.fecha >= sumarDias(f, -TOLERANCIA_DIAS) &&
            c.fecha <= sumarDias(f, TOLERANCIA_DIAS)
        )
    );

  if (match) {
    ctx.usados.add(match.id);
    return { ...base, estado: "ya_registrada", gastoExistenteId: match.id };
  }

  const cuotaCompra = base.cuota
    ? cuotaDeCompraParaLinea(
        { fechaCompra: mov.fechaCompra ?? mov.fecha, cuota: base.cuota, montoPesos },
        emisorId,
        ctx
      )
    : null;
  if (cuotaCompra) {
    return {
      ...base,
      emisorSugerido: cuotaCompra.emisorNombre,
      emisorId: cuotaCompra.emisorId,
      cuotaCompra,
      estado: "cuota_compra",
      gastoExistenteId: null,
    };
  }

  if (directo) {
    return { ...base, estado: "directo", gastoExistenteId: null };
  }

  return { ...base, estado: "faltante", gastoExistenteId: null };
}

/**
 * La compra en cuotas de la que una línea `CUOTA n/m` es cuota: primero una
 * registrada (`cuotaParaLinea`); si no hay, un gasto común de la fecha de
 * compra que parece la compra entera, que al importar se convierte.
 */
function cuotaDeCompraParaLinea(
  linea: { fechaCompra: string; cuota: Cuota; montoPesos: number },
  emisorIdLinea: number | null,
  ctx: {
    compras: CompraParaCruce[];
    candidatos: CandidatoCruce[];
    usados: Set<number>;
    deCuotas: Set<number>;
    cuotasTomadas: Set<number>;
    tarjeta: string | null;
  }
): CuotaDeCompraEnLinea | null {
  const registrada = cuotaParaLinea(linea, ctx.compras, ctx.tarjeta, ctx.cuotasTomadas);
  if (registrada) {
    ctx.cuotasTomadas.add(registrada.cuota.id);
    return {
      cuotaId: registrada.cuota.id,
      compraGastoId: registrada.compra.gastoId,
      emisorId: registrada.compra.emisorId,
      emisorNombre: registrada.compra.emisorNombre,
      fechaCompra: registrada.compra.fecha,
      numero: registrada.cuota.numero,
      cantidad: registrada.compra.cantidad,
      importeCalculado: registrada.cuota.importeCalculado,
      nueva: null,
    };
  }

  for (const gasto of ctx.candidatos) {
    if (ctx.usados.has(gasto.id) || ctx.deCuotas.has(gasto.id)) continue;
    const parecida = pareceCompraEntera(
      {
        fecha: gasto.fecha,
        total: Number(gasto.total),
        mismoComercio: emisorIdLinea !== null && emisorIdLinea === gasto.emisorId,
      },
      linea
    );
    if (!parecida) continue;
    ctx.usados.add(gasto.id);
    return {
      cuotaId: null,
      compraGastoId: gasto.id,
      emisorId: gasto.emisorId,
      emisorNombre: gasto.textos[0],
      fechaCompra: gasto.fecha,
      numero: linea.cuota.numero,
      cantidad: linea.cuota.total,
      importeCalculado: null,
      nueva: { total: Number(gasto.total), interesPct: parecida.interesPct },
    };
  }
  return null;
}

export type SeleccionImportacion = {
  indice: number;
  fecha: string;
  descripcion: string;
  montoPesos: number;
  /** El comercio elegido en la revisión; sin él se busca o se crea por `emisorNombre`. */
  emisorId?: number | null;
  emisorNombre: string;
  categoriaId: number;
  /** El texto del banco a recordar como alias del comercio de la línea. */
  aliasOriginal?: string;
};

/**
 * Lo que va al registro al importar, cotejado de nuevo acá sobre la lectura
 * guardada del PDF: a qué gasto apunta cada línea, y qué gasto se re-fecha al
 * cierre, no lo decide lo que mande el navegador. Se coteja antes de crear
 * los gastos nuevos, que si no se matchearían a sí mismos.
 * @returns null si el estado de cuenta ya no está en el registro
 */
async function registroDeImportacion(estadoCuentaId: number): Promise<{
  estadoCuentaId: number;
  cierre: string | null;
  tarjeta: string | null;
  lineas: LineaAnalizada[];
  descuentos: { movimiento: MovimientoEstadoCuenta; montoPesos: number | null }[];
} | null> {
  const fila = db
    .select({ movimientosJson: estadosCuenta.movimientosJson })
    .from(estadosCuenta)
    .where(eq(estadosCuenta.id, estadoCuentaId))
    .get();
  if (!fila) return null;
  const movimientos = leerMovimientosBorrador(fila.movimientosJson);
  const { lineas } = await cotejarMovimientos(movimientos, estadoCuentaId);
  const { descuentos } = separarDescuentos(movimientos);
  return {
    estadoCuentaId,
    ...cabeceraDe(estadoCuentaId),
    lineas,
    descuentos: await Promise.all(descuentos.map(descuentoEnPesos)),
  };
}

async function descuentoEnPesos(movimiento: MovimientoEstadoCuenta) {
  if (movimiento.moneda === "UYU") {
    return { movimiento, montoPesos: movimiento.monto };
  }
  const cotizacion = await obtenerCotizacionCacheada(movimiento.fecha);
  return {
    movimiento,
    montoPesos:
      cotizacion === null ? null : Number((movimiento.monto * cotizacion).toFixed(2)),
  };
}

/**
 * Recuerda a qué comercio va un texto del banco. Si el texto ya apuntaba a
 * otro, se pisa: es el usuario corrigiendo el comercio en la revisión.
 */
function recordarAlias(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  emisorId: number,
  texto: string
) {
  const alias = sinCuota(texto);
  if (!alias) return;
  tx.insert(emisorAlias)
    .values({ emisorId, alias })
    .onConflictDoUpdate({ target: emisorAlias.alias, set: { emisorId } })
    .run();
}

/** Una línea que el usuario eligió como la cuota esperada de una compra. */
export type AsignacionCuota = { indice: number; cuotaId: number };

export type ResultadoImportacion = {
  importados: number;
  /** Los gastos nuevos para revisar; las cuotas de compras no hace falta revisarlas. */
  gastoIds: number[];
  /** Cuotas de compras en cuotas que quedaron pagadas. */
  cuotas: number;
  /** Planes de cuotas que se corrigieron con lo que cobró el banco. */
  avisos: string[];
};

/**
 * Crea un gasto por cada línea elegida y, con `estadoCuentaId`, deja el
 * estado de cuenta en el registro con cada línea vinculada a su gasto. Sin
 * líneas elegidas sólo registra: un estado de cuenta con todo ya cargado
 * también se guarda. Una cuota que se cruzó con un gasto cargado con la fecha
 * de compra mueve ese gasto a la fecha de cierre, como se fechan las cuotas.
 *
 * Una línea que es cuota de una compra en cuotas (cruzada acá, del lado del
 * servidor, o elegida a mano en `asignaciones`) no crea un gasto suelto: paga
 * esa cuota, con el comercio y las categorías de la compra. Si la compra era
 * todavía un gasto común, primero se convierte.
 */
export async function importarMovimientos(
  seleccion: SeleccionImportacion[],
  estadoCuentaId?: number,
  asignaciones: AsignacionCuota[] = []
): Promise<ResultadoImportacion> {
  const registro =
    estadoCuentaId === undefined ? null : await registroDeImportacion(estadoCuentaId);
  if (!seleccion.length && !registro) {
    return { importados: 0, gastoIds: [], cuotas: 0, avisos: [] };
  }

  const analizadas = new Map(registro?.lineas.map((l) => [l.indice, l]) ?? []);
  const asignadaA = new Map<number, number>();
  for (const a of asignaciones) {
    const linea = analizadas.get(a.indice);
    if (!linea || linea.gastoExistenteId !== null) {
      throw new Error(
        "Una línea elegida como cuota ya no está disponible: volvé a subir el estado de cuenta"
      );
    }
    if ([...asignadaA.values()].includes(a.cuotaId)) {
      throw new Error("La misma cuota quedó elegida para dos líneas");
    }
    asignadaA.set(a.indice, a.cuotaId);
  }
  const esCuota = (indice: number) =>
    asignadaA.has(indice) || !!analizadas.get(indice)?.cuotaCompra;

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

  const elegidos = [
    ...new Set(
      seleccion.flatMap((l) =>
        !esCuota(l.indice) && l.emisorId != null ? [l.emisorId] : []
      )
    ),
  ];
  if (elegidos.length) {
    const existen = new Set(
      db
        .select({ id: emisores.id })
        .from(emisores)
        .where(inArray(emisores.id, elegidos))
        .all()
        .map((e) => e.id)
    );
    if (elegidos.some((id) => !existen.has(id))) {
      throw new Error("Uno de los comercios elegidos ya no existe: volvé a subir el estado de cuenta");
    }
  }

  for (const linea of seleccion) {
    if (esCuota(linea.indice) || linea.emisorId != null) continue;
    const clave = linea.emisorNombre.toLowerCase();
    if (emisorIdPorNombre.has(clave)) continue;
    const [creado] = await db
      .insert(emisores)
      .values({ nombre: linea.emisorNombre })
      .returning();
    emisorIdPorNombre.set(clave, creado.id);
  }

  const gastoIds: number[] = [];
  const creados = new Map<number, number>();
  const avisos: string[] = [];
  let cuotas = 0;

  db.transaction((tx) => {
    for (const linea of seleccion) {
      if (esCuota(linea.indice)) {
        const analizada = analizadas.get(linea.indice)!;
        const asignada = asignadaA.get(linea.indice);
        const enLinea = asignada === undefined ? analizada.cuotaCompra : null;
        let cuotaId = asignada ?? enLinea?.cuotaId ?? null;
        let compraNueva: number | null = null;
        if (cuotaId === null && enLinea?.nueva) {
          compraNueva = crearPlan(tx, enLinea.compraGastoId, {
            total: enLinea.nueva.total,
            cantidad: enLinea.cantidad,
            interesPct: enLinea.nueva.interesPct,
          });
          cuotaId =
            tx
              .select({ id: cuotasCompra.id })
              .from(cuotasCompra)
              .where(
                and(
                  eq(cuotasCompra.compraId, compraNueva),
                  eq(cuotasCompra.numero, enLinea.numero)
                )
              )
              .get()?.id ?? null;
        }
        if (cuotaId === null) continue;

        const importe = linea.montoPesos;
        const pago = pagarCuotaEnTx(tx, cuotaId, {
          importe,
          fecha: registro?.cierre ?? analizada.fecha,
        });
        if (compraNueva !== null) vincularCuotasImportadas(tx, compraNueva);
        aprenderTarjeta(tx, pago.compraId, registro?.tarjeta ?? null);
        creados.set(linea.indice, pago.gastoId);
        cuotas += 1;
        if (pago.interesAjustado !== null) {
          avisos.push(
            `${pago.emisorNombre}: la cuota ${pago.numero}/${pago.cantidad} se cobró ${formatearMonto(importe, { decimales: 2 })}; las que faltan se recalcularon con un recargo de ${pago.interesAjustado}%.`
          );
        }
        if (linea.aliasOriginal) {
          recordarAlias(tx, pago.emisorId, linea.aliasOriginal);
        }
        continue;
      }

      const emisorId =
        linea.emisorId ?? emisorIdPorNombre.get(linea.emisorNombre.toLowerCase())!;

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
      creados.set(linea.indice, gasto.id);

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
        recordarAlias(tx, emisorId, linea.aliasOriginal);
      }
    }

    if (registro) {
      for (const l of registro.lineas) {
        if (creados.has(l.indice) || l.gastoExistenteId === null) continue;
        if (!l.fechaCompra || !cuotaDe(l.descripcion)) continue;
        tx.update(gastos)
          .set({ fecha: l.fecha })
          .where(and(eq(gastos.id, l.gastoExistenteId), eq(gastos.fecha, l.fechaCompra)))
          .run();
      }
      tx.delete(movimientosEstadoCuenta)
        .where(eq(movimientosEstadoCuenta.estadoCuentaId, registro.estadoCuentaId))
        .run();
      const filas = movimientosDelRegistro(registro.lineas, creados, registro.descuentos);
      if (filas.length) {
        tx.insert(movimientosEstadoCuenta)
          .values(
            filas.map((f) => ({ ...f, estadoCuentaId: registro.estadoCuentaId }))
          )
          .run();
      }
      tx.update(estadosCuenta)
        .set({ importadoEn: new Date().toISOString() })
        .where(eq(estadosCuenta.id, registro.estadoCuentaId))
        .run();
    }
  });

  db.delete(estadoCuentaBorrador).run();

  revalidatePath("/gastos");
  revalidatePath("/reportes");
  revalidatePath("/");
  revalidatePath("/estado-cuenta", "layout");

  return { importados: seleccion.length, gastoIds, cuotas, avisos };
}

const COLUMNAS_REGISTRO = {
  id: estadosCuenta.id,
  nombreArchivo: estadosCuenta.nombreArchivo,
  archivo: estadosCuenta.archivo,
  subidoEn: estadosCuenta.subidoEn,
  importadoEn: estadosCuenta.importadoEn,
  conIA: estadosCuenta.conIA,
  banco: estadosCuenta.banco,
  cierre: estadosCuenta.cierre,
  vencimiento: estadosCuenta.vencimiento,
  desde: estadosCuenta.desde,
  hasta: estadosCuenta.hasta,
  pagoContadoPesos: estadosCuenta.pagoContadoPesos,
  pagoContadoUsd: estadosCuenta.pagoContadoUsd,
  pagoMinimoPesos: estadosCuenta.pagoMinimoPesos,
  pagoMinimoUsd: estadosCuenta.pagoMinimoUsd,
  tarjeta: estadosCuenta.tarjeta,
};

export type EstadoCuentaRegistrado = Omit<
  typeof estadosCuenta.$inferSelect,
  "movimientosJson" | "hash"
>;

export type ResumenEstadoCuentaRegistrado = EstadoCuentaRegistrado & {
  movimientos: number;
  importados: number;
};

export async function listarEstadosCuenta(): Promise<ResumenEstadoCuentaRegistrado[]> {
  return db
    .select({
      ...COLUMNAS_REGISTRO,
      movimientos: sql<number>`count(${movimientosEstadoCuenta.id})`,
      importados: sql<number>`coalesce(sum(${movimientosEstadoCuenta.tipo} = 'importado'), 0)`,
    })
    .from(estadosCuenta)
    .leftJoin(
      movimientosEstadoCuenta,
      eq(movimientosEstadoCuenta.estadoCuentaId, estadosCuenta.id)
    )
    .where(sql`${estadosCuenta.importadoEn} is not null`)
    .groupBy(estadosCuenta.id)
    .orderBy(desc(estadosCuenta.cierre), desc(estadosCuenta.hasta))
    .all();
}

export type MovimientoDelRegistro = typeof movimientosEstadoCuenta.$inferSelect & {
  emisor: string | null;
};

export async function obtenerEstadoCuenta(id: number) {
  const estado: EstadoCuentaRegistrado | undefined = db
    .select(COLUMNAS_REGISTRO)
    .from(estadosCuenta)
    .where(eq(estadosCuenta.id, id))
    .get();
  if (!estado || !estado.importadoEn) return null;

  const movimientos: MovimientoDelRegistro[] = db
    .select({
      movimiento: movimientosEstadoCuenta,
      emisor: emisores.nombre,
    })
    .from(movimientosEstadoCuenta)
    .leftJoin(gastos, eq(gastos.id, movimientosEstadoCuenta.gastoId))
    .leftJoin(emisores, eq(emisores.id, gastos.emisorId))
    .where(eq(movimientosEstadoCuenta.estadoCuentaId, id))
    .orderBy(asc(movimientosEstadoCuenta.fecha), asc(movimientosEstadoCuenta.id))
    .all()
    .map(({ movimiento, emisor }) => ({ ...movimiento, emisor }));

  return { estado, movimientos };
}

/**
 * Saca un estado de cuenta del registro y borra su PDF. Los gastos que se
 * importaron desde él quedan: son gastos como cualquier otro.
 */
export async function borrarEstadoCuenta(id: number) {
  const fila = db
    .select({ archivo: estadosCuenta.archivo })
    .from(estadosCuenta)
    .where(eq(estadosCuenta.id, id))
    .get();
  if (!fila) return;
  db.delete(estadosCuenta).where(eq(estadosCuenta.id, id)).run();
  await borrarPdfEstadoCuenta(fila.archivo);
  revalidatePath("/estado-cuenta", "layout");
}
