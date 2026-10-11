import { listarEntrantes } from "@/app/actions/entrantes";
import { BandejaView } from "@/components/bandeja-view";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function BandejaPage() {
  const entrantes = await listarEntrantes();

  return (
    <PageContainer maxWidth="3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Bandeja de entrada
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Comprobantes recibidos que todavía no son gastos. Cada uno se revisa
          en el formulario y recién ahí se guarda.
        </p>
      </div>
      <BandejaView entrantes={entrantes} />
    </PageContainer>
  );
}
