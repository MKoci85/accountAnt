import { leerUrlDgi } from "@/lib/config-server";
import type { FormatoProveedorCfe } from "@/lib/procesadores";

export type DatosQR = {
  ruc: string;
  tipoCfe: string;
  serie: string;
  numero: string;
  monto: string;
  fecha: string;
  hash: string;
};

/**
 * Parsea el texto de un QR de CFE uruguayo.
 * @param textoQR contenido crudo leído del QR
 * @returns los campos del CFE
 */
export function parsearQR(textoQR: string): DatosQR {
  const texto = textoQR.trim();
  const comaIndex = texto.indexOf("?");
  const datos = comaIndex >= 0 ? texto.slice(comaIndex + 1) : texto;

  const campos = decodeURIComponent(datos).split(",");
  if (campos.length !== 7) {
    throw new Error("El código QR no tiene el formato esperado de un CFE uruguayo");
  }

  const [ruc, tipoCfe, serie, numero, monto, fecha, hash] = campos.map((c) =>
    c.trim()
  );
  if (!ruc || !tipoCfe || !serie || !numero || !monto || !fecha || !hash) {
    throw new Error("El código QR no tiene el formato esperado de un CFE uruguayo");
  }

  return { ruc, tipoCfe, serie, numero, monto, fecha, hash };
}

export type ValidacionDgi = {
  valido: boolean;
  mensaje: string;
};

/**
 * Valida un CFE contra la web pública de DGI.
 * @param datos campos del CFE (de `parsearQR`)
 * @returns si es válido y el mensaje devuelto por DGI
 */
export async function validarConDgi(datos: DatosQR): Promise<ValidacionDgi> {
  const query = [
    datos.ruc,
    datos.tipoCfe,
    datos.serie,
    datos.numero,
    datos.monto,
    datos.fecha,
    datos.hash,
  ];

  const url = `${await leerUrlDgi()}?${query
    .map(encodeURIComponent)
    .join(",")}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    return { valido: false, mensaje: `DGI respondió ${res.status}` };
  }

  const html = await res.text();
  const match = html.match(/id="MENSAJERESPUESTA"[^>]*>([^<]+)</);
  const mensaje = match?.[1]?.trim() ?? "No se pudo interpretar la respuesta de DGI";

  return {
    valido: /autorizada/i.test(mensaje),
    mensaje,
  };
}

export type ItemComprobante = {
  nombre: string;
  precio: number;
  pesoTicket: number | null;
  precioPorKiloTicket: number | null;
  tamano: string | null;
  unidades: number | null;
};

const FACTOR_A_UNIDAD_BASE: Record<string, { factor: number; base: string }> = {
  kg: { factor: 1, base: "kg" },
  kgs: { factor: 1, base: "kg" },
  g: { factor: 0.001, base: "kg" },
  gr: { factor: 0.001, base: "kg" },
  grs: { factor: 0.001, base: "kg" },
  l: { factor: 1, base: "L" },
  lt: { factor: 1, base: "L" },
  lts: { factor: 1, base: "L" },
  cc: { factor: 0.001, base: "L" },
  ml: { factor: 0.001, base: "L" },
};

function formatearCantidad(valor: number): string {
  return valor
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export type NombreItemParseado = {
  nombre: string;
  tamano: string | null;
  unidades: number | null;
};

/**
 * Separa el peso/volumen o conteo que el POS pega al final del nombre de un ítem.
 * @param nombreCrudo nombre del ítem tal como viene del ticket
 * @returns nombre limpio, `tamano` (peso/volumen normalizado) y `unidades` (conteo), mutuamente excluyentes
 */
export function parsearNombreItem(nombreCrudo: string): NombreItemParseado {
  const nombre = nombreCrudo.replace(/\s+/g, " ").trim();

  const unidadesPatron = Object.keys(FACTOR_A_UNIDAD_BASE).join("|");
  const medida = nombre.match(
    new RegExp(
      `^(.*?)[\\sx*-]*((?<![a-zá-ú])[.,]\\d+|\\d+(?:[.,]\\d+)?)\\s*(${unidadesPatron})\\.?$`,
      "i"
    )
  );
  if (medida) {
    const base = medida[1].replace(/[\s.,x*-]+$/i, "").trim();
    const valor = Number(medida[2].replace(",", "."));
    const unidad = FACTOR_A_UNIDAD_BASE[medida[3].toLowerCase()];
    if (base && Number.isFinite(valor) && valor > 0) {
      return {
        nombre: base,
        tamano: `${formatearCantidad(valor * unidad.factor)}${unidad.base}`,
        unidades: null,
      };
    }
  }

  const conteo = nombre.match(
    /^(.*?)[\s.-]*(?:x\s*(\d{1,3})|(\d{1,3})\s*(?:un|uns|und|unid|unidad|unidades|u)\.?)$/i
  );
  if (conteo) {
    const base = conteo[1].replace(/[\s.,x*-]+$/i, "").trim();
    const cantidad = Number(conteo[2] ?? conteo[3]);
    if (base && Number.isFinite(cantidad) && cantidad > 0) {
      return { nombre: base, tamano: null, unidades: cantidad };
    }
  }

  return { nombre, tamano: null, unidades: null };
}

export type DetalleComprobante = {
  emisorNombre: string;
  direccion: string | null;
  items: ItemComprobante[];
  total: number | null;
  moneda: string | null;
};

function parsearMontoUY(texto: string): number {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".");
  return Number(limpio);
}

function textoDeCelda(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Consulta el detalle de un comprobante contra el proveedor de CFE del emisor.
 * @param urlBase URL de consulta del proveedor (`proveedoresCfe.urlConsulta`)
 * @param datos campos del CFE (de `parsearQR`)
 * @param formato implementación de consulta/parseo a usar
 * @returns detalle del comprobante (comercio, ítems, total, moneda)
 */
export async function consultarProcesador(
  urlBase: string,
  datos: DatosQR,
  formato: FormatoProveedorCfe
): Promise<DetalleComprobante> {
  switch (formato) {
    case "scanntech":
      return consultarScanntech(urlBase, datos);
    case "taface":
      return consultarTaface(urlBase, datos);
    default:
      throw new Error(
        "Este proveedor de CFE todavía no tiene consulta automática implementada"
      );
  }
}

async function consultarScanntech(
  urlBase: string,
  datos: DatosQR
): Promise<DetalleComprobante> {
  const body = new URLSearchParams({
    rut: datos.ruc,
    tipoCfe: datos.tipoCfe,
    serie: datos.serie,
    nroCFE: datos.numero,
    monto: datos.monto,
    fecha: datos.fecha,
    hash: datos.hash.slice(0, 6),
  });

  const res = await fetch(urlBase, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`El procesador respondió ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const html = new TextDecoder("iso-8859-1").decode(buffer);

  return parsearComprobanteHtml(html);
}

