import { listarCategorias } from "@/app/actions/catalogos";
import { obtenerProveedoresDisponiblesIA } from "@/app/actions/configuracion";
import { NuevoGastoForm } from "@/components/nuevo-gasto-form";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function NuevoGastoPage() {
  const [categorias, ia] = await Promise.all([
    listarCategorias(),
    obtenerProveedoresDisponiblesIA(),
  ]);

  return (
    <PageContainer maxWidth="6xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Inicio</span>
        <span>/</span>
        <span className="font-medium text-foreground">Cargar gasto</span>
      </div>

      <NuevoGastoForm
        categoriasIniciales={categorias}
        proveedoresIA={ia.disponibles}
        proveedorActivoIA={ia.activo}
      />
    </PageContainer>
  );
}
