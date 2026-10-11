"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Image as IconoFoto, ImageUp, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  descartarEntrante,
  reintentarEntrante,
  subirFotoEntrante,
  type EntranteListado,
} from "@/app/actions/entrantes";
import { prepararImagen } from "@/lib/subidas";
import { formatearFechaCorta, formatearMonto } from "@/lib/formato";

const ETIQUETA_LECTURA: Record<NonNullable<EntranteListado["lectura"]>, string> = {
  qr: "QR",
  link: "Link leído con IA",
  ticket: "Ticket leído con IA",
};

function detalleItems(entrante: EntranteListado): string {
  if (entrante.cantidadItems === 0) return "sin detalle de ítems";
  const items = `${entrante.cantidadItems} ítem${entrante.cantidadItems === 1 ? "" : "s"}`;
  if (entrante.sinReconocer === 0) return `${items}, todos reconocidos`;
  return `${items}, ${entrante.sinReconocer} sin reconocer`;
}

export function BandejaView({ entrantes }: { entrantes: EntranteListado[] }) {
  const fotoInputRef = useRef<HTMLInputElement | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setMensaje(null);
    setSubiendo(true);
    try {
      const { base64 } = await prepararImagen(file);
      const r = await subirFotoEntrante({ base64 });
      if (!r.ok) setMensaje(r.mensaje);
      else if (r.destino === "gasto") {
        setMensaje(
          `Se guardó solo como gasto: ${r.comercio}, ${formatearMonto(r.total)}. Todo estaba reconocido; quedó marcado para que lo mires en Gastos.`
        );
      } else if (r.estado === "error") {
        setMensaje(
          `La foto quedó en la bandeja, pero no se pudo leer: ${r.error ?? "sin detalle"}`
        );
      }
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo subir la foto");
    } finally {
      setSubiendo(false);
    }
  }

  function ejecutar(id: number, accion: () => Promise<string | null>) {
    setMensaje(null);
    setEnCurso(id);
    startTransition(async () => {
      try {
        setMensaje(await accion());
      } catch (err) {
        setMensaje(err instanceof Error ? err.message : "No se pudo completar");
      } finally {
        setEnCurso(null);
      }
    });
  }

  function handleReintentar(id: number) {
    ejecutar(id, async () => {
      const r = await reintentarEntrante(id);
      return r.ok ? null : (r.error ?? "No se pudo leer el comprobante.");
    });
  }

  function handleDescartar(entrante: EntranteListado) {
    const seguir = window.confirm(
      `¿Descartar el comprobante${entrante.comercio ? ` de ${entrante.comercio}` : ""}? No se carga ningún gasto.`
    );
    if (!seguir) return;
    ejecutar(entrante.id, async () => {
      await descartarEntrante(entrante.id);
      return null;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => fotoInputRef.current?.click()}
          disabled={subiendo}
        >
          <ImageUp className="h-4 w-4" />
          {subiendo ? "Leyendo la foto..." : "Subir foto de un comprobante"}
        </Button>
        <input
          ref={fotoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleSubirFoto}
        />
      </div>

      {mensaje && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-[13px] text-muted-foreground"
        >
          {mensaje}
        </p>
      )}

      {entrantes.length === 0 ? (
        <Card className="px-5 py-8 text-center text-sm text-muted-foreground">
          No hay comprobantes esperando.
        </Card>
      ) : (
        entrantes.map((entrante) => (
          <Card key={entrante.id} className="gap-3 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {entrante.comercio ?? "Comercio sin identificar"}
                  {entrante.lectura && (
                    <Badge variant="secondary">
                      {ETIQUETA_LECTURA[entrante.lectura]}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {entrante.fecha
                    ? formatearFechaCorta(entrante.fecha)
                    : "sin fecha legible"}
                  {entrante.estado === "pendiente" &&
                    ` · ${detalleItems(entrante)}`}
                  {` · recibido el ${formatearFechaCorta(entrante.recibidoEn.slice(0, 10))}`}
                </div>
              </div>
              {entrante.total !== null && (
                <div className="text-[15px] font-medium">
                  {formatearMonto(entrante.total)}
                </div>
              )}
            </div>

            {entrante.error && (
              <p className="flex items-start gap-2 text-[12.5px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {entrante.error}
              </p>
            )}
            {entrante.estado === "pendiente" && entrante.aviso && (
              <p className="text-[12.5px] text-muted-foreground">
                {entrante.aviso}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {entrante.estado === "pendiente" && (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link href={`/gastos/nuevo?entrante=${entrante.id}`}>
                      Revisar y guardar
                    </Link>
                  }
                />
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={enCurso === entrante.id}
                onClick={() => handleReintentar(entrante.id)}
              >
                <RotateCw className="h-3.5 w-3.5" />
                {enCurso === entrante.id ? "Leyendo..." : "Volver a leer"}
              </Button>
              {entrante.tieneFoto && (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href={`/bandeja/${entrante.id}/foto`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <IconoFoto className="h-3.5 w-3.5" />
                      Ver ticket
                    </a>
                  }
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={enCurso === entrante.id}
                onClick={() => handleDescartar(entrante)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Descartar
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
