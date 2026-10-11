import { redirect } from "next/navigation";
import { listarCategorias } from "@/app/actions/catalogos";
import { obtenerProveedoresDisponiblesIA } from "@/app/actions/configuracion";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  obtenerEntranteParaRevision,
  obtenerResumenBandeja,
} from "@/app/actions/entrantes";
import { NuevoGastoForm } from "@/components/nuevo-gasto-form";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function NuevoGastoPage({
  searchParams,
}: {
  searchParams: Promise<{ entrante?: string }>;
}) {
  const entranteId = Number((await searchParams).entrante);
  const [categorias, ia, bandeja, entrante] = await Promise.all([
    listarCategorias(),
    obtenerProveedoresDisponiblesIA(),
    obtenerResumenBandeja(),
    Number.isInteger(entranteId) && entranteId > 0
      ? obtenerEntranteParaRevision(entranteId)
      : null,
  ]);
  // Un entrante que ya se resolvió o se descartó manda de vuelta a la bandeja
  // en vez de abrir un formulario vacío que parece el suyo.
  if (entranteId && !entrante) redirect("/bandeja");

  return (
    <PageContainer maxWidth="6xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Inicio</span>
        <span>/</span>
        <span className="font-medium text-foreground">Cargar gasto</span>
      </div>

      {!entrante && bandeja.bloqueada ? (
        <Card className="items-start gap-3 px-5 py-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="h-4 w-4 text-muted-foreground" />
            La carga de gastos está bloqueada
          </div>
          <p className="text-sm text-muted-foreground">
            {bandeja.atrasados === 1
              ? "Queda 1 comprobante de un mes anterior"
              : `Quedan ${bandeja.atrasados} comprobantes de un mes anterior`}{" "}
            en la bandeja de entrada. Hasta que se guarden o se descarten no se
            pueden cargar gastos nuevos, para que ese mes no quede incompleto.
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/bandeja">Ir a la bandeja</Link>}
          />
        </Card>
      ) : (
        <NuevoGastoForm
          categoriasIniciales={categorias}
          proveedoresIA={ia.disponibles}
          proveedorActivoIA={ia.activo}
          entranteInicial={entrante ?? undefined}
        />
      )}
    </PageContainer>
  );
}
