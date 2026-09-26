"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import {
  combinarGastos,
  descartarGastosCombinables,
  type GastoResumen,
} from "@/app/actions/gastos";
import { formatearFechaCorta, formatearMonto } from "@/lib/formato";

function GrupoCombinable({ grupo }: { grupo: GastoResumen[] }) {
  const router = useRouter();
  const [seleccionados, setSeleccionados] = useState(() =>
    grupo.map((g) => g.id)
  );
  const { error, isPending, enviar } = useEnvioDialog(
    "No se pudo completar la operación"
  );

  const elegidos = grupo.filter((g) => seleccionados.includes(g.id));
  const conComprobante = elegidos.filter((g) => !g.sinComprobante).length;
  const total = elegidos.reduce((acc, g) => acc + g.montoTotal, 0);
  const motivoNoCombinable =
    elegidos.length < 2
      ? "Elegí al menos dos gastos."
      : conComprobante > 1
        ? "Dos gastos con comprobante propio no se pueden combinar."
        : null;

  function alternar(id: number) {
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function ejecutar(operacion: (ids: number[]) => Promise<void>) {
    enviar(async () => {
      await operacion(seleccionados);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm">
        <span className="font-medium">{grupo[0].emisorNombre}</span>
        <span className="text-muted-foreground">
          {" "}
          · {formatearFechaCorta(grupo[0].fecha)}
        </span>
      </div>

      <div className="divide-y rounded-lg border">
        {grupo.map((g) => (
          <div key={g.id} className="flex items-start gap-3 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={seleccionados.includes(g.id)}
              disabled={isPending}
              onChange={() => alternar(g.id)}
              aria-label={`Incluir el gasto de ${formatearMonto(g.montoTotal)}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                {formatearMonto(g.montoTotal)}
                {!g.sinComprobante && (
                  <Badge variant="secondary" className="text-[10px]">
                    Con comprobante
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">
                {g.cantidadItems} ítem{g.cantidadItems === 1 ? "" : "s"}
                {g.itemsNombres.length > 0 && ` · ${g.itemsNombres.join(", ")}`}
              </div>
            </div>
            <Link
              href={`/gastos/${g.id}`}
              className="shrink-0 text-xs font-medium text-primary hover:underline"
            >
              Ver
            </Link>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {motivoNoCombinable ??
          `Las líneas de los ${elegidos.length} gastos pasan a uno solo, que va a sumar ${formatearMonto(total)}. Si es la misma compra cargada dos veces, borrá una de las copias en vez de combinarlas.`}
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={elegidos.length < 2 || isPending}
          onClick={() => ejecutar(descartarGastosCombinables)}
        >
          Son compras distintas
        </Button>
        <Button
          disabled={motivoNoCombinable !== null || isPending}
          onClick={() => ejecutar(combinarGastos)}
        >
          {isPending ? "Guardando..." : `Combinar ${elegidos.length} gastos`}
        </Button>
      </div>
    </div>
  );
}

export function GastosCombinablesDialog({
  open,
  onOpenChange,
  grupos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grupos: GastoResumen[][];
}) {
  const [indice, setIndice] = useState(0);
  const actual = Math.min(indice, Math.max(grupos.length - 1, 0));
  const grupo = grupos[actual];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gastos que se podrían combinar</DialogTitle>
          <DialogDescription>
            Gastos del mismo comercio y la misma fecha, que pueden ser una
            sola compra cargada en partes (por ejemplo, el QR y el estado de
            cuenta por separado).
          </DialogDescription>
        </DialogHeader>

        {grupo ? (
          <>
            {grupos.length > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actual === 0}
                  onClick={() => setIndice(actual - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>
                  Grupo {actual + 1} de {grupos.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actual >= grupos.length - 1}
                  onClick={() => setIndice(actual + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <GrupoCombinable
              key={grupo.map((g) => g.id).join("-")}
              grupo={grupo}
            />
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No quedan gastos por combinar.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
