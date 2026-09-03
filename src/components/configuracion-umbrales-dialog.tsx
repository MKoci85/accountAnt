"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  guardarDiasHaciaAtrasBcu,
  guardarMargenSobreprecioPeso,
  guardarVentanaMesesReferencia,
  type ConfigAvanzada,
} from "@/app/actions/configuracion";
import { SeccionColapsable } from "@/components/seccion-colapsable";

type Mensaje = { ok: boolean; texto: string };

export function ConfiguracionUmbralesDialog({
  inicial,
}: {
  inicial: ConfigAvanzada;
}) {
  return (
    <SeccionColapsable
      icono={SlidersHorizontal}
      titulo="Umbrales de precio"
      descripcion="No hace falta tocar esto: son los valores con los que la app viene funcionando. Cambian cuándo una línea se marca como sobreprecio y contra qué historial se compara."
    >
      <div className="flex flex-col gap-4">
        <CampoNumero
          etiqueta="Margen de sobreprecio por peso"
          sufijo="%"
          valor={inicial.margenSobreprecioPeso * 100}
          porDefecto={inicial.margenSobreprecioPesoPorDefecto * 100}
          ayuda="Tolerancia sobre el precio de referencia en las líneas por kg o L. El precio por kilo que sale de un ticket nunca da exacto: sin margen casi toda compra de verdura quedaría marcada como cara. No se aplica a las líneas por unidad."
          onGuardar={(v) => guardarMargenSobreprecioPeso(v / 100)}
        />
        <CampoNumero
          etiqueta="Ventana de precio de referencia"
          sufijo="meses"
          valor={inicial.ventanaMesesReferencia}
          porDefecto={inicial.ventanaMesesReferenciaPorDefecto}
          ayuda="Cuánto hacia atrás se busca el precio más barato con el que se compara. Los precios suben: una ventana muy larga marca como sobreprecio compras normales de hoy."
          onGuardar={guardarVentanaMesesReferencia}
        />
        <CampoNumero
          etiqueta="Días hacia atrás para la cotización del BCU"
          sufijo="días"
          valor={inicial.bcuDiasHaciaAtras}
          porDefecto={inicial.bcuDiasHaciaAtrasPorDefecto}
          ayuda="El BCU no cotiza fines de semana ni feriados. Si la fecha pedida no tiene cotización se mira hacia atrás hasta encontrar una; el default cubre un fin de semana largo."
          onGuardar={guardarDiasHaciaAtrasBcu}
        />
      </div>
    </SeccionColapsable>
  );
}

export function CampoNumero({
  etiqueta,
  sufijo,
  valor,
  porDefecto,
  ayuda,
  onGuardar,
}: {
  etiqueta: string;
  sufijo: string;
  valor: number;
  porDefecto: number;
  ayuda: string;
  onGuardar: (valor: number) => Promise<void>;
}) {
  const [texto, setTexto] = useState(String(valor));
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [guardando, startGuardado] = useTransition();

  function handleGuardar() {
    setMensaje(null);
    const n = Number(texto.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setMensaje({ ok: false, texto: "Tiene que ser un número mayor que cero" });
      return;
    }
    startGuardado(async () => {
      try {
        await onGuardar(n);
        setMensaje({ ok: true, texto: "Guardado." });
      } catch (e) {
        setMensaje({
          ok: false,
          texto: e instanceof Error ? e.message : "No se pudo guardar",
        });
      }
    });
  }

  const esDefault = Number(texto.replace(",", ".")) === porDefecto;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 px-3.5 py-3">
      <label className="text-[12.5px] font-medium">{etiqueta}</label>
      <div className="flex items-center gap-2">
        <Input
          value={texto}
          inputMode="decimal"
          onChange={(e) => setTexto(e.target.value)}
          className="w-28 text-[13px]"
        />
        <span className="text-[12px] text-muted-foreground">{sufijo}</span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={handleGuardar}
          disabled={guardando}
        >
          {guardando ? "Guardando..." : "Guardar"}
        </Button>
      </div>
      <p className="text-[11.5px] text-muted-foreground">{ayuda}</p>
      {!esDefault && (
        <p className="text-[11.5px] text-muted-foreground">
          Default: {porDefecto} {sufijo}
        </p>
      )}
      {mensaje && <MensajeLinea mensaje={mensaje} />}
    </div>
  );
}

export function MensajeLinea({
  mensaje,
  className = "",
}: {
  mensaje: Mensaje;
  className?: string;
}) {
  return (
    <p
      className={`flex items-center gap-1.5 text-xs ${
        mensaje.ok ? "text-primary" : "text-destructive"
      } ${className}`}
    >
      {mensaje.ok ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" />
      )}
      {mensaje.texto}
    </p>
  );
}
