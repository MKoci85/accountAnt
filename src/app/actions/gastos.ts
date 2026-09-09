"use server";

import { db } from "@/db";
import {
  gastos,
  gastoItems,
  categorias,
  emisores,
  itemsCatalogo,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { ITEM_PAGO_TARJETA } from "@/lib/clasificacion-comercios";
import { aISO } from "@/lib/formato";
import {
  fechaLimiteVentanaPrecio,
  normalizarUnidad,
  superaReferencia,
  claveReferencia,
  type UnidadMedida,
} from "@/lib/precios-referencia";
import {
  leerMargenOferta,
  leerMargenSobreprecioPeso,
  leerVentanaMesesReferencia,
} from "@/lib/config-server";

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

async function obtenerPreciosMinimos(
  itemCatalogoIds: number[],
  fechaGasto: string,
  excluirGastoId?: number
) {
  if (!itemCatalogoIds.length) return new Map<string, number>();

  const condiciones = [
    inArray(gastoItems.itemCatalogoId, itemCatalogoIds),
    gte(
      gastos.fecha,
      fechaLimiteVentanaPrecio(fechaGasto, await leerVentanaMesesReferencia())
    ),
  ];
  if (excluirGastoId) {
    condiciones.push(sql`${gastoItems.gastoId} != ${excluirGastoId}`);
  }

  const filas = await db
    .select({
      itemCatalogoId: gastoItems.itemCatalogoId,
      precio: gastoItems.precio,
      unidad: gastoItems.unidad,
      esPrecioBase: gastoItems.esPrecioBase,
      esPesoDesconocido: gastoItems.esPesoDesconocido,
      esOferta: gastoItems.esOferta,
      fecha: gastos.fecha,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .where(and(...condiciones));

  const minimos = new Map<string, number>();
  const basesPorItem = new Map<string, { precio: number; fecha: string }>();
  for (const fila of filas) {
    if (fila.itemCatalogoId == null || fila.esPesoDesconocido) continue;
    if (fila.esOferta) continue;
    const clave = claveReferencia(fila.itemCatalogoId, normalizarUnidad(fila.unidad));
    const minimoActual = minimos.get(clave);
    if (minimoActual === undefined || fila.precio < minimoActual) {
      minimos.set(clave, fila.precio);
    }
    if (!fila.esPrecioBase) continue;
    const baseActual = basesPorItem.get(clave);
    if (!baseActual || fila.fecha > baseActual.fecha) {
      basesPorItem.set(clave, { precio: fila.precio, fecha: fila.fecha });
    }
  }

  for (const [clave, base] of basesPorItem) {
    const minimoActual = minimos.get(clave);
    minimos.set(
      clave,
      minimoActual === undefined ? base.precio : Math.min(minimoActual, base.precio)
    );
  }

  return minimos;
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

  const preciosMinimos = await obtenerPreciosMinimos(
    idsComparables,
    fechaGasto,
    excluirGastoId
  );
  const margen = await leerMargenSobreprecioPeso();

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
    const minimo = preciosMinimos.get(
      claveReferencia(item.itemCatalogoId, unidad)
    );
    return {
      ...item,
      esSobreprecio:
        minimo !== undefined &&
        superaReferencia(item.precio, minimo, unidad, margen),
    };
  });
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
          gastoFijoId: datos.gastoFijoId ?? null,
        })
        .returning()
        .get();

      tx.insert(gastoItems)
        .values(
          items.map((item) => ({
            gastoId: gasto.id,
            itemCatalogoId: item.itemCatalogoId ?? null,
            descripcion: item.descripcion ?? null,
            categoriaId: item.categoriaId,
            cantidad: item.cantidad,
            unidad: normalizarUnidad(item.unidad),
            precio: item.precio,
            esHormiga: item.esHormiga ?? false,
            esSobreprecio: item.esSobreprecio,
            esPrecioBase: item.esPrecioBase ?? false,
          esOferta: item.esOferta ?? false,
            esPesoDesconocido: item.esPesoDesconocido ?? false,
          }))
        )
        .run();

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

    tx.insert(gastoItems)
      .values(
        items.map((item) => ({
          gastoId: id,
          itemCatalogoId: item.itemCatalogoId ?? null,
          descripcion: item.descripcion ?? null,
          categoriaId: item.categoriaId,
          cantidad: item.cantidad,
          unidad: normalizarUnidad(item.unidad),
          precio: item.precio,
          esHormiga: item.esHormiga ?? false,
          esSobreprecio: item.esSobreprecio,
          esPrecioBase: item.esPrecioBase ?? false,
          esOferta: item.esOferta ?? false,
          esPesoDesconocido: item.esPesoDesconocido ?? false,
        }))
      )
      .run();
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

    tx.update(gastos)
      .set({ montoTotal: montoTotalCombinado })
      .where(eq(gastos.id, destino.id))
      .run();

    tx.delete(gastos).where(inArray(gastos.id, idsAEliminar)).run();
  });

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
  emisorId: number;
  emisorNombre: string;
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
      serie: gastos.serie,
      emisorId: emisores.id,
      emisorNombre: emisores.nombre,
      emisorRuc: emisores.ruc,
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
        emisorId: fila.emisorId,
        emisorNombre: fila.emisorNombre,
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
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
  const mesSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
  const inicioMesSiguiente = aISO(mesSiguiente);

  const gastosDelMes = (await listarGastosConDetalle()).filter(
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
 * Referencias de precio (mínimo vigente por ítem+unidad) para precargar el
 * formulario de gasto, con el mismo criterio que usa el servidor al guardar.
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

  const minimos = await obtenerPreciosMinimos(ids, fechaGasto, excluirGastoId);

  return {
    referencias: [...minimos].map(([clave, precio]) => {
      const [id, unidad] = clave.split("|");
      return {
        itemCatalogoId: Number(id),
        unidad: normalizarUnidad(unidad),
        precio,
      };
    }),
    margen: await leerMargenSobreprecioPeso(),
    margenOferta: await leerMargenOferta(),
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
 * filas es hoy el precio de referencia con el mismo criterio que usa
 * `obtenerPreciosMinimos`, que es lo que hace legible una marca de sobreprecio.
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
      gastoItemId: gastoItems.id,
      gastoId: gastoItems.gastoId,
      fecha: gastos.fecha,
      emisorNombre: emisores.nombre,
      cantidad: gastoItems.cantidad,
      unidad: gastoItems.unidad,
      precio: gastoItems.precio,
      esOferta: gastoItems.esOferta,
      esPrecioBase: gastoItems.esPrecioBase,
      esPesoDesconocido: gastoItems.esPesoDesconocido,
      esSobreprecio: gastoItems.esSobreprecio,
    })
    .from(gastoItems)
    .innerJoin(gastos, eq(gastos.id, gastoItems.gastoId))
    .innerJoin(emisores, eq(emisores.id, gastos.emisorId))
    .where(eq(gastoItems.itemCatalogoId, itemCatalogoId))
    .orderBy(desc(gastos.fecha), desc(gastoItems.id))
    .limit(limite);

  const fechaLimite = fechaLimiteVentanaPrecio(
    aISO(new Date()),
    await leerVentanaMesesReferencia()
  );

  const compras = filas.map((f) => ({
    ...f,
    unidad: normalizarUnidad(f.unidad),
    total: Number((f.precio * f.cantidad).toFixed(2)),
    esReferencia: false,
    fueraDeVentana: f.fecha < fechaLimite,
  }));

  for (const unidad of new Set(compras.map((c) => c.unidad))) {
    const elegibles = compras.filter(
      (c) =>
        c.unidad === unidad &&
        !c.fueraDeVentana &&
        !c.esOferta &&
        !c.esPesoDesconocido
    );
    const bases = elegibles.filter((c) => c.esPrecioBase);
    const referencia = bases.length
      ? bases[0]
      : elegibles.reduce<(typeof elegibles)[number] | null>(
          (mejor, c) => (mejor === null || c.precio < mejor.precio ? c : mejor),
          null
        );
    if (referencia) referencia.esReferencia = true;
  }

  return {
    itemNombre: item?.nombre ?? "Ítem",
    compras,
    fechaLimite,
  };
}

