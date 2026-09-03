"use server";

import {
  parsearQR,
  validarConDgi,
  consultarProcesador,
  type DatosQR,
  type DetalleComprobante,
} from "@/lib/cfe";
import { obtenerCotizacionCacheada } from "@/lib/bcu";
import {
  obtenerEmisorPorRuc,
  obtenerEmisorConProveedor,
  crearEmisorPorRuc,
  buscarItemPorNombreExacto,
  sugerirCategoriaPorTexto,
} from "@/app/actions/catalogos";
import {
  interpretarTicketConIA,
  type FuenteIA,
  type TicketCrudo,
} from "@/app/actions/ia";
import type { ProveedorIA } from "@/lib/proveedores-ia";
import type { categorias, emisores } from "@/db/schema";
import type { ItemCatalogoConCategoria } from "@/components/nuevo-item-dialog";

type Emisor = typeof emisores.$inferSelect;
type Categoria = typeof categorias.$inferSelect;

export type ItemTicket = {
  nombreTicket: string;
  precio: number;
  tamanoTicket: string | null;
  unidadesTicket: number | null;
  pesoTicket: number | null;
  precioPorKiloTicket: number | null;
  itemCatalogo: ItemCatalogoConCategoria | null;
  categoriaSugerida: Categoria | null;
};

export type ResultadoConsultaCFE = {
  datosQR: DatosQR;
  dgiValido: boolean;
  dgiMensaje: string;
  emisor: Emisor;
  emisorEsNuevo: boolean;
  items: ItemTicket[];
  total: number | null;
  errorProveedor: string | null;
  monedaOriginal: string | null;
  totalMonedaOriginal: number | null;
  avisoMoneda: string | null;
};

/**
 * Orquesta la lectura de un QR de CFE: valida contra DGI, matchea o crea el
 * emisor por RUC, y si el emisor ya tiene un proveedor de CFE mapeado, trae el
 * detalle (ítems, total).
 * @param qrTexto Contenido crudo del QR escaneado.
 * @returns Datos del QR, validación DGI, emisor y detalle del comprobante si se pudo consultar.
 */
export async function consultarCFE(qrTexto: string): Promise<ResultadoConsultaCFE> {
  const datosQR = parsearQR(qrTexto);

  const [validacion, emisorExistente] = await Promise.all([
    validarConDgi(datosQR).catch(
      (): { valido: boolean; mensaje: string } => ({
        valido: false,
        mensaje: "No se pudo consultar a DGI",
      })
    ),
    obtenerEmisorPorRuc(datosQR.ruc),
  ]);

  const emisor =
    emisorExistente ??
    (await crearEmisorPorRuc({ ruc: datosQR.ruc, nombre: `RUC ${datosQR.ruc}` }));

  let detalle: DetalleComprobante | null = null;
  let errorProveedor: string | null = null;
  let monedaOriginal: string | null = null;
  let totalMonedaOriginal: number | null = null;
  let avisoMoneda: string | null = null;

  const conProveedor = await obtenerEmisorConProveedor(emisor.id);
  const urlConsulta = conProveedor?.urlConsulta ?? null;
  const formato = conProveedor?.formato ?? null;

  if (urlConsulta && formato) {
    try {
      detalle = await consultarProcesador(urlConsulta, datosQR, formato);
      if (detalle.moneda && detalle.moneda !== "UYU") {
        monedaOriginal = detalle.moneda;
        totalMonedaOriginal = detalle.total;
        const conversion = await convertirAPesos(detalle, datosQR.fecha);
        detalle = conversion.detalle;
        avisoMoneda = conversion.error;
      }
    } catch (e) {
      errorProveedor =
        e instanceof Error ? e.message : "No se pudo consultar el proveedor";
    }
  } else {
    errorProveedor = "Este emisor todavía no tiene un proveedor de CFE mapeado";
  }

  const items: ItemTicket[] = await Promise.all(
    (detalle?.items ?? []).map(async (item) =>
      resolverItemContraCatalogo({
        nombre: item.nombre,
        precio: item.precio,
        tamano: item.tamano,
        unidades: item.unidades,
        pesoTicket: item.pesoTicket,
        precioPorKiloTicket: item.precioPorKiloTicket,
      })
    )
  );

  return {
    datosQR,
    dgiValido: validacion.valido,
    dgiMensaje: validacion.mensaje,
    emisor,
    emisorEsNuevo: !emisorExistente,
    items,
    total: detalle?.total ?? null,
    errorProveedor,
    monedaOriginal,
    totalMonedaOriginal,
    avisoMoneda,
  };
}

