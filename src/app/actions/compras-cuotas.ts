"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { comprasEnCuotas, cuotasCompra, gastos } from "@/db/schema";
import {
  actualizarPlan,
  crearPlan,
  pagarCuotaEnTx,
  vincularCuotasImportadas,
  type DatosPlan,
} from "@/lib/compras-cuotas-server";
import { esFechaISOValida } from "@/lib/formato";

function revalidarCuotas(gastoId?: number) {
  revalidatePath("/gastos");
  revalidatePath("/");
  revalidatePath("/reportes");
  if (gastoId !== undefined) revalidatePath(`/gastos/${gastoId}`);
}

/**
 * Marca un gasto como compra en cuotas, o cambia el plan de uno que ya lo es.
 * Al marcarlo se vinculan las cuotas que ya se hubieran importado sueltas de
 * un estado de cuenta, que es lo que deshace la duplicación.
 * @returns cuántas cuotas ya importadas quedaron vinculadas
 */
export async function marcarCompraEnCuotas(
  gastoId: number,
  datos: DatosPlan
): Promise<{ vinculadas: number }> {
  const esCuota = db
    .select({ id: cuotasCompra.id })
    .from(cuotasCompra)
    .where(eq(cuotasCompra.gastoId, gastoId))
    .get();
  if (esCuota) {
    throw new Error("Este gasto es la cuota de una compra: no puede ser una compra en cuotas");
  }
  if (!db.select({ id: gastos.id }).from(gastos).where(eq(gastos.id, gastoId)).get()) {
    throw new Error("El gasto ya no existe");
  }

  const vinculadas = db.transaction((tx) => {
    const existente = tx
      .select({ id: comprasEnCuotas.id })
      .from(comprasEnCuotas)
      .where(eq(comprasEnCuotas.gastoId, gastoId))
      .get();
    if (existente) {
      actualizarPlan(tx, existente.id, datos);
      return vincularCuotasImportadas(tx, existente.id);
    }
    return vincularCuotasImportadas(tx, crearPlan(tx, gastoId, datos));
  });
  revalidarCuotas(gastoId);
  revalidatePath("/estado-cuenta", "layout");
  return { vinculadas };
}

/**
 * Deja de tratar el gasto como compra en cuotas: vuelve a sumar entero en su
 * fecha. Los gastos de las cuotas ya pagadas quedan como gastos sueltos.
 */
export async function quitarCompraEnCuotas(gastoId: number) {
  db.delete(comprasEnCuotas).where(eq(comprasEnCuotas.gastoId, gastoId)).run();
  revalidarCuotas(gastoId);
}

/**
 * Paga a mano una cuota: crea su gasto, igual que si llegara por un estado de
 * cuenta. Es para la cuota que no va a aparecer en ninguno que se importe.
 * @returns el recargo nuevo si el importe corrigió el plan
 */
export async function pagarCuota(
  cuotaId: number,
  pago: { importe: number; fecha: string }
): Promise<{ gastoId: number; interesAjustado: number | null }> {
  if (!esFechaISOValida(pago.fecha)) throw new Error("La fecha no es válida");
  const r = db.transaction((tx) => pagarCuotaEnTx(tx, cuotaId, pago));
  const compra = db
    .select({ gastoId: comprasEnCuotas.gastoId })
    .from(comprasEnCuotas)
    .where(eq(comprasEnCuotas.id, r.compraId))
    .get();
  revalidarCuotas(compra?.gastoId);
  return { gastoId: r.gastoId, interesAjustado: r.interesAjustado };
}
