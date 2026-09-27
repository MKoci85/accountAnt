"use server";

import { db } from "@/db";
import {
  gastos,
  gastoItems,
  categorias,
  emisores,
  itemsCatalogo,
  gastosCombinablesDescartados,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { ITEM_PAGO_TARJETA } from "@/lib/clasificacion-comercios";
import { aISO, mesEnCurso } from "@/lib/formato";
import {
  agruparGastosCombinables,
  clavePar,
  paresDe,
  paresHeredados,
} from "@/lib/duplicados";
import {
  fechaLimiteVentanaPrecio,
  normalizarUnidad,
  superaReferencia,
  claveReferencia,
  referenciasDePrecio,
  type UnidadMedida,
} from "@/lib/precios-referencia";
import { leerAjuste } from "@/lib/config-server";

export type NuevoGastoItem = {
  itemCatalogoId?: number | null;
  descripcion?: string | null;
  categoriaId: number;
  cantidad: number;
  unidad?: UnidadMedida;
  precio: number;
  esHormiga?: boolean;
  esSobreprecio?: boolean;
  sobreprecioResuelto?: boolean;
  esPrecioBase?: boolean;
  esPesoDesconocido?: boolean;
  esOferta?: boolean;
};

const columnasReferencia = {
  gastoItemId: gastoItems.id,
  itemCatalogoId: gastoItems.itemCatalogoId,
  unidad: gastoItems.unidad,
  precio: gastoItems.precio,
  fecha: gastos.fecha,
  esPrecioBase: gastoItems.esPrecioBase,
  esOferta: gastoItems.esOferta,
  esPesoDesconocido: gastoItems.esPesoDesconocido,
};

async function obtenerPreciosReferencia(
  itemCatalogoIds: number[],
  fechaGasto: string,
  excluirGastoId?: number
) {
  if (!itemCatalogoIds.length) return new Map<string, number>();

  const fechaLimite = fechaLimiteVentanaPrecio(
    fechaGasto,
    await leerAjuste("ventanaMesesReferencia")
  );
  const condiciones = [
    inArray(gastoItems.itemCatalogoId, itemCatalogoIds),
    gte(gastos.fecha, fechaLimite),
  ];
  if (excluirGastoId) {
    condiciones.push(sql`${gastoItems.gastoId} != ${excluirGastoId}`);
  }

  const filas = await db
    .select(columnasReferencia)
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(and(...condiciones));

  return new Map(
    [...referenciasDePrecio(filas, fechaLimite)].map(([clave, compra]) => [
      clave,
      compra.precio,
    ])
  );
}

async function obtenerIdItemPagoTarjeta() {
  const [item] = await db
    .select({ id: itemsCatalogo.id })
    .from(itemsCatalogo)
    .where(sql`lower(${itemsCatalogo.nombre}) = lower(${ITEM_PAGO_TARJETA})`)
    .limit(1);
  return item?.id;
}

async function conSobreprecioDetectado(
  items: NuevoGastoItem[],
  fechaGasto: string,
  excluirGastoId?: number
) {
  const idPagoTarjeta = await obtenerIdItemPagoTarjeta();

  const idsComparables = items
    .map((i) => i.itemCatalogoId)
    .filter((id): id is number => id != null && id !== idPagoTarjeta);

  const preciosReferencia = await obtenerPreciosReferencia(
    idsComparables,
    fechaGasto,
    excluirGastoId
  );
  const margen = await leerAjuste("margenSobreprecioPeso");

  return items.map((item) => {
    if (item.esPesoDesconocido) return { ...item, esSobreprecio: false };
    if (item.esOferta) return { ...item, esSobreprecio: false };
    if (item.esPrecioBase) return { ...item, esSobreprecio: false };
    if (item.itemCatalogoId != null && item.itemCatalogoId === idPagoTarjeta) {
      return { ...item, esSobreprecio: false };
    }
    if (item.sobreprecioResuelto) {
      return { ...item, esSobreprecio: !!item.esSobreprecio };
    }
    if (item.esSobreprecio) return item;
    if (item.itemCatalogoId == null) {
      return { ...item, esSobreprecio: false };
    }
    const unidad = normalizarUnidad(item.unidad);
    const referencia = preciosReferencia.get(
      claveReferencia(item.itemCatalogoId, unidad)
    );
    return {
      ...item,
      esSobreprecio:
        referencia !== undefined &&
        superaReferencia(item.precio, referencia, unidad, margen),
    };
  });
}

function filasGastoItems(gastoId: number, items: NuevoGastoItem[]) {
  return items.map((item) => ({
    gastoId,
    itemCatalogoId: item.itemCatalogoId ?? null,
    descripcion: item.descripcion ?? null,
    categoriaId: item.categoriaId,
    cantidad: item.cantidad,
    unidad: normalizarUnidad(item.unidad),
    precio: item.precio,
    esHormiga: item.esHormiga ?? false,
    esSobreprecio: item.esSobreprecio ?? false,
    esPrecioBase: item.esPrecioBase ?? false,
    esOferta: item.esOferta ?? false,
    esPesoDesconocido: item.esPesoDesconocido ?? false,
  }));
}

export type NuevoGastoDatos = {
  emisorId: number;
  fecha: string;
  items: NuevoGastoItem[];
  tipoCfe?: string;
  serie?: string;
  numero?: string;
  montoTotal?: number | null;
  gastoFijoId?: number | null;
};

/**
 * Inserta el gasto y sus líneas, con la detección de sobreprecio ya resuelta.
 * No revalida ni redirige: es el paso común entre el formulario (que navega a
 * `/gastos`) y el pago de un gasto fijo (que se queda en su pantalla).
 * @returns El id del gasto creado.
 */
export async function guardarGasto(
  datos: NuevoGastoDatos
): Promise<{ id: number }> {
  if (!datos.items.length) {
    throw new Error("El gasto necesita al menos un ítem");
  }

  const items = await conSobreprecioDetectado(datos.items, datos.fecha);

  try {
    return db.transaction((tx) => {
      const gasto = tx
        .insert(gastos)
        .values({
          fecha: datos.fecha,
          emisorId: datos.emisorId,
          tipoCfe: datos.tipoCfe ?? null,
          serie: datos.serie ?? null,
          numero: datos.numero ?? null,
          montoTotal: datos.montoTotal ?? null,
          creadoEn: new Date().toISOString(),
          gastoFijoId: datos.gastoFijoId ?? null,
        })
        .returning()
        .get();

      tx.insert(gastoItems).values(filasGastoItems(gasto.id, items)).run();

      return { id: gasto.id };
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      throw new Error("Este comprobante ya fue cargado antes para este comercio.");
    }
    throw e;
  }
}

export async function crearGasto(datos: NuevoGastoDatos) {
  await guardarGasto(datos);

  revalidatePath("/gastos");
  revalidatePath("/");
  redirect("/gastos");
}

export async function editarGasto(
  id: number,
  datos: {
    emisorId: number;
    fecha: string;
    items: NuevoGastoItem[];
    redirigirA?: string;
  }
) {
  if (!datos.items.length) {
    throw new Error("El gasto necesita al menos un ítem");
  }

  const items = await conSobreprecioDetectado(datos.items, datos.fecha, id);

  db.transaction((tx) => {
    tx.update(gastos)
      .set({ fecha: datos.fecha, emisorId: datos.emisorId })
      .where(eq(gastos.id, id))
      .run();

    tx.delete(gastoItems).where(eq(gastoItems.gastoId, id)).run();

    tx.insert(gastoItems).values(filasGastoItems(id, items)).run();
  });

  revalidatePath("/gastos");
  revalidatePath(`/gastos/${id}`);
  revalidatePath("/");
  const destino =
    datos.redirigirA?.startsWith("/") && !datos.redirigirA.startsWith("//")
      ? datos.redirigirA
      : `/gastos/${id}`;
  redirect(destino);
}

export async function borrarGasto(id: number) {
  db.delete(gastos).where(eq(gastos.id, id)).run();

  revalidatePath("/gastos");
  revalidatePath("/");
}

/**
 * Combina dos o más gastos del mismo comercio y misma fecha en uno solo: sus
 * líneas pasan todas al gasto más antiguo (menor id) y los demás se borran.
 * @param idsGastos Ids de los gastos a combinar.
 */
export async function combinarGastos(idsGastos: number[]) {
  const idsUnicos = Array.from(new Set(idsGastos));
  if (idsUnicos.length < 2) {
    throw new Error("Elegí al menos dos gastos para combinar");
  }

  const filas = await db
    .select({
      id: gastos.id,
      fecha: gastos.fecha,
      emisorId: gastos.emisorId,
      serie: gastos.serie,
      montoTotal: gastos.montoTotal,
    })
    .from(gastos)
    .where(inArray(gastos.id, idsUnicos));

  if (filas.length !== idsUnicos.length) {
    throw new Error("Alguno de los gastos ya no existe");
  }

  const [primero, ...resto] = filas;
  if (resto.some((f) => f.emisorId !== primero.emisorId || f.fecha !== primero.fecha)) {
    throw new Error("Solo se pueden combinar gastos del mismo comercio y fecha");
  }

  if (filas.filter((f) => f.serie !== null).length > 1) {
    throw new Error("No se pueden combinar dos gastos que ya tienen comprobante propio");
  }

  const destino = filas.find((f) => f.serie !== null) ?? primero;
  const idsAEliminar = idsUnicos.filter((id) => id !== destino.id);

  const montoTotalCombinado = filas.some((f) => f.montoTotal != null)
    ? filas.reduce((acc, f) => acc + (f.montoTotal ?? 0), 0)
    : null;

  db.transaction((tx) => {
    tx.update(gastoItems)
      .set({ gastoId: destino.id })
      .where(inArray(gastoItems.gastoId, idsAEliminar))
      .run();

    const descartesHeredados = paresHeredados(
      tx
        .select({
          menor: gastosCombinablesDescartados.gastoMenorId,
          mayor: gastosCombinablesDescartados.gastoMayorId,
        })
        .from(gastosCombinablesDescartados)
        .where(
          or(
            inArray(gastosCombinablesDescartados.gastoMenorId, idsAEliminar),
            inArray(gastosCombinablesDescartados.gastoMayorId, idsAEliminar)
          )
        )
        .all()
        .map((d): [number, number] => [d.menor, d.mayor]),
      idsAEliminar,
      destino.id
    ).map(([gastoMenorId, gastoMayorId]) => ({ gastoMenorId, gastoMayorId }));
    if (descartesHeredados.length > 0) {
      tx.insert(gastosCombinablesDescartados)
        .values(descartesHeredados)
        .onConflictDoNothing()
        .run();
    }

    tx.update(gastos)
      .set({ montoTotal: montoTotalCombinado })
      .where(eq(gastos.id, destino.id))
      .run();

    tx.delete(gastos).where(inArray(gastos.id, idsAEliminar)).run();
  });

  revalidatePath("/gastos");
  revalidatePath("/");
}

/**
 * @returns las claves (`clavePar`) de los pares de gastos que el usuario ya
 * marcó como compras distintas.
 */
export async function listarGastosCombinablesDescartados() {
  const filas = await db
    .select({
      menor: gastosCombinablesDescartados.gastoMenorId,
      mayor: gastosCombinablesDescartados.gastoMayorId,
    })
    .from(gastosCombinablesDescartados);
  return filas.map((f) => clavePar(f.menor, f.mayor));
}

/**
 * Registra que los gastos elegidos son compras distintas aunque compartan
 * comercio y fecha (dos idas al súper el mismo día), para que dejen de
 * ofrecerse como combinables entre sí.
 */
export async function descartarGastosCombinables(ids: number[]) {
  const pares = paresDe(ids);
  if (pares.length === 0) {
    throw new Error("Elegí al menos dos gastos");
  }
  await db
    .insert(gastosCombinablesDescartados)
    .values(pares.map(([gastoMenorId, gastoMayorId]) => ({ gastoMenorId, gastoMayorId })))
    .onConflictDoNothing();
  revalidatePath("/gastos");
  revalidatePath("/");
}

export type GastoDetalle = {
  id: number;
  fecha: string;
  emisorId: number;
  emisorNombre: string;
  emisorRuc: string | null;
  tipoCfe: string | null;
  serie: string | null;
  numero: string | null;
  montoTotal: number | null;
  items: {
    id: number;
    itemCatalogoId: number | null;
    itemNombre: string | null;
    itemMarca: string | null;
    itemTamano: string | null;
    descripcion: string | null;
    categoriaId: number;
    categoriaNombre: string;
    cantidad: number;
    unidad: string;
    precio: number;
    esHormiga: boolean;
    esSobreprecio: boolean;
    esPrecioBase: boolean;
    esOferta: boolean;
    esPesoDesconocido: boolean;
  }[];
};

export async function obtenerGasto(id: number): Promise<GastoDetalle> {
  const [cabecera] = await db
    .select({
      id: gastos.id,
      fecha: gastos.fecha,
      emisorId: gastos.emisorId,
      emisorNombre: emisores.nombre,
      emisorRuc: emisores.ruc,
      tipoCfe: gastos.tipoCfe,
      serie: gastos.serie,
      numero: gastos.numero,
      montoTotal: gastos.montoTotal,
    })
    .from(gastos)
    .innerJoin(emisores, eq(gastos.emisorId, emisores.id))
    .where(eq(gastos.id, id))
    .limit(1);

  if (!cabecera) notFound();

  const items = await db
    .select({
      id: gastoItems.id,
      itemCatalogoId: gastoItems.itemCatalogoId,
      itemNombre: itemsCatalogo.nombre,
      itemMarca: itemsCatalogo.marca,
      itemTamano: itemsCatalogo.tamano,
      descripcion: gastoItems.descripcion,
      categoriaId: gastoItems.categoriaId,
      categoriaNombre: categorias.nombre,
      cantidad: gastoItems.cantidad,
      unidad: gastoItems.unidad,
      precio: gastoItems.precio,
      esHormiga: gastoItems.esHormiga,
      esSobreprecio: gastoItems.esSobreprecio,
      esPrecioBase: gastoItems.esPrecioBase,
      esPesoDesconocido: gastoItems.esPesoDesconocido,
      esOferta: gastoItems.esOferta,
    })
    .from(gastoItems)
    .leftJoin(itemsCatalogo, eq(itemsCatalogo.id, gastoItems.itemCatalogoId))
    .innerJoin(categorias, eq(categorias.id, gastoItems.categoriaId))
    .where(eq(gastoItems.gastoId, id));

  return { ...cabecera, items };
}

export type GastoResumen = {
  id: number;
  fecha: string;
  creadoEn: string | null;
  emisorId: number;
  emisorNombre: string;
  emisorGenerico: boolean;
  sinComprobante: boolean;
  emisorPendiente: boolean;
  categorias: { id: number; nombre: string; color: string | null }[];
  itemsNombres: string[];
  cantidadItems: number;
  montoTotal: number;
};

async function listarGastosConDetalle() {
  const filas = await db
    .select({
      gastoId: gastos.id,
      fecha: gastos.fecha,
      creadoEn: gastos.creadoEn,
      serie: gastos.serie,
      emisorId: emisores.id,
      emisorNombre: emisores.nombre,
      emisorRuc: emisores.ruc,
      emisorGenerico: emisores.esGenerico,
      proveedorCfeId: emisores.proveedorCfeId,
      categoriaId: categorias.id,
      categoriaNombre: categorias.nombre,
      categoriaColor: categorias.color,
      itemNombre: itemsCatalogo.nombre,
      descripcionLinea: gastoItems.descripcion,
      cantidad: gastoItems.cantidad,
      unidad: gastoItems.unidad,
      precio: gastoItems.precio,
    })
    .from(gastos)
    .innerJoin(emisores, eq(gastos.emisorId, emisores.id))
    .leftJoin(gastoItems, eq(gastoItems.gastoId, gastos.id))
    .leftJoin(categorias, eq(categorias.id, gastoItems.categoriaId))
    .leftJoin(itemsCatalogo, eq(itemsCatalogo.id, gastoItems.itemCatalogoId))
    .orderBy(desc(gastos.fecha), desc(gastos.id));

  const porGasto = new Map<number, GastoResumen>();

  for (const fila of filas) {
    let gasto = porGasto.get(fila.gastoId);
    if (!gasto) {
      gasto = {
        id: fila.gastoId,
        fecha: fila.fecha,
        creadoEn: fila.creadoEn,
        emisorId: fila.emisorId,
        emisorNombre: fila.emisorNombre,
        emisorGenerico: fila.emisorGenerico,
        sinComprobante: fila.serie === null,
        emisorPendiente:
          fila.emisorRuc !== null && fila.proveedorCfeId === null,
        categorias: [],
        itemsNombres: [],
        cantidadItems: 0,
        montoTotal: 0,
      };
      porGasto.set(fila.gastoId, gasto);
    }
    if (fila.categoriaId && !gasto.categorias.some((c) => c.id === fila.categoriaId)) {
      gasto.categorias.push({
        id: fila.categoriaId,
        nombre: fila.categoriaNombre!,
        color: fila.categoriaColor,
      });
    }
    const nombre = fila.itemNombre ?? fila.descripcionLinea;
    if (nombre) {
      gasto.itemsNombres.push(nombre);
    }
    if (fila.cantidad !== null && fila.precio !== null) {
      gasto.cantidadItems += 1;
      gasto.montoTotal += fila.cantidad * fila.precio;
    }
  }

  return Array.from(porGasto.values());
}

export async function listarGastos() {
  return listarGastosConDetalle();
}

export async function obtenerResumenDashboard() {
  const hoy = new Date();
  const { desde: inicioMes } = mesEnCurso(hoy);
  const mesSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
  const inicioMesSiguiente = aISO(mesSiguiente);

  const [todos, descartados] = await Promise.all([
    listarGastosConDetalle(),
    listarGastosCombinablesDescartados(),
  ]);
  const gastosDelMes = todos.filter(
    (g) => g.fecha >= inicioMes && g.fecha < inicioMesSiguiente
  );

  const totalMes = gastosDelMes.reduce((acc, g) => acc + g.montoTotal, 0);

  const totalHormiga = await db
    .select({
      total: sql<number>`coalesce(sum(${gastoItems.precio} * ${gastoItems.cantidad}), 0)`,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(
      and(
        eq(gastoItems.esHormiga, true),
        gte(gastos.fecha, inicioMes),
        lt(gastos.fecha, inicioMesSiguiente)
      )
    )
    .then((r) => r[0]?.total ?? 0);

  const emisoresPendientes = await db
    .select({ id: emisores.id })
    .from(emisores)
    .where(and(isNotNull(emisores.ruc), isNull(emisores.proveedorCfeId)));

  return {
    totalMes,
    cantidadGastosMes: gastosDelMes.length,
    totalHormiga,
    porcentajeHormiga: totalMes > 0 ? Math.round((totalHormiga / totalMes) * 100) : 0,
    emisoresPendientes: emisoresPendientes.length,
    gruposGastosCombinables: agruparGastosCombinables(todos, new Set(descartados))
      .length,
    gastosRecientes: gastosDelMes.slice(0, 5),
  };
}

export type ReferenciaPrecio = {
  itemCatalogoId: number;
  unidad: UnidadMedida;
  precio: number;
};

export type ReferenciasConMargen = {
  referencias: ReferenciaPrecio[];
  margen: number;
  margenOferta: number;
};

/**
 * Referencias de precio vigentes por ítem+unidad para precargar el formulario
 * de gasto, con el mismo criterio que usa el servidor al guardar.
 * @param itemCatalogoIds Ids de ítems de catálogo a resolver.
 * @param fechaGasto Fecha del gasto, para acotar la ventana de referencia.
 * @param excluirGastoId Gasto a excluir del cálculo (al editar uno existente).
 * @returns Las referencias encontradas y el margen de sobreprecio vigente.
 */
export async function obtenerReferenciasDePrecio(
  itemCatalogoIds: number[],
  fechaGasto: string,
  excluirGastoId?: number
): Promise<ReferenciasConMargen> {
  const idPagoTarjeta = await obtenerIdItemPagoTarjeta();
  const ids = [...new Set(itemCatalogoIds)].filter(
    (id) => Number.isInteger(id) && id > 0 && id !== idPagoTarjeta
  );

  const preciosReferencia = await obtenerPreciosReferencia(
    ids,
    fechaGasto,
    excluirGastoId
  );

  return {
    referencias: [...preciosReferencia].map(([clave, precio]) => {
      const [id, unidad] = clave.split("|");
      return {
        itemCatalogoId: Number(id),
        unidad: normalizarUnidad(unidad),
        precio,
      };
    }),
    margen: await leerAjuste("margenSobreprecioPeso"),
    margenOferta: await leerAjuste("margenOferta"),
  };
}

export type CompraHistorial = {
  gastoItemId: number;
  gastoId: number;
  fecha: string;
  emisorNombre: string;
  cantidad: number;
  unidad: UnidadMedida;
  precio: number;
  total: number;
  esOferta: boolean;
  esPrecioBase: boolean;
  esPesoDesconocido: boolean;
  esSobreprecio: boolean;
  esReferencia: boolean;
  fueraDeVentana: boolean;
};

export type HistorialPrecios = {
  itemNombre: string;
  compras: CompraHistorial[];
  fechaLimite: string;
};

/**
 * Historial de compras de un ítem del catálogo, para responder "¿cuánto pagué
 * antes y dónde?" sin salir del gasto que se está cargando. Marca cuál de las
 * filas es hoy el precio de referencia con `referenciasDePrecio`, el mismo
 * criterio que usa la detección de sobreprecio, que es lo que hace legible
 * una marca. La referencia se elige entre todas las compras de la ventana,
 * no sólo entre las que se devuelven.
 * @param itemCatalogoId Ítem a consultar.
 * @param limite Cuántas compras devolver, de la más reciente hacia atrás.
 */
export async function obtenerHistorialPrecios(
  itemCatalogoId: number,
  limite = 20
): Promise<HistorialPrecios> {
  const [item] = await db
    .select({ nombre: itemsCatalogo.nombre })
    .from(itemsCatalogo)
    .where(eq(itemsCatalogo.id, itemCatalogoId))
    .limit(1);

  const filas = await db
    .select({
      ...columnasReferencia,
      gastoId: gastoItems.gastoId,
      emisorNombre: emisores.nombre,
      cantidad: gastoItems.cantidad,
      esSobreprecio: gastoItems.esSobreprecio,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .innerJoin(emisores, eq(emisores.id, gastos.emisorId))
    .where(eq(gastoItems.itemCatalogoId, itemCatalogoId))
    .orderBy(desc(gastos.fecha), desc(gastoItems.id));

  const fechaLimite = fechaLimiteVentanaPrecio(
    aISO(new Date()),
    await leerAjuste("ventanaMesesReferencia")
  );
  const referencias = new Set(referenciasDePrecio(filas, fechaLimite).values());

  const compras = filas.slice(0, limite).map((f) => ({
    gastoItemId: f.gastoItemId,
    gastoId: f.gastoId,
    fecha: f.fecha,
    emisorNombre: f.emisorNombre,
    cantidad: f.cantidad,
    unidad: normalizarUnidad(f.unidad),
    precio: f.precio,
    total: Number((f.precio * f.cantidad).toFixed(2)),
    esOferta: f.esOferta,
    esPrecioBase: f.esPrecioBase,
    esPesoDesconocido: f.esPesoDesconocido,
    esSobreprecio: f.esSobreprecio,
    esReferencia: referencias.has(f),
    fueraDeVentana: f.fecha < fechaLimite,
  }));

  return {
    itemNombre: item?.nombre ?? "Ítem",
    compras,
    fechaLimite,
  };
}

/**
 * Marca (o desmarca) una compra ya guardada como hecha en oferta. Existe
 * porque el flag no se puede poner al cargar un gasto viejo: la línea puede
 * ser la única del ítem, y entonces el formulario no tiene contra qué
 * sugerirlo.
 *
 * Marcarla limpia el sobreprecio que ese precio hubiera provocado en las demás
 * compras del ítem, y cada línea limpiada guarda en `sobreprecioLimpiadoPor`
 * qué oferta la limpió. Desmarcarla es la operación inversa: vuelve a marcar
 * sólo esas líneas, y sólo si siguen superando la referencia. Nunca se marca
 * un sobreprecio que no haya limpiado esta misma oferta, para no pisar una
 * decisión manual del usuario. La marca de "subió de precio" no se toca:
 * mientras la línea sea oferta queda inerte, y al desmarcarla vuelve.
 * @returns Cuántas líneas dejaron de estar, o volvieron a estar, marcadas
 * como sobreprecio.
 */
export async function marcarCompraComoOferta(
  gastoItemId: number,
  esOferta: boolean
): Promise<{ sobrepreciosLimpiados: number; sobrepreciosRestaurados: number }> {
  const [linea] = await db
    .select({
      itemCatalogoId: gastoItems.itemCatalogoId,
      esSobreprecio: gastoItems.esSobreprecio,
      sobreprecioLimpiadoPor: gastoItems.sobreprecioLimpiadoPor,
    })
    .from(gastoItems)
    .where(eq(gastoItems.id, gastoItemId))
    .limit(1);
  if (!linea?.itemCatalogoId) {
    throw new Error("Esa línea no está vinculada a un ítem del catálogo");
  }

  let sobrepreciosLimpiados = 0;
  let sobrepreciosRestaurados = 0;
  if (esOferta) {
    await db
      .update(gastoItems)
      .set({
        esOferta: true,
        esSobreprecio: false,
        sobreprecioLimpiadoPor: linea.esSobreprecio
          ? gastoItemId
          : linea.sobreprecioLimpiadoPor,
      })
      .where(eq(gastoItems.id, gastoItemId));
    sobrepreciosLimpiados = await limpiarSobreprecioDeItem(
      linea.itemCatalogoId,
      gastoItemId
    );
  } else {
    await db
      .update(gastoItems)
      .set({ esOferta: false })
      .where(eq(gastoItems.id, gastoItemId));
    sobrepreciosRestaurados = await restaurarSobreprecioLimpiado(
      linea.itemCatalogoId,
      gastoItemId
    );
  }

  revalidatePath("/gastos");
  revalidatePath("/reportes");
  revalidatePath("/catalogos");
  return { sobrepreciosLimpiados, sobrepreciosRestaurados };
}

const columnasRecalculo = {
  id: gastoItems.id,
  gastoId: gastoItems.gastoId,
  fecha: gastos.fecha,
  unidad: gastoItems.unidad,
  precio: gastoItems.precio,
  esOferta: gastoItems.esOferta,
  esPrecioBase: gastoItems.esPrecioBase,
  esPesoDesconocido: gastoItems.esPesoDesconocido,
};

async function superaReferenciaVigente(
  itemCatalogoId: number,
  fila: { gastoId: number; fecha: string; unidad: string; precio: number },
  margen: number
) {
  const unidad = normalizarUnidad(fila.unidad);
  const referencia = (
    await obtenerPreciosReferencia([itemCatalogoId], fila.fecha, fila.gastoId)
  ).get(claveReferencia(itemCatalogoId, unidad));
  return (
    referencia !== undefined &&
    superaReferencia(fila.precio, referencia, unidad, margen)
  );
}

async function limpiarSobreprecioDeItem(itemCatalogoId: number, ofertaId: number) {
  const margen = await leerAjuste("margenSobreprecioPeso");
  const filas = await db
    .select(columnasRecalculo)
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(
      and(
        eq(gastoItems.itemCatalogoId, itemCatalogoId),
        eq(gastoItems.esSobreprecio, true)
      )
    );

  let limpiados = 0;
  for (const fila of filas) {
    if (fila.esOferta || fila.esPesoDesconocido) {
      await db
        .update(gastoItems)
        .set({ esSobreprecio: false })
        .where(eq(gastoItems.id, fila.id));
      limpiados += 1;
      continue;
    }
    if (!(await superaReferenciaVigente(itemCatalogoId, fila, margen))) {
      await db
        .update(gastoItems)
        .set({ esSobreprecio: false, sobreprecioLimpiadoPor: ofertaId })
        .where(eq(gastoItems.id, fila.id));
      limpiados += 1;
    }
  }
  return limpiados;
}

async function restaurarSobreprecioLimpiado(
  itemCatalogoId: number,
  ofertaId: number
) {
  const margen = await leerAjuste("margenSobreprecioPeso");
  const filas = await db
    .select(columnasRecalculo)
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(eq(gastoItems.sobreprecioLimpiadoPor, ofertaId));

  let restaurados = 0;
  for (const fila of filas) {
    const vuelveASerSobreprecio =
      !fila.esOferta &&
      !fila.esPesoDesconocido &&
      !fila.esPrecioBase &&
      (await superaReferenciaVigente(itemCatalogoId, fila, margen));
    await db
      .update(gastoItems)
      .set({
        sobreprecioLimpiadoPor: null,
        ...(vuelveASerSobreprecio ? { esSobreprecio: true } : {}),
      })
      .where(eq(gastoItems.id, fila.id));
    if (vuelveASerSobreprecio) restaurados += 1;
  }
  return restaurados;
}
