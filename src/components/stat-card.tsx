import { Card, CardContent } from "@/components/ui/card";

type StatCardProps = {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "accent";
};

export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <Card>
      <CardContent className="px-5 py-1">
        <div className="text-[13px] font-medium text-muted-foreground">
          {label}
        </div>
        <div
          className={`mt-2 text-3xl font-semibold tracking-tight ${
            tone === "accent" ? "text-destructive" : "text-foreground"
          }`}
        >
          {value}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
