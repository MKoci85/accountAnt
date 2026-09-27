"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Enciende la cámara trasera mientras esté activa y la apaga al desactivarla
 * o al desmontar el componente, incluso si el permiso llega después de que el
 * usuario ya cerró la vista. Pide 1920×1080 porque el default ronda 640×480,
 * donde los precios de un ticket no se leen.
 * @param alReproducir se llama con el video ya reproduciendo; lo que devuelva
 * se ejecuta al apagar la cámara (para cortar un loop de lectura, por ejemplo).
 */
export function useCamara(
  alReproducir?: (video: HTMLVideoElement) => void | (() => void)
) {
  const [activa, setActiva] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const alReproducirRef = useRef(alReproducir);

  useEffect(() => {
    alReproducirRef.current = alReproducir;
  });

  useEffect(() => {
    if (!activa) return;

    let cancelado = false;
    let stream: MediaStream | null = null;
    let limpiar: void | (() => void);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((obtenido) => {
        if (cancelado) {
          obtenido.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = obtenido;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = obtenido;
        video.play();
        limpiar = alReproducirRef.current?.(video);
      })
      .catch((e) => {
        if (cancelado) return;
        setError(
          e instanceof Error ? e.message : "No se pudo acceder a la cámara"
        );
        setActiva(false);
      });

    return () => {
      cancelado = true;
      limpiar?.();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [activa]);

  const encender = useCallback(() => {
    setError(null);
    setActiva(true);
  }, []);
  const apagar = useCallback(() => setActiva(false), []);

  return { activa, encender, apagar, error, videoRef };
}
