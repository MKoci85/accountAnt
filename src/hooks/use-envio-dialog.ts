"use client";

import { useState, useTransition } from "react";

/**
 * Maneja el ciclo de guardado de un diálogo: estado pending, mensaje de
 * error y ejecución de la operación.
 * @param mensajeFallback mensaje a mostrar si el error no es una `Error`
 */
export function useEnvioDialog(mensajeFallback: string) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function enviar(operacion: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await operacion();
      } catch (e) {
        setError(e instanceof Error ? e.message : mensajeFallback);
      }
    });
  }

  return { error, setError, isPending, enviar };
}
