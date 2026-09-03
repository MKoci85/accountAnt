"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  eleccionInicial,
  SelectorModeloIA,
  type EleccionModelo,
} from "@/components/selector-modelo-ia";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import {
  destinosParaReporte,
  prepararReporteParaChat,
  type DestinoPosible,
} from "@/app/actions/chat-ia";
import type { FiltrosReporte } from "@/app/actions/reportes";
import type { ProveedorDisponibleIA } from "@/app/actions/configuracion";
import type { ProveedorIA } from "@/lib/proveedores-ia";
import { formatearFechaLarga } from "@/lib/formato";
import { cn } from "@/lib/utils";

export function DialogoAnalizarIA({
  open,
  onOpenChange,
  filtros,
  proveedores,
  proveedorActivo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filtros: FiltrosReporte;
  proveedores: ProveedorDisponibleIA[];
  proveedorActivo: ProveedorIA;
}) {
  const router = useRouter();
  const { error, isPending, enviar } = useEnvioDialog(
    "No se pudo mandar el reporte al asistente",
  );
  const [datos, setDatos] = useState<{
    etiqueta: string;
    caracteresReporte: number;
    conversaciones: DestinoPosible[];
  } | null>(null);
  const [cargando, startCarga] = useTransition();
  const [destino, setDestino] = useState<"nueva" | number>("nueva");
  const [eleccion, setEleccion] = useState<EleccionModelo>(() =>
    eleccionInicial(proveedores, proveedorActivo),
  );

  const claveFiltros = JSON.stringify(filtros);
  useEffect(() => {
    startCarga(async () => {
      setDatos(await destinosParaReporte(JSON.parse(claveFiltros)));
    });
  }, [claveFiltros]);

  const sinProveedores = proveedores.length === 0;
  const elegida =
    typeof destino === "number"
      ? datos?.conversaciones.find((c) => c.id === destino)
      : undefined;

  function handleAnalizar() {
    enviar(async () => {
      const { conversacionId } = await prepararReporteParaChat(
        JSON.parse(claveFiltros),
        destino === "nueva"
          ? {
              tipo: "nueva",
              proveedor: eleccion.proveedor,
              modelo: eleccion.modelo,
            }
          : { tipo: "existente", conversacionId: destino },
      );
      onOpenChange(false);
      router.push(`/reportes/asistente/${conversacionId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Analizar con IA</DialogTitle>
          <DialogDescription>
            {datos
              ? `Se adjunta el reporte de ${datos.etiqueta} (${Math.max(1, Math.round(datos.caracteresReporte / 1024)).toLocaleString("es-UY")} KB de JSON). No se pega en el chat: viaja como adjunto.`
              : "Midiendo el reporte…"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-pressed={destino === "nueva"}
            disabled={sinProveedores}
            onClick={() => setDestino("nueva")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              destino === "nueva"
                ? "border-primary/60 bg-primary/5"
                : "border-border hover:bg-muted/50",
            )}
          >
            <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
            Conversación nueva
          </button>

          {destino === "nueva" &&
            (sinProveedores ? (
              <p className="text-[12px] text-amber-500">
                No hay ninguna API key configurada. Cargá una en Ajustes para
                poder usar el asistente.
              </p>
            ) : (
              <SelectorModeloIA
                idPrefijo="analizar"
                proveedores={proveedores}
                valor={eleccion}
                onCambio={setEleccion}
                deshabilitado={isPending}
              />
            ))}

          {datos && datos.conversaciones.length > 0 && (
            <>
              <div className="text-[11.5px] text-muted-foreground">
                …o seguir una conversación existente:
              </div>
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {datos.conversaciones.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={destino === c.id}
                    onClick={() => setDestino(c.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors",
                      destino === c.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="truncate text-[13px]">{c.titulo}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {formatearFechaLarga(new Date(c.actualizadaEn))} ·{" "}
                      {c.modelo}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {elegida && !elegida.entra && (
            <p className="flex items-start gap-1.5 text-[12px] text-amber-500">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                El reporte (~{elegida.tokensReporte.toLocaleString("es-UY")}{" "}
                tokens) no entra entero en el contexto de {elegida.modelo}: se va
                a mandar recortado. Probá con un período más corto, o con una
                conversación de otro modelo.
              </span>
            </p>
          )}

          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleAnalizar}
            disabled={
              isPending || cargando || (destino === "nueva" && sinProveedores)
            }
          >
            {isPending ? "Preparando…" : "Analizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
