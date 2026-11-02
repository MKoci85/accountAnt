import { formatearFechaCorta, formatearMonto } from "@/lib/formato";

/** Diferencia en pesos que se toma como redondeo del banco y no como error del plan. */
export const TOLERANCIA_CUOTA = 2;

/**
 * Días antes del cierre en que una compra puede no llegar a su primer estado
 * de cuenta: el banco la pasa al siguiente.
 */
const DIAS_CUOTA_1_AL_CIERRE = 5;

/** Recargo máximo que se acepta al deducirlo de una cuota: más es otra compra. */
const RECARGO_MAXIMO_PCT = 100;

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
}

/**
 * El total que se termina pagando: el precio más el recargo, que se toma como
 * un porcentaje sobre el precio (así se anuncia: "12 cuotas con 10% de recargo").
 */
export function totalFinanciado(total: number, interesPct: number): number {
  return redondear(total * (1 + interesPct / 100));
}

/**
 * Reparte un importe en partes iguales a centavos; la última absorbe lo que
 * sobra del redondeo, para que la suma dé exacta.
 */
function partesIguales(importe: number, partes: number): number[] {
  if (partes <= 0) return [];
  const base = redondear(importe / partes);
  return Array.from({ length: partes }, (_, i) =>
    i === partes - 1 ? redondear(importe - base * (partes - 1)) : base
  );
}

/** El importe calculado de cada cuota de una compra. */
export function planDeCuotas(
  total: number,
  cantidad: number,
  interesPct: number
): number[] {
  return partesIguales(totalFinanciado(total, interesPct), cantidad);
}

/** El recargo que resulta de pagar `financiado` por algo que vale `total`. */
export function interesImplicito(total: number, financiado: number): number {
  return total > 0 ? redondear((financiado / total - 1) * 100) : 0;
}

export type CuotaPlan = {
  numero: number;
  importeCalculado: number;
  importePagado: number | null;
  pagada: boolean;
};

/**
 * Vuelve a calcular las cuotas sin pagar con el total y el recargo dados: lo
 * que falta del total financiado, descontado lo ya pagado, en partes iguales.
 * Las pagadas no se tocan.
 */
export function recalcularPendientes<C extends CuotaPlan>(
  total: number,
  interesPct: number,
  cuotas: C[]
): C[] {
  const pagado = cuotas
    .filter((c) => c.pagada)
    .reduce((acc, c) => acc + (c.importePagado ?? c.importeCalculado), 0);
  const pendientes = cuotas.filter((c) => !c.pagada);
  const importes = partesIguales(
    Math.max(totalFinanciado(total, interesPct) - pagado, 0),
    pendientes.length
  );
  const porNumero = new Map(pendientes.map((c, i) => [c.numero, importes[i]]));
  return cuotas.map((c) =>
    c.pagada ? c : { ...c, importeCalculado: porNumero.get(c.numero) ?? 0 }
  );
}

/**
 * Corrige el plan con lo que de verdad cobró el banco. Mira la última cuota
 * pagada: si el cobro difiere del cálculo en más que el redondeo, el recargo
 * estaba mal (o no se sabía), y como el banco cobra cuotas fijas las que
 * faltan pasan a valer lo cobrado. El recargo se actualiza al que surge de eso.
 * @returns el plan, el recargo y si hubo que ajustar
 */
export function ajustarPlan<C extends CuotaPlan>(
  total: number,
  interesPct: number,
  cuotas: C[]
): { cuotas: C[]; interesPct: number; ajustado: boolean } {
  const ultima = cuotas
    .filter((c) => c.pagada && c.importePagado !== null)
    .sort((a, b) => b.numero - a.numero)[0];
  if (
    !ultima ||
    ultima.importePagado === null ||
    Math.abs(ultima.importePagado - ultima.importeCalculado) <= TOLERANCIA_CUOTA
  ) {
    return { cuotas, interesPct, ajustado: false };
  }
  const referencia = ultima.importePagado;
  const pagado = cuotas
    .filter((c) => c.pagada)
    .reduce((acc, c) => acc + (c.importePagado ?? c.importeCalculado), 0);
  const pendientes = cuotas.filter((c) => !c.pagada).length;
  return {
    cuotas: cuotas.map((c) =>
      c.pagada ? c : { ...c, importeCalculado: referencia }
    ),
    interesPct: interesImplicito(total, pagado + referencia * pendientes),
    ajustado: true,
  };
}

