"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  Pencil,
  ListChecks,
  ScanLine,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  buscarEmisores,
  buscarItemsCatalogo,
  crearEmisor,
  obtenerEmisor,
  listarProveedoresCfe,
  obtenerOCrearEmisorGenerico,
} from "@/app/actions/catalogos";
import {
  crearGasto,
  editarGasto,
  obtenerReferenciasDePrecio,
  type GastoDetalle,
} from "@/app/actions/gastos";
import { NuevaCategoriaDialog } from "@/components/nueva-categoria-dialog";
import {
  NuevoItemDialog,
  draftItemVacio,
  draftDesdeItem,
  type ItemCatalogoConCategoria,
  type NuevoItemDraft,
} from "@/components/nuevo-item-dialog";
import { EscanerComprobante, type LineaDesdeTicket } from "@/components/escaner-comprobante";
import { LectorTicketIA } from "@/components/lector-ticket-ia";
import type { ResultadoTicketIA } from "@/app/actions/cfe";
import { EmisorDialog } from "@/components/emisor-dialog";
import { LineaGastoFila } from "@/components/linea-gasto-fila";
import { ComboboxBusqueda } from "@/components/combobox-busqueda";
import { ITEM_PAGO_TARJETA } from "@/lib/clasificacion-comercios";
import {
  superaReferencia,
  claveReferencia,
  formatearCantidadConUnidad,
  MARGEN_SOBREPRECIO_POR_PESO_DEFAULT,
} from "@/lib/precios-referencia";
import { formatearMonto, hoyISO } from "@/lib/formato";
import {
  lineaDeServicioNueva,
  lineasDesdeGasto,
  lineasDesdeTicket,
  montoDeLinea,
  normalizarLineasDeServicio,
  type LineaGasto,
} from "@/lib/lineas-gasto";
import { useDebounced } from "@/hooks/use-debounced";
import type { ProveedorIA } from "@/lib/proveedores-ia";
import type { categorias, emisores, proveedoresCfe } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;
type Emisor = typeof emisores.$inferSelect;
type ProveedorCfe = typeof proveedoresCfe.$inferSelect;

function destinoSiguiente(revision: RevisionImportacion): string {
  const siguiente = revision.gastoIds[revision.paso + 1];
  if (siguiente === undefined) {
    return `/estado-cuenta?importados=${revision.gastoIds.length}`;
  }
  return `/gastos/${siguiente}/editar?revision=${revision.gastoIds.join(
    ","
  )}&paso=${revision.paso + 1}${revision.detalle ? "&detalle=1" : ""}`;
}

function huellaFormulario(
  fecha: string,
  emisorId: number | null,
  lineas: LineaGasto[]
): string {
  return JSON.stringify([
    fecha,
    emisorId,
    lineas.map((l) => [
      l.item.id,
      l.item.nombre,
      l.categoriaId,
      l.cantidad,
      l.precio,
      l.unidad,
      l.esHormiga,
      l.esSobreprecio,
      l.esPrecioBase,
      l.esPesoDesconocido,
    ]),
  ]);
}

export type RevisionImportacion = {
  gastoIds: number[];
  paso: number;
  detalle: boolean;
};

