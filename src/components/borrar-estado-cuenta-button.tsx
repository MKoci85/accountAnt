"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmarBorradoDialog } from "@/components/confirmar-borrado-dialog";
import { borrarEstadoCuenta } from "@/app/actions/estado-cuenta";

export function BorrarEstadoCuentaButton({ id }: { id: number }) {
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
        Quitar del registro
      </Button>

      <ConfirmarBorradoDialog
        open={open}
        onOpenChange={setOpen}
        titulo="¿Quitar este estado de cuenta?"
        descripcion="Se borra el PDF guardado y el detalle de sus líneas. Los gastos que se importaron desde él no se tocan."
        onConfirmar={async () => {
          await borrarEstadoCuenta(id);
          router.push("/estado-cuenta");
        }}
      />
    </>
  );
}
