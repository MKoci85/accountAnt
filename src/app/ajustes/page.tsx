import {
  obtenerProveedorIA,
  obtenerEstadoProveedoresIA,
  obtenerLimitadorIA,
  obtenerConfigAvanzada,
} from "@/app/actions/configuracion";
import { ConfiguracionIaDialog } from "@/components/configuracion-ia-dialog";
import { ConfiguracionUmbralesDialog } from "@/components/configuracion-umbrales-dialog";
import { ConfiguracionEndpointsDialog } from "@/components/configuracion-endpoints-dialog";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  const estados = await obtenerEstadoProveedoresIA();
  const proveedor = await obtenerProveedorIA();
  const limitador = await obtenerLimitadorIA();
  const configAvanzada = await obtenerConfigAvanzada();

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Configuración de la app.
        </p>
      </div>

      <ConfiguracionIaDialog
        proveedorInicial={proveedor}
        estados={estados}
        limitadorInicial={limitador}
      />

      <ConfiguracionUmbralesDialog inicial={configAvanzada} />
      <ConfiguracionEndpointsDialog inicial={configAvanzada} />
    </PageContainer>
  );
}
