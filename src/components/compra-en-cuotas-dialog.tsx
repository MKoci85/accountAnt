"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampoFormulario } from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import { formatearMonto, parsearMonto } from "@/lib/formato";
import { planDeCuotas, totalFinanciado } from "@/lib/cuotas";

export type DatosCompraEnCuotas = {
  total: number;
  cantidad: number;
  interesPct: number;
};

function textoInicial(n: number | undefined) {
  return n === undefined ? "" : String(n).replace(".", ",");
}

/**
 * Pide lo necesario para calcular las cuotas de una compra: el total, en
 * cuántas cuotas y el recargo. El importe de cada cuota no se pide porque no
 * siempre se sabe: se calcula, y se corrige con lo que cobre el banco.
 */
export function CompraEnCuotasDialog({
  open,
  onOpenChange,
  titulo,
  descripcion,
  inicial,
  etiquetaConfirmar,
  alternativa,
  onConfirmar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  descripcion?: string;
  inicial: { total: number; cantidad?: number; interesPct?: number };
  etiquetaConfirmar: string;
  /** Una segunda salida además de cancelar (en el formulario: "Fue en un pago"). */
  alternativa?: { etiqueta: string; onClick: () => Promise<void> };
  onConfirmar: (datos: DatosCompraEnCuotas) => Promise<void>;
}) {
  const [total, setTotal] = useState(textoInicial(inicial.total));
  const [cantidad, setCantidad] = useState(textoInicial(inicial.cantidad));
  const [interes, setInteres] = useState(textoInicial(inicial.interesPct ?? 0));
  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo guardar la compra en cuotas"
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setTotal(textoInicial(inicial.total));
      setCantidad(textoInicial(inicial.cantidad));
      setInteres(textoInicial(inicial.interesPct ?? 0));
      setError(null);
    }
    onOpenChange(next);
  }

  const montoTotal = parsearMonto(total);
  const cuotas = Number(cantidad);
  const interesPct = interes.trim() ? parsearMonto(interes) : 0;
  const valido =
    montoTotal !== null &&
    montoTotal > 0 &&
    Number.isInteger(cuotas) &&
    cuotas >= 2 &&
    cuotas <= 60 &&
    interesPct !== null &&
    interesPct >= 0;
  const plan = valido ? planDeCuotas(montoTotal, cuotas, interesPct) : [];
  const ultimaDistinta = plan.length > 1 && plan[plan.length - 1] !== plan[0];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {descripcion && (
            <p className="text-[12.5px] text-muted-foreground">{descripcion}</p>
          )}
          <CampoFormulario label="Total de la compra" htmlFor="cuotas-total">
            <Input
              id="cuotas-total"
              value={total}
              inputMode="decimal"
              onChange={(e) => setTotal(e.target.value)}
            />
          </CampoFormulario>
          <div className="grid grid-cols-2 gap-3">
            <CampoFormulario label="Cuotas" htmlFor="cuotas-cantidad">
              <Input
                id="cuotas-cantidad"
                value={cantidad}
                inputMode="numeric"
                placeholder="Ej: 6"
                onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </CampoFormulario>
            <CampoFormulario label="Recargo (%)" htmlFor="cuotas-interes">
              <Input
                id="cuotas-interes"
                value={interes}
                inputMode="decimal"
                placeholder="0"
                onChange={(e) => setInteres(e.target.value)}
              />
            </CampoFormulario>
          </div>

          {valido && (
            <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[12.5px]">
              {ultimaDistinta
                ? `${cuotas - 1} cuotas de ${formatearMonto(plan[0], { decimales: 2 })} y la última de ${formatearMonto(plan[plan.length - 1], { decimales: 2 })}`
                : `${cuotas} cuotas de ${formatearMonto(plan[0], { decimales: 2 })}`}
              {interesPct > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · se pagan{" "}
                  {formatearMonto(totalFinanciado(montoTotal, interesPct), { decimales: 2 })}
                </span>
              )}
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Si el banco cobra otra cosa, las cuotas que falten se recalculan con lo
                cobrado.
              </p>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          {alternativa ? (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => enviar(alternativa.onClick)}
            >
              {alternativa.etiqueta}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          )}
          <Button
            disabled={!valido || isPending}
            onClick={() =>
              enviar(async () => {
                if (!valido) return;
                await onConfirmar({ total: montoTotal, cantidad: cuotas, interesPct });
              })
            }
          >
            {isPending ? "Guardando..." : etiquetaConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