async function convertirAPesos(
  detalle: DetalleComprobante,
  fechaQR: string
): Promise<{ detalle: DetalleComprobante; error: string | null }> {
  if (detalle.moneda !== "USD") {
    return {
      detalle,
      error: `El comprobante está en ${detalle.moneda}, todavía no se puede convertir automáticamente a pesos. Cargá el monto a mano.`,
    };
  }

  const cotizacion = await obtenerCotizacionCacheada(fechaISODesdeQR(fechaQR));
  if (!cotizacion) {
    return {
      detalle,
      error:
        "El comprobante está en USD y no se pudo obtener la cotización del BCU. Cargá el monto en pesos a mano.",
    };
  }

  const aPesos = (monto: number) => Math.round(monto * cotizacion * 100) / 100;
  return {
    detalle: {
      ...detalle,
      total: detalle.total !== null ? aPesos(detalle.total) : null,
      items: detalle.items.map((item) => ({
        ...item,
        precio: aPesos(item.precio),
        precioPorKiloTicket:
          item.precioPorKiloTicket !== null ? aPesos(item.precioPorKiloTicket) : null,
      })),
    },
    error: null,
  };
}

function fechaISODesdeQR(fechaQR: string): string {
  const [dia, mes, anio] = fechaQR.split("/");
  return `${anio}-${mes}-${dia}`;
}

async function resolverItemContraCatalogo(item: {
  nombre: string;
  precio: number;
  tamano: string | null;
  unidades: number | null;
  pesoTicket: number | null;
  precioPorKiloTicket: number | null;
}): Promise<ItemTicket> {
  const itemCatalogo = await buscarItemPorNombreExacto(item.nombre);
  return {
    nombreTicket: item.nombre,
    precio: item.precio,
    tamanoTicket: item.tamano,
    unidadesTicket: item.unidades,
    pesoTicket: item.pesoTicket,
    precioPorKiloTicket: item.precioPorKiloTicket,
    itemCatalogo,
    categoriaSugerida: itemCatalogo
      ? null
      : await sugerirCategoriaPorTexto(item.nombre),
  };
}

export type ResultadoTicketIA = {
  comercio: string;
  fecha: string;
  items: ItemTicket[];
};

/**
 * Lee una foto de ticket o nota de pedido con IA y devuelve sus ítems ya
 * resueltos contra el catálogo, listos para precargar el formulario de gasto.
 * @param fuente Imagen o texto del ticket.
 * @param proveedor Proveedor de IA a usar; sin esto, el activo.
 * @returns El ticket interpretado, o el error si la IA no pudo leerlo.
 */
export async function interpretarTicket(
  fuente: FuenteIA,
  proveedor?: ProveedorIA
): Promise<{ ok: boolean; ticket?: ResultadoTicketIA; error?: string }> {
  const r = await interpretarTicketConIA(fuente, proveedor);
  if (!r.ok || !r.ticket) {
    return { ok: false, error: r.error ?? "La IA no pudo interpretar el ticket" };
  }

  return { ok: true, ticket: await resolverTicket(r.ticket) };
}

async function resolverTicket(ticket: TicketCrudo): Promise<ResultadoTicketIA> {
  const items = await Promise.all(
    ticket.items.map((item) =>
      resolverItemContraCatalogo({
        nombre: item.nombre,
        precio: item.precio,
        tamano: null,
        unidades: item.cantidad,
        pesoTicket: item.peso,
        precioPorKiloTicket: item.precioPorKilo,
      })
    )
  );

  return { comercio: ticket.comercio, fecha: ticket.fecha, items };
}
