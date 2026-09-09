"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BadgeLinea } from "@/components/badge-linea";
import {
  marcarCompraComoOferta,
  obtenerHistorialPrecios,
  type HistorialPrecios,
} from "@/app/actions/gastos";
import { formatearFechaCorta, formatearMonto } from "@/lib/formato";
import {
  etiquetaUnidad,
  formatearCantidadConUnidad,
} from "@/lib/precios-referencia";

export function HistorialPreciosDialog({
  itemCatalogoId,
  nombreItem,
  open,
  onOpenChange,
  permitirMarcar = true,
}: {
  itemCatalogoId: number | null;
  nombreItem: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permitirMarcar?: boolean;
}) {
  const [cargado, setCargado] = useState<{
    itemCatalogoId: number;
    datos: HistorialPrecios;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, startGuardado] = useTransition();

  const historial =
    cargado && cargado.itemCatalogoId === itemCatalogoId ? cargado.datos : null;
  const cargando = open && historial === null && error === null;

  useEffect(() => {
    if (!open || itemCatalogoId === null) return;
    let cancelado = false;
    obtenerHistorialPrecios(itemCatalogoId)
      .then((datos) => {
        if (cancelado) return;
        setCargado({ itemCatalogoId, datos });
        setError(null);
        setAviso(null);
      })
      .catch((e) => {
        if (!cancelado) {
          setError(
            e instanceof Error ? e.message : "No se pudo leer el historial"
          );
        }
      });
    return () => {
      cancelado = true;
    };
  }, [open, itemCatalogoId]);

  function alternarOferta(gastoItemId: number, esOferta: boolean) {
    if (itemCatalogoId === null) return;
    setError(null);
    setAviso(null);
    startGuardado(async () => {
      try {
        const { sobrepreciosLimpiados } = await marcarCompraComoOferta(
          gastoItemId,
          esOferta
        );
        setCargado({
          itemCatalogoId,
          datos: await obtenerHistorialPrecios(itemCatalogoId),
        });
        setAviso(
          sobrepreciosLimpiados === 0
            ? "Listo. Ninguna otra compra estaba marcada de más."
            : sobrepreciosLimpiados === 1
              ? "Listo. Una compra dejó de contar como sobreprecio."
              : `Listo. ${sobrepreciosLimpiados} compras dejaron de contar como sobreprecio.`
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "No se pudo guardar el cambio"
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Historial de precios</DialogTitle>
          <DialogDescription>
            {historial?.itemNombre ?? nombreItem} — qué pagaste antes y dónde.
            La compra marcada como referencia es contra la que se compara el
            sobreprecio.{" "}
            {permitirMarcar
              ? "Marcá una como oferta para que deje de servir de referencia."
              : "Para marcar una compra vieja como oferta, entrá al ítem desde Catálogos."}
          </DialogDescription>
        </DialogHeader>

        {cargando && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Buscando compras anteriores...
          </p>
        )}

        {!cargando && historial && historial.compras.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Todavía no hay ninguna compra guardada de este ítem.
          </p>
        )}

        {!cargando && historial && historial.compras.length > 0 && (
          <div className="flex max-h-[55vh] flex-col divide-y divide-border/60 overflow-y-auto">
            {historial.compras.map((compra) => (
              <div key={compra.gastoItemId} className="flex flex-col gap-1 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-medium">
                    {formatearMonto(compra.precio)}{" "}
                    <span className="text-[11.5px] font-normal text-muted-foreground">
                      {etiquetaUnidad(compra.unidad)}
                    </span>
                  </span>
                  <Link
                    href={`/gastos/${compra.gastoId}`}
                    className="text-[12.5px] text-muted-foreground hover:text-foreground"
                  >
                    {formatearFechaCorta(compra.fecha)}
                  </Link>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-muted-foreground">
                    {compra.emisorNombre}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {formatearCantidadConUnidad(compra.cantidad, compra.unidad)}
                    {" · "}
                    {formatearMonto(compra.total)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {compra.esReferencia && (
                    <Badge
                      variant="secondary"
                      className="bg-primary/15 text-primary"
                    >
                      Referencia
                    </Badge>
                  )}
                  {compra.esSobreprecio && <BadgeLinea tipo="sobreprecio" />}
                  {compra.esPrecioBase && <BadgeLinea tipo="precioBase" />}
                  {compra.esPesoDesconocido && (
                    <BadgeLinea tipo="pesoDesconocido" />
                  )}
                  {compra.fueraDeVentana && (
                    <span className="text-[11px] text-muted-foreground">
                      fuera de la ventana de comparación
                    </span>
                  )}
                  {permitirMarcar && !compra.esPesoDesconocido && (
                    <button
                      type="button"
                      disabled={guardando}
                      className="ml-auto"
                      onClick={() =>
                        alternarOferta(compra.gastoItemId, !compra.esOferta)
                      }
                    >
                      <BadgeLinea
                        tipo="oferta"
                        activo={compra.esOferta}
                        etiquetaInactiva="Marcar como oferta"
                      />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {aviso && <p className="text-[12.5px] text-primary">{aviso}</p>}
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
