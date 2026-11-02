import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageContainer } from "@/components/page-container";
import { BorrarEstadoCuentaButton } from "@/components/borrar-estado-cuenta-button";
import {
  formatearDolares,
  periodoEstadoCuenta,
} from "@/components/registro-estados-cuenta";
import {
  obtenerEstadoCuenta,
  type MovimientoDelRegistro,
} from "@/app/actions/estado-cuenta";
import {
  formatearFechaCorta,
  formatearFechaLarga,
  formatearMonto,
} from "@/lib/formato";
import { cuotasRestantes } from "@/lib/estado-cuenta";

export const dynamic = "force-dynamic";

const ETIQUETA_TIPO: Record<MovimientoDelRegistro["tipo"], string> = {
  importado: "Importado",
  ya_registrado: "Ya estaba",
  omitido: "No importado",
  descuento: "Descuento",
};

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

function Importes({ pesos, usd }: { pesos: number | null; usd: number | null }) {
  if (pesos === null && usd === null) return <>—</>;
  return (
    <>
      {pesos !== null && formatearMonto(pesos, { decimales: 2 })}
      {pesos !== null && !!usd && " + "}
      {!!usd && formatearDolares(usd)}
    </>
  );
}

export default async function DetalleEstadoCuentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  const datos = Number.isInteger(id) ? await obtenerEstadoCuenta(id) : null;
  if (!datos) notFound();
  const { estado, movimientos } = datos;

  const compras = movimientos.filter((m) => m.tipo !== "descuento");
  const sinGasto = compras.filter((m) => m.gastoId === null).length;
  const restantesDe = (m: MovimientoDelRegistro) =>
    m.cuotaNumero !== null && m.cuotasTotal !== null
      ? cuotasRestantes({ numero: m.cuotaNumero, total: m.cuotasTotal }, m.montoPesos)
      : null;
  const cuotasPorPagar = compras.reduce(
    (acc, m) => acc + (restantesDe(m)?.pesos ?? 0),
    0
  );
  const urlPdf = `/estado-cuenta/${estado.id}/pdf`;

  return (
    <PageContainer>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/estado-cuenta" className="hover:text-foreground">
          Estado de cuenta
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">
          {periodoEstadoCuenta(estado)}
        </span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {estado.banco ?? "Estado de cuenta"}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {periodoEstadoCuenta(estado)} · {estado.nombreArchivo}
          </p>
        </div>
        <div className="flex gap-2">
          {estado.archivo && (
            <Button
              variant="outline"
              className="gap-2"
              nativeButton={false}
              render={<a href={urlPdf} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink className="h-4 w-4" />
              Abrir PDF
            </Button>
          )}
          <BorrarEstadoCuentaButton id={estado.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2.5 px-5 py-4.5">
            <div className="mb-0.5 text-sm font-semibold">Resumen</div>
            <Dato etiqueta="Cierre">
              {estado.cierre ? formatearFechaLarga(estado.cierre) : "—"}
            </Dato>
            <Dato etiqueta="Vencimiento">
              {estado.vencimiento ? formatearFechaLarga(estado.vencimiento) : "—"}
            </Dato>
            <Dato etiqueta="Pago contado">
              <Importes pesos={estado.pagoContadoPesos} usd={estado.pagoContadoUsd} />
            </Dato>
            <Dato etiqueta="Pago mínimo">
              <Importes pesos={estado.pagoMinimoPesos} usd={estado.pagoMinimoUsd} />
            </Dato>
            <Dato etiqueta="Movimientos">{compras.length}</Dato>
            {sinGasto > 0 && <Dato etiqueta="Sin gasto vinculado">{sinGasto}</Dato>}
            {cuotasPorPagar > 0 && (
              <Dato etiqueta="Cuotas que faltan">
                {formatearMonto(cuotasPorPagar, { decimales: 2 })}
              </Dato>
            )}
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Importado el{" "}
              {formatearFechaLarga(new Date(estado.importadoEn ?? estado.subidoEn))}
              {estado.conIA && " · leído con IA"}
            </p>
          </Card>

          {estado.archivo && (
            <Card className="hidden overflow-hidden p-0 lg:flex">
              <iframe
                src={urlPdf}
                title="PDF del estado de cuenta"
                className="h-[520px] w-full border-0 bg-muted"
              />
            </Card>
          )}
        </div>

        <Card className="px-5 py-4.5">
          <div className="mb-3 text-sm font-semibold">Líneas y sus gastos</div>
          {movimientos.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No quedó ninguna línea registrada.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {movimientos.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                >
                  <span className="w-12 shrink-0 text-[12px] text-muted-foreground">
                    {formatearFechaCorta(m.fecha)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {m.descripcion}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {m.gastoId !== null ? (
                        <Link
                          href={`/gastos/${m.gastoId}`}
                          className="text-primary hover:underline"
                        >
                          {m.emisor ?? "Ver gasto"}
                        </Link>
                      ) : m.tipo === "descuento" ? (
                        "No es un gasto"
                      ) : m.tipo === "omitido" ? (
                        "Sin gasto"
                      ) : (
                        "El gasto se borró"
                      )}
                    </div>
                  </div>
                  {m.cuotaNumero !== null && m.cuotasTotal !== null && (
                    <Badge
                      variant="outline"
                      className="shrink-0"
                      title={`Compra del ${formatearFechaCorta(m.fecha)}`}
                    >
                      Cuota {m.cuotaNumero}/{m.cuotasTotal}
                      {!!restantesDe(m)?.cantidad &&
                        ` · faltan ${restantesDe(m)?.cantidad}`}
                    </Badge>
                  )}
                  <Badge
                    variant={m.tipo === "importado" ? "secondary" : "outline"}
                    className="shrink-0"
                  >
                    {ETIQUETA_TIPO[m.tipo]}
                  </Badge>
                  <div className="w-28 shrink-0 text-right text-[13px] tabular-nums">
                    {m.moneda === "USD" ? (
                      <>
                        <div>{formatearDolares(m.monto)}</div>
                        {m.montoPesos !== null && (
                          <div className="text-[11px] text-muted-foreground">
                            {formatearMonto(m.montoPesos, { decimales: 2 })}
                          </div>
                        )}
                      </>
                    ) : (
                      formatearMonto(m.monto, { decimales: 2 })
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
