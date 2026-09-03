import { listarCategorias } from "@/app/actions/catalogos";
import { listarGastosFijos } from "@/app/actions/gastos-fijos";
import { GastosFijosView } from "@/components/gastos-fijos-view";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function GastosFijosPage() {
  const [plantillas, categorias] = await Promise.all([
    listarGastosFijos(),
    listarCategorias(),
  ]);

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Gastos fijos</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          UTE, alquiler, suscripciones: lo que se paga todos los meses, con un
          toque para registrar el pago del mes.
        </p>
      </div>

      <GastosFijosView plantillas={plantillas} categorias={categorias} />
    </PageContainer>
  );
}
