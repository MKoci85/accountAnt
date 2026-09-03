"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ImageUp, Sparkles, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { interpretarTicket, type ResultadoTicketIA } from "@/app/actions/cfe";
import type { ProveedorIA } from "@/lib/proveedores-ia";
import { EsperandoIA, BloqueoIA } from "@/components/esperando-ia";
import { capturarVideo, prepararImagen, type ImagenParaIA } from "@/lib/subidas";

export function LectorTicketIA({
  proveedoresIA,
  proveedorActivoIA,
  onResuelto,
}: {
  proveedoresIA: { id: ProveedorIA; nombre: string; modelo: string }[];
  proveedorActivoIA: ProveedorIA;
  onResuelto: (ticket: ResultadoTicketIA) => void;
}) {
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [proveedorIA, setProveedorIA] = useState<ProveedorIA>(
    proveedoresIA.some((p) => p.id === proveedorActivoIA)
      ? proveedorActivoIA
      : (proveedoresIA[0]?.id ?? proveedorActivoIA),
  );

  const [camaraActiva, setCamaraActiva] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function detenerCamara() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamaraActiva(false);
  }

  useEffect(() => {
    if (!camaraActiva) return;

    let cancelado = false;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.play();
      })
      .catch((e) => {
        if (cancelado) return;
        setError(
          e instanceof Error ? e.message : "No se pudo acceder a la cámara",
        );
        setCamaraActiva(false);
      });

    return () => {
      cancelado = true;
      detenerCamara();
    };
  }, [camaraActiva]);

  async function analizar(obtenerImagen: () => Promise<ImagenParaIA>) {
    setError(null);
    setResumen(null);
    setAnalizando(true);
    try {
      const r = await interpretarTicket(
        { tipo: "imagen", ...(await obtenerImagen()) },
        proveedorIA,
      );
      if (!r.ok || !r.ticket) {
        setError(r.error ?? "No se pudo leer el ticket");
        return;
      }
      setResumen(
        `${r.ticket.items.length} ${r.ticket.items.length === 1 ? "ítem" : "ítems"} cargados${
          r.ticket.comercio ? ` · ${r.ticket.comercio}` : ""
        }`,
      );
      onResuelto(r.ticket);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la foto");
    } finally {
      setAnalizando(false);
    }
  }

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    analizar(() => prepararImagen(file));
  }

  function handleCapturar() {
    const video = videoRef.current;
    if (!video || video.readyState < video.HAVE_CURRENT_DATA) return;
    const imagen = capturarVideo(video);
    detenerCamara();
    analizar(async () => imagen);
  }

  if (!proveedoresIA.length) {
    return (
      <Card className="px-5 py-4.5">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Ticket sin QR
        </div>
        <p className="text-[12px] text-muted-foreground">
          Para leer la foto de un ticket hace falta una API key de IA.{" "}
          <Link href="/ajustes" className="font-medium text-primary hover:underline">
            Configurar
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card className="relative px-5 py-4.5">
      {analizando && <BloqueoIA texto="Leyendo el ticket…" />}
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        Ticket sin QR
      </div>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Foto de un ticket o nota de pedido: la IA saca el detalle y completa las
        líneas de abajo para que las revises.
      </p>

      {proveedoresIA.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="proveedor-ticket" className="text-[12px] text-muted-foreground">
            Analizar con
          </label>
          <Select
            id="proveedor-ticket"
            value={proveedorIA}
            disabled={analizando}
            onChange={(e) => setProveedorIA(e.target.value as ProveedorIA)}
            className="h-8 w-auto text-[12.5px]"
          >
            {proveedoresIA.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.id === proveedorActivoIA ? " (predeterminado)" : ""}
              </option>
            ))}
          </Select>
        </div>
      )}

      {analizando ? (
        <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-3 py-6 text-center">
          <div className="text-[13px] font-medium text-muted-foreground">
            <EsperandoIA texto="Leyendo..." />
          </div>
        </div>
      ) : camaraActiva ? (
        <div className="flex flex-col gap-2">
          <div className="relative overflow-hidden rounded-lg border border-input bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="max-h-[55vh] w-full object-contain"
            />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="absolute right-2 top-2 h-7 w-7"
              onClick={detenerCamara}
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="absolute inset-x-0 bottom-0 bg-black/50 px-3 py-1.5 text-center text-[12px] text-white">
              Encuadrá el ticket entero, derecho y sin sombras
            </div>
          </div>
          <Button type="button" className="w-full" onClick={handleCapturar}>
            <Camera className="h-4 w-4" />
            Sacar la foto
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setCamaraActiva(true);
            }}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-3 py-6 text-center hover:bg-muted/60"
          >
            <Camera className="h-5 w-5 text-muted-foreground" />
            <div className="text-[13px] font-medium text-muted-foreground">
              Sacar foto
            </div>
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-3 py-6 text-center hover:bg-muted/60"
          >
            <ImageUp className="h-5 w-5 text-muted-foreground" />
            <div className="text-[13px] font-medium text-muted-foreground">
              Subir foto
            </div>
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFoto}
      />

      <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          La foto se manda a tu proveedor de IA tal cual: en una imagen no se
          puede ocultar nada. Recortá lo que no quieras enviar.
        </p>
      </div>

      {error && <p className="mt-2.5 text-xs text-destructive">{error}</p>}
      {resumen && <p className="mt-2.5 text-xs text-primary">{resumen}</p>}
    </Card>
  );
}