/**
 * Parsea el HTML de boleta devuelto por Scanntech.
 * @param html HTML de respuesta del procesador
 * @returns detalle del comprobante
 */
export function parsearComprobanteHtml(html: string): DetalleComprobante {
  const filas = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((td) =>
      textoDeCelda(td[1])
    )
  );

  const emisorNombre =
    filas.find((f) => f.length === 1 && f[0] && !/\d/.test(f[0]))?.[0] ??
    "Comercio desconocido";

  const direccionFila = filas.find(
    (f) => f.length === 1 && /^[A-ZÁÉÍÓÚÑ0-9 .,]+$/.test(f[0] ?? "") && /\d/.test(f[0] ?? "") && !/^RUT:/i.test(f[0] ?? "")
  );
  const direccion = direccionFila?.[0] ?? null;

  const items: ItemComprobante[] = [];
  let total: number | null = null;

  for (const fila of filas) {
    if (fila.length === 0) continue;
    const ultima = fila[fila.length - 1];

    if (/^TOTAL:/i.test(fila[0] ?? "")) {
      const monto = ultima.replace(/[^\d.,]/g, "");
      if (monto) total = parsearMontoUY(monto);
      continue;
    }

    if (fila.length === 1) {
      const detalle = parsearFilaDetalle(fila[0] ?? "");
      const ultimoItem = items[items.length - 1];
      if (detalle && ultimoItem) {
        if (detalle.esPeso) {
          ultimoItem.pesoTicket = detalle.cantidad;
          ultimoItem.precioPorKiloTicket = detalle.precioUnitario;
        } else {
          ultimoItem.unidades = detalle.cantidad;
        }
      }
      continue;
    }

    if (fila.length === 2 && ES_MONTO.test(ultima)) {
      const crudo = fila[0];
      if (crudo) {
        const { nombre, tamano, unidades } = parsearNombreItem(crudo);
        items.push({
          nombre,
          tamano,
          unidades,
          precio: parsearMontoUY(ultima),
          pesoTicket: null,
          precioPorKiloTicket: null,
        });
      }
    }
  }

  return { emisorNombre, direccion, items, total, moneda: null };
}

