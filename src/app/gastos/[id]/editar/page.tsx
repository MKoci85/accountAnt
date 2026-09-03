import Link from "next/link";
import { listarCategorias } from "@/app/actions/catalogos";
import { obtenerGasto } from "@/app/actions/gastos";
import { NuevoGastoForm } from "@/components/nuevo-gasto-form";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function EditarGastoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ revision?: string; paso?: string; detalle?: string }>;
}) {
  const { id } = await params;
  const gastoId = Number(id);
  const {
    revision: revisionParam,
    paso: pasoParam,
    detalle: detalleParam,
  } = await searchParams;

  const cola = (revisionParam ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const paso = Number(pasoParam);
  const revision =
    cola.length > 0 && cola.includes(gastoId)
      ? {
          gastoIds: cola,
          paso: Number.isInteger(paso) && paso >= 0 && paso < cola.length
            ? paso
            : cola.indexOf(gastoId),
          detalle: detalleParam === "1",
        }
      : undefined;

  const [categorias, gasto] = await Promise.all([
    listarCategorias(),
    obtenerGasto(gastoId),
  ]);

  return (
    <PageContainer maxWidth="6xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {revision ? (
          <>
            <Link href="/estado-cuenta" className="hover:text-foreground">
              Estado de cuenta
            </Link>
            <span>/</span>
            <span className="font-medium text-foreground">
              Revisar importación
            </span>
          </>
        ) : (
          <>
            <Link href="/gastos" className="hover:text-foreground">
              Gastos
            </Link>
            <span>/</span>
            <Link href={`/gastos/${gastoId}`} className="hover:text-foreground">
              {gasto.emisorNombre}
            </Link>
            <span>/</span>
            <span className="font-medium text-foreground">Editar</span>
          </>
        )}
      </div>

      <NuevoGastoForm
        categoriasIniciales={categorias}
        gastoInicial={gasto}
        revision={revision}
      />
    </PageContainer>
  );
}