export type GrupoDeCompra = {
  categoriaId: number;
  esHormiga: boolean;
  monto: number;
};

/**
 * Cómo se reparte una cuota en el gasto que la representa. La parte de
 * capital (el precio dividido en cuotas) va a las categorías de la compra en
 * proporción, separando lo hormiga de lo que no lo es; lo que se paga por
 * encima es recargo de financiación y va aparte, para que se vea cuánto se
 * pagó de intereses.
 * @param capitalPorCuota el total de la compra dividido la cantidad de cuotas
 */
export function repartoDeCuota(
  grupos: GrupoDeCompra[],
  importe: number,
  capitalPorCuota: number
): { lineas: GrupoDeCompra[]; recargo: number } {
  const validos = grupos.filter((g) => g.monto > 0);
  const recargo =
    capitalPorCuota > 0 && importe - capitalPorCuota >= 0.01
      ? redondear(importe - capitalPorCuota)
      : 0;
  const capital = redondear(importe - recargo);
  const suma = validos.reduce((acc, g) => acc + g.monto, 0);
  if (!validos.length || suma <= 0) return { lineas: [], recargo };

  let asignado = 0;
  const lineas = validos.map((g, i) => {
    const monto =
      i === validos.length - 1
        ? redondear(capital - asignado)
        : redondear((capital * g.monto) / suma);
    asignado = redondear(asignado + monto);
    return { ...g, monto };
  });
  return { lineas: lineas.filter((l) => l.monto > 0), recargo };
}

/** Suma los montos de las líneas de una compra por categoría y marca hormiga. */
export function gruposDeCompra(
  lineas: { categoriaId: number; esHormiga: boolean; monto: number }[]
): GrupoDeCompra[] {
  const porClave = new Map<string, GrupoDeCompra>();
  for (const l of lineas) {
    const clave = `${l.categoriaId}|${l.esHormiga}`;
    const previo = porClave.get(clave);
    porClave.set(clave, {
      categoriaId: l.categoriaId,
      esHormiga: l.esHormiga,
      monto: redondear((previo?.monto ?? 0) + l.monto),
    });
  }
  return [...porClave.values()];
}

export type CuotaDeCompra = CuotaPlan & {
  id: number;
  gastoId: number | null;
  /** Fecha del gasto que la pagó; null si no está pagada. */
  fechaPago: string | null;
};

export type CompraParaCruce = {
  compraId: number;
  gastoId: number;
  fecha: string;
  emisorId: number;
  emisorNombre: string;
  cantidad: number;
  total: number;
  tarjeta: string | null;
  cuotas: CuotaDeCompra[];
};

/** Si la compra puede estar en un estado de cuenta de esa tarjeta. */
export function tarjetaCompatible(
  deCompra: string | null,
  deEstadoCuenta: string | null
): boolean {
  return deCompra === null || deEstadoCuenta === null || deCompra === deEstadoCuenta;
}

export type LineaConCuota = {
  /** La fecha de compra que imprime el banco en la línea. */
  fechaCompra: string;
  cuota: { numero: number; total: number };
  montoPesos: number;
};

/**
 * La cuota de una compra registrada a la que corresponde una línea `CUOTA n/m`:
 * misma fecha de compra (±1 día), la misma cantidad de cuotas, y la cuota n
 * todavía sin pagar ni tomada por otra línea. El importe no decide si
 * corresponde (puede estar mal calculado), sólo desempata.
 * @param tomadas cuotas ya asignadas a otras líneas del mismo estado de cuenta
 */
