"use client";

import { desenvolver } from "@/lib/resultado";
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
  buscarProcesador,
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
  const [probarSinMapeo, setProbarSinMapeo] = useState(
    proveedorExistente?.probarSinMapeo ?? false
  );
  const soportado = Boolean(buscarProcesador(formato)?.soportado);
  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo guardar el proveedor"
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setNombre(proveedorExistente?.nombre ?? "");
      setUrlConsulta(proveedorExistente?.urlConsulta ?? "");
      setFormato(proveedorExistente?.formato ?? "otro");
      setProbarSinMapeo(proveedorExistente?.probarSinMapeo ?? false);
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
        ? desenvolver(await editarProveedorCfe(proveedorExistente.id, {
            nombre,
            urlConsulta,
            formato,
            probarSinMapeo: soportado && probarSinMapeo,
          }))
        : desenvolver(await obtenerOCrearProveedorCfe({
            nombre,
            urlConsulta,
            formato,
            probarSinMapeo: soportado && probarSinMapeo,
          }));
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

      <label
        className={`flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2.5 text-[13px] ${soportado ? "cursor-pointer" : "opacity-60"}`}
      >
        <input
          type="checkbox"
          checked={soportado && probarSinMapeo}
          disabled={!soportado}
          onChange={(e) => setProbarSinMapeo(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-primary"
        />
        <span>
          Probar con comercios sin proveedor
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
            {soportado
              ? "Cuando llega un ticket de un comercio que todavía no tiene proveedor de CFE, se busca también acá. Si lo encuentra, trae el detalle y el proveedor queda asignado al comercio."
              : "Sólo para formatos con consulta automática: con éste no hay cómo saber si el comprobante es suyo."}
          </span>
        </span>
      </label>
    </DialogFormulario>
  );
}
