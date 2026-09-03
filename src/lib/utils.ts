import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function nombreLinea(linea: {
  itemNombre: string | null;
  descripcion: string | null;
}) {
  return linea.itemNombre ?? linea.descripcion ?? "Sin detalle";
}
