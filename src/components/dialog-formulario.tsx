"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function DialogFormulario({
  open,
  onOpenChange,
  titulo,
  etiquetaGuardar,
  puedeGuardar,
  isPending,
  error,
  onGuardar,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  etiquetaGuardar: string;
  puedeGuardar: boolean;
  isPending: boolean;
  error: string | null;
  onGuardar: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {children}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onGuardar} disabled={!puedeGuardar || isPending}>
            {isPending ? "Guardando..." : etiquetaGuardar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CampoFormulario({
  label,
  htmlFor,
  accion,
  children,
}: {
  label: string;
  htmlFor?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {accion ? (
        <div className="flex items-center justify-between">
          <label
            htmlFor={htmlFor}
            className="text-xs font-medium text-muted-foreground"
          >
            {label}
          </label>
          {accion}
        </div>
      ) : (
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
      )}
      {children}
    </div>
  );
}
