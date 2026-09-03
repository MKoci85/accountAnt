import Link from "next/link";
import { Pencil, ScanLine, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BadgeLinea } from "@/components/badge-linea";
import { Card } from "@/components/ui/card";
import { obtenerGasto } from "@/app/actions/gastos";
import { BorrarGastoButton } from "@/components/borrar-gasto-button";
import { PageContainer } from "@/components/page-container";
import { nombreLinea } from "@/lib/utils";
import {
  formatearCantidadConUnidad,
  etiquetaUnidad,
  normalizarUnidad,
} from "@/lib/precios-referencia";
import { formatearMonto, formatearFechaLarga } from "@/lib/formato";

export const dynamic = "force-dynamic";

export default async function DetalleGastoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gasto = await obtenerGasto(Number(id));

  const total = gasto.items.reduce((acc, i) => acc + i.precio * i.cantidad, 0);
  const sinComprobante = gasto.serie === null;

  return (
    <PageContainer>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/gastos" className="hover:text-foreground">
          Gastos
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">{gasto.emisorNombre}</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {gasto.emisorNombre}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatearFechaLarga(gasto.fecha)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            nativeButton={false}
            render={<Link href={`/gastos/${gasto.id}/editar`} />}
          >
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          <BorrarGastoButton gastoId={gasto.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="px-5 py-4.5">
            <div className="mb-3 text-sm font-semibold">Comprobante</div>
            {sinComprobante ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-4 py-6 text-center">
                <ScanLine className="h-6 w-6 text-muted-foreground" />
                <div className="text-[13px] font-medium text-muted-foreground">
                  Cargado sin comprobante
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">RUC comercio</span>
                  <span className="font-medium">{gasto.emisorRuc}</span>
                </div>
                {gasto.tipoCfe && gasto.serie && gasto.numero && (
                  <div className="flex justify-between text-[13px]">
                    <span className="text-muted-foreground">Comprobante</span>
                    <span className="font-medium">
                      {gasto.tipoCfe} {gasto.serie} {gasto.numero}
                    </span>
                  </div>
                )}
              </div>
            )}
          </Card>

          {sinComprobante && (
            <Card className="flex-row gap-2.5 border-destructive/20 bg-destructive/5 px-4.5 py-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-[12.5px] leading-relaxed text-destructive/90">
                Este gasto se cargó sin comprobante (efectivo o sin factura).
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="overflow-visible py-0">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <span className="text-sm font-semibold">
                Ítems{" "}
                <span className="font-normal text-muted-foreground">
                  ({gasto.items.length})
                </span>
              </span>
            </div>

            <div className="hidden grid-cols-[1fr_110px_70px_90px_90px] gap-2.5 border-b px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
              <div>Ítem</div>
              <div>Categoría</div>
              <div>Cant. / peso</div>
              <div>Precio</div>
              <div>Tipo</div>
            </div>

            <div className="divide-y">
              {gasto.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 px-5 py-3.5 md:grid md:grid-cols-[1fr_110px_70px_90px_90px] md:items-center md:gap-2.5"
                >
                  <div>
                    <div className="text-[13.5px] font-medium">
                      {nombreLinea(item)}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {[item.itemMarca, item.itemTamano]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div>
                    <Badge variant="secondary">{item.categoriaNombre}</Badge>
                  </div>
                  <div className="text-[13px] text-muted-foreground">
                    {formatearCantidadConUnidad(
                      item.cantidad,
                      normalizarUnidad(item.unidad)
                    )}
                  </div>
                  <div className="text-[13.5px] font-medium">
                    {formatearMonto(Number(item.precio.toFixed(2)), {
                      decimales: normalizarUnidad(item.unidad) === "un" ? undefined : 2,
                    })}
                    {normalizarUnidad(item.unidad) !== "un" && (
                      <span className="block text-[10.5px] font-normal text-muted-foreground">
                        {etiquetaUnidad(normalizarUnidad(item.unidad))} ={" "}
                        {formatearMonto(
                          Number((item.precio * item.cantidad).toFixed(2)),
                          { decimales: 2 }
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <BadgeLinea tipo="hormiga" activo={item.esHormiga} />
                    {item.esSobreprecio && <BadgeLinea tipo="sobreprecio" />}
                    {item.esPrecioBase && <BadgeLinea tipo="precioBase" />}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex items-center justify-between px-1">
            <span className="text-sm text-muted-foreground">Total del gasto</span>
            <span className="text-xl font-semibold">{formatearMonto(total)}</span>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
