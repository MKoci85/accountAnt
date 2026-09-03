"use server";

import { db } from "@/db";
import { categorias, emisores, gastoItems, gastos, gastosFijos } from "@/db/schema";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { obtenerOCrearEmisorGenerico } from "@/app/actions/catalogos";
import { guardarGasto } from "@/app/actions/gastos";
import { hoyISO } from "@/lib/formato";

export type GastoFijoConEstado = {
  id: number;
  nombre: string;
  categoriaId: number;
  categoriaNombre: string;
  categoriaColor: string | null;
  emisorId: number | null;
  emisorNombre: string | null;
  importe: number | null;
  activo: boolean;
  ultimoPagoId: number | null;
  ultimoPagoFecha: string | null;
  ultimoPagoImporte: number | null;
  pagadoEsteMes: boolean;
  cantidadPagos: number;
};

function revalidarGastosFijos() {
  revalidatePath("/gastos-fijos");
  revalidatePath("/gastos");
  revalidatePath("/");
}

function mesDe(fechaISO: string) {
  return fechaISO.slice(0, 7);
}

/**
 * Lista las plantillas con su último pago, calculado sumando las líneas del
 * gasto (no `montoTotal`, que queda viejo si después se edita el gasto).
 */
export async function listarGastosFijos(): Promise<GastoFijoConEstado[]> {
  const plantillas = await db
    .select({
      id: gastosFijos.id,
      nombre: gastosFijos.nombre,
      categoriaId: gastosFijos.categoriaId,
      categoriaNombre: categorias.nombre,
      categoriaColor: categorias.color,
      emisorId: gastosFijos.emisorId,
      emisorNombre: emisores.nombre,
      importe: gastosFijos.importe,
      activo: gastosFijos.activo,
    })
    .from(gastosFijos)
    .innerJoin(categorias, eq(categorias.id, gastosFijos.categoriaId))
    .leftJoin(emisores, eq(emisores.id, gastosFijos.emisorId))
    .orderBy(asc(gastosFijos.nombre));

  const pagos = await db
    .select({
      gastoId: gastos.id,
      gastoFijoId: gastos.gastoFijoId,
      fecha: gastos.fecha,
      total: sql<number>`coalesce(sum(${gastoItems.precio} * ${gastoItems.cantidad}), 0)`,
    })
    .from(gastos)
    .leftJoin(gastoItems, eq(gastoItems.gastoId, gastos.id))
    .where(isNotNull(gastos.gastoFijoId))
    .groupBy(gastos.id);

  const ultimos = new Map<number, { id: number; fecha: string; total: number }>();
  const conteo = new Map<number, number>();
  for (const pago of pagos) {
    if (pago.gastoFijoId == null) continue;
    conteo.set(pago.gastoFijoId, (conteo.get(pago.gastoFijoId) ?? 0) + 1);
    const actual = ultimos.get(pago.gastoFijoId);
    const gana =
      !actual ||
      pago.fecha > actual.fecha ||
      (pago.fecha === actual.fecha && pago.gastoId > actual.id);
    if (gana) {
      ultimos.set(pago.gastoFijoId, {
        id: pago.gastoId,
        fecha: pago.fecha,
        total: pago.total,
      });
    }
  }

  const mesActual = mesDe(hoyISO());

  return plantillas.map((plantilla) => {
    const ultimo = ultimos.get(plantilla.id);
    return {
      ...plantilla,
      ultimoPagoId: ultimo?.id ?? null,
      ultimoPagoFecha: ultimo?.fecha ?? null,
      ultimoPagoImporte: ultimo ? Number(ultimo.total.toFixed(2)) : null,
      pagadoEsteMes: ultimo ? mesDe(ultimo.fecha) === mesActual : false,
      cantidadPagos: conteo.get(plantilla.id) ?? 0,
    };
  });
}

function validarDatos(datos: {
  nombre: string;
  categoriaId: number;
  importe?: number | null;
}) {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new Error("El nombre del gasto fijo es obligatorio");
  if (!datos.categoriaId) throw new Error("Elegí un tipo para el gasto fijo");
  if (datos.importe != null && datos.importe <= 0) {
    throw new Error("El importe esperado tiene que ser mayor a cero");
  }
  return nombre;
}

export async function crearGastoFijo(datos: {
  nombre: string;
  categoriaId: number;
  emisorId?: number | null;
  importe?: number | null;
}) {
  const nombre = validarDatos(datos);

  const [plantilla] = await db
    .insert(gastosFijos)
    .values({
      nombre,
      categoriaId: datos.categoriaId,
      emisorId: datos.emisorId ?? null,
      importe: datos.importe ?? null,
    })
    .returning();

  revalidarGastosFijos();
  return plantilla;
}

export async function editarGastoFijo(
  id: number,
  datos: {
    nombre: string;
    categoriaId: number;
    emisorId?: number | null;
    importe?: number | null;
  }
) {
  const nombre = validarDatos(datos);

  const [plantilla] = await db
    .update(gastosFijos)
    .set({
      nombre,
      categoriaId: datos.categoriaId,
      emisorId: datos.emisorId ?? null,
      importe: datos.importe ?? null,
    })
    .where(eq(gastosFijos.id, id))
    .returning();

  revalidarGastosFijos();
  return plantilla;
}

export async function cambiarActivoGastoFijo(id: number, activo: boolean) {
  await db.update(gastosFijos).set({ activo }).where(eq(gastosFijos.id, id));
  revalidarGastosFijos();
}

/**
 * Borra la plantilla. Los gastos ya registrados sobreviven: la FK es
 * `on delete set null`, así que solo pierden la referencia.
 */
export async function borrarGastoFijo(id: number) {
  await db.delete(gastosFijos).where(eq(gastosFijos.id, id));
  revalidarGastosFijos();
}

/**
 * Registra el pago del mes como un gasto normal, con una única línea de
 * servicio, y guarda el importe en la plantilla como referencia del próximo.
 * @returns El id del gasto creado.
 */
export async function pagarGastoFijo(
  id: number,
  datos: { importe: number; fecha: string }
) {
  if (!(datos.importe > 0)) {
    throw new Error("El importe tiene que ser mayor a cero");
  }
  if (!datos.fecha) throw new Error("Falta la fecha del pago");

  const [plantilla] = await db
    .select()
    .from(gastosFijos)
    .where(eq(gastosFijos.id, id))
    .limit(1);
  if (!plantilla) throw new Error("El gasto fijo ya no existe");

  const emisorId =
    plantilla.emisorId ?? (await obtenerOCrearEmisorGenerico()).id;

  const gasto = await guardarGasto({
    emisorId,
    fecha: datos.fecha,
    gastoFijoId: plantilla.id,
    montoTotal: datos.importe,
    items: [
      {
        itemCatalogoId: null,
        descripcion: plantilla.nombre,
        categoriaId: plantilla.categoriaId,
        cantidad: 1,
        unidad: "un",
        precio: datos.importe,
        esHormiga: false,
        esSobreprecio: false,
        sobreprecioResuelto: true,
        esPrecioBase: false,
        esPesoDesconocido: false,
      },
    ],
  });

  await db
    .update(gastosFijos)
    .set({ importe: datos.importe })
    .where(eq(gastosFijos.id, id));

  revalidarGastosFijos();
  return gasto;
}
