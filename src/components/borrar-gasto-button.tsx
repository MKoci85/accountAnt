"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmarBorradoDialog } from "@/components/confirmar-borrado-dialog";
import { borrarGasto } from "@/app/actions/gastos";

export function BorrarGastoButton({ gastoId }: { gastoId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        className="gap-2 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        Borrar
      </Button>

      <ConfirmarBorradoDialog
        open={open}
        onOpenChange={setOpen}
        titulo="¿Borrar este gasto?"
        descripcion="Esta acción no se puede deshacer. Se van a borrar todas sus líneas."
        onConfirmar={async () => {
          await borrarGasto(gastoId);
          router.push("/gastos");
        }}
      />
    </>
  );
}
