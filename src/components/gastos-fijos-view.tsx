"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Check,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmarBorradoDialog } from "@/components/confirmar-borrado-dialog";
import { GastoFijoDialog } from "@/components/gasto-fijo-dialog";
import { PagarGastoFijoDialog } from "@/components/pagar-gasto-fijo-dialog";
import {
  borrarGastoFijo,
  cambiarActivoGastoFijo,
  type GastoFijoConEstado,
} from "@/app/actions/gastos-fijos";
import { formatearFechaCorta, formatearMonto } from "@/lib/formato";
import type { categorias } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;

function agruparPorCategoria(plantillas: GastoFijoConEstado[]) {
  const grupos = new Map<string, GastoFijoConEstado[]>();
  for (const plantilla of plantillas) {
    const actual = grupos.get(plantilla.categoriaNombre) ?? [];
    actual.push(plantilla);
    grupos.set(plantilla.categoriaNombre, actual);
  }
  return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function descripcionBorrado(plantilla: GastoFijoConEstado) {
  if (plantilla.cantidadPagos === 0) {
    return "Esta plantilla nunca se pagó, así que no queda nada más que borrar.";
  }
  const pagos =
    plantilla.cantidadPagos === 1
      ? "1 gasto ya registrado sigue"
      : `${plantilla.cantidadPagos} gastos ya registrados siguen`;
  return `${pagos} en la lista de gastos, pero pierden el vínculo con esta plantilla (se deja de saber si el mes está pagado). Si solo la querés fuera de la grilla, archivala.`;
}

export function GastosFijosView({
  plantillas,
  categorias: categoriasList,
}: {
  plantillas: GastoFijoConEstado[];
  categorias: Categoria[];
}) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [formularioOpen, setFormularioOpen] = useState(false);
  const [editando, setEditando] = useState<GastoFijoConEstado | null>(null);
  const [pagando, setPagando] = useState<GastoFijoConEstado | null>(null);
  const [borrando, setBorrando] = useState<GastoFijoConEstado | null>(null);

  const activas = plantillas.filter((p) => p.activo);
  const archivadas = plantillas.filter((p) => !p.activo);
  const pagadas = activas.filter((p) => p.pagadoEsteMes);
  const totalDelMes = pagadas.reduce(
    (acc, p) => acc + (p.ultimoPagoImporte ?? 0),
    0
  );

  function abrirNuevo() {
    setEditando(null);
    setFormularioOpen(true);
  }

  function abrirEdicion(plantilla: GastoFijoConEstado) {
    setEditando(plantilla);
    setFormularioOpen(true);
  }

  async function alternarArchivado(plantilla: GastoFijoConEstado) {
    await cambiarActivoGastoFijo(plantilla.id, !plantilla.activo);
    setMensaje(
      plantilla.activo
        ? `${plantilla.nombre} quedó archivado`
        : `${plantilla.nombre} volvió a la grilla`
    );
    router.refresh();
  }

  function tarjeta(plantilla: GastoFijoConEstado) {
    const referencia = plantilla.ultimoPagoImporte ?? plantilla.importe;
    return (
      <Card
        key={plantilla.id}
        className={`flex flex-col gap-3 px-4 py-3.5 ${
          plantilla.activo ? "" : "opacity-60"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium">
              {plantilla.nombre}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {plantilla.emisorNombre ?? "Sin comercio"}
            </div>
          </div>
          {plantilla.activo &&
            (plantilla.pagadoEsteMes ? (
              <Badge variant="secondary" className="shrink-0 gap-1">
                <Check className="h-3 w-3" />
                {plantilla.ultimoPagoFecha
                  ? formatearFechaCorta(plantilla.ultimoPagoFecha)
                  : "Pagado"}
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">
                Pendiente
              </Badge>
            ))}
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[17px] font-semibold">
            {referencia != null ? formatearMonto(referencia) : "—"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {plantilla.ultimoPagoImporte != null
              ? "último pago"
              : referencia != null
                ? "esperado"
                : "todavía sin monto"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {plantilla.activo && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                setMensaje(null);
                setPagando(plantilla);
              }}
            >
              Pagar
            </Button>
          )}
          {!plantilla.activo && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1.5"
              onClick={() => alternarArchivado(plantilla)}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              Reactivar
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Editar gasto fijo"
            title="Editar"
            onClick={() => abrirEdicion(plantilla)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {plantilla.activo && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Archivar gasto fijo"
              title="Archivar"
              onClick={() => alternarArchivado(plantilla)}
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Borrar gasto fijo"
            title="Borrar"
            onClick={() => setBorrando(plantilla)}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {activas.length === 0
            ? "Todavía no hay gastos fijos cargados."
            : `${pagadas.length} de ${activas.length} pagados este mes · ${formatearMonto(totalDelMes)}`}
        </p>
        <Button size="sm" className="gap-1.5" onClick={abrirNuevo}>
          <Plus className="h-3.5 w-3.5" />
          Nuevo gasto fijo
        </Button>
      </div>

      {mensaje && (
        <p className="rounded-lg border border-dashed px-4 py-2.5 text-[12.5px] text-muted-foreground">
          {mensaje}
        </p>
      )}

      {agruparPorCategoria(activas).map(([categoria, delGrupo]) => (
        <div key={categoria} className="flex flex-col gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {categoria}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {delGrupo.map(tarjeta)}
          </div>
        </div>
      ))}

      {archivadas.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Archivados
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archivadas.map(tarjeta)}
          </div>
        </div>
      )}

      <GastoFijoDialog
        key={`gasto-fijo-${editando?.id ?? "nuevo"}`}
        open={formularioOpen}
        onOpenChange={(open) => {
          setFormularioOpen(open);
          if (!open) setEditando(null);
        }}
        categorias={categoriasList}
        plantillaExistente={editando}
        onGuardado={() => {
          setMensaje(null);
          router.refresh();
        }}
      />

      {pagando && (
        <PagarGastoFijoDialog
          key={`pago-${pagando.id}`}
          open={pagando !== null}
          onOpenChange={(open) => {
            if (!open) setPagando(null);
          }}
          plantilla={pagando}
          onPagado={(texto) => {
            setMensaje(texto);
            router.refresh();
          }}
        />
      )}

      <ConfirmarBorradoDialog
        open={borrando !== null}
        onOpenChange={(open) => {
          if (!open) setBorrando(null);
        }}
        titulo={`¿Borrar "${borrando?.nombre ?? ""}"?`}
        descripcion={borrando ? descripcionBorrado(borrando) : ""}
        onConfirmar={async () => {
          if (!borrando) return;
          await borrarGastoFijo(borrando.id);
          setMensaje(`${borrando.nombre} se borró`);
          router.refresh();
        }}
      />
    </div>
  );
}
