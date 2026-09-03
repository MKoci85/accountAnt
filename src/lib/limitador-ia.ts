import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { usoIA } from "@/db/schema";
import {
  leerLimitadorActivo,
  leerRpdEfectivo,
  leerTpmEfectivo,
} from "@/lib/config-server";
import { configDe, type ProveedorIA } from "@/lib/proveedores-ia";

export const VENTANA_MINUTO_MS = 60_000;

const RETENCION_MS = 2 * 24 * 60 * 60 * 1000;

export type MotivoCuota = "rpm" | "tpm" | "rpd";

export type EstadoCuota = {
  esperaMs: number;
  motivo?: MotivoCuota;
  requestsRestantesHoy: number | null;
  limiteDiario: number | null;
  agotadoHastaManana: boolean;
};

function inicioDelDiaMs(ahora: number): number {
  const d = new Date(ahora);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Chequea los tres ejes de cuota (RPM, TPM, RPD) contra el uso registrado.
 * @param proveedor proveedor de IA
 * @param modelo modelo (el TPM se cuenta por proveedor+modelo)
 * @param tokensPedidos tokens que el request va a consumir (entrada estimada + techo de respuesta)
 * @returns el estado de cuota más restrictivo de los tres ejes
 */
export async function estadoCuota(
  proveedor: ProveedorIA,
  modelo: string,
  tokensPedidos: number,
): Promise<EstadoCuota> {
  const ahora = Date.now();
  const desdeMinuto = ahora - VENTANA_MINUTO_MS;
  const desdeHoy = inicioDelDiaMs(ahora);

  const { rpmGratuito } = configDe(proveedor);
  const tpm = await leerTpmEfectivo(proveedor, modelo);
  const rpd = await leerRpdEfectivo(proveedor);

  const usadosHoy = rpd
    ? await contar(
        and(eq(usoIA.proveedor, proveedor), gte(usoIA.enMs, desdeHoy)),
      )
    : 0;
  const restantesHoy = rpd ? Math.max(0, rpd - usadosHoy) : null;

  const enElMinuto = await db
    .select({
      requests: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(${usoIA.tokensEstimados}), 0)`,
      primero: sql<number | null>`min(${usoIA.enMs})`,
    })
    .from(usoIA)
    .where(and(eq(usoIA.proveedor, proveedor), gte(usoIA.enMs, desdeMinuto)));

  const [minutoProveedor] = enElMinuto;

  const [minutoModelo] = await db
    .select({
      tokens: sql<number>`coalesce(sum(${usoIA.tokensEstimados}), 0)`,
      primero: sql<number | null>`min(${usoIA.enMs})`,
    })
    .from(usoIA)
    .where(
      and(
        eq(usoIA.proveedor, proveedor),
        eq(usoIA.modelo, modelo),
        gte(usoIA.enMs, desdeMinuto),
      ),
    );

  const agotadoHastaManana = restantesHoy !== null && restantesHoy <= 0;

  if (!(await leerLimitadorActivo())) {
    return {
      esperaMs: 0,
      requestsRestantesHoy: restantesHoy,
      limiteDiario: rpd,
      agotadoHastaManana,
    };
  }

  if (agotadoHastaManana) {
    return {
      esperaMs: inicioDelDiaMs(ahora) + 24 * 60 * 60 * 1000 - ahora,
      motivo: "rpd",
      requestsRestantesHoy: 0,
      limiteDiario: rpd,
      agotadoHastaManana: true,
    };
  }

  let esperaMs = 0;
  let motivo: MotivoCuota | undefined;

  const proponer = (espera: number, m: MotivoCuota) => {
    if (espera > esperaMs) {
      esperaMs = espera;
      motivo = m;
    }
  };

  if (rpmGratuito && minutoProveedor.requests >= rpmGratuito) {
    proponer(esperaHasta(minutoProveedor.primero, ahora), "rpm");
  }

  if (tpm && minutoModelo.tokens + tokensPedidos > tpm) {
    proponer(esperaHasta(minutoModelo.primero, ahora), "tpm");
  }

  return {
    esperaMs,
    motivo,
    requestsRestantesHoy: restantesHoy,
    limiteDiario: rpd,
    agotadoHastaManana: false,
  };
}

function esperaHasta(primero: number | null, ahora: number): number {
  if (primero === null) return 0;
  const resto = primero + VENTANA_MINUTO_MS - ahora;
  return resto > 0 ? resto : 0;
}

async function contar(
  filtro: ReturnType<typeof and> | ReturnType<typeof eq>,
): Promise<number> {
  const [fila] = await db
    .select({ n: sql<number>`count(*)` })
    .from(usoIA)
    .where(filtro);
  return fila?.n ?? 0;
}

/**
 * Registra el uso de un request, antes de llamarlo, y purga filas viejas de la tabla.
 * @param proveedor proveedor de IA
 * @param modelo modelo usado
 * @param tokensEstimados tokens estimados del request
 * @param origen flujo que originó el request
 */
export async function registrarUso(
  proveedor: ProveedorIA,
  modelo: string,
  tokensEstimados: number,
  origen: (typeof usoIA.$inferInsert)["origen"],
): Promise<void> {
  const ahora = Date.now();

  await db.insert(usoIA).values({
    proveedor,
    modelo,
    enMs: ahora,
    tokensEstimados,
    origen,
  });

  await db.delete(usoIA).where(lt(usoIA.enMs, ahora - RETENCION_MS));
}

/**
 * Arma el mensaje de espera a mostrar en la UI según el estado de cuota.
 * @param estado resultado de `estadoCuota`
 * @param proveedorNombre nombre visible del proveedor
 * @param modelo modelo en uso
 * @returns texto listo para mostrar al usuario
 */
export function mensajeEspera(
  estado: EstadoCuota,
  proveedorNombre: string,
  modelo: string,
): string {
  if (estado.agotadoHastaManana) {
    return `Se agotó la cuota diaria de ${proveedorNombre} (${estado.limiteDiario} consultas por día). Esperar no alcanza: hay que esperar a mañana o cambiar de proveedor en Ajustes. Si comprás créditos, podés subir el límite diario ahí mismo.`;
  }

  const seg = Math.ceil(estado.esperaMs / 1000);
  const plural = seg === 1 ? "" : "s";
  const porque =
    estado.motivo === "tpm"
      ? `Se llegó al límite de tokens por minuto de ${proveedorNombre} (${modelo})`
      : `Se llegó al límite de consultas por minuto de ${proveedorNombre}`;

  return `${porque}. Esperá ${seg} segundo${plural}. El limitador evita gastar una consulta que el proveedor va a rechazar; se puede desactivar en Ajustes.`;
}
