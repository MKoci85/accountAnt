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
  esPesoDesconocido: boolean;
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

  if (linea.precioPorKiloTicket && linea.precioPorKiloTicket > 0) {
    return {
      cantidad: Number((linea.precio / linea.precioPorKiloTicket).toFixed(3)),
      precio: linea.precioPorKiloTicket,
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

function claveAgrupacion(linea: LineaGasto): string {
  const item =
    linea.item.id > 0
      ? `id:${linea.item.id}`
      : `nombre:${linea.item.nombre.trim().toLowerCase()}`;
  const precio = montoDeLinea(linea.precio).toFixed(2);
  const peso = linea.esPesoDesconocido ? "?" : "";
  return `${item}|${linea.categoriaId}|${linea.unidad}${peso}|${precio}`;
}

function agruparRepetidas(lineas: LineaGasto[]): LineaGasto[] {
  const agrupadas = new Map<string, LineaGasto>();
  for (const linea of lineas) {
    const clave = claveAgrupacion(linea);
    const existente = agrupadas.get(clave);
    if (!existente) {
      agrupadas.set(clave, linea);
      continue;
    }
    agrupadas.set(clave, {
      ...existente,
      cantidad: Number((existente.cantidad + linea.cantidad).toFixed(3)),
    });
  }
  return [...agrupadas.values()];
}

export function lineasDesdeTicket(lineas: LineaDesdeTicket[]): LineaGasto[] {
  const convertidas = lineas.map((linea) => {
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
        esPesoDesconocido: false,
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
      esPesoDesconocido: false,
      bloqueada: false,
    };
  });

  return agruparRepetidas(convertidas);
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
    esPesoDesconocido: item.esPesoDesconocido,
    bloqueada: false,
    genericaEditable:
      abrirGenericas && item.itemNombre === ITEM_PAGO_TARJETA,
  }));
}
