"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NuevaCategoriaDialog } from "@/components/nueva-categoria-dialog";
import { EmisorDialog } from "@/components/emisor-dialog";
import { ProveedorCfeDialog } from "@/components/proveedor-cfe-dialog";
import { ConfirmarBorradoDialog } from "@/components/confirmar-borrado-dialog";
import {
  NuevoItemDialog,
  draftItemVacio,
  draftDesdeItem,
  type ItemCatalogoConCategoria,
  type NuevoItemDraft,
} from "@/components/nuevo-item-dialog";
import {
  borrarCategoria,
  borrarItemCatalogo,
  borrarEmisor,
  borrarProveedorCfe,
} from "@/app/actions/catalogos";
import { buscarProcesador } from "@/lib/procesadores";
import type { categorias, emisores, proveedoresCfe } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;
type Emisor = typeof emisores.$inferSelect;
type ProveedorCfe = typeof proveedoresCfe.$inferSelect;

type Borrado =
  | { tipo: "categoria"; item: Categoria }
  | { tipo: "item"; item: ItemCatalogoConCategoria }
  | { tipo: "emisor"; item: Emisor }
  | { tipo: "proveedor"; item: ProveedorCfe };

type TipoBorrado = Borrado["tipo"];

const tabs = [
  { key: "categorias", label: "Categorías" },
  { key: "items", label: "Ítems" },
  { key: "emisores", label: "Comercios" },
  { key: "proveedores", label: "Proveedores de CFE" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const SUSTANTIVO_BORRADO: Record<TipoBorrado, string> = {
  categoria: "categoría",
  item: "ítem",
  emisor: "comercio",
  proveedor: "proveedor de CFE",
};

function ordenarPorNombre<T extends { nombre: string | null }>(lista: T[]) {
  return [...lista].sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""));
}

const opcionesPorPagina = [5, 10, 20, 50] as const;

function paginar<T>(lista: T[], pagina: number, porPagina: number) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const paginaDatos = lista.slice(
    (paginaActual - 1) * porPagina,
    paginaActual * porPagina
  );
  return { paginaActual, totalPaginas, paginaDatos };
}

