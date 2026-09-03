"use client";

import { useEffect } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VistaCamara({
  videoRef,
  indicacion,
  onCerrar,
  accion,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  indicacion: string;
  onCerrar: () => void;
  accion?: { etiqueta: string; onClick: () => void };
}) {
  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function alPresionar(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", alPresionar);

    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener("keydown", alPresionar);
    };
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        className="min-h-0 w-full flex-1 object-contain"
      />
      <Button
        type="button"
        size="icon"
        variant="secondary"
        aria-label="Cerrar la cámara"
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] h-9 w-9"
        onClick={onCerrar}
      >
        <X className="h-4 w-4" />
      </Button>
      <div className="shrink-0 bg-black px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <p className="mb-3 text-center text-[12px] text-white/80">
          {indicacion}
        </p>
        {accion && (
          <Button type="button" className="w-full" onClick={accion.onClick}>
            <Camera className="h-4 w-4" />
            {accion.etiqueta}
          </Button>
        )}
      </div>
    </div>
  );
}
