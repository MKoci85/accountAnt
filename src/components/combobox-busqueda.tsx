"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function ComboboxBusqueda<T>({
  id,
  query,
  onQueryChange,
  resultados,
  claveOpcion,
  etiquetaOpcion,
  detalleOpcion,
  onElegir,
  accionFinal,
  placeholder,
  suspendido = false,
  conIcono = true,
  inputRef,
  className,
  inputClassName,
  panelClassName,
}: {
  id: string;
  query: string;
  onQueryChange: (valor: string) => void;
  resultados: T[];
  claveOpcion: (opcion: T) => string | number;
  etiquetaOpcion: (opcion: T) => ReactNode;
  detalleOpcion?: (opcion: T) => ReactNode;
  onElegir: (opcion: T) => void;
  accionFinal: { etiqueta: ReactNode; onElegir: () => void };
  placeholder: string;
  suspendido?: boolean;
  conIcono?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  inputClassName?: string;
  panelClassName?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [indiceActivo, setIndiceActivo] = useState(0);

  const hayQuery = query.trim().length > 0;
  const panelVisible = abierto && hayQuery && !suspendido;
  const totalOpciones = resultados.length + 1;

  const huellaResultados = resultados.map(claveOpcion).join(",");
  const [huellaPrevia, setHuellaPrevia] = useState(huellaResultados);
  if (huellaPrevia !== huellaResultados) {
    setHuellaPrevia(huellaResultados);
    setIndiceActivo(0);
  }

  function elegirIndice(indice: number) {
    setAbierto(false);
    if (indice >= resultados.length) {
      accionFinal.onElegir();
      return;
    }
    const opcion = resultados[indice];
    if (opcion !== undefined) onElegir(opcion);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setAbierto(false);
      return;
    }
    if (!panelVisible) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAbierto(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndiceActivo((i) => (i + 1) % totalOpciones);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndiceActivo((i) => (i - 1 + totalOpciones) % totalOpciones);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      elegirIndice(indiceActivo);
    }
  }

  const idPanel = `${id}-panel`;
  const idOpcion = (indice: number) => `${id}-opcion-${indice}`;

  return (
    <div className={`relative ${className ?? ""}`}>
      {conIcono && (
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        id={id}
        role="combobox"
        aria-expanded={panelVisible}
        aria-controls={idPanel}
        aria-autocomplete="list"
        aria-activedescendant={
          panelVisible ? idOpcion(indiceActivo) : undefined
        }
        ref={inputRef}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
      />
      {panelVisible && (
        <div
          id={idPanel}
          role="listbox"
          className={`absolute inset-x-0 z-10 overflow-hidden rounded-lg border bg-popover shadow-lg ${
            panelClassName ?? "top-full mt-1"
          }`}
        >
          {resultados.map((opcion, indice) => (
            <div
              key={claveOpcion(opcion)}
              id={idOpcion(indice)}
              role="option"
              aria-selected={indice === indiceActivo}
              onMouseDown={() => elegirIndice(indice)}
              onMouseEnter={() => setIndiceActivo(indice)}
              className={`flex cursor-pointer items-center justify-between border-b px-3 py-2 text-left text-[13px] ${
                indice === indiceActivo ? "bg-muted/60" : ""
              }`}
            >
              <span>{etiquetaOpcion(opcion)}</span>
              {detalleOpcion && (
                <span className="text-muted-foreground">
                  {detalleOpcion(opcion)}
                </span>
              )}
            </div>
          ))}
          <div
            id={idOpcion(resultados.length)}
            role="option"
            aria-selected={indiceActivo === resultados.length}
            onMouseDown={() => elegirIndice(resultados.length)}
            onMouseEnter={() => setIndiceActivo(resultados.length)}
            className={`cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-primary ${
              indiceActivo === resultados.length ? "bg-muted/60" : ""
            }`}
          >
            {accionFinal.etiqueta}
          </div>
        </div>
      )}
    </div>
  );
}
