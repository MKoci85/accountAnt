"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import jsQR from "jsqr";
import { ScanLine, CheckCircle2, AlertTriangle, Lock, Camera, X, ImageUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { consultarCFE, type ResultadoConsultaCFE } from "@/app/actions/cfe";
import { guardarProveedorEmisor } from "@/app/actions/catalogos";
import {
  PROCESADORES_CONOCIDOS,
  buscarProcesador,
  type FormatoProveedorCfe,
} from "@/lib/procesadores";
import { formatearMonto } from "@/lib/formato";
import type { categorias, emisores } from "@/db/schema";
import type { ItemCatalogoConCategoria } from "@/components/nuevo-item-dialog";

type Emisor = typeof emisores.$inferSelect;
type Categoria = typeof categorias.$inferSelect;

export type LineaDesdeTicket = {
  nombreTicket: string;
  precio: number;
  tamanoTicket: string | null;
  unidadesTicket: number | null;
  pesoTicket: number | null;
  precioPorKiloTicket: number | null;
  itemCatalogo: ItemCatalogoConCategoria | null;
  categoriaSugerida: Categoria | null;
  bloqueada: boolean;
};

export function EscanerComprobante({
  onResuelto,
}: {
  onResuelto: (datos: {
    emisor: Emisor;
    tipoCfe: string;
    serie: string;
    numero: string;
    fecha: string;
    lineas: LineaDesdeTicket[];
    total: number | null;
    avisoMoneda: string | null;
  }) => void;
}) {
  const [qrTexto, setQrTexto] = useState("");
  const [resultado, setResultado] = useState<ResultadoConsultaCFE | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [procesadorElegido, setProcesadorElegido] = useState("");
  const [nombreProcesador, setNombreProcesador] = useState("");
  const [urlProcesador, setUrlProcesador] = useState("");
  const [guardandoProcesador, startGuardadoProcesador] = useTransition();

  const procesadorSeleccionado = buscarProcesador(procesadorElegido);

  function handleElegirProcesador(id: string) {
    setProcesadorElegido(id);
    const conocido = buscarProcesador(id);
    if (conocido) {
      setNombreProcesador(conocido.nombre);
      setUrlProcesador(conocido.urlEjemplo ?? "");
    } else {
      setNombreProcesador("");
      setUrlProcesador("");
    }
  }

  const [camaraActiva, setCamaraActiva] = useState(false);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const [analizandoFoto, setAnalizandoFoto] = useState(false);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const fotoInputRef = useRef<HTMLInputElement | null>(null);

  function detenerCamara() {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
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

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");

        const tick = () => {
          if (canvas && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "attemptBoth",
            });
            if (code?.data) {
              detenerCamara();
              consultar(code.data);
              return;
            }
          }
          frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
      })
      .catch((e) => {
        if (cancelado) return;
        setErrorCamara(
          e instanceof Error ? e.message : "No se pudo acceder a la cámara"
        );
        setCamaraActiva(false);
      });

    return () => {
      cancelado = true;
      detenerCamara();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camaraActiva]);

  function aplicarResultado(resultado: ResultadoConsultaCFE) {
    setResultado(resultado);
    const [dia, mes, anio] = resultado.datosQR.fecha.split("/");
    onResuelto({
      emisor: resultado.emisor,
      tipoCfe: resultado.datosQR.tipoCfe,
      serie: resultado.datosQR.serie,
      numero: resultado.datosQR.numero,
      fecha: `${anio}-${mes}-${dia}`,
      total: resultado.total,
      avisoMoneda: resultado.avisoMoneda,
      lineas: resultado.items.map((item) => ({
        nombreTicket: item.nombreTicket,
        precio: item.precio,
        tamanoTicket: item.tamanoTicket,
        unidadesTicket: item.unidadesTicket,
        pesoTicket: item.pesoTicket,
        precioPorKiloTicket: item.precioPorKiloTicket,
        itemCatalogo: item.itemCatalogo,
        categoriaSugerida: item.categoriaSugerida,
        bloqueada: item.itemCatalogo !== null,
      })),
    });
  }

  function consultar(texto: string) {
    setQrTexto(texto);
    setError(null);
    startTransition(async () => {
      try {
        const resultado = await consultarCFE(texto.trim());
        aplicarResultado(resultado);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo leer el QR");
      }
    });
  }

  function handleConsultar() {
    if (!qrTexto.trim()) return;
    consultar(qrTexto);
  }

  async function handleSubirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setErrorFoto(null);
    setAnalizandoFoto(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = canvasRef.current ?? document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo analizar la imagen");

      const code = buscarQREnBitmap(bitmap, canvas, ctx);
      bitmap.close();

      if (!code?.data) {
        setErrorFoto(
          "No se encontró ningún QR en la foto. Probá con otra imagen más nítida, o si el ticket no tiene QR, cargalo desde \"Importar\" con análisis por IA."
        );
        return;
      }
      consultar(code.data);
    } catch (err) {
      setErrorFoto(
        err instanceof Error ? err.message : "No se pudo analizar la imagen"
      );
    } finally {
      setAnalizandoFoto(false);
    }
  }

  function buscarQREnBitmap(
    bitmap: ImageBitmap,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
  ) {
    const ladoMax = Math.max(bitmap.width, bitmap.height);
    const maxLado = 1600;
    const escalas = [1, 0.5, 0.25]
      .map((escala) => Math.min(escala, maxLado / ladoMax))
      .filter((factor, i, arr) => arr.indexOf(factor) === i);

    for (const factor of escalas) {
      const ancho = Math.max(1, Math.round(bitmap.width * factor));
      const alto = Math.max(1, Math.round(bitmap.height * factor));
      canvas.width = ancho;
      canvas.height = alto;
      ctx.drawImage(bitmap, 0, 0, ancho, alto);
      const imageData = ctx.getImageData(0, 0, ancho, alto);

      const code = jsQR(imageData.data, ancho, alto, {
        inversionAttempts: "attemptBoth",
      });
      if (code?.data) return code;
    }

    return null;
  }

  function handleGuardarProcesador() {
    if (!resultado || !nombreProcesador.trim() || !urlProcesador.trim()) return;
    startGuardadoProcesador(async () => {
      try {
        await guardarProveedorEmisor(resultado.emisor.id, {
          nombre: nombreProcesador.trim(),
          urlConsulta: urlProcesador.trim(),
          formato: (procesadorElegido || "otro") as FormatoProveedorCfe,
        });
        const nuevoResultado = await consultarCFE(qrTexto.trim());
        aplicarResultado(nuevoResultado);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "No se pudo guardar el proveedor"
        );
      }
    });
  }

  return (
    <Card className="px-5 py-4.5">
      <div className="mb-3 text-sm font-semibold">Comprobante</div>

      {!resultado && (
        <div className="flex flex-col gap-2.5">
          {camaraActiva ? (
            <div className="relative overflow-hidden rounded-lg border border-input bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
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
                Apuntá al QR del comprobante
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setErrorCamara(null);
                  setCamaraActiva(true);
                }}
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-3 py-5 text-center hover:bg-muted/60"
              >
                <Camera className="h-6 w-6 text-muted-foreground" />
                <div className="text-[13px] font-medium text-muted-foreground">
                  Escanear QR con cámara
                </div>
              </button>
              <button
                type="button"
                onClick={() => fotoInputRef.current?.click()}
                disabled={analizandoFoto}
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-3 py-5 text-center hover:bg-muted/60 disabled:opacity-60"
              >
                <ImageUp className="h-6 w-6 text-muted-foreground" />
                <div className="text-[13px] font-medium text-muted-foreground">
                  {analizandoFoto ? "Buscando QR..." : "Subir foto con QR"}
                </div>
              </button>
              <input
                ref={fotoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleSubirFoto}
              />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
          {errorCamara && (
            <p className="text-xs text-destructive">{errorCamara}</p>
          )}
          {errorFoto && <p className="text-xs text-destructive">{errorFoto}</p>}
          {isPending && (
            <p className="text-xs text-muted-foreground">Consultando comprobante...</p>
          )}

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            o pegar a mano
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              value={qrTexto}
              onChange={(e) => setQrTexto(e.target.value)}
              placeholder="RUC,tipoCFE,serie,numero,monto,fecha,hash"
              className="text-[13px]"
            />
          </div>
          <Button
            size="sm"
            onClick={handleConsultar}
            disabled={!qrTexto.trim() || isPending}
          >
            {isPending ? "Consultando..." : "Consultar comprobante"}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {resultado && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 text-[12.5px]">
            {resultado.dgiValido ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <span className="text-muted-foreground">{resultado.dgiMensaje}</span>
          </div>

          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-[13px]">
            <div className="font-medium">{resultado.emisor.nombre}</div>
            <div className="text-muted-foreground">RUC {resultado.emisor.ruc}</div>
            {resultado.total !== null && (
              <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                {resultado.avisoMoneda ? (
                  <>
                    Total del ticket ({resultado.monedaOriginal}, sin convertir):{" "}
                    {resultado.total}
                  </>
                ) : (
                  <>
                    Total del ticket: {formatearMonto(resultado.total)}
                    {resultado.monedaOriginal && resultado.totalMonedaOriginal !== null && (
                      <Badge variant="outline" className="shrink-0">
                        {resultado.monedaOriginal} {resultado.totalMonedaOriginal}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {resultado.avisoMoneda && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-[12.5px] text-muted-foreground">
                {resultado.avisoMoneda}
              </p>
            </div>
          )}

          {resultado.items.length > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Lock className="h-3 w-3" />
              Los ítems que ya coinciden con el catálogo quedaron bloqueados
              abajo — destildá para editarlos.
            </div>
          )}

          {resultado.errorProveedor && (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
              <p className="text-[12.5px] text-destructive/90">
                {resultado.errorProveedor}. Si conocés el proveedor de CFE de
                este comercio (ej. Scanntech), cargalo para traer el detalle de
                ítems la próxima vez.
              </p>
              <select
                value={procesadorElegido}
                onChange={(e) => handleElegirProcesador(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
              >
                <option value="">Elegí el proveedor...</option>
                {PROCESADORES_CONOCIDOS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.soportado ? "" : " (sin soporte automático)"}
                  </option>
                ))}
                <option value="otro">Otro...</option>
              </select>

              {procesadorElegido === "otro" && (
                <Input
                  value={nombreProcesador}
                  onChange={(e) => setNombreProcesador(e.target.value)}
                  placeholder="Nombre del proveedor"
                  className="h-8 text-[13px]"
                />
              )}

              {procesadorSeleccionado && !procesadorSeleccionado.soportado && (
                <p className="text-[12px] text-muted-foreground">
                  Todavía no se puede traer el detalle de ítems de{" "}
                  {procesadorSeleccionado.nombre} automáticamente. Igual conviene
                  guardarlo: queda como referencia de por qué este comercio no
                  trae detalle.
                </p>
              )}

              <Input
                value={urlProcesador}
                onChange={(e) => setUrlProcesador(e.target.value)}
                placeholder="URL de consulta (ej: https://efactura.scanntech.com/products.eticket.consultaQR/)"
                className="h-8 text-[13px]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleGuardarProcesador}
                disabled={
                  !nombreProcesador.trim() ||
                  !urlProcesador.trim() ||
                  guardandoProcesador
                }
              >
                {guardandoProcesador ? "Guardando..." : "Guardar y reintentar"}
              </Button>
            </div>
          )}

          <button
            type="button"
            className="text-left text-[12px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setResultado(null);
              setQrTexto("");
            }}
          >
            Escanear otro comprobante
          </button>
        </div>
      )}
    </Card>
  );
}