const ES_MONTO = /^\d{1,3}(\.\d{3})*,\d{2}$/;

const FILA_DETALLE = /^\(\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*\)$/;

function parsearFilaDetalle(
  celda: string
): { cantidad: number; precioUnitario: number; esPeso: boolean } | null {
  const match = celda.trim().match(FILA_DETALLE);
  if (!match) return null;
  const crudo = match[1];
  const cantidad = Number(crudo.replace(",", "."));
  const precioUnitario = parsearMontoUY(match[2]);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) return null;
  return { cantidad, precioUnitario, esPeso: /[.,]/.test(crudo) };
}

async function consultarTaface(
  urlBase: string,
  datos: DatosQR
): Promise<DetalleComprobante> {
  const partes = [
    datos.ruc,
    datos.tipoCfe,
    datos.numero,
    datos.serie,
    datos.monto,
    datos.hash.slice(0, 6),
  ];
  const url = `${urlBase}?${partes.map(encodeURIComponent).join(",")}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`El procesador respondió ${res.status}`);
  }

  return parsearComprobanteTaface(await res.text());
}

/**
 * Parsea el HTML de respuesta devuelto por TA-Face.
 * @param html HTML de respuesta del procesador
 * @returns detalle del comprobante
 */
export function parsearComprobanteTaface(html: string): DetalleComprobante {
  const gridMatch = html.match(/name="Grid1ContainerDataV" value='([^']*)'/);
  let filas: string[][] = [];
  if (gridMatch) {
    try {
      filas = JSON.parse(
        gridMatch[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&")
      );
    } catch {
      filas = [];
    }
  }

  if (filas.length === 0) {
    throw new Error("Comprobante no encontrado en TA-Face");
  }

  const emisorNombre = campoTaface(html, "span_vEMIRZNSOC") ?? "Comercio desconocido";
  const direccion = campoTaface(html, "span_vEMIDOMFISCAL");
  const totalTexto = campoTaface(html, "span_vTOTMNTTOTAL");
  const total = totalTexto ? parsearMontoUY(totalTexto) : null;
  const moneda = campoTaface(html, "span_vTOTTPOMONEDA");

  const items: ItemComprobante[] = filas
    .filter((fila) => fila.length >= 9)
    .map((fila) => {
      const [, ivaPctCrudo, articuloCrudo, , cantidadCruda, um, precioUnitarioCrudo, , montoCrudo] =
        fila;
      const { nombre, tamano, unidades } = parsearNombreItem(
        articuloCrudo.replace(/^\s*\d+\s*-\s*/, "")
      );
      const cantidad = Number(cantidadCruda.replace(",", "."));
      const esPeso =
        um.trim().toUpperCase() === "KG" &&
        Number.isFinite(cantidad) &&
        cantidad > 0;
      const conIva = conIvaDeLinea(ivaPctCrudo);

      return {
        nombre,
        tamano,
        unidades,
        precio: conIva(parsearMontoUY(montoCrudo)),
        pesoTicket: esPeso ? cantidad : null,
        precioPorKiloTicket: esPeso ? conIva(parsearMontoUY(precioUnitarioCrudo)) : null,
      };
    })
    .filter((item) => item.precio > 0);

  return { emisorNombre, direccion, items, total, moneda };
}

function conIvaDeLinea(ivaPctCrudo: string): (montoNeto: number) => number {
  const ivaPct = Number(ivaPctCrudo.replace(",", ".").replace("%", ""));
  if (!Number.isFinite(ivaPct) || ivaPct <= 0) return (montoNeto) => montoNeto;
  return (montoNeto) => Math.round(montoNeto * (1 + ivaPct / 100) * 100) / 100;
}

function campoTaface(html: string, id: string): string | null {
  const match = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
  const texto = match?.[1]?.trim();
  return texto ? texto : null;
}