/**
 * Marca (o desmarca) una compra ya guardada como hecha en oferta, y limpia el
 * sobreprecio que ese precio hubiera provocado en las demás compras del ítem.
 * Existe porque el flag no se puede poner al cargar un gasto viejo: la línea
 * puede ser la única del ítem, y entonces el formulario no tiene contra qué
 * sugerirlo. Sólo *desmarca* sobreprecios que ya no superan la referencia —
 * nunca marca uno nuevo, para no pisar una decisión manual del usuario.
 * @returns Cuántas líneas dejaron de estar marcadas como sobreprecio.
 */
export async function marcarCompraComoOferta(
  gastoItemId: number,
  esOferta: boolean
): Promise<{ sobrepreciosLimpiados: number }> {
  const [linea] = await db
    .select({ itemCatalogoId: gastoItems.itemCatalogoId })
    .from(gastoItems)
    .where(eq(gastoItems.id, gastoItemId))
    .limit(1);
  if (!linea?.itemCatalogoId) {
    throw new Error("Esa línea no está vinculada a un ítem del catálogo");
  }

  await db
    .update(gastoItems)
    .set({
      esOferta,
      ...(esOferta ? { esPrecioBase: false, esSobreprecio: false } : {}),
    })
    .where(eq(gastoItems.id, gastoItemId));

  const sobrepreciosLimpiados = await recalcularSobreprecioDeItem(
    linea.itemCatalogoId
  );

  revalidatePath("/gastos");
  revalidatePath("/reportes");
  revalidatePath("/catalogos");
  return { sobrepreciosLimpiados };
}

async function recalcularSobreprecioDeItem(itemCatalogoId: number) {
  const margen = await leerMargenSobreprecioPeso();
  const filas = await db
    .select({
      id: gastoItems.id,
      gastoId: gastoItems.gastoId,
      fecha: gastos.fecha,
      unidad: gastoItems.unidad,
      precio: gastoItems.precio,
      esOferta: gastoItems.esOferta,
      esPesoDesconocido: gastoItems.esPesoDesconocido,
    })
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
    const unidad = normalizarUnidad(fila.unidad);
    const minimos = await obtenerPreciosMinimos(
      [itemCatalogoId],
      fila.fecha,
      fila.gastoId
    );
    const minimo = minimos.get(claveReferencia(itemCatalogoId, unidad));
    if (minimo === undefined || !superaReferencia(fila.precio, minimo, unidad, margen)) {
      await db
        .update(gastoItems)
        .set({ esSobreprecio: false })
        .where(eq(gastoItems.id, fila.id));
      limpiados += 1;
    }
  }
  return limpiados;
}
