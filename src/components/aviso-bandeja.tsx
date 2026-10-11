"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox } from "lucide-react";

/**
 * Aviso permanente de que hay comprobantes sin resolver. Va en el layout para
 * que no dependa de pasar por el inicio, y se calla en la bandeja y mientras
 * se revisa un comprobante: ahí ya se está haciendo lo que pide.
 */
export function AvisoBandeja({
  total,
  atrasados,
}: {
  total: number;
  atrasados: number;
}) {
  const pathname = usePathname();
  if (total === 0 || pathname === "/bandeja" || pathname === "/gastos/nuevo") {
    return null;
  }

  return (
    <Link
      href="/bandeja"
      className="flex items-center gap-2.5 border-b border-amber-500/20 bg-amber-500/5 px-5 py-2.5 text-[13px] hover:bg-amber-500/10 md:px-10"
    >
      <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        <span className="font-medium">
          {total === 1
            ? "1 comprobante sin confirmar"
            : `${total} comprobantes sin confirmar`}
        </span>
        <span className="text-muted-foreground">
          {atrasados > 0
            ? ` · ${atrasados === 1 ? "1 es" : `${atrasados} son`} de un mes anterior: la carga de gastos está bloqueada`
            : " en la bandeja de entrada"}
        </span>
      </span>
    </Link>
  );
}
