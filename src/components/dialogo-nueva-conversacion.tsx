"use client";

import { useState } from "react";
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
import { crearConversacion } from "@/app/actions/chat-ia";
import type { ProveedorDisponibleIA } from "@/app/actions/configuracion";
import type { ProveedorIA } from "@/lib/proveedores-ia";

export function DialogoNuevaConversacion({
  open,
  onOpenChange,
  proveedores,
  proveedorActivo,
  onCreada,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proveedores: ProveedorDisponibleIA[];
  proveedorActivo: ProveedorIA;
  onCreada: (id: number) => void;
}) {
  const { error, isPending, enviar } = useEnvioDialog(
    "No se pudo crear la conversación",
  );
  const [eleccion, setEleccion] = useState<EleccionModelo>(() =>
    eleccionInicial(proveedores, proveedorActivo),
  );

  const sinProveedores = proveedores.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva conversación</DialogTitle>
          <DialogDescription>
            Quedan fijados para todo el hilo: cambiar de modelo a mitad de camino
            mezclaría comportamientos, así que se elige acá. No cambia el
            predeterminado de Ajustes.
          </DialogDescription>
        </DialogHeader>

        {sinProveedores ? (
          <p className="text-[12px] text-amber-500">
            No hay ninguna API key configurada. Cargá una en Ajustes para poder
            usar el asistente.
          </p>
        ) : (
          <SelectorModeloIA
            idPrefijo="nueva-conversacion"
            proveedores={proveedores}
            valor={eleccion}
            onCambio={setEleccion}
            deshabilitado={isPending}
          />
        )}

        {error && <p className="text-[12px] text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={isPending || sinProveedores}
            onClick={() =>
              enviar(async () => {
                const id = await crearConversacion({
                  proveedor: eleccion.proveedor,
                  modelo: eleccion.modelo,
                });
                onOpenChange(false);
                onCreada(id);
              })
            }
          >
            {isPending ? "Creando…" : "Empezar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}