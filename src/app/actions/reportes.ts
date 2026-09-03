"use server";

import { db } from "@/db";
import {
  gastos,
  gastoItems,
  categorias,
  emisores,
  itemsCatalogo,
} from "@/db/schema";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  normalizarUnidad,
  etiquetaUnidad,
  claveReferencia,
  type UnidadMedida,
} from "@/lib/precios-referencia";
import {
  leerMargenSobreprecioPeso,
  leerVentanaMesesReferencia,
} from "@/lib/config-server";
import { aISO } from "@/lib/formato";

export type FiltrosReporte = {
  desde: string;
  hasta: string;
  categoriaIds?: number[];
  emisorIds?: number[];
};

type LineaPlana = {
  gastoId: number;
  fecha: string;
  emisorId: number;
  emisorNombre: string;
  categoriaId: number;
  categoriaNombre: string;
  categoriaColor: string | null;
  itemCatalogoId: number | null;
  itemNombre: string | null;
  itemMarca: string | null;
  cantidad: number;
  unidad: UnidadMedida;
  precio: number;
  total: number;
  esHormiga: boolean;
  esSobreprecio: boolean;
};

async function obtenerLineas(filtros: FiltrosReporte): Promise<LineaPlana[]> {
  const condiciones = [
    gte(gastos.fecha, filtros.desde),
    lte(gastos.fecha, filtros.hasta),
  ];
  if (filtros.categoriaIds?.length) {
    condiciones.push(inArray(gastoItems.categoriaId, filtros.categoriaIds));
  }
  if (filtros.emisorIds?.length) {
    condiciones.push(inArray(gastos.emisorId, filtros.emisorIds));
  }

  const filas = await db
    .select({
      gastoId: gastos.id,
      fecha: gastos.fecha,
      emisorId: emisores.id,
      emisorNombre: emisores.nombre,
      categoriaId: categorias.id,
      categoriaNombre: categorias.nombre,
      categoriaColor: categorias.color,
      itemCatalogoId: itemsCatalogo.id,
      itemNombre: itemsCatalogo.nombre,
      itemMarca: itemsCatalogo.marca,
      cantidad: gastoItems.cantidad,
      unidad: gastoItems.unidad,
      precio: gastoItems.precio,
      esHormiga: gastoItems.esHormiga,
      esSobreprecio: gastoItems.esSobreprecio,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .innerJoin(emisores, eq(emisores.id, gastos.emisorId))
    .innerJoin(categorias, eq(categorias.id, gastoItems.categoriaId))
    .leftJoin(itemsCatalogo, eq(itemsCatalogo.id, gastoItems.itemCatalogoId))
    .where(and(...condiciones))
    .orderBy(asc(gastos.fecha));

  return filas.map((f) => ({
    ...f,
    unidad: normalizarUnidad(f.unidad),
    total: f.precio * f.cantidad,
  }));
}

async function obtenerReferenciasPrecio() {
  const hoy = new Date();
  hoy.setMonth(hoy.getMonth() - (await leerVentanaMesesReferencia()));
  const fechaLimite = aISO(hoy);

  const filas = await db
    .select({
      itemCatalogoId: gastoItems.itemCatalogoId,
      precio: gastoItems.precio,
      esPrecioBase: gastoItems.esPrecioBase,
      fecha: gastos.fecha,
      emisorNombre: emisores.nombre,
      unidad: gastoItems.unidad,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .innerJoin(emisores, eq(emisores.id, gastos.emisorId))
    .where(gte(gastos.fecha, fechaLimite));

  const referencias = new Map<string, Referencia>();
  const basesPorItem = new Map<
    string,
    { precio: number; fecha: string; emisorNombre: string; unidad: UnidadMedida }
  >();
  for (const fila of filas) {
    if (fila.itemCatalogoId == null) continue;
    const unidad = normalizarUnidad(fila.unidad);
    const clave = claveReferencia(fila.itemCatalogoId, unidad);

    const actual = referencias.get(clave);
    if (!actual || fila.precio < actual.minimo) {
      referencias.set(clave, {
        minimo: fila.precio,
        emisorNombre: fila.emisorNombre,
        unidad,
      });
    }
    if (!fila.esPrecioBase) continue;
    const baseActual = basesPorItem.get(clave);
    if (!baseActual || fila.fecha > baseActual.fecha) {
      basesPorItem.set(clave, {
        precio: fila.precio,
        fecha: fila.fecha,
        emisorNombre: fila.emisorNombre,
        unidad,
      });
    }
  }

  for (const [clave, base] of basesPorItem) {
    const actual = referencias.get(clave);
    if (!actual || base.precio < actual.minimo) {
      referencias.set(clave, {
        minimo: base.precio,
        emisorNombre: base.emisorNombre,
        unidad: base.unidad,
      });
    }
  }

  return referencias;
}

type Referencia = {
  minimo: number;
  emisorNombre: string;
  unidad: UnidadMedida;
};

function precioReferenciaComparable(referencia: Referencia, margen: number) {
  return referencia.unidad === "un"
    ? referencia.minimo
    : referencia.minimo * (1 + margen);
}

function porcentaje(parte: number, total: number) {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

function referenciaDe(
  referencias: Map<string, Referencia>,
  itemCatalogoId: number | null,
  unidad: UnidadMedida
) {
  return itemCatalogoId == null
    ? undefined
    : referencias.get(claveReferencia(itemCatalogoId, unidad));
}

export type Reporte = Awaited<ReturnType<typeof obtenerReporte>>;

/**
 * Arma el reporte completo (resumen, categorías, ítems con sobreprecio,
 * comercios, evolución mensual, matriz hormiga×sobreprecio) recorriendo las
 * líneas de gasto del período una sola vez.
 * @param filtros Rango de fechas y filtros opcionales de categoría/emisor.
 */
export async function obtenerReporte(filtros: FiltrosReporte) {
  const lineas = await obtenerLineas(filtros);
  const referencias = await obtenerReferenciasPrecio();
  const margen = await leerMargenSobreprecioPeso();

  const totalGastado = lineas.reduce((acc, l) => acc + l.total, 0);
  const totalHormiga = lineas
    .filter((l) => l.esHormiga)
    .reduce((acc, l) => acc + l.total, 0);

  let totalSobreprecio = 0;
  for (const linea of lineas) {
    if (!linea.esSobreprecio) continue;
    const referencia = referenciaDe(
      referencias,
      linea.itemCatalogoId,
      linea.unidad
    );
    if (!referencia) continue;
    totalSobreprecio +=
      (linea.precio - precioReferenciaComparable(referencia, margen)) * linea.cantidad;
  }

  const sobreprecioEnHormiga = lineas
    .filter((l) => l.esHormiga && l.esSobreprecio)
    .reduce((acc, l) => {
      const referencia = referenciaDe(referencias, l.itemCatalogoId, l.unidad);
      return referencia
        ? acc + (l.precio - precioReferenciaComparable(referencia, margen)) * l.cantidad
        : acc;
    }, 0);
  const potencialAhorro = totalHormiga + totalSobreprecio - sobreprecioEnHormiga;

  const gastosUnicos = new Set(lineas.map((l) => l.gastoId));

  const porCategoria = new Map<
    number,
    {
      categoriaId: number;
      nombre: string;
      color: string | null;
      total: number;
      totalHormiga: number;
      cantidadLineas: number;
    }
  >();
  for (const linea of lineas) {
    let cat = porCategoria.get(linea.categoriaId);
    if (!cat) {
      cat = {
        categoriaId: linea.categoriaId,
        nombre: linea.categoriaNombre,
        color: linea.categoriaColor,
        total: 0,
        totalHormiga: 0,
        cantidadLineas: 0,
      };
      porCategoria.set(linea.categoriaId, cat);
    }
    cat.total += linea.total;
    if (linea.esHormiga) cat.totalHormiga += linea.total;
    cat.cantidadLineas += 1;
  }

  const categoriasOrdenadas = Array.from(porCategoria.values())
    .sort((a, b) => b.total - a.total)
    .map((c) => ({
      ...c,
      porcentajeDelTotal: porcentaje(c.total, totalGastado),
      porcentajeHormiga: porcentaje(c.totalHormiga, c.total),
    }));

  const porItem = new Map<
    number,
    {
      itemCatalogoId: number;
      nombre: string;
      marca: string | null;
      comprasConSobreprecio: number;
      totalPagado: number;
      pagadoDeMas: number;
      precioMinimoConocido: number;
      unidadReferencia: string;
      dondeEstaMasBarato: string;
      precioPagadoMax: number;
    }
  >();
  for (const linea of lineas) {
    if (!linea.esSobreprecio) continue;
    const referencia = referenciaDe(
      referencias,
      linea.itemCatalogoId,
      linea.unidad
    );
    if (!referencia) continue;
    if (linea.itemCatalogoId == null) continue;

    let item = porItem.get(linea.itemCatalogoId);
    if (!item) {
      item = {
        itemCatalogoId: linea.itemCatalogoId,
        nombre: linea.itemNombre ?? "Sin detalle",
        marca: linea.itemMarca,
        comprasConSobreprecio: 0,
        totalPagado: 0,
        pagadoDeMas: 0,
        precioMinimoConocido: referencia.minimo,
        unidadReferencia: etiquetaUnidad(referencia.unidad),
        dondeEstaMasBarato: referencia.emisorNombre,
        precioPagadoMax: 0,
      };
      porItem.set(linea.itemCatalogoId, item);
    }
    item.comprasConSobreprecio += 1;
    item.totalPagado += linea.total;
    item.pagadoDeMas +=
      (linea.precio - precioReferenciaComparable(referencia, margen)) * linea.cantidad;
    item.precioPagadoMax = Math.max(item.precioPagadoMax, linea.precio);
  }

  const itemsSobreprecio = Array.from(porItem.values()).sort(
    (a, b) => b.pagadoDeMas - a.pagadoDeMas
  );

  const porEmisor = new Map<
    number,
    {
      emisorId: number;
      nombre: string;
      total: number;
      totalHormiga: number;
      pagadoDeMas: number;
      visitas: Set<number>;
    }
  >();
  for (const linea of lineas) {
    let em = porEmisor.get(linea.emisorId);
    if (!em) {
      em = {
        emisorId: linea.emisorId,
        nombre: linea.emisorNombre,
        total: 0,
        totalHormiga: 0,
        pagadoDeMas: 0,
        visitas: new Set(),
      };
      porEmisor.set(linea.emisorId, em);
    }
    em.total += linea.total;
    if (linea.esHormiga) em.totalHormiga += linea.total;
    if (linea.esSobreprecio) {
      const referencia = referenciaDe(
        referencias,
        linea.itemCatalogoId,
        linea.unidad
      );
      if (referencia) {
        em.pagadoDeMas +=
          (linea.precio - precioReferenciaComparable(referencia, margen)) *
          linea.cantidad;
      }
    }
    em.visitas.add(linea.gastoId);
  }

  const comercios = Array.from(porEmisor.values())
    .map((e) => ({
      emisorId: e.emisorId,
      nombre: e.nombre,
      total: e.total,
      totalHormiga: e.totalHormiga,
      pagadoDeMas: e.pagadoDeMas,
      visitas: e.visitas.size,
      ticketPromedio: Math.round(e.total / e.visitas.size),
      porcentajeHormiga: porcentaje(e.totalHormiga, e.total),
    }))
    .sort((a, b) => b.total - a.total);

  const porMes = new Map<
    string,
    { mes: string; total: number; hormiga: number; sobreprecio: number; sobreprecioEnHormiga: number }
  >();
  for (const linea of lineas) {
    const mes = linea.fecha.slice(0, 7); // YYYY-MM
    let m = porMes.get(mes);
    if (!m) {
      m = { mes, total: 0, hormiga: 0, sobreprecio: 0, sobreprecioEnHormiga: 0 };
      porMes.set(mes, m);
    }
    m.total += linea.total;
    if (linea.esHormiga) m.hormiga += linea.total;
    if (linea.esSobreprecio) {
      const referencia = referenciaDe(referencias, linea.itemCatalogoId, linea.unidad);
      if (referencia) {
        const deMas =
          (linea.precio - precioReferenciaComparable(referencia, margen)) * linea.cantidad;
        m.sobreprecio += deMas;
        if (linea.esHormiga) m.sobreprecioEnHormiga += deMas;
      }
    }
  }

  let mesAnterior: number | null = null;
  const evolucionMensual = Array.from(porMes.values())
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((m) => {
      const potencialAhorroMes = m.hormiga + m.sobreprecio - m.sobreprecioEnHormiga;
      const ahorroVsMesAnterior = mesAnterior == null ? null : potencialAhorroMes - mesAnterior;
      mesAnterior = potencialAhorroMes;
      return {
        mes: m.mes,
        total: m.total,
        hormiga: m.hormiga,
        necesario: m.total - m.hormiga,
        sobreprecio: m.sobreprecio,
        potencialAhorro: potencialAhorroMes,
        porcentajeHormiga: porcentaje(m.hormiga, m.total),
        ahorroVsMesAnterior,
      };
    });

  function sumaCuadrante(hormiga: boolean, sobreprecio: boolean) {
    return lineas
      .filter((l) => l.esHormiga === hormiga && l.esSobreprecio === sobreprecio)
      .reduce((acc, l) => acc + l.total, 0);
  }

  const matriz = {
    necesarioBuenPrecio: sumaCuadrante(false, false),
    necesarioCaro: sumaCuadrante(false, true),
    hormigaBuenPrecio: sumaCuadrante(true, false),
    hormigaCaro: sumaCuadrante(true, true),
  };

  return {
    filtros,
    resumen: {
      totalGastado,
      cantidadGastos: gastosUnicos.size,
      cantidadLineas: lineas.length,
      totalHormiga,
      porcentajeHormiga: porcentaje(totalHormiga, totalGastado),
      totalSobreprecio,
      porcentajeSobreprecio: porcentaje(totalSobreprecio, totalGastado),
      potencialAhorro,
      porcentajePotencialAhorro: porcentaje(potencialAhorro, totalGastado),
    },
    categorias: categoriasOrdenadas,
    itemsSobreprecio,
    comercios,
    evolucionMensual,
    matriz,
  };
}

function redondearMonto(monto: number) {
  return Number(monto.toFixed(2));
}

/**
 * Exporta el reporte como JSON autocontenido (con contexto y glosario) para
 * ser leído por un agente de IA que no conoce la app.
 * @param filtros Rango de fechas y filtros opcionales de categoría/emisor.
 * @returns El reporte serializado en JSON.
 */
export async function exportarReporteJSON(filtros: FiltrosReporte) {
  const reporte = await obtenerReporte(filtros);
  const mesesVentana = await leerVentanaMesesReferencia();

  const [todasCategorias, todosEmisores] = await Promise.all([
    db.select({ id: categorias.id, nombre: categorias.nombre }).from(categorias),
    db.select({ id: emisores.id, nombre: emisores.nombre }).from(emisores),
  ]);

  const nombresCategorias = filtros.categoriaIds?.length
    ? todasCategorias
        .filter((c) => filtros.categoriaIds!.includes(c.id))
        .map((c) => c.nombre)
    : null;
  const nombresEmisores = filtros.emisorIds?.length
    ? todosEmisores.filter((e) => filtros.emisorIds!.includes(e.id)).map((e) => e.nombre)
    : null;

  return JSON.stringify(
    {
      contexto: {
        descripcion:
          "Reporte de gastos personales de un usuario en Uruguay. El objetivo es identificar en qué se puede ahorrar.",
        moneda: "UYU (pesos uruguayos)",
        nota: "Los montos pueden tener hasta 2 decimales (centésimos).",
        periodo: {
          desde: reporte.filtros.desde,
          hasta: reporte.filtros.hasta,
        },
        filtrosAplicados: {
          categorias: nombresCategorias ?? "todas",
          comercios: nombresEmisores ?? "todos",
        },
      },
      glosario: {
        gastoHormiga:
          "Compra pequeña e impulsiva, marcada manualmente por el usuario como evitable (no necesaria). Es el foco principal de ahorro.",
        sobreprecio: `Línea de gasto donde se pagó un precio mayor al precio de referencia de ese mismo producto (el mínimo pagado en cualquier comercio dentro de los últimos ${mesesVentana} meses). Se marca automáticamente al cargar el gasto, o a mano por el usuario. Si el usuario confirma que fue una suba general (no una mala compra), esa línea deja de contar como sobreprecio y pasa a ser la nueva referencia.`,
        comparacionPorUnidadDeMedida:
          "Cada línea de gasto tiene una unidad: 'un' (piezas), 'kg' o 'L'. Cuando es kg o L, el campo 'precio' NO es el monto pagado sino el precio POR KILO (o por litro), y 'cantidad' es el peso de esa compra — el monto pagado es precio × cantidad. Esto es lo que hace comparables los productos de peso variable (frutas y verduras, quesos y fiambres, carne, panificados al peso), donde cada compra pesa distinto: 0,150 kg de cebolla a $14,85 y 0,400 kg a $40 son el mismo precio por kilo ($99 vs $100), y comparar los montos pagados marcaría la segunda compra como cara sólo porque pesa más. Los precios de referencia se agrupan por producto Y unidad, nunca se mezcla un precio por kilo con uno por pieza. En 'itemsConSobreprecio', 'precioMinimoConocido' viene en la unidad que indica 'unidadReferencia'.",
        pagadoDeMas:
          "Diferencia en pesos entre lo que se pagó y lo que habría costado al mínimo histórico conocido de ese producto, a igual tamaño (la referencia por unidad de medida se reexpande al tamaño de cada línea antes de restar). Es plata recuperable comprando en otro lado.",
        potencialAhorro:
          "Suma del gasto hormiga (evitable por completo) más el sobreprecio del gasto necesario (recuperable comprando al mejor precio). No se cuenta dos veces el sobreprecio de las líneas que ya son hormiga.",
        matriz:
          "Cruce de los dos flags. El cuadrante 'hormigaCaro' es el ahorro más fácil: compras evitables que además se pagaron caro.",
        ahorroVsMesAnterior:
          "En 'evolucionMensual', diferencia del 'potencialAhorro' de ese mes contra el mes anterior. Positivo significa que ese mes se dejó MÁS plata sobre la mesa que el anterior (empeoró); negativo significa que se ahorró más que el mes anterior (mejoró). Null en el primer mes del período, que no tiene mes previo con el cual compararse.",
      },
      resumen: {
        ...reporte.resumen,
        totalGastado: redondearMonto(reporte.resumen.totalGastado),
        totalHormiga: redondearMonto(reporte.resumen.totalHormiga),
        totalSobreprecio: redondearMonto(reporte.resumen.totalSobreprecio),
        potencialAhorro: redondearMonto(reporte.resumen.potencialAhorro),
      },
      gastoPorCategoria: reporte.categorias.map((c) => ({
        ...c,
        total: redondearMonto(c.total),
        totalHormiga: redondearMonto(c.totalHormiga),
      })),
      itemsConSobreprecio: reporte.itemsSobreprecio.map((i) => ({
        ...i,
        totalPagado: redondearMonto(i.totalPagado),
        pagadoDeMas: redondearMonto(i.pagadoDeMas),
        precioMinimoConocido: redondearMonto(i.precioMinimoConocido),
        precioPagadoMax: redondearMonto(i.precioPagadoMax),
      })),
      comercios: reporte.comercios.map((e) => ({
        ...e,
        total: redondearMonto(e.total),
        totalHormiga: redondearMonto(e.totalHormiga),
        pagadoDeMas: redondearMonto(e.pagadoDeMas),
      })),
      evolucionMensual: reporte.evolucionMensual.map((m) => ({
        ...m,
        total: redondearMonto(m.total),
        hormiga: redondearMonto(m.hormiga),
        necesario: redondearMonto(m.necesario),
        sobreprecio: redondearMonto(m.sobreprecio),
        potencialAhorro: redondearMonto(m.potencialAhorro),
        ahorroVsMesAnterior:
          m.ahorroVsMesAnterior == null
            ? null
            : redondearMonto(m.ahorroVsMesAnterior),
      })),
      matrizHormigaSobreprecio: {
        necesarioBuenPrecio: redondearMonto(reporte.matriz.necesarioBuenPrecio),
        necesarioCaro: redondearMonto(reporte.matriz.necesarioCaro),
        hormigaBuenPrecio: redondearMonto(reporte.matriz.hormigaBuenPrecio),
        hormigaCaro: redondearMonto(reporte.matriz.hormigaCaro),
      },
      preguntaSugerida:
        "En base a estos datos, ¿qué plan concreto de ahorro me propondrías para el próximo mes? Priorizá acciones específicas (qué dejar de comprar, dónde cambiar de comercio) por sobre consejos genéricos.",
    },
    null,
    2
  );
}