function PiePaginacion({
  total,
  mostrando,
  paginaActual,
  totalPaginas,
  porPagina,
  onCambiarPagina,
  onCambiarPorPagina,
}: {
  total: number;
  mostrando: number;
  paginaActual: number;
  totalPaginas: number;
  porPagina: number;
  onCambiarPagina: (pagina: number) => void;
  onCambiarPorPagina: (porPagina: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col items-start gap-3 border-t px-5 py-3 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span>
          Mostrando {mostrando} de {total}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" />
            }
          >
            Por página: <span className="font-semibold text-foreground">{porPagina}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={String(porPagina)}
              onValueChange={(v) => onCambiarPorPagina(Number(v))}
            >
              {opcionesPorPagina.map((n) => (
                <DropdownMenuRadioItem key={n} value={String(n)} closeOnClick>
                  {n}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={paginaActual <= 1}
            onClick={() => onCambiarPagina(paginaActual - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span>
            Página {paginaActual} de {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={paginaActual >= totalPaginas}
            onClick={() => onCambiarPagina(paginaActual + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function CatalogosView({
  categoriasIniciales,
  itemsIniciales,
  emisoresIniciales,
  proveedoresIniciales,
}: {
  categoriasIniciales: Categoria[];
  itemsIniciales: ItemCatalogoConCategoria[];
  emisoresIniciales: Emisor[];
  proveedoresIniciales: ProveedorCfe[];
}) {
  const [tab, setTab] = useState<TabKey>("categorias");

  const [categoriasList, setCategoriasList] = useState(categoriasIniciales);
  const [itemsList, setItemsList] = useState(itemsIniciales);
  const [emisoresList, setEmisoresList] = useState(emisoresIniciales);
  const [proveedoresList, setProveedoresList] = useState(proveedoresIniciales);

  const [porPagina, setPorPagina] = useState<number>(10);
  const [numPaginaCategorias, setNumPaginaCategorias] = useState(1);
  const [numPaginaItems, setNumPaginaItems] = useState(1);
  const [numPaginaEmisores, setNumPaginaEmisores] = useState(1);
  const [numPaginaProveedores, setNumPaginaProveedores] = useState(1);

  function aplicarPorPagina(n: number) {
    setPorPagina(n);
    setNumPaginaCategorias(1);
    setNumPaginaItems(1);
    setNumPaginaEmisores(1);
    setNumPaginaProveedores(1);
  }

  const paginaCategorias = paginar(categoriasList, numPaginaCategorias, porPagina);
  const paginaItems = paginar(itemsList, numPaginaItems, porPagina);
  const paginaEmisores = paginar(emisoresList, numPaginaEmisores, porPagina);
  const paginaProveedores = paginar(proveedoresList, numPaginaProveedores, porPagina);

  const [categoriaDialogOpen, setCategoriaDialogOpen] = useState(false);
  const [categoriaEditando, setCategoriaEditando] = useState<Categoria | null>(null);

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemDraft, setItemDraft] = useState<NuevoItemDraft>(draftItemVacio);
  const [itemEditandoId, setItemEditandoId] = useState<number | null>(null);
  const [reabrirItemDialog, setReabrirItemDialog] = useState(false);

  function nombreProveedor(id: number | null) {
    return proveedoresList.find((p) => p.id === id)?.nombre ?? null;
  }

  const [emisorDialogOpen, setEmisorDialogOpen] = useState(false);
  const [emisorEditando, setEmisorEditando] = useState<Emisor | null>(null);
  const [proveedorDialogOpen, setProveedorDialogOpen] = useState(false);
  const [proveedorEditando, setProveedorEditando] =
    useState<ProveedorCfe | null>(null);

  const [borrado, setBorrado] = useState<Borrado | null>(null);

  async function handleConfirmarBorrado() {
    if (!borrado) return;
    if (borrado.tipo === "categoria") {
      await borrarCategoria(borrado.item.id);
      setCategoriasList((prev) => prev.filter((c) => c.id !== borrado.item.id));
    } else if (borrado.tipo === "item") {
      await borrarItemCatalogo(borrado.item.id);
      setItemsList((prev) => prev.filter((i) => i.id !== borrado.item.id));
    } else if (borrado.tipo === "emisor") {
      await borrarEmisor(borrado.item.id);
      setEmisoresList((prev) => prev.filter((e) => e.id !== borrado.item.id));
    } else {
      await borrarProveedorCfe(borrado.item.id);
      setProveedoresList((prev) =>
        prev.filter((p) => p.id !== borrado.item.id)
      );
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1.5 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "categorias" && (
        <Card className="py-0">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <span className="text-sm font-semibold">
              Categorías{" "}
              <span className="font-normal text-muted-foreground">
                ({categoriasList.length})
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setCategoriaEditando(null);
                setCategoriaDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Nueva categoría
            </Button>
          </div>
          <div className="divide-y">
            {paginaCategorias.paginaDatos.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="flex items-center gap-2">
                  {c.color && (
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-foreground/10"
                      style={{ backgroundColor: c.color }}
                    />
                  )}
                  <div>
                    <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                      {c.nombre}
                      {c.esServicio && (
                        <Badge variant="secondary" className="text-[10px]">
                          Servicio
                        </Badge>
                      )}
                    </div>
                    {c.descripcion && (
                      <div className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">
                        {c.descripcion}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setCategoriaEditando(c);
                      setCategoriaDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setBorrado({ tipo: "categoria", item: c })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            {categoriasList.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                Todavía no hay categorías.
              </div>
            )}
          </div>
          <PiePaginacion
            total={categoriasList.length}
            mostrando={paginaCategorias.paginaDatos.length}
            paginaActual={paginaCategorias.paginaActual}
            totalPaginas={paginaCategorias.totalPaginas}
            porPagina={porPagina}
            onCambiarPagina={setNumPaginaCategorias}
            onCambiarPorPagina={aplicarPorPagina}
          />
        </Card>
      )}

      {tab === "items" && (
        <Card className="py-0">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <span className="text-sm font-semibold">
              Ítems del catálogo{" "}
              <span className="font-normal text-muted-foreground">
                ({itemsList.length})
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setItemEditandoId(null);
                setItemDraft(draftItemVacio);
                setItemDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo ítem
            </Button>
          </div>
          <div className="divide-y">
            {paginaItems.paginaDatos.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-5 py-3"
              >
                <div>
                  <div className="text-[13.5px] font-medium">{item.nombre}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {[item.marca, item.tamano].filter(Boolean).join(" · ")}
                  </div>
                  {item.descripcion && (
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/80 italic">
                      {item.descripcion}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{item.categoriaNombre}</Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setItemEditandoId(item.id);
                      setItemDraft(draftDesdeItem(item));
                      setItemDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setBorrado({ tipo: "item", item })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            {itemsList.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                Todavía no hay ítems catalogados.
              </div>
            )}
          </div>
          <PiePaginacion
            total={itemsList.length}
            mostrando={paginaItems.paginaDatos.length}
            paginaActual={paginaItems.paginaActual}
            totalPaginas={paginaItems.totalPaginas}
            porPagina={porPagina}
            onCambiarPagina={setNumPaginaItems}
            onCambiarPorPagina={aplicarPorPagina}
          />
        </Card>
      )}

      {tab === "emisores" && (
        <Card className="py-0">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <span className="text-sm font-semibold">
              Comercios{" "}
              <span className="font-normal text-muted-foreground">
                ({emisoresList.length})
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setEmisorEditando(null);
                setEmisorDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo comercio
            </Button>
          </div>
          <div className="divide-y">
            {paginaEmisores.paginaDatos.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between px-5 py-3"
              >
                <div>
                  <div className="text-[13.5px] font-medium">{e.nombre}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {e.ruc ? `RUC ${e.ruc}` : "Sin RUC"}
                    {nombreProveedor(e.proveedorCfeId)
                      ? ` · ${nombreProveedor(e.proveedorCfeId)}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {e.ruc && !e.proveedorCfeId && (
                    <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                      Sin proveedor
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setEmisorEditando(e);
                      setEmisorDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setBorrado({ tipo: "emisor", item: e })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            {emisoresList.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                Todavía no hay comercios.
              </div>
            )}
          </div>
          <PiePaginacion
            total={emisoresList.length}
            mostrando={paginaEmisores.paginaDatos.length}
            paginaActual={paginaEmisores.paginaActual}
            totalPaginas={paginaEmisores.totalPaginas}
            porPagina={porPagina}
            onCambiarPagina={setNumPaginaEmisores}
            onCambiarPorPagina={aplicarPorPagina}
          />
        </Card>
      )}

      {tab === "proveedores" && (
        <Card className="py-0">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <span className="text-sm font-semibold">
              Proveedores de CFE{" "}
              <span className="font-normal text-muted-foreground">
                ({proveedoresList.length})
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setProveedorEditando(null);
                setProveedorDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo proveedor
            </Button>
          </div>
          <div className="divide-y">
            {paginaProveedores.paginaDatos.map((p) => {
              const comercios = emisoresList.filter(
                (e) => e.proveedorCfeId === p.id
              ).length;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-5 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="text-[13.5px] font-medium">{p.nombre}</div>
                      {!buscarProcesador(p.formato)?.soportado && (
                        <Badge variant="outline" className="text-[10.5px]">
                          sin detalle de ítems
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {p.urlConsulta}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {comercios === 1
                        ? "1 comercio"
                        : `${comercios} comercios`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setProveedorEditando(p);
                        setProveedorDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setBorrado({ tipo: "proveedor", item: p })}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {proveedoresList.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                Todavía no hay proveedores de CFE.
              </div>
            )}
          </div>
          <PiePaginacion
            total={proveedoresList.length}
            mostrando={paginaProveedores.paginaDatos.length}
            paginaActual={paginaProveedores.paginaActual}
            totalPaginas={paginaProveedores.totalPaginas}
            porPagina={porPagina}
            onCambiarPagina={setNumPaginaProveedores}
            onCambiarPorPagina={aplicarPorPagina}
          />
        </Card>
      )}

      <ProveedorCfeDialog
        key={`proveedor-${proveedorEditando?.id ?? "nuevo"}`}
        open={proveedorDialogOpen}
        onOpenChange={(open) => {
          setProveedorDialogOpen(open);
          if (!open) setProveedorEditando(null);
        }}
        proveedorExistente={proveedorEditando}
        onGuardado={(proveedor) =>
          setProveedoresList((prev) =>
            ordenarPorNombre(
              prev.some((p) => p.id === proveedor.id)
                ? prev.map((p) => (p.id === proveedor.id ? proveedor : p))
                : [...prev, proveedor]
            )
          )
        }
      />

      <NuevaCategoriaDialog
        key={`categoria-${categoriaEditando?.id ?? "nueva"}`}
        open={categoriaDialogOpen}
        onOpenChange={(open) => {
          setCategoriaDialogOpen(open);
          if (!open && reabrirItemDialog) {
            setReabrirItemDialog(false);
            setItemDialogOpen(true);
          }
        }}
        categoriaExistente={categoriaEditando}
        onCreada={(categoria) => {
          setCategoriasList((prev) => ordenarPorNombre([...prev, categoria]));
          if (reabrirItemDialog) {
            setItemDraft((prev) => ({ ...prev, categoriaId: categoria.id }));
          }
        }}
        onEditada={(categoria) =>
          setCategoriasList((prev) =>
            ordenarPorNombre(prev.map((c) => (c.id === categoria.id ? categoria : c)))
          )
        }
      />

      <NuevoItemDialog
        open={itemDialogOpen}
        onOpenChange={(open) => {
          setItemDialogOpen(open);
          if (!open && !reabrirItemDialog) setItemDraft(draftItemVacio);
        }}
        draft={itemDraft}
        onDraftChange={setItemDraft}
        categorias={categoriasList}
        itemExistenteId={itemEditandoId}
        onCategoriaFaltante={() => {
          setItemDialogOpen(false);
          setReabrirItemDialog(true);
          setCategoriaDialogOpen(true);
        }}
        onCreado={(item) =>
          setItemsList((prev) => ordenarPorNombre([...prev, item]))
        }
        onEditado={(item) =>
          setItemsList((prev) =>
            ordenarPorNombre(prev.map((i) => (i.id === item.id ? item : i)))
          )
        }
      />

      <EmisorDialog
        key={`emisor-${emisorEditando?.id ?? "nuevo"}`}
        open={emisorDialogOpen}
        onOpenChange={setEmisorDialogOpen}
        emisorExistente={emisorEditando}
        proveedores={proveedoresList}
        onCreado={(emisor) =>
          setEmisoresList((prev) => ordenarPorNombre([...prev, emisor]))
        }
        onEditado={(emisor) =>
          setEmisoresList((prev) =>
            ordenarPorNombre(prev.map((e) => (e.id === emisor.id ? emisor : e)))
          )
        }
      />

      {borrado && (
        <ConfirmarBorradoDialog
          open={!!borrado}
          onOpenChange={(open) => {
            if (!open) setBorrado(null);
          }}
          titulo={`Borrar ${SUSTANTIVO_BORRADO[borrado.tipo]} "${borrado.item.nombre}"`}
          descripcion="Esta acción no se puede deshacer. Si el registro está en uso, no se va a poder borrar."
          onConfirmar={handleConfirmarBorrado}
        />
      )}
    </div>
  );
}
