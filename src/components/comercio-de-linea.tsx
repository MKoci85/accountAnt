"use client";

import { useState } from "react";
import { ComboboxBusqueda } from "@/components/combobox-busqueda";

export type ComercioElegido = { id: number | null; nombre: string };

type EmisorBuscable = { id: number; nombre: string; ruc: string | null };

/**
 * El comercio al que va una línea del estado de cuenta, editable con el mismo
 * buscador del formulario de gastos. Uno que todavía no existe se marca como
 * nuevo, que es lo que hay que mirar: el texto del banco rara vez coincide con
 * el nombre que ya tiene el comercio.
 */
export function ComercioDeLinea({
  id,
  comercio,
  emisores,
  onElegir,
}: {
  id: string;
  comercio: ComercioElegido;
  emisores: EmisorBuscable[];
  onElegir: (comercio: ComercioElegido) => void;
}) {
  const [query, setQuery] = useState(comercio.nombre);
  const [editando, setEditando] = useState(false);
  const [previo, setPrevio] = useState(comercio);
  if (previo !== comercio) {
    setPrevio(comercio);
    setQuery(comercio.nombre);
    setEditando(false);
  }

  const texto = query.trim().toLowerCase();
  const resultados =
    editando && texto
      ? emisores
          .filter((e) =>
            [e.nombre, e.ruc].filter(Boolean).join(" ").toLowerCase().includes(texto)
          )
          .slice(0, 8)
      : [];

  return (
    <div
      className="relative flex min-w-0 items-center gap-2"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setQuery(comercio.nombre);
          setEditando(false);
        }
      }}
    >
      <ComboboxBusqueda
        id={id}
        query={query}
        onQueryChange={(valor) => {
          setQuery(valor);
          setEditando(true);
        }}
        resultados={resultados}
        claveOpcion={(e) => e.id}
        etiquetaOpcion={(e) => e.nombre}
        detalleOpcion={(e) => (e.ruc ? `RUC ${e.ruc}` : null)}
        onElegir={(e) => onElegir({ id: e.id, nombre: e.nombre })}
        accionFinal={{
          etiqueta: `+ Crear comercio "${query.trim()}"`,
          onElegir: () => onElegir({ id: null, nombre: query.trim() }),
        }}
        placeholder="Buscar comercio..."
        suspendido={!editando}
        conIcono={false}
        className="w-64 max-w-full"
        inputClassName="h-7 text-[12px]"
        panelClassName="top-8"
      />
      {comercio.id === null && (
        <span
          className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600"
          title="No existe todavía: se crea al importar. Si es un comercio que ya tenés con otro nombre, buscalo acá."
        >
          nuevo
        </span>
      )}
    </div>
  );
}
