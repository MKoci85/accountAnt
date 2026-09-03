"use client";

import { useEffect, useState } from "react";

/**
 * Devuelve `value` retrasado `delayMs` milisegundos tras su último cambio.
 * @param value valor a debouncear
 * @param delayMs milisegundos de espera (default 250)
 * @returns el último valor de `value` una vez transcurrido `delayMs` sin cambios
 */
export function useDebounced(value: string, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
