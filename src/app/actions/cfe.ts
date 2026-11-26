"use server";

import {
  parsearQR,
  validarConDgi,
  consultarProcesador,
  fechaISODesdeQR,
  detalleCorrespondeAlQR,
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
  listarProveedoresParaProbar,
} from "@/app/actions/catalogos";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emisores as tablaEmisores } from "@/db/schema";
import { normalizarTextoComparable } from "@/lib/duplicados";
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
  /** null cuando el QR trae la fecha en un formato que no se reconoce. */
  fechaISO: string | null;
  dgiMensaje: string;
  emisor: Emisor;
  emisorEsNuevo: boolean;
  items: ItemTicket[];
  total: number | null;
  errorProveedor: string | null;
  /**
   * Nombre del proveedor que trajo el detalle cuando el emisor no tenía uno y
   * se encontró probando los marcados: quedó asignado al emisor.
   */
  proveedorDetectado: string | null;
  monedaOriginal: string | null;
  totalMonedaOriginal: number | null;
  avisoMoneda: string | null;
};

export type RespuestaConsultaCFE =
  | { ok: true; resultado: ResultadoConsultaCFE }
  | { ok: false; error: string };

/**
 * Orquesta la lectura de un QR de CFE (o del link impreso equivalente): valida
 * contra DGI, matchea o crea el emisor por RUC, y si el emisor ya tiene un
 * proveedor de CFE mapeado, trae el detalle (ítems, total). Un comprobante que
 * DGI no confirma corta acá, antes de escribir nada.
 * @param qrTexto Contenido crudo del QR escaneado.
 * @returns Emisor y detalle del comprobante, o el motivo por el que no se pudo validar.
 */
export async function consultarCFE(qrTexto: string): Promise<RespuestaConsultaCFE> {
  let datosQR: DatosQR;
  try {
    datosQR = parsearQR(qrTexto);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "No se pudo leer el QR",
    };
  }

  const validacion = await validarConDgi(datosQR).catch(() => null);
  if (!validacion) {
    return {
      ok: false,
      error:
        "No se pudo consultar a DGI para validar el comprobante. Probá de nuevo en un momento, o cargá el gasto a mano en el formulario.",
    };
  }
  if (!validacion.valido) {
    return {
      ok: false,
      error: `DGI no reconoce este comprobante: ${validacion.mensaje}`,
    };
  }

  const emisorExistente = await obtenerEmisorPorRuc(datosQR.ruc);
  let emisor =
    emisorExistente ??
    (await crearEmisorPorRuc({ ruc: datosQR.ruc, nombre: nombreProvisorio(datosQR.ruc) }));

  const consulta = await obtenerDetalle(emisor.id, datosQR);
  const { errorProveedor, proveedorDetectado } = consulta;
  let detalle = consulta.detalle;
  let monedaOriginal: string | null = null;
  let totalMonedaOriginal: number | null = null;
  let avisoMoneda: string | null = null;

  if (detalle) {
    emisor = await completarEmisor(emisor, detalle, proveedorDetectado?.id ?? null);
    if (detalle.total !== null && !Number.isFinite(detalle.total)) {
      detalle = { ...detalle, total: null };
    }
    if (detalle.moneda && detalle.moneda !== "UYU") {
      monedaOriginal = detalle.moneda;
      totalMonedaOriginal = detalle.total;
      const conversion = await convertirAPesos(detalle, datosQR.fecha);
      detalle = conversion.detalle;
      avisoMoneda = conversion.error;
    }
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
    ok: true,
    resultado: {
      datosQR,
      fechaISO: fechaISODesdeQR(datosQR.fecha),
      dgiMensaje: validacion.mensaje,
      emisor,
      emisorEsNuevo: !emisorExistente,
      items,
      total: detalle?.total ?? null,
      errorProveedor,
      proveedorDetectado: proveedorDetectado?.nombre ?? null,
      monedaOriginal,
      totalMonedaOriginal,
      avisoMoneda,
    },
  };
}

function nombreProvisorio(ruc: string) {
  return `RUC ${ruc}`;
}

type Detalle = {
  detalle: DetalleComprobante | null;
  errorProveedor: string | null;
  proveedorDetectado: { id: number; nombre: string } | null;
};

/**
 * El detalle del comprobante: del proveedor mapeado al emisor, o — si no
 * tiene — del primero de los marcados para probar que lo reconozca. Un
 * proveedor mapeado que falla no da pie a probar otros: el mapeo es del
 * usuario, y que hoy no conteste no lo desmiente.
 */
