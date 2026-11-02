"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CuotaEsperada } from "@/lib/cuotas";
import { formatearFechaCorta, formatearMonto } from "@/lib/formato";

type LineaElegible = {
  indice: number;
  fecha: string;
  descripcion: string;
  montoPesos: number | null;
};

function titulo(e: CuotaEsperada) {
  const cuota = `la cuota ${e.numero}/${e.cantidad} de ${e.emisorNombre}`;
  if (e.tipo === "sin_registrar") {
    return `No se registró ${cuota}: ¿importaste el estado de cuenta anterior?`;
  }
  if (e.tipo === "puede_venir") {
    return `Todavía no apareció ${cuota}: puede venir en el próximo`;
  }
  return `No apareció ${cuota}`;
}

/**
 * Las cuotas de compras registradas que tendrían que estar en este estado de
 * cuenta y no se cruzaron con ninguna línea. Muestra la línea más parecida y
 * en qué no coincide (eso es lo que delata un plan mal calculado o una marca
 * de cuota que no se reconoce), y deja elegir la línea que sí es.
 */
export function CuotasEsperadas({
  esperadas,
  lineas,
  asignaciones,
  onAsignar,
  onOcultar,
}: {
  esperadas: CuotaEsperada[];
  lineas: LineaElegible[];
  /** Línea elegida para cada cuota, por id de cuota. */
  asignaciones: Record<number, number>;
  onAsignar: (cuotaId: number, indice: number | null) => void;
  onOcultar: (cuotaId: number) => void;
}) {
  if (!esperadas.length) return null;
  const porIndice = new Map(lineas.map((l) => [l.indice, l]));
  const tomadas = new Set(Object.values(asignaciones));
  const faltantes = esperadas.filter((e) => e.tipo === "faltante").length;

  return (
    <Card className="gap-3 border-amber-500/20 bg-amber-500/5 px-5 py-4.5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        {faltantes > 0
          ? "Cuotas que tendrían que estar y no aparecen"
          : "Cuotas pendientes de compras en cuotas"}
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        Son cuotas de compras que tenés registradas en cuotas. Si una no coincide con
        ninguna línea, lo más probable es que el cálculo esté mal (el recargo, por
        ejemplo): elegí la línea que es y las cuotas que faltan se recalculan con lo que
        cobró el banco.
      </p>

      <ul className="flex flex-col divide-y divide-amber-500/15 rounded-lg border border-amber-500/15 bg-card">
        {esperadas.map((e) => {
          const asignada = asignaciones[e.cuotaId];
          const lineaAsignada = asignada !== undefined ? porIndice.get(asignada) : undefined;
          const mejor = e.candidatos[0];
          const lineaMejor = mejor ? porIndice.get(mejor.indice) : undefined;
          const opciones = e.candidatos.filter(
            (c) => c.indice === asignada || !tomadas.has(c.indice)
          );
          return (
            <li key={e.cuotaId} className="flex flex-col gap-2 px-3.5 py-3">
              <div className="flex items-start gap-2">
                {e.tipo === "puede_venir" ? (
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : lineaAsignada ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{titulo(e)}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    Calculada en {formatearMonto(e.importeCalculado, { decimales: 2 })} ·
                    compra del {formatearFechaCorta(e.fechaCompra)} ·{" "}
                    <Link href={`/gastos/${e.gastoId}`} className="text-primary hover:underline">
                      ver la compra
                    </Link>
                  </div>
                  {!lineaAsignada && mejor && lineaMejor && (
                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                      Lo más parecido: <span className="text-foreground">{lineaMejor.descripcion}</span>
                      {mejor.motivos.length > 0 && ` — ${mejor.motivos.join(", ")}`}
                    </div>
                  )}
                  {lineaAsignada && (
                    <div className="mt-1 text-[11.5px] text-primary">
                      Es la línea {lineaAsignada.descripcion}
                      {lineaAsignada.montoPesos !== null &&
                        ` (${formatearMonto(lineaAsignada.montoPesos, { decimales: 2 })})`}
                      : al importar queda pagada.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-5.5">
                {e.tipo !== "sin_registrar" && opciones.length > 0 && (
                  <select
                    aria-label={`Línea que es la cuota ${e.numero}/${e.cantidad} de ${e.emisorNombre}`}
                    value={asignada ?? ""}
                    onChange={(ev) =>
                      onAsignar(e.cuotaId, ev.target.value === "" ? null : Number(ev.target.value))
                    }
                    className="h-7 max-w-full rounded-md border border-input bg-background px-1.5 text-[12px]"
                  >
                    <option value="">Es esta línea…</option>
                    {opciones.map((c) => {
                      const l = porIndice.get(c.indice);
                      if (!l) return null;
                      return (
                        <option key={c.indice} value={c.indice}>
                          {formatearFechaCorta(l.fecha)} · {l.descripcion}
                          {l.montoPesos !== null &&
                            ` · ${formatearMonto(l.montoPesos, { decimales: 2 })}`}
                        </option>
                      );
                    })}
                  </select>
                )}
                {asignada === undefined && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[12px]"
                    onClick={() => onOcultar(e.cuotaId)}
                  >
                    No es de esta tarjeta
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
