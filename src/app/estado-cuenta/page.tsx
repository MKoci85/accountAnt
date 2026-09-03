import { listarCategorias } from "@/app/actions/catalogos";
import { obtenerProveedoresDisponiblesIA } from "@/app/actions/configuracion";
import { EstadoCuentaView } from "@/components/estado-cuenta-view";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function EstadosCuentaPage() {
  const [categorias, ia] = await Promise.all([
    listarCategorias(),
    obtenerProveedoresDisponiblesIA(),
  ]);

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Estado de cuenta
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Subí el PDF del estado de cuenta de tu tarjeta y cargá de una lo que
          hoy queda afuera: combustible, telepeaje y suscripciones. Cada línea
          es una compra distinta — la foto de un ticket, que es UNA compra con
          varios ítems, se lee desde Nuevo gasto.
        </p>
      </div>

      <EstadoCuentaView
        categorias={categorias}
        proveedoresIA={ia.disponibles}
        proveedorActivoIA={ia.activo}
      />
    </PageContainer>
  );
}
