"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import { crearItemCatalogo, editarItemCatalogo } from "@/app/actions/catalogos";
import type { categorias } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;

export type ItemCatalogoConCategoria = {
  id: number;
  nombre: string;
  marca: string | null;
  tamano: string | null;
  descripcion: string | null;
  categoriaId: number;
  categoriaNombre: string;
};

export type NuevoItemDraft = {
  nombre: string;
  marca: string;
  tamano: string;
  descripcion: string;
  categoriaId: number | "";
};

export const draftItemVacio: NuevoItemDraft = {
  nombre: "",
  marca: "",
  tamano: "",
  descripcion: "",
  categoriaId: "",
};

export function draftDesdeItem(item: ItemCatalogoConCategoria): NuevoItemDraft {
  return {
    nombre: item.nombre,
    marca: item.marca ?? "",
    tamano: item.tamano ?? "",
    descripcion: item.descripcion ?? "",
    categoriaId: item.categoriaId,
  };
}

export function NuevoItemDialog({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  categorias,
  itemExistenteId,
  onCategoriaFaltante,
  onCreado,
  onEditado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: NuevoItemDraft;
  onDraftChange: (draft: NuevoItemDraft) => void;
  categorias: Categoria[];
  itemExistenteId?: number | null;
  onCategoriaFaltante: () => void;
  onCreado: (item: ItemCatalogoConCategoria) => void;
  onEditado?: (item: ItemCatalogoConCategoria) => void;
}) {
  const modoEdicion = itemExistenteId != null;
  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo guardar el ítem"
  );

  function handleSubmit() {
    if (draft.categoriaId === "") {
      setError("Elegí una categoría");
      return;
    }
    const categoriaId = draft.categoriaId;
    enviar(async () => {
      const categoria = categorias.find((c) => c.id === categoriaId);
      const datos = {
        nombre: draft.nombre,
        marca: draft.marca,
        tamano: draft.tamano,
        descripcion: draft.descripcion,
        categoriaId,
      };
      if (modoEdicion && itemExistenteId != null) {
        const item = await editarItemCatalogo(itemExistenteId, datos);
        onEditado?.({ ...item, categoriaNombre: categoria?.nombre ?? "" });
      } else {
        const item = await crearItemCatalogo(datos);
        onCreado({ ...item, categoriaNombre: categoria?.nombre ?? "" });
      }
      onOpenChange(false);
    });
  }

  return (
    <DialogFormulario
      open={open}
      onOpenChange={onOpenChange}
      titulo={modoEdicion ? "Editar ítem de catálogo" : "Nuevo ítem de catálogo"}
      etiquetaGuardar={modoEdicion ? "Guardar cambios" : "Crear ítem"}
      puedeGuardar={!!draft.nombre.trim()}
      isPending={isPending}
      error={error}
      onGuardar={handleSubmit}
    >
      <CampoFormulario label="Nombre" htmlFor="item-nombre">
        <Input
          id="item-nombre"
          value={draft.nombre}
          onChange={(e) => onDraftChange({ ...draft, nombre: e.target.value })}
          placeholder="Ej: Coca-Cola Regular"
          autoFocus
        />
      </CampoFormulario>

      <div className="grid grid-cols-2 gap-2.5">
        <CampoFormulario label="Marca" htmlFor="item-marca">
          <Input
            id="item-marca"
            value={draft.marca}
            onChange={(e) => onDraftChange({ ...draft, marca: e.target.value })}
            placeholder="Opcional"
          />
        </CampoFormulario>
        <CampoFormulario label="Peso/Tamaño" htmlFor="item-tamano">
          <Input
            id="item-tamano"
            value={draft.tamano}
            onChange={(e) => onDraftChange({ ...draft, tamano: e.target.value })}
            placeholder="Opcional, ej: 1.5L"
          />
        </CampoFormulario>
      </div>

      <CampoFormulario label="Descripción (opcional)" htmlFor="item-descripcion">
        <textarea
          id="item-descripcion"
          value={draft.descripcion}
          onChange={(e) =>
            onDraftChange({ ...draft, descripcion: e.target.value })
          }
          placeholder="Para identificar variantes o buscarlo por otros términos"
          rows={2}
          className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </CampoFormulario>

      <CampoFormulario
        label="Categoría por defecto"
        htmlFor="item-categoria"
        accion={
          <button
            type="button"
            onClick={onCategoriaFaltante}
            className="text-xs font-medium text-primary hover:underline"
          >
            + Crear categoría
          </button>
        }
      >
        <Select
          id="item-categoria"
          value={draft.categoriaId}
          onChange={(e) =>
            onDraftChange({
              ...draft,
              categoriaId: e.target.value ? Number(e.target.value) : "",
            })
          }
          className="h-8"
        >
          <option value="">Elegir categoría...</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Select>
      </CampoFormulario>
    </DialogFormulario>
  );
}
