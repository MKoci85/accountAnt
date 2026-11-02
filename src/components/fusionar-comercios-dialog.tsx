"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import { combinarEmisores } from "@/app/actions/catalogos";
import { comercioAConservar, problemaParaFusionar } from "@/lib/emisores";
import type { emisores } from "@/db/schema";

type Emisor = typeof emisores.$inferSelect;

/**
 * Fusiona un comercio con otro que es el mismo: elegís el otro y cuál de los
 * dos queda. El que se absorbe deja su nombre como alias del que queda.
 */
export function FusionarComerciosDialog({
  emisor,
  emisores,
  onCerrar,
  onFusionado,
}: {
  emisor: Emisor;
  emisores: Emisor[];
  onCerrar: () => void;
  onFusionado: (resultado: { emisor: Emisor; absorbidoId: number; gastosMovidos: number }) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [otro, setOtro] = useState<Emisor | null>(null);
  const [conservarId, setConservarId] = useState<number | null>(null);
  const { error, isPending, enviar } = useEnvioDialog("No se pudieron fusionar los comercios");

  const texto = busqueda.trim().toLowerCase();
  const candidatos = emisores
    .filter((e) => e.id !== emisor.id && !e.esGenerico)
    .filter((e) =>
      !texto ||
      [e.nombre, e.ruc].filter(Boolean).join(" ").toLowerCase().includes(texto)
    )
    .slice(0, 8);

  const conservar = otro
    ? ([emisor, otro].find((e) => e.id === conservarId) ?? comercioAConservar([emisor, otro])!)
    : null;
  const absorbido = otro && conservar ? (conservar.id === emisor.id ? otro : emisor) : null;
  const problema = conservar && absorbido ? problemaParaFusionar(conservar, [absorbido]) : null;

  function elegir(e: Emisor) {
    setOtro(e);
    setConservarId(comercioAConservar([emisor, e])!.id);
  }

  return (
    <DialogFormulario
      open
      onOpenChange={(open) => {
        if (!open) onCerrar();
      }}
      titulo={`Fusionar "${emisor.nombre}"`}
      etiquetaGuardar="Fusionar"
      puedeGuardar={!!conservar && !!absorbido && problema === null}
      isPending={isPending}
      error={error}
      onGuardar={() =>
        enviar(async () => {
          if (!conservar || !absorbido) return;
          const r = await combinarEmisores({
            conservarId: conservar.id,
            absorberIds: [absorbido.id],
          });
          onFusionado({ ...r, absorbidoId: absorbido.id });
        })
      }
    >
      <p className="text-[12.5px] text-muted-foreground">
        Para cuando un mismo comercio quedó dos veces, típicamente uno con RUC (del QR) y
        otro con el nombre que trae el estado de cuenta.
      </p>

      <CampoFormulario label="Es el mismo que" htmlFor="fusionar-buscar">
        <Input
          id="fusionar-buscar"
          value={busqueda}
          placeholder="Buscar por nombre o RUC"
          onChange={(e) => setBusqueda(e.target.value)}
          autoFocus
        />
        <div className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-border/60">
          {candidatos.length === 0 ? (
            <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
              Ningún comercio coincide.
            </p>
          ) : (
            candidatos.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => elegir(e)}
                className={`flex flex-col items-start px-3 py-1.5 text-left text-[13px] hover:bg-muted ${
                  otro?.id === e.id ? "bg-muted font-medium" : ""
                }`}
              >
                {e.nombre}
                <span className="text-[11px] text-muted-foreground">
                  {e.ruc ? `RUC ${e.ruc}` : "Sin RUC"}
                </span>
              </button>
            ))
          )}
        </div>
      </CampoFormulario>

      {otro && conservar && absorbido && (
        <>
          <CampoFormulario label="Cuál queda">
            <div className="flex flex-col gap-1.5">
              {[emisor, otro].map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="fusionar-conservar"
                    checked={conservar.id === e.id}
                    onChange={() => setConservarId(e.id)}
                    className="accent-primary"
                  />
                  {e.nombre}
                  <span className="text-[11px] text-muted-foreground">
                    {e.ruc ? `RUC ${e.ruc}` : "sin RUC"}
                  </span>
                </label>
              ))}
            </div>
          </CampoFormulario>
          {problema ? (
            <p className="text-[12.5px] text-destructive">{problema}</p>
          ) : (
            <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
              Los gastos, gastos fijos y alias de <strong>{absorbido.nombre}</strong> pasan a{" "}
              <strong>{conservar.nombre}</strong>, y &quot;{absorbido.nombre}&quot; queda como
              nombre alternativo para los estados de cuenta. {absorbido.nombre} se borra.
            </p>
          )}
        </>
      )}
    </DialogFormulario>
  );
}