async function obtenerDetalle(emisorId: number, datosQR: DatosQR): Promise<Detalle> {
  const conProveedor = await obtenerEmisorConProveedor(emisorId);
  if (conProveedor?.urlConsulta && conProveedor.formato) {
    try {
      return {
        detalle: await consultarProcesador(
          conProveedor.urlConsulta,
          datosQR,
          conProveedor.formato
        ),
        errorProveedor: null,
        proveedorDetectado: null,
      };
    } catch (e) {
      return {
        detalle: null,
        errorProveedor:
          e instanceof Error ? e.message : "No se pudo consultar el proveedor",
        proveedorDetectado: null,
      };
    }
  }

  const candidatos = await listarProveedoresParaProbar();
  const respuestas = await Promise.all(
    candidatos.map((p) =>
      consultarProcesador(p.urlConsulta, datosQR, p.formato)
        .then((d) => (detalleCorrespondeAlQR(d, datosQR) ? d : null))
        .catch(() => null)
    )
  );
  const i = respuestas.findIndex((r) => r !== null);
  if (i >= 0) {
    return {
      detalle: respuestas[i],
      errorProveedor: null,
      proveedorDetectado: { id: candidatos[i].id, nombre: candidatos[i].nombre },
    };
  }

  const sinMapeo = "Este emisor todavía no tiene un proveedor de CFE mapeado";
  return {
    detalle: null,
    errorProveedor:
      candidatos.length === 0
        ? sinMapeo
        : `${sinMapeo} (se probó con ${listaDeNombres(candidatos.map((c) => c.nombre))} y no lo reconoció ninguno)`,
    proveedorDetectado: null,
  };
}

function listaDeNombres(nombres: string[]) {
  return nombres.length === 1
    ? nombres[0]
    : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/**
 * Lo que el detalle le enseña al emisor: el proveedor detectado probando, y su
 * nombre si todavía tiene el provisorio "RUC …" con que lo crea el QR. El
 * nombre no se toma si otro comercio ya se llama así (ese caso se resuelve
 * fusionándolos desde /catalogos, no duplicando el nombre).
 */
async function completarEmisor(
  emisor: Emisor,
  detalle: DetalleComprobante,
  proveedorId: number | null
): Promise<Emisor> {
  const cambios: Partial<Pick<Emisor, "nombre" | "proveedorCfeId">> = {};
  if (proveedorId !== null && emisor.proveedorCfeId === null) {
    cambios.proveedorCfeId = proveedorId;
  }

  const nombre = detalle.emisorNombre.trim();
  if (
    /^RUC \d+$/.test(emisor.nombre) &&
    nombre &&
    nombre !== "Comercio desconocido" &&
    (await nombreLibre(nombre, emisor.id))
  ) {
    cambios.nombre = nombre;
  }

  if (Object.keys(cambios).length === 0) return emisor;
  const [actualizado] = await db
    .update(tablaEmisores)
    .set(cambios)
    .where(eq(tablaEmisores.id, emisor.id))
    .returning();
  revalidatePath("/catalogos");
  return actualizado ?? emisor;
}

async function nombreLibre(nombre: string, idExcluido: number) {
  const buscado = normalizarTextoComparable(nombre);
  const todos = await db
    .select({ id: tablaEmisores.id, nombre: tablaEmisores.nombre })
    .from(tablaEmisores);
  return !todos.some(
    (e) => e.id !== idExcluido && normalizarTextoComparable(e.nombre) === buscado
  );
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

  const fechaISO = fechaISODesdeQR(fechaQR);
  const cotizacion = fechaISO ? await obtenerCotizacionCacheada(fechaISO) : null;
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

/**
 * Busca un ítem de ticket en el catálogo (nombre, alias o descripción) y, si no
 * está, le sugiere una categoría por el texto.
 */
export async function resolverItemContraCatalogo(item: {
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
): Promise<{
  ok: boolean;
  ticket?: ResultadoTicketIA;
  error?: string;
  aviso?: string;
}> {
  const r = await interpretarTicketConIA(fuente, proveedor);
  if (!r.ok || !r.ticket) {
    return { ok: false, error: r.error ?? "La IA no pudo interpretar el ticket" };
  }

  return { ok: true, ticket: await resolverTicket(r.ticket), aviso: r.aviso };
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