export function NuevoGastoForm({
  categoriasIniciales,
  gastoInicial,
  revision,
  proveedoresIA = [],
  proveedorActivoIA,
}: {
  categoriasIniciales: Categoria[];
  gastoInicial?: GastoDetalle;
  revision?: RevisionImportacion;
  proveedoresIA?: { id: ProveedorIA; nombre: string; modelo: string }[];
  proveedorActivoIA?: ProveedorIA;
}) {
  const [categoriasList, setCategoriasList] = useState(categoriasIniciales);

  const [fecha, setFecha] = useState(gastoInicial?.fecha ?? hoyISO());

  const [emisorQuery, setEmisorQuery] = useState(
    gastoInicial?.emisorNombre ?? ""
  );
  const [emisorSeleccionado, setEmisorSeleccionado] = useState<Emisor | null>(
    gastoInicial
      ? {
          id: gastoInicial.emisorId,
          nombre: gastoInicial.emisorNombre,
          ruc: gastoInicial.emisorRuc,
          proveedorCfeId: null,
          esGenerico: false,
        }
      : null
  );
  const [resultadosEmisorRaw, setResultadosEmisor] = useState<Emisor[]>([]);
  const debouncedEmisorQuery = useDebounced(emisorQuery);
  const [emisorDialogOpen, setEmisorDialogOpen] = useState(false);
  const [emisorAEditar, setEmisorAEditar] = useState<Emisor | null>(null);
  const [cargandoEmisor, setCargandoEmisor] = useState(false);
  const [proveedoresCfeList, setProveedoresCfeList] = useState<ProveedorCfe[]>([]);

  const [itemQuery, setItemQuery] = useState("");
  const [resultadosItemRaw, setResultadosItem] = useState<ItemCatalogoConCategoria[]>([]);
  const debouncedItemQuery = useDebounced(itemQuery);
  const buscadorItemRef = useRef<HTMLInputElement | null>(null);
  const [inicio] = useState(() =>
    normalizarLineasDeServicio(
      gastoInicial ? lineasDesdeGasto(gastoInicial, revision?.detalle) : [],
      categoriasIniciales
    )
  );
  const [lineas, setLineas] = useState<LineaGasto[]>(inicio.lineas);

  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [datosCfe, setDatosCfe] = useState<{
    tipoCfe: string;
    serie: string;
    numero: string;
  } | null>(null);
  const [totalComprobante, setTotalComprobante] = useState<number | null>(null);

  const [categoriaDialogOpen, setCategoriaDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemDraft, setItemDraft] = useState<NuevoItemDraft>(draftItemVacio);
  const [reabrirItemDialog, setReabrirItemDialog] = useState(false);
  const [lineaProvisoriaAResolver, setLineaProvisoriaAResolver] = useState<
    string | null
  >(null);
  const [itemCatalogoAEditar, setItemCatalogoAEditar] = useState<number | null>(
    null
  );

  const [referencias, setReferencias] = useState<Map<string, number>>(new Map());
  const [margenSobreprecio, setMargenSobreprecio] = useState(
    MARGEN_SOBREPRECIO_POR_PESO_DEFAULT
  );

  const [guardando, startGuardado] = useTransition();
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);

  const huellaActual = huellaFormulario(
    fecha,
    emisorSeleccionado?.id ?? null,
    lineas
  );
  const [huellaInicial] = useState(huellaActual);
  const hayCambiosSinGuardar = huellaActual !== huellaInicial && !guardando;

  useEffect(() => {
    if (!hayCambiosSinGuardar) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [hayCambiosSinGuardar]);

  function confirmarSalida(e: React.MouseEvent) {
    if (!hayCambiosSinGuardar) return;
    const seguir = window.confirm(
      "Hay ítems cargados que todavía no se guardaron. ¿Salir y perderlos?"
    );
    if (!seguir) e.preventDefault();
  }

  useEffect(() => {
    const query = debouncedEmisorQuery.trim();
    if (!query || emisorSeleccionado) return;
    let cancelado = false;
    buscarEmisores(query).then((r) => {
      if (!cancelado) setResultadosEmisor(r);
    });
    return () => {
      cancelado = true;
    };
  }, [debouncedEmisorQuery, emisorSeleccionado]);

  useEffect(() => {
    const query = debouncedItemQuery.trim();
    if (!query) return;
    let cancelado = false;
    buscarItemsCatalogo(query).then((r) => {
      if (!cancelado) setResultadosItem(r);
    });
    return () => {
      cancelado = true;
    };
  }, [debouncedItemQuery]);

  const resultadosEmisor =
    debouncedEmisorQuery.trim() && !emisorSeleccionado
      ? resultadosEmisorRaw
      : [];
  const resultadosItem = debouncedItemQuery.trim() ? resultadosItemRaw : [];

  function seleccionarEmisor(e: Emisor) {
    setEmisorSeleccionado(e);
    setEmisorQuery(e.nombre);
  }

  async function crearEmisorAlVuelo() {
    const nombre = emisorQuery.trim();
    if (!nombre) return;
    const emisor = await crearEmisor({ nombre });
    seleccionarEmisor(emisor);
  }

  async function usarEmisorGenerico() {
    const emisor = await obtenerOCrearEmisorGenerico();
    seleccionarEmisor(emisor);
  }

  async function abrirEdicionEmisor() {
    if (!emisorSeleccionado) return;
    setCargandoEmisor(true);
    try {
      const [completo, proveedores] = await Promise.all([
        obtenerEmisor(emisorSeleccionado.id),
        listarProveedoresCfe(),
      ]);
      if (!completo) return;
      setProveedoresCfeList(proveedores);
      setEmisorAEditar(completo);
      setEmisorDialogOpen(true);
    } finally {
      setCargandoEmisor(false);
    }
  }

  function emisorEditado(emisor: Emisor) {
    setEmisorSeleccionado(emisor);
    setEmisorQuery(emisor.nombre);
    setResultadosEmisor((prev) =>
      prev.map((e) => (e.id === emisor.id ? emisor : e))
    );
  }

  function agregarLinea(item: ItemCatalogoConCategoria) {
    setLineas((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        item,
        categoriaId: item.categoriaId,
        categoriaNombre: item.categoriaNombre,
        cantidad: 1,
        precio: "",
        unidad: "un",
        esHormiga: false,
        esSobreprecio: false,
        sobreprecioManual: false,
        esPrecioBase: false,
        esPesoDesconocido: false,
        bloqueada: false,
      },
    ]);
    setItemQuery("");
    setResultadosItem([]);
    setItemDraft(draftItemVacio);
    buscadorItemRef.current?.focus();
  }

  function setLineasNormalizadas(nuevas: LineaGasto[]) {
    setLineas(normalizarLineasDeServicio(nuevas, categoriasList).lineas);
  }

  function agregarLineaDeServicio() {
    const categoria =
      categoriasList.find((c) => c.esServicio) ?? categoriasList[0];
    if (!categoria) return;
    setLineas((prev) => [...prev, lineaDeServicioNueva(categoria)]);
  }

  function quitarLinea(key: string) {
    setLineas((prev) => prev.filter((l) => l.key !== key));
  }

  function renombrarLinea(key: string, nombre: string) {
    setLineas((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              item: {
                ...l.item,
                id: l.item.id > 0 ? -1 : l.item.id,
                nombre,
                marca: null,
                tamano: null,
              },
            }
          : l
      )
    );
  }

  function crearItemParaLinea(linea: LineaGasto) {
    setItemDraft({
      ...draftItemVacio,
      nombre: linea.item.nombre,
      tamano: linea.item.tamano ?? "",
    });
    setLineaProvisoriaAResolver(linea.key);
    setItemCatalogoAEditar(null);
    setItemDialogOpen(true);
  }

  function abrirEdicionItemCatalogo(linea: LineaGasto) {
    setItemDraft(draftDesdeItem(linea.item));
    setItemCatalogoAEditar(linea.item.id);
    setItemDialogOpen(true);
  }

  function itemCatalogoEditado(item: ItemCatalogoConCategoria) {
    setLineas((prev) =>
      prev.map((l) =>
        l.item.id === item.id
          ? {
              ...l,
              item,
              categoriaId: item.categoriaId,
              categoriaNombre: item.categoriaNombre,
            }
          : l
      )
    );
  }

  function resolverLineaProvisoria(key: string, item: ItemCatalogoConCategoria) {
    setLineas((prev) =>
      prev.map((l) =>
          l.key === key
          ? {
              ...l,
              item,
              categoriaId: item.categoriaId,
              categoriaNombre: item.categoriaNombre,
              genericaEditable: false,
            }
          : l
      )
    );
  }

  function handleComprobanteResuelto(datos: {
    emisor: Emisor;
    tipoCfe: string;
    serie: string;
    numero: string;
    fecha: string;
    lineas: LineaDesdeTicket[];
    total: number | null;
    avisoMoneda: string | null;
  }) {
    seleccionarEmisor(datos.emisor);
    setDatosCfe({
      tipoCfe: datos.tipoCfe,
      serie: datos.serie,
      numero: datos.numero,
    });
    setFecha(datos.fecha);
    setLineasNormalizadas(lineasDesdeTicket(datos.lineas));
    setTotalComprobante(datos.avisoMoneda ? null : datos.total);
  }

  async function handleTicketIAResuelto(ticket: ResultadoTicketIA) {
    setTotalComprobante(null);
    setLineasNormalizadas(
      lineasDesdeTicket(
        ticket.items.map((item) => ({
          nombreTicket: item.nombreTicket,
          precio: item.precio,
          tamanoTicket: item.tamanoTicket,
          unidadesTicket: item.unidadesTicket,
          pesoTicket: item.pesoTicket,
          precioPorKiloTicket: item.precioPorKiloTicket,
          itemCatalogo: item.itemCatalogo,
          categoriaSugerida: item.categoriaSugerida,
          bloqueada: item.itemCatalogo !== null,
        }))
      )
    );
    if (ticket.fecha) setFecha(ticket.fecha);

    if (ticket.comercio) {
      setEmisorQuery(ticket.comercio);
      const encontrados = await buscarEmisores(ticket.comercio);
      const exacto = encontrados.find(
        (e) => e.nombre.toLowerCase() === ticket.comercio.toLowerCase()
      );
      if (exacto) seleccionarEmisor(exacto);
    }
  }

  function actualizarLinea(key: string, cambios: Partial<LineaGasto>) {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const actualizada = { ...l, ...cambios };
        if (cambios.unidad && cambios.unidad !== l.unidad) {
          actualizada.cantidad = 1;
        }
        return normalizarLineasDeServicio([actualizada], categoriasList)
          .lineas[0];
      })
    );
  }

  const idsConReferencia = lineas
    .map((l) => l.item.id)
    .filter((id) => id > 0)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    const ids = idsConReferencia
      .split(",")
      .filter(Boolean)
      .map(Number);
    if (!ids.length || !fecha) return;
    let cancelado = false;
    obtenerReferenciasDePrecio(ids, fecha, gastoInicial?.id).then((r) => {
      if (cancelado) return;
      setReferencias(
        new Map(
          r.referencias.map((ref) => [
            claveReferencia(ref.itemCatalogoId, ref.unidad),
            ref.precio,
          ])
        )
      );
      setMargenSobreprecio(r.margen);
    });
    return () => {
      cancelado = true;
    };
  }, [idsConReferencia, fecha, gastoInicial?.id]);

  function referenciaDeLinea(linea: LineaGasto) {
    if (linea.item.id <= 0 || linea.item.nombre === ITEM_PAGO_TARJETA) {
      return undefined;
    }
    return referencias.get(claveReferencia(linea.item.id, linea.unidad));
  }

  function sobreprecioDeLinea(linea: LineaGasto) {
    if (linea.esPesoDesconocido) return false;
    if (linea.esPrecioBase) return false;
    if (linea.sobreprecioManual) return linea.esSobreprecio;
    if (linea.esSobreprecio) return true;
    const referencia = referenciaDeLinea(linea);
    const precio = montoDeLinea(linea.precio);
    if (referencia === undefined || precio <= 0) return false;
    return superaReferencia(
      precio,
      referencia,
      linea.unidad,
      margenSobreprecio
    );
  }

  function handleCategoriaCreada(categoria: Categoria) {
    setCategoriasList((prev) =>
      [...prev, categoria].sort((a, b) => a.nombre.localeCompare(b.nombre))
    );
    if (reabrirItemDialog) {
      setItemDraft((prev) => ({ ...prev, categoriaId: categoria.id }));
    }
  }

  const total = lineas.reduce(
    (acc, l) => acc + montoDeLinea(l.precio) * l.cantidad,
    0
  );

  const diferenciaComprobante =
    totalComprobante !== null &&
    Math.abs(totalComprobante - total) > 1
      ? Number((totalComprobante - total).toFixed(2))
      : null;

  function motivoNoGuardable(): string | null {
    if (!fecha) return "Falta la fecha del gasto.";
    if (!emisorSeleccionado) return "Falta elegir el comercio.";
    if (lineas.length === 0) return "Agregá al menos un ítem.";

    const sinNombre = lineas.filter(
      (l) => l.item.id <= 0 && !l.item.nombre.trim()
    );
    if (sinNombre.length > 0) {
      return sinNombre.length === 1
        ? "Falta el nombre de una de las líneas."
        : `Faltan los nombres de ${sinNombre.length} líneas.`;
    }

    const sinCatalogar = lineas.filter(
      (l) => l.item.id < 0 && l.item.id !== -1
    );
    if (sinCatalogar.length > 0) {
      return sinCatalogar.length === 1
        ? `Falta vincular al catálogo: ${sinCatalogar[0].item.nombre}.`
        : `Faltan vincular al catálogo ${sinCatalogar.length} ítems.`;
    }

    const sinPrecio = lineas.filter((l) => montoDeLinea(l.precio) <= 0);
    if (sinPrecio.length > 0) {
      return sinPrecio.length === 1
        ? `Falta el precio de ${sinPrecio[0].item.nombre}.`
        : `Faltan los precios de ${sinPrecio.length} ítems.`;
    }
    return null;
  }

  const motivo = motivoNoGuardable();
  const puedeGuardar = motivo === null;

  function handleGuardarGasto() {
    if (!emisorSeleccionado || !puedeGuardar) return;
    setErrorGuardado(null);
    startGuardado(async () => {
      try {
        const items = lineas.map((l) => ({
          itemCatalogoId: l.item.id > 0 ? l.item.id : null,
          descripcion: l.item.id > 0 ? null : l.item.nombre,
          categoriaId: l.categoriaId,
          cantidad: l.cantidad,
          unidad: l.unidad,
          precio: montoDeLinea(l.precio),
          esHormiga: l.esHormiga,
          esSobreprecio: sobreprecioDeLinea(l),
          sobreprecioResuelto: true,
          esPrecioBase: l.esPrecioBase,
          esPesoDesconocido: l.esPesoDesconocido,
        }));
        if (gastoInicial) {
          await editarGasto(gastoInicial.id, {
            emisorId: emisorSeleccionado.id,
            fecha,
            items,
            redirigirA: revision ? destinoSiguiente(revision) : undefined,
          });
        } else {
          await crearGasto({
            emisorId: emisorSeleccionado.id,
            fecha,
            items,
            ...(datosCfe ?? {}),
          });
        }
      } catch (e) {
        setErrorGuardado(
          e instanceof Error ? e.message : "No se pudo guardar el gasto"
        );
      }
    });
  }

  const esUltimoPaso = revision
    ? revision.paso === revision.gastoIds.length - 1
    : false;

  const contenido = (
    <div
      className={
        gastoInicial
          ? "grid grid-cols-1 gap-5"
          : "grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]"
      }
    >
      {!gastoInicial && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            aria-expanded={capturaAbierta}
            onClick={() => setCapturaAbierta((v) => !v)}
            className="flex items-center gap-2 rounded-lg border bg-card px-5 py-3 text-left text-sm font-semibold md:hidden"
          >
            <ScanLine className="h-4 w-4 text-muted-foreground" />
            Cargar desde el ticket
            <span className="ml-auto text-[12px] font-normal text-muted-foreground">
              QR o foto
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                capturaAbierta ? "rotate-180" : ""
              }`}
            />
          </button>
          <div
            className={
              capturaAbierta
                ? "flex flex-col gap-4"
                : "hidden md:flex md:flex-col md:gap-4"
            }
          >
            <EscanerComprobante onResuelto={handleComprobanteResuelto} />
            <LectorTicketIA
              proveedoresIA={proveedoresIA}
              proveedorActivoIA={proveedorActivoIA ?? proveedoresIA[0]?.id ?? "gemini"}
              onResuelto={handleTicketIAResuelto}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Card className="overflow-visible px-5 py-4.5">
          <div className="mb-2 text-[13px] font-semibold text-muted-foreground">
            Fecha
          </div>
          <Input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="h-10 max-w-[180px]"
          />
        </Card>

        <Card className="overflow-visible px-5 py-4.5">
          <div className="mb-2 text-[13px] font-semibold text-muted-foreground">
            Comercio
          </div>
          <ComboboxBusqueda
            id="buscador-comercio"
            query={emisorQuery}
            onQueryChange={(valor) => {
              setEmisorQuery(valor);
              setEmisorSeleccionado(null);
            }}
            resultados={resultadosEmisor}
            claveOpcion={(e) => e.id}
            etiquetaOpcion={(e) => e.nombre}
            onElegir={seleccionarEmisor}
            accionFinal={{
              etiqueta: `+ Crear comercio "${emisorQuery.trim()}"`,
              onElegir: crearEmisorAlVuelo,
            }}
            placeholder="Buscar comercio..."
            suspendido={!!emisorSeleccionado}
            inputClassName="h-10 pl-8"
            panelClassName="top-11"
          />
          {!emisorSeleccionado && (
            <button
              type="button"
              onClick={usarEmisorGenerico}
              className="mt-2 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
            >
              Compra puntual, sin comercio para catalogar
            </button>
          )}
          {emisorSeleccionado?.esGenerico && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Cargado como compra puntual (sin comercio específico).
            </p>
          )}
          {emisorSeleccionado && !emisorSeleccionado.esGenerico && (
            <button
              type="button"
              onClick={abrirEdicionEmisor}
              disabled={cargandoEmisor}
              className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <Pencil className="h-3.5 w-3.5" />
              {cargandoEmisor ? "Abriendo..." : "Editar comercio"}
            </button>
          )}
        </Card>

        <Card className="overflow-visible py-0">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <span className="text-sm font-semibold">
              Ítems{" "}
              <span className="font-normal text-muted-foreground">
                ({lineas.length})
              </span>
            </span>
          </div>

          {lineas.length > 0 && (
            <>
              <div className="hidden grid-cols-[1fr_140px_80px_110px_120px_28px] gap-3 border-b px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <div>Ítem</div>
                <div>Categoría</div>
                <div>Cant. / peso</div>
                <div>Precio</div>
                <div>Tipo</div>
                <div />
              </div>

              <div className="divide-y">
                {lineas.map((linea) => (
                  <LineaGastoFila
                    key={linea.key}
                    linea={linea}
                    categorias={categoriasList}
                    actualizarLinea={actualizarLinea}
                    quitarLinea={quitarLinea}
                    renombrarLinea={renombrarLinea}
                    resolverLineaProvisoria={resolverLineaProvisoria}
                    abrirEdicionItemCatalogo={abrirEdicionItemCatalogo}
                    onCrearItemParaLinea={crearItemParaLinea}
                    sobreprecioDeLinea={sobreprecioDeLinea}
                    referenciaDeLinea={referenciaDeLinea}
                  />
                ))}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2 px-5 py-3.5">
            <ComboboxBusqueda
              id="buscador-item-gasto"
              query={itemQuery}
              onQueryChange={setItemQuery}
              resultados={resultadosItem}
              claveOpcion={(item) => item.id}
              etiquetaOpcion={(item) =>
                `${item.nombre}${item.marca ? ` · ${item.marca}` : ""}`
              }
              detalleOpcion={(item) => item.categoriaNombre}
              onElegir={agregarLinea}
              accionFinal={{
                etiqueta: "+ Crear ítem nuevo",
                onElegir: () => {
                  setItemDraft({
                    ...draftItemVacio,
                    nombre: itemQuery.trim(),
                  });
                  setItemCatalogoAEditar(null);
                  setItemDialogOpen(true);
                },
              }}
              placeholder="Buscar ítem..."
              inputRef={buscadorItemRef}
              className="w-full max-w-sm sm:w-auto sm:flex-1"
              inputClassName="h-8 pl-8 text-[13px] ring-2 ring-ring/40"
              panelClassName="top-9"
            />
            <button
              type="button"
              onClick={agregarLineaDeServicio}
              className="shrink-0 rounded-lg border border-dashed px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover:border-solid hover:text-foreground"
            >
              + Agregar servicio o concepto
            </button>
          </div>
        </Card>

        {inicio.convertidas.length > 0 && (
          <div className="rounded-lg border border-dashed px-4 py-3 text-[12.5px] text-muted-foreground">
            <p className="font-medium text-foreground">
              {inicio.convertidas.length === 1
                ? "Una línea pasó a ser un servicio"
                : `${inicio.convertidas.length} líneas pasaron a ser servicios`}
            </p>
            <p className="mt-1">
              Su categoría está marcada como servicio, así que ya no llevan
              cantidad ni unidad: se muestran como un importe único, con el mismo
              monto de antes. Se guarda así cuando confirmes el gasto.
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {inicio.convertidas.map((c) => (
                <li key={`${c.nombre}-${c.importe}`}>
                  {c.nombre || "Sin detalle"}:{" "}
                  {formatearCantidadConUnidad(c.cantidad, c.unidad)} ×{" "}
                  {formatearMonto(c.precio)} → {formatearMonto(c.importe)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between px-1">
          <span className="text-sm text-muted-foreground">Total del gasto</span>
          <span className="text-xl font-semibold">{formatearMonto(total)}</span>
        </div>

        {diferenciaComprobante !== null && (
          <p className="px-1 text-right text-[12.5px] text-muted-foreground">
            El comprobante dice{" "}
            <span className="font-medium text-foreground">
              {formatearMonto(totalComprobante!)}
            </span>{" "}
            —{" "}
            {diferenciaComprobante > 0
              ? `faltan ${formatearMonto(diferenciaComprobante)}`
              : `hay ${formatearMonto(-diferenciaComprobante)} de más`}
          </p>
        )}

        {errorGuardado && (
          <p className="px-1 text-sm text-destructive">{errorGuardado}</p>
        )}

        {motivo && (
          <p className="px-1 text-right text-[12.5px] text-muted-foreground">
            {motivo}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link
                href={
                  revision
                    ? "/estado-cuenta"
                    : gastoInicial
                      ? `/gastos/${gastoInicial.id}`
                      : "/gastos"
                }
                onClick={confirmarSalida}
              />
            }
          >
            {revision ? "Salir de la revisión" : "Cancelar"}
          </Button>
          {revision && (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={destinoSiguiente(revision)}
                  onClick={confirmarSalida}
                />
              }
            >
              {esUltimoPaso ? "Dejar como está" : "Saltear"}
            </Button>
          )}
          <Button
            className="gap-2"
            disabled={!puedeGuardar || guardando}
            onClick={handleGuardarGasto}
          >
            <Check className="h-4 w-4" />
            {guardando
              ? "Guardando..."
              : revision
                ? esUltimoPaso
                  ? "Guardar y terminar"
                  : "Guardar y siguiente"
                : gastoInicial
                  ? "Guardar cambios"
                  : "Guardar gasto"}
          </Button>
        </div>
      </div>

      <EmisorDialog
        key={`emisor-gasto-${emisorAEditar?.id ?? "ninguno"}`}
        open={emisorDialogOpen}
        onOpenChange={(open) => {
          setEmisorDialogOpen(open);
          if (!open) setEmisorAEditar(null);
        }}
        emisorExistente={emisorAEditar}
        proveedores={proveedoresCfeList}
        onCreado={emisorEditado}
        onEditado={emisorEditado}
      />

      <NuevaCategoriaDialog
        open={categoriaDialogOpen}
        onOpenChange={(open) => {
          setCategoriaDialogOpen(open);
          if (!open && reabrirItemDialog) {
            setReabrirItemDialog(false);
            setItemDialogOpen(true);
          }
        }}
        onCreada={handleCategoriaCreada}
      />

      <NuevoItemDialog
        open={itemDialogOpen}
        onOpenChange={(open) => {
          setItemDialogOpen(open);
          if (!open && !reabrirItemDialog) {
            setItemDraft(draftItemVacio);
            setLineaProvisoriaAResolver(null);
            setItemCatalogoAEditar(null);
          }
        }}
        draft={itemDraft}
        onDraftChange={setItemDraft}
        categorias={categoriasList}
        itemExistenteId={itemCatalogoAEditar}
        onCategoriaFaltante={() => {
          setItemDialogOpen(false);
          setReabrirItemDialog(true);
          setCategoriaDialogOpen(true);
        }}
        onCreado={(item) => {
          if (lineaProvisoriaAResolver) {
            resolverLineaProvisoria(lineaProvisoriaAResolver, item);
            setLineaProvisoriaAResolver(null);
          } else {
            agregarLinea(item);
          }
        }}
        onEditado={(item) => {
          itemCatalogoEditado(item);
          setItemCatalogoAEditar(null);
        }}
      />
    </div>
  );

  if (!revision) return contenido;

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Revisando la importación
            <Badge variant="secondary">
              {revision.paso + 1} de {revision.gastoIds.length}
            </Badge>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            El movimiento ya se importó como gasto. Ajustá comercio, categoría o
            desglosalo en ítems, y pasá al siguiente.
          </p>
        </div>
        <div className="flex gap-1">
          {revision.gastoIds.map((id, i) => (
            <span
              key={id}
              className={`h-1.5 w-6 rounded-full ${
                i < revision.paso
                  ? "bg-primary/40"
                  : i === revision.paso
                    ? "bg-primary"
                    : "bg-muted"
              }`}
            />
          ))}
        </div>
      </Card>
      {contenido}
    </div>
  );
}
