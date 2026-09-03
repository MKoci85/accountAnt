"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import {
  pagarGastoFijo,
  type GastoFijoConEstado,
} from "@/app/actions/gastos-fijos";
import {
  formatearFechaLarga,
  formatearMonto,
  hoyISO,
  parsearMonto,
} from "@/lib/formato";

function importeSugerido(plantilla: GastoFijoConEstado) {
  const valor = plantilla.ultimoPagoImporte ?? plantilla.importe;
  return valor != null ? String(valor) : "";
}

export function PagarGastoFijoDialog({
  open,
  onOpenChange,
  plantilla,
  onPagado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plantilla: GastoFijoConEstado;
  onPagado: (mensaje: string) => void;
}) {
  const [importe, setImporte] = useState(importeSugerido(plantilla));
  const [fecha, setFecha] = useState(hoyISO());
  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo registrar el pago"
  );

  function handleOpenChange(next: boolean) {
    if (next) {
      setImporte(importeSugerido(plantilla));
      setFecha(hoyISO());
      setError(null);
    }
    onOpenChange(next);
  }

  const monto = parsearMonto(importe);
  const montoValido = monto !== null && monto > 0;
  const referencia = plantilla.ultimoPagoImporte ?? plantilla.importe;
  const diferencia =
    montoValido && referencia != null && Math.abs(monto - referencia) > 0.5
      ? monto - referencia
      : null;

  function handleGuardar() {
    enviar(async () => {
      if (!montoValido) return;
      await pagarGastoFijo(plantilla.id, { importe: monto, fecha });
      onPagado(`${plantilla.nombre}: pago de ${formatearMonto(monto)} guardado`);
      onOpenChange(false);
    });
  }

  return (
    <DialogFormulario
      open={open}
      onOpenChange={handleOpenChange}
      titulo={`Pagar ${plantilla.nombre}`}
      etiquetaGuardar="Registrar pago"
      puedeGuardar={montoValido && !!fecha}
      isPending={isPending}
      error={error}
      onGuardar={handleGuardar}
    >
      {plantilla.pagadoEsteMes && plantilla.ultimoPagoFecha && (
        <p className="rounded-lg border border-dashed border-destructive/50 px-3 py-2 text-[12.5px] text-muted-foreground">
          Ya hay un pago de este gasto fijo en el mes en curso, el{" "}
          <span className="font-medium text-foreground">
            {formatearFechaLarga(plantilla.ultimoPagoFecha)}
          </span>
          {plantilla.ultimoPagoImporte != null && (
            <> por {formatearMonto(plantilla.ultimoPagoImporte)}</>
          )}
          . Si seguís, queda registrado un segundo gasto.
        </p>
      )}

      <CampoFormulario label="Importe" htmlFor="pago-importe">
        <Input
          id="pago-importe"
          value={importe}
          inputMode="decimal"
          onChange={(e) => setImporte(e.target.value)}
          placeholder="Ej: 1.240"
          autoFocus
        />
        {diferencia !== null && referencia != null && (
          <p className="text-[11.5px] text-muted-foreground">
            El último fue {formatearMonto(referencia)} —{" "}
            {diferencia > 0
              ? `${formatearMonto(diferencia)} más`
              : `${formatearMonto(-diferencia)} menos`}
          </p>
        )}
      </CampoFormulario>

      <CampoFormulario label="Fecha" htmlFor="pago-fecha">
        <Input
          id="pago-fecha"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="max-w-45"
        />
      </CampoFormulario>
    </DialogFormulario>
  );
}
