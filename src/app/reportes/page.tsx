import { obtenerReporte } from "@/app/actions/reportes";
import { listarCategorias, listarEmisores } from "@/app/actions/catalogos";
import { obtenerProveedoresDisponiblesIA } from "@/app/actions/configuracion";
import { ReportesView } from "@/components/reportes-view";
import { PageContainer } from "@/components/page-container";
import { aISO } from "@/lib/formato";

export const dynamic = "force-dynamic";

export default async function ReportesPage() {
  const hoy = new Date();
  const inicioMes = aISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));

  const [reporteInicial, categorias, emisores, proveedores] = await Promise.all([
    obtenerReporte({ desde: inicioMes, hasta: aISO(hoy) }),
    listarCategorias(),
    listarEmisores(),
    obtenerProveedoresDisponiblesIA(),
  ]);

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reportes</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          En qué se va la plata y dónde hay margen para ahorrar.
        </p>
      </div>

      <ReportesView
        reporteInicial={reporteInicial}
        categorias={categorias}
        emisores={emisores}
        proveedoresIA={proveedores.disponibles}
        proveedorActivoIA={proveedores.activo}
      />
    </PageContainer>
  );
}
