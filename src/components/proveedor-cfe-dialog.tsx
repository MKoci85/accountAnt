"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import {
  editarProveedorCfe,
  obtenerOCrearProveedorCfe,
} from "@/app/actions/catalogos";
import {
  PROCESADORES_CONOCIDOS,
  type FormatoProveedorCfe,
} from "@/lib/procesadores";
import type { proveedoresCfe } from "@/db/schema";

type ProveedorCfe = typeof proveedoresCfe.$inferSelect;

export function ProveedorCfeDialog({
  open,
  onOpenChange,
  proveedorExistente,
  onGuardado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proveedorExistente?: ProveedorCfe | null;
  onGuardado: (proveedor: ProveedorCfe) => void;
}) {
  const modoEdicion = !!proveedorExistente;
  const [nombre, setNombre] = useState(proveedorExistente?.nombre ?? "");
  const [urlConsulta, setUrlConsulta] = useState(
    proveedorExistente?.urlConsulta ?? ""
  );
  const [formato, setFormato] = useState<FormatoProveedorCfe>(
    proveedorExistente?.formato ?? "otro"
  );
  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo guardar el proveedor"
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setNombre(proveedorExistente?.nombre ?? "");
      setUrlConsulta(proveedorExistente?.urlConsulta ?? "");
      setFormato(proveedorExistente?.formato ?? "otro");
      setError(null);
    }
    onOpenChange(next);
  }

  function precargarConocido(id: string) {
    const conocido = PROCESADORES_CONOCIDOS.find((p) => p.id === id);
    if (!conocido) return;
    setNombre(conocido.nombre);
    if (conocido.urlEjemplo) setUrlConsulta(conocido.urlEjemplo);
    setFormato(conocido.id);
  }

  function handleSubmit() {
    enviar(async () => {
      const proveedor = proveedorExistente
        ? await editarProveedorCfe(proveedorExistente.id, {
            nombre,
            urlConsulta,
            formato,
          })
        : await obtenerOCrearProveedorCfe({ nombre, urlConsulta, formato });
      onGuardado(proveedor);
      onOpenChange(false);
    });
  }

  return (
    <DialogFormulario
      open={open}
      onOpenChange={handleOpenChange}
      titulo={modoEdicion ? "Editar proveedor de CFE" : "Nuevo proveedor de CFE"}
      etiquetaGuardar={modoEdicion ? "Guardar cambios" : "Crear proveedor"}
      puedeGuardar={!!nombre.trim() && !!urlConsulta.trim()}
      isPending={isPending}
      error={error}
      onGuardar={handleSubmit}
    >
      {!modoEdicion && (
        <CampoFormulario
          label="Proveedor conocido (opcional)"
          htmlFor="proveedor-conocido"
        >
          <Select
            id="proveedor-conocido"
            defaultValue=""
            onChange={(e) => precargarConocido(e.target.value)}
          >
            <option value="">Cargar a mano...</option>
            {PROCESADORES_CONOCIDOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.soportado ? "" : " (sin detalle de ítems)"}
              </option>
            ))}
          </Select>
        </CampoFormulario>
      )}

      <CampoFormulario label="Nombre" htmlFor="proveedor-nombre">
        <Input
          id="proveedor-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Scanntech"
          autoFocus
        />
      </CampoFormulario>

      <CampoFormulario label="URL de consulta" htmlFor="proveedor-url">
        <Input
          id="proveedor-url"
          value={urlConsulta}
          onChange={(e) => setUrlConsulta(e.target.value)}
          placeholder="https://..."
        />
        <p className="text-[11.5px] text-muted-foreground">
          La comparten todos los comercios de este proveedor.
        </p>
      </CampoFormulario>

      <CampoFormulario label="Formato" htmlFor="proveedor-formato">
        <Select
          id="proveedor-formato"
          value={formato}
          onChange={(e) => setFormato(e.target.value as FormatoProveedorCfe)}
        >
          {PROCESADORES_CONOCIDOS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
              {p.soportado ? "" : " (sin detalle de ítems)"}
            </option>
          ))}
          <option value="otro">Otro / desconocido (sin detalle de ítems)</option>
        </Select>
        <p className="text-[11.5px] text-muted-foreground">
          Cómo pedirle el detalle a este proveedor — elige la implementación
          que usa la app al consultar un comprobante.
        </p>
      </CampoFormulario>
    </DialogFormulario>
  );
}
