"use client";

import { useEffect, useId, useState } from "react";
import { ComboboxBusqueda } from "@/components/combobox-busqueda";
import { buscarItemsCatalogo } from "@/app/actions/catalogos";
import { useDebounced } from "@/hooks/use-debounced";
import type { ItemCatalogoConCategoria } from "@/components/nuevo-item-dialog";

export function BuscadorItemLinea({
  onElegido,
  onCrearNuevo,
}: {
  onElegido: (item: ItemCatalogoConCategoria) => void;
  onCrearNuevo: () => void;
}) {
  const [query, setQuery] = useState("");
  const [resultadosRaw, setResultadosRaw] = useState<ItemCatalogoConCategoria[]>([]);
  const debouncedQuery = useDebounced(query);
  const id = useId();

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) return;
    let cancelado = false;
    buscarItemsCatalogo(q).then((r) => {
      if (!cancelado) setResultadosRaw(r);
    });
    return () => {
      cancelado = true;
    };
  }, [debouncedQuery]);

  const resultados = debouncedQuery.trim() ? resultadosRaw : [];

  return (
    <ComboboxBusqueda
      id={`item-linea-${id}`}
      query={query}
      onQueryChange={setQuery}
      resultados={resultados}
      claveOpcion={(item) => item.id}
      etiquetaOpcion={(item) =>
        `${item.nombre}${item.marca ? ` · ${item.marca}` : ""}`
      }
      detalleOpcion={(item) => item.categoriaNombre}
      onElegir={onElegido}
      accionFinal={{ etiqueta: "+ Crear ítem nuevo", onElegir: onCrearNuevo }}
      placeholder="Buscar ítem del catálogo..."
      conIcono={false}
      className="mt-1.5 max-w-xs"
      inputClassName="h-7 text-[12px]"
    />
  );
}
