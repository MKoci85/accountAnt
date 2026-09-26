"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { CampoFormulario } from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import {
  combinarItemsCatalogo,
  descartarItemsSimilares,
} from "@/app/actions/catalogos";
import {
  describirPresentacion,
  parsearPresentacion,
  separarPresentacion,
} from "@/lib/duplicados";
import type { ItemCatalogoConCategoria } from "@/components/nuevo-item-dialog";

function presentacionDe(item: ItemCatalogoConCategoria) {
  const presentacion =
    parsearPresentacion(item.tamano) ?? separarPresentacion(item.nombre).presentacion;
  return presentacion ? describirPresentacion(presentacion) : null;
}

function textoCompras(n: number) {
  if (n === 0) return "sin compras";
  return n === 1 ? "1 compra" : `${n} compras`;
}

function masUsado(
  grupo: ItemCatalogoConCategoria[],
  compras: Record<number, number>
) {
  return [...grupo].sort(
    (a, b) => (compras[b.id] ?? 0) - (compras[a.id] ?? 0) || a.id - b.id
  )[0];
}

function camposDesde(
  conservado: ItemCatalogoConCategoria,
  grupo: ItemCatalogoConCategoria[]
) {
  return {
    nombre: conservado.nombre,
    marca: conservado.marca ?? grupo.find((i) => i.marca)?.marca ?? "",
    tamano: conservado.tamano ?? grupo.find((i) => i.tamano)?.tamano ?? "",
  };
}

function GrupoSimilares({
  grupo,
  comprasPorItem,
  onCombinado,
  onDescartado,
}: {
  grupo: ItemCatalogoConCategoria[];
  comprasPorItem: Record<number, number>;
  onCombinado: (
    item: ItemCatalogoConCategoria,
    absorbidosIds: number[],
    descartados: string[]
  ) => void;
  onDescartado: (ids: number[]) => void;
}) {
  const [conservarId, setConservarId] = useState(
    () => masUsado(grupo, comprasPorItem).id
  );
  const [seleccionados, setSeleccionados] = useState(() =>
    grupo.map((i) => i.id)
  );
  const [campos, setCampos] = useState(() =>
    camposDesde(masUsado(grupo, comprasPorItem), grupo)
  );
  const { error, isPending, enviar } = useEnvioDialog(
    "No se pudo completar la operación"
  );

  const conservado = grupo.find((i) => i.id === conservarId)!;
  const absorbidos = grupo.filter(
    (i) => i.id !== conservarId && seleccionados.includes(i.id)
  );
  const comprasQueSeMueven = absorbidos.reduce(
    (acc, i) => acc + (comprasPorItem[i.id] ?? 0),
    0
  );

  function elegirConservado(id: number) {
    setConservarId(id);
    setSeleccionados((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setCampos(camposDesde(grupo.find((i) => i.id === id)!, grupo));
  }

  function alternar(id: number) {
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function combinar() {
    enviar(async () => {
      const resultado = await combinarItemsCatalogo({
        conservarId,
        absorberIds: absorbidos.map((i) => i.id),
        ...campos,
      });
      onCombinado(
        resultado.item,
        absorbidos.map((i) => i.id),
        resultado.descartados
      );
    });
  }

  function descartar() {
    enviar(async () => {
      await descartarItemsSimilares(seleccionados);
      onDescartado(seleccionados);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="divide-y rounded-lg border">
        {grupo.map((item) => {
          const presentacion = presentacionDe(item);
          const esConservado = item.id === conservarId;
          return (
            <div key={item.id} className="flex items-start gap-3 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 disabled:opacity-40"
                checked={seleccionados.includes(item.id)}
                disabled={esConservado || isPending}
                onChange={() => alternar(item.id)}
                aria-label={`Incluir ${item.nombre}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{item.nombre}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {[item.marca, item.tamano, presentacion && `(${presentacion})`]
                    .filter(Boolean)
                    .join(" · ") || "Sin marca ni tamaño"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{item.categoriaNombre}</Badge>
                  <span className="text-[11.5px] text-muted-foreground">
                    {textoCompras(comprasPorItem[item.id] ?? 0)}
                  </span>
                </div>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="conservar"
                  className="h-3.5 w-3.5"
                  checked={esConservado}
                  disabled={isPending}
                  onChange={() => elegirConservado(item.id)}
                />
                Conservar
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <CampoFormulario label="Nombre que queda" htmlFor="similares-nombre">
          <Input
            id="similares-nombre"
            value={campos.nombre}
            onChange={(e) => setCampos({ ...campos, nombre: e.target.value })}
          />
        </CampoFormulario>
        <div className="grid grid-cols-2 gap-2.5">
          <CampoFormulario label="Marca" htmlFor="similares-marca">
            <Input
              id="similares-marca"
              value={campos.marca}
              onChange={(e) => setCampos({ ...campos, marca: e.target.value })}
            />
          </CampoFormulario>
          <CampoFormulario label="Peso/Tamaño" htmlFor="similares-tamano">
            <Input
              id="similares-tamano"
              value={campos.tamano}
              onChange={(e) => setCampos({ ...campos, tamano: e.target.value })}
            />
          </CampoFormulario>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {absorbidos.length === 0
          ? "Marcá al menos otro ítem para combinarlo con el que se conserva."
          : `Se conserva "${conservado.nombre}" (${conservado.categoriaNombre}). ${
              absorbidos.length === 1
                ? "El otro ítem se borra"
                : `Los otros ${absorbidos.length} ítems se borran`
            } y ${
              comprasQueSeMueven === 1
                ? "su compra pasa"
                : `sus ${comprasQueSeMueven} compras pasan`
            } al que queda. No se puede deshacer.`}
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={seleccionados.length < 2 || isPending}
          onClick={descartar}
        >
          No son el mismo
        </Button>
        <Button
          disabled={absorbidos.length === 0 || !campos.nombre.trim() || isPending}
          onClick={combinar}
        >
          {isPending ? "Guardando..." : `Combinar ${absorbidos.length + 1} ítems`}
        </Button>
      </div>
    </div>
  );
}

export function ItemsSimilaresDialog({
  open,
  onOpenChange,
  grupos,
  comprasPorItem,
  onCombinado,
  onDescartado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grupos: ItemCatalogoConCategoria[][];
  comprasPorItem: Record<number, number>;
  onCombinado: (
    item: ItemCatalogoConCategoria,
    absorbidosIds: number[],
    descartados: string[]
  ) => void;
  onDescartado: (ids: number[]) => void;
}) {
  const [indice, setIndice] = useState(0);
  const actual = Math.min(indice, Math.max(grupos.length - 1, 0));
  const grupo = grupos[actual];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ítems similares</DialogTitle>
          <DialogDescription>
            Ítems que parecen el mismo producto por nombre, marca y
            presentación. Elegí cuál se conserva; los demás se borran y sus
            compras pasan a ese.
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
            <GrupoSimilares
              key={grupo.map((i) => i.id).join("-")}
              grupo={grupo}
              comprasPorItem={comprasPorItem}
              onCombinado={onCombinado}
              onDescartado={onDescartado}
            />
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No quedan ítems similares por revisar.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
