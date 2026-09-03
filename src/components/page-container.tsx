import { cn } from "@/lib/utils";

const anchosMaximos = {
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

const espaciados = {
  6: "gap-6",
  7: "gap-7",
} as const;

export function PageContainer({
  maxWidth = "5xl",
  gap = 6,
  className,
  children,
}: {
  maxWidth?: keyof typeof anchosMaximos;
  gap?: keyof typeof espaciados;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col px-5 py-8 md:px-10 md:py-10",
        anchosMaximos[maxWidth],
        espaciados[gap],
        className
      )}
    >
      {children}
    </div>
  );
}
