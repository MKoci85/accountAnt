import { Badge } from "@/components/ui/badge";

export type TipoBadgeLinea = "hormiga" | "sobreprecio" | "precioBase";

const ESTILOS: Record<TipoBadgeLinea, string> = {
  hormiga: "bg-destructive/10 text-destructive",
  sobreprecio: "bg-destructive/15 text-destructive/80",
  precioBase: "bg-primary/15 text-primary",
};

const ESTILO_NECESARIO = "bg-accent text-accent-foreground";

const ETIQUETAS: Record<TipoBadgeLinea, string> = {
  hormiga: "Hormiga",
  sobreprecio: "Sobreprecio",
  precioBase: "Subió de precio",
};

export function BadgeLinea({
  tipo,
  activo = true,
  etiquetaInactiva,
  className,
}: {
  tipo: TipoBadgeLinea;
  activo?: boolean;
  etiquetaInactiva?: string;
  className?: string;
}) {
  const etiqueta = activo
    ? ETIQUETAS[tipo]
    : (etiquetaInactiva ??
      (tipo === "hormiga" ? "Necesario" : ETIQUETAS[tipo]));
  const estilo = activo
    ? ESTILOS[tipo]
    : tipo === "hormiga"
      ? ESTILO_NECESARIO
      : "bg-muted text-muted-foreground";

  return (
    <Badge variant="secondary" className={`${estilo} ${className ?? ""}`.trim()}>
      {etiqueta}
    </Badge>
  );
}
