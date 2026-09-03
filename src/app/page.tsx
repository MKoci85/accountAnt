import Link from "next/link";
import { ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { PageContainer } from "@/components/page-container";
import { obtenerResumenDashboard } from "@/app/actions/gastos";
import { formatearMonto, formatearFechaLarga, nombreMes } from "@/lib/formato";

export const dynamic = "force-dynamic";

export default async function Home() {
  const resumen = await obtenerResumenDashboard();

  return (
    <PageContainer gap={7}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Hola — así va {nombreMes()}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatearFechaLarga(new Date())}
          </p>
        </div>
        <Button
          size="lg"
          className="w-full sm:w-auto"
          nativeButton={false}
          render={<Link href="/gastos/nuevo">Cargar gasto</Link>}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Gastado este mes"
          value={formatearMonto(resumen.totalMes)}
          hint={`${resumen.cantidadGastosMes} ${resumen.cantidadGastosMes === 1 ? "gasto registrado" : "gastos registrados"}`}
        />
        <StatCard
          label="Gasto hormiga"
          value={formatearMonto(resumen.totalHormiga)}
          hint={`${resumen.porcentajeHormiga}% del total del mes`}
          tone="accent"
        />
        <StatCard
          label="Comercios pendientes"
          value={String(resumen.emisoresPendientes)}
          hint="falta completar proveedor de CFE"
        />
      </div>

      <Card className="py-0">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <span className="text-[15px] font-semibold">Gastos recientes</span>
          <Link
            href="/gastos"
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver todos →
          </Link>
        </div>
        {resumen.gastosRecientes.length === 0 ? (
          <CardContent className="px-5 py-8 text-center text-sm text-muted-foreground">
            Todavía no cargaste ningún gasto este mes.
          </CardContent>
        ) : (
          <CardContent className="divide-y px-0 py-0">
            {resumen.gastosRecientes.map((g) => (
              <div key={g.id} className="flex items-center gap-3.5 px-5 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <ShoppingBasket className="h-[17px] w-[17px] text-accent-foreground" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{g.emisorNombre}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {g.cantidadItems} ítem{g.cantidadItems === 1 ? "" : "s"}
                    {g.categorias.length > 0 &&
                      ` · ${g.categorias.map((c) => c.nombre).join(", ")}`}
                    {g.sinComprobante && " · sin comprobante"}
                  </div>
                </div>
                <div className="text-[15px] font-medium">
                  {formatearMonto(g.montoTotal)}
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </PageContainer>
  );
}
