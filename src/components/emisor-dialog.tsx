"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import { crearEmisor, editarEmisor } from "@/app/actions/catalogos";
import type { emisores, proveedoresCfe } from "@/db/schema";

type Emisor = typeof emisores.$inferSelect;
type ProveedorCfe = typeof proveedoresCfe.$inferSelect;

export function EmisorDialog({
  open,
  onOpenChange,
  emisorExistente,
  proveedores,
  onCreado,
  onEditado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emisorExistente?: Emisor | null;
  proveedores: ProveedorCfe[];
  onCreado: (emisor: Emisor) => void;
  onEditado?: (emisor: Emisor) => void;
}) {
  const modoEdicion = !!emisorExistente;
  const [nombre, setNombre] = useState(emisorExistente?.nombre ?? "");
  const [ruc, setRuc] = useState(emisorExistente?.ruc ?? "");
  const [proveedorCfeId, setProveedorCfeId] = useState<number | "">(
    emisorExistente?.proveedorCfeId ?? ""
  );
  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo guardar el comercio"
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setNombre(emisorExistente?.nombre ?? "");
      setRuc(emisorExistente?.ruc ?? "");
      setProveedorCfeId(emisorExistente?.proveedorCfeId ?? "");
      setError(null);
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    enviar(async () => {
      const datos = {
        nombre,
        ruc,
        proveedorCfeId: proveedorCfeId === "" ? null : proveedorCfeId,
      };
      if (emisorExistente) {
        onEditado?.(await editarEmisor(emisorExistente.id, datos));
      } else {
        onCreado(await crearEmisor(datos));
      }
      onOpenChange(false);
    });
  }

  return (
    <DialogFormulario
      open={open}
      onOpenChange={handleOpenChange}
      titulo={modoEdicion ? "Editar comercio" : "Nuevo comercio"}
      etiquetaGuardar={modoEdicion ? "Guardar cambios" : "Crear comercio"}
      puedeGuardar={!!nombre.trim()}
      isPending={isPending}
      error={error}
      onGuardar={handleSubmit}
    >
      <CampoFormulario label="Nombre" htmlFor="emisor-nombre">
        <Input
          id="emisor-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Disco Pocitos"
          autoFocus
        />
      </CampoFormulario>

      <CampoFormulario label="RUC (opcional)" htmlFor="emisor-ruc">
        <Input
          id="emisor-ruc"
          value={ruc}
          onChange={(e) => setRuc(e.target.value)}
          placeholder="Ej: 060006080018"
        />
      </CampoFormulario>

      {/* La URL de consulta ya no se pide acá: es del proveedor, no del
          comercio. Se administra en la pestaña Proveedores de CFE. */}
      <CampoFormulario
        label="Proveedor de CFE (opcional)"
        htmlFor="emisor-proveedor"
      >
        <Select
          id="emisor-proveedor"
          value={proveedorCfeId}
          onChange={(e) =>
            setProveedorCfeId(e.target.value ? Number(e.target.value) : "")
          }
        >
          <option value="">Sin proveedor</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Select>
      </CampoFormulario>
    </DialogFormulario>
  );
}
