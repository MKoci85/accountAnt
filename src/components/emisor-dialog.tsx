"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import {
  borrarAliasEmisor,
  crearEmisor,
  editarEmisor,
  listarAliasEmisor,
} from "@/app/actions/catalogos";
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

      {emisorExistente && <AliasDelComercio emisorId={emisorExistente.id} />}
    </DialogFormulario>
  );
}

/**
 * Los textos de estado de cuenta que caen en este comercio. Quitar uno es
 * como se deshace un comercio mal elegido al importar: el próximo estado de
 * cuenta con ese texto vuelve a dejarlo para elegir.
 */
function AliasDelComercio({ emisorId }: { emisorId: number }) {
  const [alias, setAlias] = useState<{ id: number; alias: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarAliasEmisor(emisorId).then((filas) => {
      if (vigente) setAlias(filas);
    });
    return () => {
      vigente = false;
    };
  }, [emisorId]);

  if (!alias?.length) return null;

  return (
    <CampoFormulario label="Nombres en estados de cuenta">
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border/60">
        {alias.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="min-w-0 truncate text-[12.5px]">{a.alias}</span>
            <button
              type="button"
              aria-label={`Quitar el alias ${a.alias}`}
              title="Quitar: el próximo estado de cuenta con este texto vuelve a preguntar el comercio"
              onClick={async () => {
                setError(null);
                try {
                  await borrarAliasEmisor(a.id);
                  setAlias((prev) => prev?.filter((x) => x.id !== a.id) ?? null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "No se pudo quitar el alias");
                }
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        Las líneas del estado de cuenta con estos textos se cargan a este comercio. Quitar
        uno es inmediato.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </CampoFormulario>
  );
}
