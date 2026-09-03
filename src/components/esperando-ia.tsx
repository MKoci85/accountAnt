import { Sparkles } from "lucide-react";

export function EsperandoIA({ texto }: { texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
      <span className="animate-shimmer-texto">{texto}</span>
    </span>
  );
}

export function BloqueoIA({ texto }: { texto: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] bg-background/70 backdrop-blur-[1px]">
      <span className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 text-[13px] font-medium shadow-lg">
        <Sparkles className="h-4 w-4 shrink-0 animate-pulse text-primary" />
        <span className="animate-shimmer-texto">{texto}</span>
      </span>
    </div>
  );
}
