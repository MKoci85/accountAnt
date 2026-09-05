"use client";

import { Lock, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BadgeLinea } from "@/components/badge-linea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BuscadorItemLinea } from "@/components/buscador-item";
import { ITEM_PAGO_TARJETA } from "@/lib/clasificacion-comercios";
import {
  UNIDADES,
  normalizarUnidad,
  etiquetaUnidad,
  type UnidadMedida,
} from "@/lib/precios-referencia";
import { formatearMonto } from "@/lib/formato";
import {
  esLineaDeServicio,
  montoDeLinea,
  type LineaGasto,
} from "@/lib/lineas-gasto";
import type { ItemCatalogoConCategoria } from "@/components/nuevo-item-dialog";
import type { categorias } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;

const ETIQUETA_UNIDAD_CORTA: Record<UnidadMedida, string> = {
  un: "unidad",
  kg: "kilo (peso variable)",
  L: "litro",
};

const ETIQUETA_CANTIDAD: Record<UnidadMedida, string> = {
  un: "Cantidad",
  kg: "Peso (kg)",
  L: "Volumen (L)",
};

const ETIQUETA_PRECIO: Record<UnidadMedida, string> = {
  un: "Precio",
  kg: "Precio por kg",
  L: "Precio por L",
};

export function LineaGastoFila({
  linea,
  categorias: categoriasList,
  actualizarLinea,
  quitarLinea,
  renombrarLinea,
  resolverLineaProvisoria,
  abrirEdicionItemCatalogo,
  onCrearItemParaLinea,
  sobreprecioDeLinea,
  referenciaDeLinea,
}: {
  linea: LineaGasto;
  categorias: Categoria[];
  actualizarLinea: (key: string, cambios: Partial<LineaGasto>) => void;
  quitarLinea: (key: string) => void;
  renombrarLinea: (key: string, nombre: string) => void;
  resolverLineaProvisoria: (key: string, item: ItemCatalogoConCategoria) => void;
  abrirEdicionItemCatalogo: (linea: LineaGasto) => void;
  onCrearItemParaLinea: (linea: LineaGasto) => void;
  sobreprecioDeLinea: (linea: LineaGasto) => boolean;
  referenciaDeLinea: (linea: LineaGasto) => number | undefined;
}) {
  const esServicio = esLineaDeServicio(linea, categoriasList);
  const esGenericaEditable = linea.genericaEditable === true;
  const necesitaCatalogo =
    !linea.sinCatalogo && (linea.item.id <= 0 || esGenericaEditable);
  const nombreEditable = linea.sinCatalogo || necesitaCatalogo;
  const vieneDelTicket = linea.item.id <= 0;
  const eligeUnidad =
    !necesitaCatalogo &&
    !esServicio &&
    (!linea.sinCatalogo || linea.unidad !== "un");
  const sinPeso = linea.esPesoDesconocido;
  const puedeNoSaberElPeso =
    linea.item.nombre !== ITEM_PAGO_TARJETA &&
    (linea.unidad !== "un" || sinPeso);
  return (
    <div
      className="flex flex-col gap-2 px-5 py-3.5 md:grid md:grid-cols-[1fr_140px_80px_110px_120px_28px] md:items-center md:gap-3"
    >
      <div>
        <div className="flex items-start gap-2">
          {nombreEditable ? (
            <Input
              value={linea.item.nombre}
              onChange={(e) =>
                renombrarLinea(linea.key, e.target.value)
              }
              placeholder={
                esServicio
                  ? "Ej: Consulta odontológica"
                  : linea.sinCatalogo
                    ? "Ej: Uniforme deportivo"
                    : "Nombre del ítem"
              }
              className="h-7 text-[13px] font-medium"
            />
          ) : (
            <div className="text-[13.5px] font-medium">
              {linea.item.nombre}
            </div>
          )}
          {!nombreEditable && linea.item.id > 0 && (
            <button
              type="button"
              title="Editar ítem del catálogo (nombre, marca, categoría por defecto)"
              onClick={() => abrirEdicionItemCatalogo(linea)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-accent hover:text-accent-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {necesitaCatalogo && (
            <button
              type="button"
              title="Crear ítem nuevo en el catálogo"
              onClick={() => onCrearItemParaLinea(linea)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[13px] font-semibold leading-none text-primary hover:bg-primary/25"
            >
              +
            </button>
          )}
        </div>
        {necesitaCatalogo && (
          <>
            <div className="mt-0.5 text-[11.5px] text-primary">
              {vieneDelTicket
                ? linea.item.tamano
                  ? `Del ticket, sin catalogar · ${linea.item.tamano}`
                  : "Del ticket, sin catalogar"
                : "Importado sin detalle — buscá el ítem real o creá uno"}
            </div>
            <BuscadorItemLinea
              onElegido={(item) =>
                resolverLineaProvisoria(linea.key, item)
              }
              onCrearNuevo={() => onCrearItemParaLinea(linea)}
            />
          </>
        )}
        {!nombreEditable && (
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {[linea.item.marca, linea.item.tamano]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
        {linea.bloqueada ? (
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            Bloqueado (del ticket) —
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() =>
                actualizarLinea(linea.key, { bloqueada: false })
              }
            >
              editar
            </button>
          </label>
        ) : (
          eligeUnidad && (
            <label className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="whitespace-nowrap">Se vende por</span>
              <Select
                value={linea.unidad}
                onChange={(e) => {
                  const unidad = normalizarUnidad(e.target.value);
                  actualizarLinea(linea.key, {
                    unidad,
                    ...(unidad === "un" ? { esPesoDesconocido: false } : {}),
                  });
                }}
                className="h-auto w-auto rounded-md px-1.5 py-0.5 text-[11px]"
              >
                {UNIDADES.map((u) => (
                  <option key={u} value={u}>
                    {ETIQUETA_UNIDAD_CORTA[u]}
                  </option>
                ))}
              </Select>
            </label>
          )
        )}
      </div>
      <div>
        {nombreEditable ? (
          <Select
            value={linea.categoriaId}
            onChange={(e) => {
              const id = Number(e.target.value);
              const categoria = categoriasList.find(
                (c) => c.id === id
              );
              if (!categoria) return;
              actualizarLinea(linea.key, {
                categoriaId: categoria.id,
                categoriaNombre: categoria.nombre,
              });
            }}
            className="h-7 rounded-md px-1.5 text-[12px]"
          >
            {linea.categoriaId < 0 && (
              <option value={linea.categoriaId}>
                {linea.categoriaNombre}
              </option>
            )}
            {categoriasList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        ) : (
          <Badge variant="secondary">{linea.categoriaNombre}</Badge>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
      {!esServicio && (
        <>
          <label
            htmlFor={`cantidad-${linea.key}`}
            className="text-[11px] font-medium text-muted-foreground md:hidden"
          >
            {sinPeso ? "Peso" : ETIQUETA_CANTIDAD[linea.unidad]}
          </label>
          <Input
            id={`cantidad-${linea.key}`}
            type="number"
            onWheel={(e) => e.currentTarget.blur()}
            min={linea.unidad === "un" ? 1 : 0}
            step={linea.unidad === "un" ? 1 : 0.001}
            value={sinPeso ? "" : linea.cantidad}
            disabled={linea.bloqueada || sinPeso}
            onChange={(e) =>
              actualizarLinea(linea.key, {
                cantidad: Number(e.target.value) || 0,
              })
            }
            placeholder={
              sinPeso ? "sin dato" : linea.unidad === "un" ? "1" : "0,165"
            }
            className="h-8 w-full text-[13px]"
          />
        </>
      )}
      </div>
      <div className="flex flex-col gap-0.5">
      <label
        htmlFor={`precio-${linea.key}`}
        className="text-[11px] font-medium text-muted-foreground md:hidden"
      >
        {esServicio
          ? "Importe"
          : sinPeso
            ? "Total pagado"
            : ETIQUETA_PRECIO[linea.unidad]}
      </label>
      <Input
        id={`precio-${linea.key}`}
        type="number"
        onWheel={(e) => e.currentTarget.blur()}
        min={0}
        value={linea.precio}
        disabled={linea.bloqueada}
        onChange={(e) =>
          actualizarLinea(linea.key, {
            precio:
              e.target.value === "" ? "" : Number(e.target.value) || 0,
          })
        }
        placeholder={
          sinPeso || linea.unidad === "un" ? "$" : `$ por ${linea.unidad}`
        }
        className="h-8 w-full text-[13px]"
      />
      {!sinPeso && linea.unidad !== "un" && montoDeLinea(linea.precio) > 0 && (
        <span className="text-[10.5px] text-muted-foreground">
          ={" "}
          {formatearMonto(
            Number((montoDeLinea(linea.precio) * linea.cantidad).toFixed(2))
          )}
        </span>
      )}
      </div>
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          aria-pressed={linea.esHormiga}
          disabled={linea.bloqueada}
          onClick={() =>
            actualizarLinea(linea.key, { esHormiga: !linea.esHormiga })
          }
        >
          <BadgeLinea tipo="hormiga" activo={linea.esHormiga} />
        </button>
        {puedeNoSaberElPeso && (
          <button
            type="button"
            aria-pressed={sinPeso}
            disabled={linea.bloqueada}
            title="El ticket no dice cuánto pesaba: se registra el gasto pero queda fuera de la comparación de precios"
            onClick={() =>
              actualizarLinea(linea.key, {
                esPesoDesconocido: !sinPeso,
                cantidad: 1,
                ...(sinPeso
                  ? {}
                  : {
                      esSobreprecio: false,
                      sobreprecioManual: true,
                      esPrecioBase: false,
                    }),
              })
            }
          >
            <BadgeLinea
              tipo="pesoDesconocido"
              activo={sinPeso}
              etiquetaInactiva="¿No sabés el peso?"
            />
          </button>
        )}
        {!sinPeso &&
          linea.item.nombre !== ITEM_PAGO_TARJETA &&
          linea.item.id > 0 && (() => {
            const caro = sobreprecioDeLinea(linea);
            const referencia = referenciaDeLinea(linea);
            return (
              <>
                <button
                  type="button"
                  aria-pressed={caro}
                  disabled={linea.bloqueada}
                  onClick={() =>
                    actualizarLinea(linea.key, {
                      esSobreprecio: !caro,
                      sobreprecioManual: true,
                      esPrecioBase: false,
                    })
                  }
                >
                  <BadgeLinea tipo="sobreprecio" activo={caro} />
                </button>
                {caro && referencia !== undefined && (
                  <span className="text-[10.5px] text-muted-foreground">
                    ref. {formatearMonto(Number(referencia.toFixed(2)))}{" "}
                    {etiquetaUnidad(linea.unidad)}
                  </span>
                )}
              </>
            );
          })()}
        {!sinPeso && (sobreprecioDeLinea(linea) || linea.esPrecioBase) && (
          <button
            type="button"
            aria-pressed={linea.esPrecioBase}
            disabled={linea.bloqueada}
            onClick={() =>
              actualizarLinea(linea.key, {
                esPrecioBase: !linea.esPrecioBase,
                esSobreprecio: linea.esPrecioBase,
                sobreprecioManual: linea.esPrecioBase,
              })
            }
          >
            <BadgeLinea
              tipo="precioBase"
              activo={linea.esPrecioBase}
              etiquetaInactiva="¿Subió de precio?"
            />
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Quitar ítem del gasto"
        onClick={() => quitarLinea(linea.key)}
        className="inline-flex items-center gap-1.5 self-start text-[12px] font-medium text-muted-foreground/70 hover:text-destructive md:self-center"
      >
        <Trash2 className="h-4 w-4" />
        <span className="md:hidden">Quitar</span>
      </button>
    </div>
  );
}
