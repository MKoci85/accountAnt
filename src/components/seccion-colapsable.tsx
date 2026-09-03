"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function SeccionColapsable({
  icono: Icono,
  titulo,
  descripcion,
  abiertaPorDefecto = false,
  children,
}: {
  icono: LucideIcon;
  titulo: string;
  descripcion: string;
  abiertaPorDefecto?: boolean;
  children: ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);

  return (
    <Card className="px-5 py-4.5">
      <Collapsible open={abierta} onOpenChange={setAbierta}>
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 text-left">
          <Icono className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-semibold">{titulo}</div>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              abierta ? "rotate-180" : ""
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-3 mb-4 text-[12.5px] text-muted-foreground">
            {descripcion}
          </p>
          {children}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
