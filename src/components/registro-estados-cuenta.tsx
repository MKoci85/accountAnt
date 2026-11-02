import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ResumenEstadoCuentaRegistrado } from "@/app/actions/estado-cuenta";
import { formatearFechaLarga, formatearMonto } from "@/lib/formato";

export function formatearDolares(monto: number) {
  return `USD ${monto.toLocaleString("es-UY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Cómo se nombra un estado de cuenta del registro: por su cierre cuando el PDF
 * lo trae, y si no por el período de sus movimientos.
 */
export function periodoEstadoCuenta(estado: {
  cierre: string | null;
  desde: string | null;
  hasta: string | null;
}) {
  if (estado.cierre) return `Cierre ${formatearFechaLarga(estado.cierre)}`;
  if (estado.desde && estado.hasta) {
    return `${formatearFechaLarga(estado.desde)} – ${formatearFechaLarga(estado.hasta)}`;
  }
  return "Sin fechas";
}

export function RegistroEstadosCuenta({
  estados,
}: {
  estados: ResumenEstadoCuentaRegistrado[];
}) {
  return (
    <Card className="px-5 py-4.5">
      <div className="mb-1 text-sm font-semibold">Estados de cuenta cargados</div>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Cada uno con su PDF original y el gasto que corresponde a cada línea.
      </p>
      {estados.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input bg-muted/40 px-3 py-5 text-center text-[12.5px] text-muted-foreground">
          Todavía no hay ninguno: aparecen acá al importar un PDF.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {estados.map((e) => (
            <li key={e.id}>
              <Link
                href={`/estado-cuenta/${e.id}`}
                className="flex items-center gap-3 py-2.5 hover:text-primary"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">
                    {e.banco ?? "Estado de cuenta"} · {periodoEstadoCuenta(e)}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {e.movimientos}{" "}
                    {e.movimientos === 1 ? "movimiento" : "movimientos"}
                    {e.importados > 0 &&
                      ` · ${e.importados} ${e.importados === 1 ? "importado" : "importados"}`}
                    {e.vencimiento &&
                      ` · vence el ${formatearFechaLarga(e.vencimiento)}`}
                  </div>
                </div>
                {(e.pagoContadoPesos !== null || e.pagoContadoUsd !== null) && (
                  <div className="shrink-0 text-right text-[12.5px] tabular-nums">
                    {e.pagoContadoPesos !== null && (
                      <div>{formatearMonto(e.pagoContadoPesos, { decimales: 2 })}</div>
                    )}
                    {!!e.pagoContadoUsd && (
                      <div className="text-muted-foreground">
                        {formatearDolares(e.pagoContadoUsd)}
                      </div>
                    )}
                  </div>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
