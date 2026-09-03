import { ITEM_PAGO_TARJETA } from "@/lib/clasificacion-comercios";
import {
  normalizarUnidad,
  parsearTamano,
  type UnidadMedida,
} from "@/lib/precios-referencia";
import type { GastoDetalle } from "@/app/actions/gastos";
import type { LineaDesdeTicket } from "@/components/escaner-comprobante";
import type { ItemCatalogoConCategoria } from "@/components/nuevo-item-dialog";
import type { categorias } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;

export type LineaGasto = {
  key: string;
  item: ItemCatalogoConCategoria;
  categoriaId: number;
  categoriaNombre: string;
  cantidad: number;
  precio: number | "";
  unidad: UnidadMedida;
  esHormiga: boolean;
  esSobreprecio: boolean;
  sobreprecioManual: boolean;
  esPrecioBase: boolean;
  bloqueada: boolean;
  genericaEditable?: boolean;
};

export function montoDeLinea(precio: number | ""): number {
  return precio === "" ? 0 : precio;
}

const CATEGORIA_SIN_ASIGNAR: Categoria = {
  id: -1,
  nombre: "Sin asignar",
  color: null,
  descripcion: null,
};

let contadorItemProvisorio = -1;

function camposDesdeTicket(linea: LineaDesdeTicket): {
  cantidad: number;
  precio: number;
  unidad: UnidadMedida;
} {
  if (linea.pesoTicket && linea.pesoTicket > 0) {
    return {
      cantidad: linea.pesoTicket,
      precio: linea.precioPorKiloTicket ?? linea.precio / linea.pesoTicket,
      unidad: "kg",
    };
  }

  const tamano = parsearTamano(linea.tamanoTicket);
  if (tamano && tamano.unidad !== "un") {
    const piezas = linea.unidadesTicket ?? 1;
    const total = tamano.cantidad * piezas;
    return {
      cantidad: total,
      precio: linea.precio / total,
      unidad: tamano.unidad,
    };
  }
  const piezas = linea.unidadesTicket ?? tamano?.cantidad ?? null;
  if (piezas && piezas > 0) {
    return { cantidad: piezas, precio: linea.precio / piezas, unidad: "un" };
  }
  return { cantidad: 1, precio: linea.precio, unidad: "un" };
}

export function lineasDesdeTicket(lineas: LineaDesdeTicket[]): LineaGasto[] {
  return lineas.map((linea) => {
    if (linea.itemCatalogo) {
      return {
        key: `ticket-${linea.itemCatalogo.id}-${Date.now()}-${contadorItemProvisorio--}`,
        item: linea.itemCatalogo,
        categoriaId: linea.itemCatalogo.categoriaId,
        categoriaNombre: linea.itemCatalogo.categoriaNombre,
        ...camposDesdeTicket(linea),
        esHormiga: false,
        esSobreprecio: false,
        sobreprecioManual: false,
        esPrecioBase: false,
        bloqueada: linea.bloqueada,
      };
    }

    const categoria = linea.categoriaSugerida ?? CATEGORIA_SIN_ASIGNAR;
    const idProvisorio = contadorItemProvisorio--;
    return {
      key: `ticket-nuevo-${idProvisorio}`,
      item: {
        id: idProvisorio,
        nombre: linea.nombreTicket,
        marca: null,
        tamano: null,
        descripcion: null,
        categoriaId: categoria.id,
        categoriaNombre: categoria.nombre,
      },
      categoriaId: categoria.id,
      categoriaNombre: categoria.nombre,
      ...camposDesdeTicket(linea),
      esHormiga: false,
      esSobreprecio: false,
      sobreprecioManual: false,
      esPrecioBase: false,
      bloqueada: false,
    };
  });
}

export function lineasDesdeGasto(
  gasto: GastoDetalle,
  abrirGenericas = false
): LineaGasto[] {
  return gasto.items.map((item) => ({
    key: `existente-${item.id}`,
    item: {
      id: item.itemCatalogoId ?? -1,
      nombre: item.itemNombre ?? item.descripcion ?? "Sin detalle",
      marca: item.itemMarca,
      tamano: item.itemTamano,
      descripcion: item.descripcion,
      categoriaId: item.categoriaId,
      categoriaNombre: item.categoriaNombre,
    },
    categoriaId: item.categoriaId,
    categoriaNombre: item.categoriaNombre,
    cantidad: item.cantidad,
    precio: item.precio,
    unidad: normalizarUnidad(item.unidad),
    esHormiga: item.esHormiga,
    esSobreprecio: item.esSobreprecio,
    sobreprecioManual: false,
    esPrecioBase: item.esPrecioBase,
    bloqueada: false,
    genericaEditable:
      abrirGenericas && item.itemNombre === ITEM_PAGO_TARJETA,
  }));
}