export function cuotaParaLinea(
  linea: LineaConCuota,
  compras: CompraParaCruce[],
  tarjeta: string | null,
  tomadas: Set<number>
): { compra: CompraParaCruce; cuota: CuotaDeCompra } | null {
  const opciones = compras.flatMap((compra) => {
    if (compra.cantidad !== linea.cuota.total) return [];
    if (diasEntre(compra.fecha, linea.fechaCompra) > 1) return [];
    if (!tarjetaCompatible(compra.tarjeta, tarjeta)) return [];
    const cuota = compra.cuotas.find(
      (c) => c.numero === linea.cuota.numero && !c.pagada && !tomadas.has(c.id)
    );
    return cuota ? [{ compra, cuota }] : [];
  });
  opciones.sort(
    (a, b) =>
      Math.abs(a.cuota.importeCalculado - linea.montoPesos) -
      Math.abs(b.cuota.importeCalculado - linea.montoPesos)
  );
  return opciones[0] ?? null;
}

/**
 * Si un gasto común puede ser la compra entera de la que una línea es cuota:
 * en la fecha de compra (±1 día) y, o el total coincide con cuota × cantidad
 * (sin recargo, con el redondeo del banco en cada cuota), o es del mismo
 * comercio y cuota × cantidad lo supera, que es el recargo.
 * @returns el recargo deducido, o null si no parece la misma compra
 */
export function pareceCompraEntera(
  gasto: { fecha: string; total: number; mismoComercio: boolean },
  linea: LineaConCuota
): { interesPct: number } | null {
  if (gasto.total <= 0 || diasEntre(gasto.fecha, linea.fechaCompra) > 1) return null;
  const financiado = redondear(linea.montoPesos * linea.cuota.total);
  if (Math.abs(financiado - gasto.total) <= TOLERANCIA_CUOTA * linea.cuota.total) {
    return { interesPct: 0 };
  }
  if (!gasto.mismoComercio || financiado < gasto.total) return null;
  const interesPct = interesImplicito(gasto.total, financiado);
  return interesPct <= RECARGO_MAXIMO_PCT ? { interesPct } : null;
}

export type LineaParaEsperar = {
  indice: number;
  descripcion: string;
  /** Fecha de compra para una cuota, la de la línea si no lo es. */
  fechaCompra: string;
  montoPesos: number | null;
  cuota: { numero: number; total: number } | null;
  /** La cuota de compra que tomó esta línea, automática o elegida a mano. */
  cuotaAsignadaId: number | null;
  gastoExistenteId: number | null;
  /** Ya tiene otro destino (convierte un gasto en compra en cuotas): no se ofrece. */
  ocupada?: boolean;
};

export type TipoCuotaEsperada = "faltante" | "sin_registrar" | "puede_venir";

export type CuotaEsperada = {
  cuotaId: number;
  compraId: number;
  gastoId: number;
  numero: number;
  cantidad: number;
  importeCalculado: number;
  emisorNombre: string;
  fechaCompra: string;
  tipo: TipoCuotaEsperada;
  /** Líneas que podrían ser la cuota, la más parecida primero, con lo que no coincide. */
  candidatos: { indice: number; motivos: string[] }[];
};

function motivosContra(
  linea: LineaParaEsperar,
  compra: CompraParaCruce,
  cuota: CuotaDeCompra
): { puntaje: number; motivos: string[] } {
  const motivos: string[] = [];
  let puntaje = 0;
  if (!linea.cuota) {
    motivos.push("no tiene marca de cuota");
  } else if (linea.cuota.total !== compra.cantidad) {
    motivos.push(
      `la cantidad de cuotas no coincide (${linea.cuota.total} contra ${compra.cantidad})`
    );
  } else {
    puntaje += 3;
    if (linea.cuota.numero !== cuota.numero) {
      motivos.push(`es la cuota ${linea.cuota.numero}, no la ${cuota.numero}`);
    }
  }
  if (diasEntre(linea.fechaCompra, compra.fecha) <= 1) {
    puntaje += 2;
  } else if (linea.cuota) {
    motivos.push(`fecha de compra distinta (${formatearFechaCorta(linea.fechaCompra)})`);
  }
  if (linea.montoPesos !== null) {
    const diferencia = Math.abs(linea.montoPesos - cuota.importeCalculado);
    if (diferencia <= TOLERANCIA_CUOTA) {
      puntaje += 2;
    } else {
      if (diferencia <= cuota.importeCalculado * 0.25) puntaje += 1;
      motivos.push(
        `importe distinto: ${formatearMonto(linea.montoPesos, { decimales: 2 })} contra ${formatearMonto(cuota.importeCalculado, { decimales: 2 })} calculados`
      );
    }
  }
  return { puntaje, motivos };
}

