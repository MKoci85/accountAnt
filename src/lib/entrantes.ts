import type { DatosQR } from "@/lib/cfe";
import { aISO } from "@/lib/formato";

/** Un ítem tal como vino del comprobante, antes de buscarlo en el catálogo. */
export type ItemEntrante = {
  nombre: string;
  precio: number;
  tamano: string | null;
  unidades: number | null;
  pesoTicket: number | null;
  precioPorKiloTicket: number | null;
};

/**
 * Identidad de un comprobante dentro de la bandeja. Es lo mismo que DGI mira
 * para validarlo (RUC, tipo, serie y número): el monto, la fecha y el hash no
 * distinguen un comprobante de otro.
 */
export function claveComprobante(datos: DatosQR): string {
  return [datos.ruc, datos.tipoCfe, datos.serie, datos.numero].join("|");
}

/**
 * La fecha por la que un entrante cuenta para el bloqueo por mes: la del
 * comprobante, y si no se pudo leer, el día en que llegó (en hora local —
 * `recibidoEn` es UTC y de noche ya marca el día siguiente).
 */
export function fechaDeReferencia(entrante: {
  fecha: string | null;
  recibidoEn: string;
}): string {
  return entrante.fecha ?? aISO(new Date(entrante.recibidoEn));
}

/** Si el entrante quedó pendiente de un mes anterior al de `hoy`. */
export function esDeMesAnterior(
  entrante: { fecha: string | null; recibidoEn: string },
  hoy: Date = new Date()
): boolean {
  return fechaDeReferencia(entrante).slice(0, 7) < aISO(hoy).slice(0, 7);
}

function numeroONull(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

/**
 * Lee los ítems guardados de un entrante. Un JSON corrupto o con otra forma
 * degrada a "sin ítems" en vez de romper la bandeja entera: el comprobante
 * sigue pudiéndose reintentar o descartar.
 */
export function parsearItemsEntrante(json: string): ItemEntrante[] {
  let crudo: unknown;
  try {
    crudo = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(crudo)) return [];

  return crudo.flatMap((fila): ItemEntrante[] => {
    if (!fila || typeof fila !== "object") return [];
    const f = fila as Record<string, unknown>;
    const precio = numeroONull(f.precio);
    if (typeof f.nombre !== "string" || !f.nombre.trim() || precio === null) {
      return [];
    }
    return [
      {
        nombre: f.nombre,
        precio,
        tamano: typeof f.tamano === "string" ? f.tamano : null,
        unidades: numeroONull(f.unidades),
        pesoTicket: numeroONull(f.pesoTicket),
        precioPorKiloTicket: numeroONull(f.precioPorKiloTicket),
      },
    ];
  });
}

/**
 * Por qué un comprobante recibido tiene que pasar por la revisión manual, o
 * null si se puede guardar solo. La vara es que no quede nada por decidir:
 * vino de un QR que DGI validó, el proveedor devolvió el detalle sin avisos,
 * todas las líneas son ítems del catálogo con precio, y su suma da el total
 * del comprobante. Un link o un ticket leídos por IA nunca pasan: un precio
 * mal leído se volvería precio de referencia sin que nadie lo viera.
 */
export function motivoDeRevision(comprobante: {
  lectura: "qr" | "link" | "ticket" | null;
  aviso: string | null;
  total: number | null;
  lineas: { catalogada: boolean; cantidad: number; precio: number }[];
}): string | null {
  if (comprobante.lectura !== "qr") {
    return "Se leyó con IA, sin un QR validado: hay que revisarlo contra el papel.";
  }
  if (comprobante.aviso) return comprobante.aviso;
  if (comprobante.lineas.length === 0) {
    return "El comprobante no trajo el detalle de ítems.";
  }

  const sinReconocer = comprobante.lineas.filter((l) => !l.catalogada).length;
  if (sinReconocer > 0) {
    return sinReconocer === 1
      ? "Hay 1 ítem sin reconocer."
      : `Hay ${sinReconocer} ítems sin reconocer.`;
  }
  if (comprobante.lineas.some((l) => !(l.precio > 0) || !(l.cantidad > 0))) {
    return "Hay ítems sin precio o sin cantidad.";
  }
  if (comprobante.total === null || !Number.isFinite(comprobante.total)) {
    return "El comprobante no trajo el total.";
  }

  const suma = comprobante.lineas.reduce(
    (acc, l) => acc + l.cantidad * l.precio,
    0
  );
  if (Math.abs(suma - comprobante.total) > 1) {
    return "La suma de los ítems no coincide con el total del comprobante.";
  }
  return null;
}

function diasEntre(fechaA: string, fechaB: string): number {
  const ms = Date.parse(`${fechaA}T12:00:00Z`) - Date.parse(`${fechaB}T12:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
}

export type ConflictoBandeja = {
  entranteId: number;
  /** Índices de los movimientos del estado de cuenta con los que choca. */
  movimientos: number[];
  /** true si choca por no poder descartarlo (le falta fecha o total), no por coincidir. */
  sinDatos: boolean;
};

/**
 * Qué comprobantes de la bandeja podrían ser un movimiento del estado de
 * cuenta que se está por importar. Importarlo igual dejaría el gasto duplicado
 * cuando el comprobante se confirme.
 *
 * El criterio es el mismo con el que un movimiento matchea un gasto ya
 * cargado: misma fecha con un día de tolerancia y mismo monto. Un comprobante
 * al que le falta la fecha o el total no se puede descartar, así que choca con
 * que su fecha de referencia caiga dentro del período del estado de cuenta.
 * @param movimientos Sólo los que se importarían (no los que ya matchean un gasto).
 */
export function entrantesEnConflicto(
  movimientos: { indice: number; fecha: string; montoPesos: number | null }[],
  entrantes: {
    id: number;
    fecha: string | null;
    recibidoEn: string;
    total: number | null;
  }[],
  tolerancia: { dias: number; monto: number }
): ConflictoBandeja[] {
  if (!movimientos.length) return [];
  const fechas = movimientos.map((m) => m.fecha).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];

  return entrantes.flatMap((entrante): ConflictoBandeja[] => {
    if (entrante.fecha === null || entrante.total === null) {
      const referencia = fechaDeReferencia(entrante);
      const enPeriodo =
        (referencia >= desde && referencia <= hasta) ||
        diasEntre(referencia, desde) <= tolerancia.dias ||
        diasEntre(referencia, hasta) <= tolerancia.dias;
      return enPeriodo
        ? [{ entranteId: entrante.id, movimientos: [], sinDatos: true }]
        : [];
    }

    const { fecha, total } = entrante;
    const coinciden = movimientos.filter(
      (m) =>
        m.montoPesos !== null &&
        Math.abs(m.montoPesos - total) <= tolerancia.monto &&
        diasEntre(m.fecha, fecha) <= tolerancia.dias
    );
    return coinciden.length
      ? [
          {
            entranteId: entrante.id,
            movimientos: coinciden.map((m) => m.indice),
            sinDatos: false,
          },
        ]
      : [];
  });
}
