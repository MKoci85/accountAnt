import Link from "next/link";
import { Button } from "@/components/ui/button";
import { listarGastos } from "@/app/actions/gastos";
import { listarCategorias, listarEmisores } from "@/app/actions/catalogos";
import { GastosView } from "@/components/gastos-view";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function GastosPage() {
  const [gastos, categorias, emisores] = await Promise.all([
    listarGastos(),
    listarCategorias(),
    listarEmisores(),
  ]);

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Gastos</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {gastos.length} {gastos.length === 1 ? "registrado" : "registrados"} en total
          </p>
        </div>
        <Button
          size="lg"
          className="w-full sm:w-auto"
          nativeButton={false}
          render={<Link href="/gastos/nuevo">Cargar gasto</Link>}
        />
      </div>

      <GastosView
        gastos={gastos}
        categorias={categorias}
        emisores={emisores.filter((e) => !e.esGenerico)}
      />
    </PageContainer>
  );
}
