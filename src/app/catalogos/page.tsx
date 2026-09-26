import {
  listarCategorias,
  listarItemsCatalogo,
  listarEmisores,
  listarProveedoresCfe,
  contarComprasPorItem,
  listarItemsSimilaresDescartados,
} from "@/app/actions/catalogos";
import { CatalogosView } from "@/components/catalogos-view";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function CatalogosPage({
  searchParams,
}: {
  searchParams: Promise<{ [clave: string]: string | string[] | undefined }>;
}) {
  const [categorias, items, emisores, proveedores, compras, descartados, params] =
    await Promise.all([
      listarCategorias(),
      listarItemsCatalogo(),
      listarEmisores(),
      listarProveedoresCfe(),
      contarComprasPorItem(),
      listarItemsSimilaresDescartados(),
      searchParams,
    ]);

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Catálogos</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Categorías, ítems, comercios y proveedores de CFE reutilizables al cargar un gasto.
        </p>
      </div>

      <CatalogosView
        categoriasIniciales={categorias}
        itemsIniciales={items}
        emisoresIniciales={emisores.filter((e) => !e.esGenerico)}
        proveedoresIniciales={proveedores}
        comprasPorItemIniciales={compras}
        similaresDescartados={descartados}
        abrirSimilares={params.similares !== undefined}
      />
    </PageContainer>
  );
}
