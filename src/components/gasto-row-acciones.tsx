"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { ConfirmarBorradoDialog } from "@/components/confirmar-borrado-dialog";
import { borrarGasto } from "@/app/actions/gastos";

const claseBoton =
  "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function VerGastoAccion({ gastoId }: { gastoId: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Ver detalle"
      title="Ver detalle"
      className={claseBoton}
      onClick={(e) => {
        e.stopPropagation();
        router.push(`/gastos/${gastoId}`);
      }}
    >
      <Eye className="h-4 w-4" />
    </button>
  );
}

export function EditarGastoAccion({ gastoId }: { gastoId: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Editar"
      title="Editar"
      className={claseBoton}
      onClick={(e) => {
        e.stopPropagation();
        router.push(`/gastos/${gastoId}/editar`);
      }}
    >
      <Pencil className="h-4 w-4" />
    </button>
  );
}

export function BorrarGastoAccion({ gastoId }: { gastoId: number }) {
  const router = useRouter();
  const [confirmarOpen, setConfirmarOpen] = useState(false);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Borrar"
        title="Borrar"
        className={`${claseBoton} hover:bg-destructive/10 hover:text-destructive`}
        onClick={() => setConfirmarOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <ConfirmarBorradoDialog
        open={confirmarOpen}
        onOpenChange={setConfirmarOpen}
        titulo="¿Borrar este gasto?"
        descripcion="Esta acción no se puede deshacer. Se van a borrar todas sus líneas."
        onConfirmar={async () => {
          await borrarGasto(gastoId);
          router.refresh();
        }}
      />
    </div>
  );
}
