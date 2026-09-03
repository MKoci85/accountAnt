"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import { Check, Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import { crearCategoria, editarCategoria } from "@/app/actions/catalogos";
import type { categorias } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;

const PALETA_COLORES = [
  "#8fae87",
  "#c99a6b",
  "#7c9bb5",
  "#b58a6a",
  "#a180ab",
  "#d97757",
  "#6ba587",
  "#c2896f",
  "#7f97c9",
  "#b8935f",
  "#9c7fb0",
  "#8a9a6b",
];

export function NuevaCategoriaDialog({
  open,
  onOpenChange,
  nombreInicial = "",
  categoriaExistente,
  onCreada,
  onEditada,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nombreInicial?: string;
  categoriaExistente?: Categoria | null;
  onCreada: (categoria: Categoria) => void;
  onEditada?: (categoria: Categoria) => void;
}) {
  const modoEdicion = !!categoriaExistente;
  const [nombre, setNombre] = useState(categoriaExistente?.nombre ?? nombreInicial);
  const [color, setColor] = useState(categoriaExistente?.color ?? PALETA_COLORES[0]);
  const [descripcion, setDescripcion] = useState(categoriaExistente?.descripcion ?? "");
  const [esServicio, setEsServicio] = useState(
    categoriaExistente?.esServicio ?? false
  );
  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo guardar la categoría"
  );
  const colorNativoRef = useRef<HTMLInputElement | null>(null);

  const colorEsHexValido = /^#[0-9a-f]{6}$/i.test(color);

  function handleOpenChange(next: boolean) {
    if (next) {
      setNombre(categoriaExistente?.nombre ?? nombreInicial);
      setColor(categoriaExistente?.color ?? PALETA_COLORES[0]);
      setDescripcion(categoriaExistente?.descripcion ?? "");
      setEsServicio(categoriaExistente?.esServicio ?? false);
      setError(null);
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    enviar(async () => {
      if (categoriaExistente) {
        onEditada?.(
          await editarCategoria(categoriaExistente.id, {
            nombre,
            color,
            descripcion,
            esServicio,
          })
        );
      } else {
        onCreada(
          await crearCategoria({ nombre, color, descripcion, esServicio })
        );
      }
      onOpenChange(false);
    });
  }

  return (
    <DialogFormulario
      open={open}
      onOpenChange={handleOpenChange}
      titulo={modoEdicion ? "Editar categoría" : "Nueva categoría"}
      etiquetaGuardar={modoEdicion ? "Guardar cambios" : "Crear categoría"}
      puedeGuardar={!!nombre.trim()}
      isPending={isPending}
      error={error}
      onGuardar={handleSubmit}
    >
      <CampoFormulario label="Nombre" htmlFor="categoria-nombre">
        <Input
          id="categoria-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Golosinas"
          autoFocus
        />
      </CampoFormulario>

      <CampoFormulario label="Color · elegí uno rápido o abrí el selector completo">
        <div className="flex flex-wrap gap-2">
          {PALETA_COLORES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              aria-label={swatch}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-foreground/10 transition-transform hover:scale-105",
                color.toLowerCase() === swatch.toLowerCase() &&
                  "ring-2 ring-offset-2 ring-offset-card ring-ring"
              )}
              style={{ backgroundColor: swatch }}
            >
              {color.toLowerCase() === swatch.toLowerCase() && (
                <Check className="h-4 w-4 text-white drop-shadow-sm" />
              )}
            </button>
          ))}
        </div>
        <div className="relative mt-1">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center justify-center"
            style={{ color: colorEsHexValido ? color : undefined }}
          >
            {colorEsHexValido ? (
              <span
                className="block h-4 w-4 rounded-full ring-1 ring-foreground/15"
                style={{ backgroundColor: color }}
              />
            ) : (
              <Pipette className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
          <Input
            id="categoria-color"
            value={color}
            readOnly
            onClick={() => colorNativoRef.current?.click()}
            placeholder="Ej: #d97757"
            className="cursor-pointer pl-9 text-[13px] caret-transparent"
          />
          <input
            ref={colorNativoRef}
            type="color"
            value={colorEsHexValido ? color : "#000000"}
            onChange={(e) => setColor(e.target.value)}
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 opacity-0"
            tabIndex={-1}
          />
        </div>
      </CampoFormulario>

      <CampoFormulario
        label="Descripción (opcional)"
        htmlFor="categoria-descripcion"
      >
        <textarea
          id="categoria-descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Ej: arroz, fideos, aceite — se usa para sugerir esta categoría al escanear un ticket"
          rows={2}
          className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </CampoFormulario>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 px-3 py-2.5 text-[13px]">
        <input
          type="checkbox"
          checked={esServicio}
          onChange={(e) => setEsServicio(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-primary"
        />
        <span>
          Es un servicio (no lleva unidad ni cantidad)
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
            Para consultas médicas, UTE, alquiler o suscripciones: en el
            formulario de gasto la línea pide solo nombre e importe, y no se
            compara contra precios anteriores.
          </span>
        </span>
      </label>
    </DialogFormulario>
  );
}
