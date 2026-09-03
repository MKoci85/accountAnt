import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cotizaciones } from "@/db/schema";
import {
  leerDiasHaciaAtrasBcu,
  leerTimeoutBcuMs,
  leerUrlBcu,
} from "@/lib/config-server";

const MONEDA_USD = 2222;

export type Cotizacion = {
  fecha: string;
  compra: number;
  venta: number;
};

function restarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

function construirSobre(desde: string, hasta: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Body>
    <cot:wsbcucotizaciones.Execute>
      <cot:Entrada>
        <cot:Moneda><cot:item>${MONEDA_USD}</cot:item></cot:Moneda>
        <cot:FechaDesde>${desde}</cot:FechaDesde>
        <cot:FechaHasta>${hasta}</cot:FechaHasta>
        <cot:Grupo>0</cot:Grupo>
      </cot:Entrada>
    </cot:wsbcucotizaciones.Execute>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function parsearRespuesta(xml: string): Cotizacion[] {
  const cotizaciones: Cotizacion[] = [];
  const bloques = [
    ...xml.matchAll(
      /<(?:\w+:)?datoscotizaciones\.dato\b[^>]*>([\s\S]*?)<\/(?:\w+:)?datoscotizaciones\.dato>/gi
    ),
  ].map((m) => m[1]);

  for (const bloque of bloques) {
    const fecha = /<(?:\w+:)?Fecha>([^<]+)</i.exec(bloque)?.[1]?.trim();
    const tcc = /<(?:\w+:)?TCC>([^<]+)</i.exec(bloque)?.[1]?.trim();
    const tcv = /<(?:\w+:)?TCV>([^<]+)</i.exec(bloque)?.[1]?.trim();
    if (!fecha || !tcc) continue;

    const compra = Number(tcc);
    const venta = Number(tcv ?? tcc);
    if (!Number.isFinite(compra) || compra <= 0) continue;

    cotizaciones.push({
      fecha: fecha.slice(0, 10),
      compra,
      venta: Number.isFinite(venta) && venta > 0 ? venta : compra,
    });
  }

  return cotizaciones;
}

/**
 * Consulta al BCU la última cotización del dólar disponible para una fecha.
 * @param fecha fecha ISO pedida
 * @returns la última cotización con fecha <= la pedida, o null si el BCU no respondió o no hay ninguna
 */
export async function obtenerCotizacionUSD(
  fecha: string
): Promise<Cotizacion | null> {
  const desde = restarDias(fecha, await leerDiasHaciaAtrasBcu());

  let respuesta: Response;
  try {
    respuesta = await fetch(await leerUrlBcu(), {
      method: "POST",
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        SOAPAction: "Execute",
      },
      body: construirSobre(desde, fecha),
      signal: AbortSignal.timeout(await leerTimeoutBcuMs()),
    });
  } catch {
    return null;
  }

  if (!respuesta.ok) return null;

  const cotizaciones = parsearRespuesta(await respuesta.text())
    .filter((c) => c.fecha <= fecha)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return cotizaciones.at(-1) ?? null;
}

/**
 * Cotización de compra del dólar para una fecha, cacheada en la tabla `cotizaciones`.
 * @param fecha fecha ISO pedida
 * @returns la cotización de compra, o null si no se pudo obtener
 */
export async function obtenerCotizacionCacheada(
  fecha: string
): Promise<number | null> {
  const [guardada] = await db
    .select()
    .from(cotizaciones)
    .where(eq(cotizaciones.fecha, fecha))
    .limit(1);
  if (guardada) return guardada.compra;

  const cotizacion = await obtenerCotizacionUSD(fecha);
  if (!cotizacion) return null;

  await db
    .insert(cotizaciones)
    .values({
      fecha,
      fechaCotizacion: cotizacion.fecha,
      compra: cotizacion.compra,
      venta: cotizacion.venta,
    })
    .onConflictDoNothing();

  return cotizacion.compra;
}