/**
 * Las cuotas que tendrían que estar en este estado de cuenta y no se cruzaron
 * con ninguna línea. Para cada compra con cuotas sin pagar, de una tarjeta
 * compatible, comprada antes del corte y sin un pago posterior a él:
 * - si otra línea de este estado de cuenta pagó una cuota posterior, las
 *   anteriores sin pagar son de un estado de cuenta que no se importó;
 * - si ninguna línea es de esta compra, se espera la siguiente sin pagar,
 *   salvo la primera de una compra de pocos días antes del corte, que puede
 *   venir en el próximo.
 * @param corte cierre del estado de cuenta, o la fecha de su último movimiento
 */
export function cuotasEsperadas(
  compras: CompraParaCruce[],
  estadoCuenta: { corte: string; tarjeta: string | null },
  lineas: LineaParaEsperar[]
): CuotaEsperada[] {
  const esperadas: CuotaEsperada[] = [];
  const libres = lineas.filter(
    (l) => !l.ocupada && l.cuotaAsignadaId === null && l.gastoExistenteId === null
  );

  for (const compra of compras) {
    if (compra.fecha > estadoCuenta.corte) continue;
    if (!tarjetaCompatible(compra.tarjeta, estadoCuenta.tarjeta)) continue;
    if (compra.cuotas.some((c) => c.fechaPago !== null && c.fechaPago > estadoCuenta.corte)) {
      continue;
    }

    const idsCuotas = new Map(compra.cuotas.map((c) => [c.id, c]));
    const gastosCuotas = new Map(
      compra.cuotas.flatMap((c) => (c.gastoId === null ? [] : [[c.gastoId, c] as const]))
    );
    const enEste = lineas.flatMap((l) => {
      const cuota =
        (l.cuotaAsignadaId !== null ? idsCuotas.get(l.cuotaAsignadaId) : undefined) ??
        (l.gastoExistenteId !== null ? gastosCuotas.get(l.gastoExistenteId) : undefined);
      return cuota ? [cuota.numero] : [];
    });
    const sinPagar = compra.cuotas
      .filter((c) => !c.pagada && !enEste.includes(c.numero))
      .sort((a, b) => a.numero - b.numero);
    if (!sinPagar.length) continue;

    const faltan: { cuota: CuotaDeCompra; tipo: TipoCuotaEsperada }[] = enEste.length
      ? sinPagar
          .filter((c) => c.numero < Math.max(...enEste))
          .map((cuota) => ({ cuota, tipo: "sin_registrar" as const }))
      : [
          {
            cuota: sinPagar[0],
            tipo:
              sinPagar[0].numero === 1 &&
              diasEntre(compra.fecha, estadoCuenta.corte) <= DIAS_CUOTA_1_AL_CIERRE
                ? "puede_venir"
                : "faltante",
          },
        ];

    for (const { cuota, tipo } of faltan) {
      const candidatos = libres
        .map((l) => ({ indice: l.indice, ...motivosContra(l, compra, cuota) }))
        .filter((c) => c.puntaje > 0)
        .sort((a, b) => b.puntaje - a.puntaje)
        .map(({ indice, motivos }) => ({ indice, motivos }));
      esperadas.push({
        cuotaId: cuota.id,
        compraId: compra.compraId,
        gastoId: compra.gastoId,
        numero: cuota.numero,
        cantidad: compra.cantidad,
        importeCalculado: cuota.importeCalculado,
        emisorNombre: compra.emisorNombre,
        fechaCompra: compra.fecha,
        tipo,
        candidatos,
      });
    }
  }
  return esperadas;
}
