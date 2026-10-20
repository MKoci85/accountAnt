"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, ImageUp, MessageCircle, RotateCw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buscarRegistroRecepcion,
  vaciarRegistroRecepcion,
} from "@/app/actions/entrantes";
import { useDebounced } from "@/hooks/use-debounced";
import type { FallaRecepcion } from "@/lib/entrantes";
import type { FiltrosRegistro, RegistroRecepcion as Registro } from "@/lib/entrantes-server";

const formatoHora = new Intl.DateTimeFormat("es-UY", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const ORIGEN = {
  whatsapp: { icono: MessageCircle, texto: "WhatsApp" },
  subida: { icono: ImageUp, texto: "Foto subida" },
  reintento: { icono: RotateCw, texto: "Volver a leer" },
} as const;

function Falla({ falla }: { falla: FallaRecepcion }) {
  return (
    <p className="flex items-start gap-1.5 text-destructive">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-medium">{falla.paso}:</span> {falla.detalle}
      </span>
    </p>
  );
}

/**
 * Registro de recepción: cada mensaje que llegó por WhatsApp y cada falla al
 * leer un comprobante. Un mensaje que no aparece acá no llegó a la app: el
 * webhook anota cada uno antes de contestarle a Meta.
 *
 * Sin filtros muestra lo que trae la página (y se refresca con ella); con
 * filtros, lo que devuelve la búsqueda en el servidor.
 */
export function RegistroRecepcion({ inicial }: { inicial: Registro }) {
  const [busqueda, setBusqueda] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [buscado, setBuscado] = useState<{ clave: string; registro: Registro } | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [limpiando, startLimpiar] = useTransition();

  const busquedaDebounced = useDebounced(busqueda.trim(), 300);
  const filtros: FiltrosRegistro = { busqueda: busquedaDebounced, desde, hasta };
  const clave = JSON.stringify(filtros);
  const sinFiltros = !busquedaDebounced && !desde && !hasta;

  useEffect(() => {
    if (sinFiltros) return;
    let vigente = true;
    buscarRegistroRecepcion(JSON.parse(clave) as FiltrosRegistro).then(
      (registro) => {
        if (vigente) setBuscado({ clave, registro });
      },
      () => {
        if (vigente) setMensaje("No se pudo buscar en el registro.");
      }
    );
    return () => {
      vigente = false;
    };
  }, [clave, sinFiltros]);

  const registro = sinFiltros ? inicial : (buscado?.registro ?? inicial);
  const buscando = !sinFiltros && buscado?.clave !== clave;
  const { eventos, total } = registro;

  function limpiarFiltros() {
    setBusqueda("");
    setDesde("");
    setHasta("");
  }

  function handleLimpiar() {
    const seguir = window.confirm(
      "¿Borrar todo el registro de recepción? Sólo quedan los mensajes de WhatsApp que todavía se pueden reintentar."
    );
    if (!seguir) return;
    setMensaje(null);
    startLimpiar(async () => {
      try {
        const borradas = await vaciarRegistroRecepcion();
        limpiarFiltros();
        setBuscado(null);
        setMensaje(
          borradas
            ? `Se borraron ${borradas} registro${borradas === 1 ? "" : "s"}.`
            : "No había nada para borrar."
        );
      } catch {
        setMensaje("No se pudo limpiar el registro.");
      }
    });
  }

  return (
    <section id="registro" className="flex scroll-mt-6 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Registro de recepción</h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={limpiando || inicial.total === 0}
          onClick={handleLimpiar}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {limpiando ? "Limpiando..." : "Limpiar"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Cada mensaje que llega por WhatsApp se anota acá, aunque no traiga foto
        o venga de un número no autorizado, junto con cualquier error al leerlo
        (QR, DGI, proveedor, modelos de IA). Si mandaste algo y no aparece, Meta
        no lo entregó.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por número, resultado o error"
            aria-label="Buscar en el registro"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <Input
          type="date"
          aria-label="Desde"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          className="h-8 w-[150px] text-[13px]"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="date"
          aria-label="Hasta"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          className="h-8 w-[150px] text-[13px]"
        />
        {(busqueda || desde || hasta) && (
          <Button size="sm" variant="ghost" onClick={limpiarFiltros}>
            <X className="h-3.5 w-3.5" />
            Quitar filtros
          </Button>
        )}
      </div>

      {mensaje && (
        <p role="status" className="text-xs text-muted-foreground">
          {mensaje}
        </p>
      )}

      {eventos.length === 0 ? (
        <Card className="px-5 py-6 text-center text-sm text-muted-foreground">
          {buscando
            ? "Buscando..."
            : sinFiltros
              ? "Todavía no hay nada registrado."
              : "Nada coincide con la búsqueda."}
        </Card>
      ) : (
        <Card
          className={`max-h-[28rem] gap-0 divide-y divide-border overflow-y-auto px-0 py-0 ${buscando ? "opacity-60" : ""}`}
        >
          {eventos.map((ev) => {
            const { icono: Icono, texto } = ORIGEN[ev.tipo === "whatsapp" ? "whatsapp" : ev.origen];
            return (
              <div key={ev.id} className="flex flex-col gap-1 px-4 py-2.5 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Icono className="h-3.5 w-3.5" />
                    {texto}
                  </span>
                  <span>{formatoHora.format(new Date(ev.fecha))}</span>
                  {ev.tipo === "whatsapp" && <span>+{ev.remitente}</span>}
                </div>
                {ev.tipo === "whatsapp" ? (
                  <>
                    <div className={ev.resultado === null ? "text-muted-foreground" : undefined}>
                      {ev.resultado ?? "Procesando..."}
                    </div>
                    {ev.fallas.map((f, i) => (
                      <Falla key={i} falla={f} />
                    ))}
                  </>
                ) : (
                  <Falla falla={ev.falla} />
                )}
              </div>
            );
          })}
        </Card>
      )}
      {total > eventos.length && (
        <p className="text-xs text-muted-foreground">
          Se muestran los {eventos.length} más recientes de {total}: filtrá por
          fecha o texto para llegar al resto.
        </p>
      )}
    </section>
  );
}
