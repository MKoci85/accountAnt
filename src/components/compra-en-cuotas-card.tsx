"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmarBorradoDialog } from "@/components/confirmar-borrado-dialog";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { CompraEnCuotasDialog } from "@/components/compra-en-cuotas-dialog";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import {
  marcarCompraEnCuotas,
  pagarCuota,
  quitarCompraEnCuotas,
} from "@/app/actions/compras-cuotas";
import type { GastoDetalle } from "@/app/actions/gastos";
import { formatearFechaCorta, formatearMonto, hoyISO, parsearMonto } from "@/lib/formato";

type Compra = NonNullable<GastoDetalle["compraEnCuotas"]>;
type CuotaDelPlan = Compra["cuotas"][number];

/**
 * El plan de cuotas en la ficha de un gasto: si es una compra en cuotas, sus
 * cuotas con lo calculado y lo cobrado; si no, el botón para marcarla.
 */
export function CompraEnCuotasCard({
  gastoId,
  totalGasto,
  compra,
}: {
  gastoId: number;
  totalGasto: number;
  compra: Compra | null;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [pagando, setPagando] = useState<CuotaDelPlan | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function guardarPlan(datos: { total: number; cantidad: number; interesPct: number }) {
    const { vinculadas } = await marcarCompraEnCuotas(gastoId, datos);
    setEditando(false);
    setMensaje(
      vinculadas
        ? `Listo. ${vinculadas === 1 ? "Se vinculó 1 cuota que ya estaba importada" : `Se vincularon ${vinculadas} cuotas que ya estaban importadas`}.`
        : null
    );
    router.refresh();
  }

  if (!compra) {
    return (
      <>
        <Button variant="outline" className="gap-2" onClick={() => setEditando(true)}>
          <CreditCard className="h-4 w-4" />
          En cuotas
        </Button>
        <CompraEnCuotasDialog
          open={editando}
          onOpenChange={setEditando}
          titulo="Pagada en cuotas"
          descripcion="Una compra en cuotas no suma entera en su fecha: suma cada cuota en el mes en que la cobra el banco. Si ya importaste cuotas de esta compra desde un estado de cuenta, se vinculan solas."
          inicial={{ total: Number(totalGasto.toFixed(2)) }}
          etiquetaConfirmar="Guardar"
          onConfirmar={guardarPlan}
        />
      </>
    );
  }

  const pagadas = compra.cuotas.filter((c) => c.pagada);
  const faltan = compra.cuotas
    .filter((c) => !c.pagada)
    .reduce((acc, c) => acc + c.importeCalculado, 0);

  return (
    <Card className="flex flex-col gap-2.5 px-5 py-4.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Compra en {compra.cantidad} cuotas
        </div>
        <span className="text-[12px] text-muted-foreground">
          {pagadas.length} de {compra.cantidad} cobradas
        </span>
      </div>
      <div className="flex justify-between text-[13px]">
        <span className="text-muted-foreground">Precio</span>
        <span className="font-medium tabular-nums">
          {formatearMonto(compra.total, { decimales: 2 })}
          {compra.interesPct > 0 && ` + ${compra.interesPct}% de recargo`}
        </span>
      </div>
      {faltan > 0 && (
        <div className="flex justify-between text-[13px]">
          <span className="text-muted-foreground">Falta pagar</span>
          <span className="font-medium tabular-nums">
            {formatearMonto(faltan, { decimales: 2 })}
          </span>
        </div>
      )}
      {compra.tarjeta && (
        <div className="flex justify-between text-[13px]">
          <span className="text-muted-foreground">Tarjeta</span>
          <span className="font-medium">···· {compra.tarjeta}</span>
        </div>
      )}

      <div className="mt-1 flex flex-col divide-y divide-border rounded-lg border border-border/60">
        {compra.cuotas.map((c) => (
          <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
            <span className="w-8 shrink-0 text-muted-foreground">{c.numero}</span>
            <div className="min-w-0 flex-1 tabular-nums">
              {c.pagada ? (
                <>
                  {formatearMonto(c.importePagado ?? c.importeCalculado, { decimales: 2 })}
                  {c.importePagado !== null &&
                    Math.abs(c.importePagado - c.importeCalculado) > 0.005 && (
                      <span className="text-muted-foreground">
                        {" "}
                        (calculada {formatearMonto(c.importeCalculado, { decimales: 2 })})
                      </span>
                    )}
                </>
              ) : (
                <span className="text-muted-foreground">
                  {formatearMonto(c.importeCalculado, { decimales: 2 })} calculada
                </span>
              )}
            </div>
            {c.pagada && c.gastoId !== null ? (
              <Link href={`/gastos/${c.gastoId}`} className="shrink-0 text-primary hover:underline">
                {c.fechaPago ? `Cobrada ${formatearFechaCorta(c.fechaPago)}` : "Ver gasto"}
              </Link>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-[12px]"
                onClick={() => setPagando(c)}
              >
                Marcar pagada
              </Button>
            )}
          </div>
        ))}
      </div>

      {mensaje && <p className="text-[12px] text-primary">{mensaje}</p>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
          Editar plan
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setQuitando(true)}
        >
          No fue en cuotas
        </Button>
      </div>

      <CompraEnCuotasDialog
        open={editando}
        onOpenChange={setEditando}
        titulo="Editar el plan de cuotas"
        descripcion="Las cuotas ya cobradas no cambian: se recalculan las que faltan."
        inicial={{
          total: compra.total,
          cantidad: compra.cantidad,
          interesPct: compra.interesPct,
        }}
        etiquetaConfirmar="Guardar"
        onConfirmar={guardarPlan}
      />

      <ConfirmarBorradoDialog
        open={quitando}
        onOpenChange={setQuitando}
        titulo="¿No fue en cuotas?"
        descripcion={
          pagadas.length
            ? `La compra vuelve a sumar entera en su fecha. Los gastos de las ${pagadas.length} cuotas ya cobradas quedan como gastos sueltos: si eran de esta compra, borralos para no contarla dos veces.`
            : "La compra vuelve a sumar entera en su fecha."
        }
        onConfirmar={async () => {
          await quitarCompraEnCuotas(gastoId);
          router.refresh();
        }}
      />

      {pagando && (
        <PagarCuotaDialog
          cuota={pagando}
          cantidad={compra.cantidad}
          onCerrar={() => setPagando(null)}
          onPagada={(texto) => {
            setPagando(null);
            setMensaje(texto);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function PagarCuotaDialog({
  cuota,
  cantidad,
  onCerrar,
  onPagada,
}: {
  cuota: CuotaDelPlan;
  cantidad: number;
  onCerrar: () => void;
  onPagada: (mensaje: string) => void;
}) {
  const [importe, setImporte] = useState(String(cuota.importeCalculado).replace(".", ","));
  const [fecha, setFecha] = useState(hoyISO());
  const { error, isPending, enviar } = useEnvioDialog("No se pudo registrar la cuota");
  const monto = parsearMonto(importe);
  const valido = monto !== null && monto > 0 && !!fecha;

  return (
    <DialogFormulario
      open
      onOpenChange={(open) => {
        if (!open) onCerrar();
      }}
      titulo={`Cuota ${cuota.numero} de ${cantidad}`}
      etiquetaGuardar="Marcar pagada"
      puedeGuardar={valido}
      isPending={isPending}
      error={error}
      onGuardar={() =>
        enviar(async () => {
          if (!valido) return;
          const r = await pagarCuota(cuota.id, { importe: monto, fecha });
          onPagada(
            r.interesAjustado !== null
              ? `Cuota registrada. El importe no coincidía con el calculado: las que faltan se recalcularon con un recargo de ${r.interesAjustado}%.`
              : "Cuota registrada."
          );
        })
      }
    >
      <p className="text-[12.5px] text-muted-foreground">
        Para una cuota que no va a llegar en ningún estado de cuenta que importes. Se
        crea su gasto, igual que si viniera del banco.
      </p>
      <CampoFormulario label="Importe cobrado" htmlFor="cuota-importe">
        <Input
          id="cuota-importe"
          value={importe}
          inputMode="decimal"
          onChange={(e) => setImporte(e.target.value)}
          autoFocus
        />
      </CampoFormulario>
      <CampoFormulario label="Fecha" htmlFor="cuota-fecha">
        <Input
          id="cuota-fecha"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="max-w-45"
        />
      </CampoFormulario>
    </DialogFormulario>
  );
}
