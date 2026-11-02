import type { FilaPdf, FragmentoPdf } from "./pdf";

export type MovimientoEstadoCuenta = {
  fecha: string;
  descripcion: string;
  monto: number;
  moneda: "UYU" | "USD";
  /** La fecha de compra que imprime el banco, cuando `fecha` es otra (una cuota). */
  fechaCompra?: string;
};

export type Cuota = { numero: number; total: number };

const RE_CUOTA = /\bCUOTAS?\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i;

export function cuotaDe(texto: string): Cuota | null {
  const m = RE_CUOTA.exec(texto);
  return m ? { numero: Number(m[1]), total: Number(m[2]) } : null;
}

/**
 * El texto sin la marca de cuota: es el mismo comercio en todas las cuotas, y
 * con la marca cada mes crearía un emisor y un alias nuevos.
 */
export function sinCuota(texto: string): string {
  return texto.replace(RE_CUOTA, " ").replace(/\s+/g, " ").trim();
}

/**
 * Pasa cada cuota a la fecha de cierre del estado de cuenta. El banco imprime
 * todas las cuotas con la fecha de la compra original, y cada una se cobra en
 * el mes de su estado de cuenta: con la fecha impresa, las cuatro cuotas de
 * una compra caerían en el mismo mes. La fecha impresa queda en `fechaCompra`.
 * @param cierre fecha de cierre; sin ella no se toca nada
 */
export function fecharCuotas(
  movimientos: MovimientoEstadoCuenta[],
  cierre: string | null
): MovimientoEstadoCuenta[] {
  if (!cierre) return movimientos;
  return movimientos.map((m) =>
    cuotaDe(m.descripcion) && m.fecha !== cierre
      ? { ...m, fecha: cierre, fechaCompra: m.fecha }
      : m
  );
}

/**
 * Si una línea en cuotas puede ser un gasto ya cargado: sólo si es la misma
 * cuota. Un gasto sin marca de cuota no se descarta, porque no hay con qué
 * distinguirlo; una línea sin cuota no tiene esta restricción.
 * @param textosGasto nombre del comercio y descripciones de las líneas del gasto
 */
export function cuotaCompatible(descripcion: string, textosGasto: string[]): boolean {
  const deLinea = cuotaDe(descripcion);
  if (!deLinea) return true;
  const delGasto = textosGasto.map(cuotaDe).find((c) => c !== null);
  return !delGasto || delGasto.numero === deLinea.numero;
}

/** Cuántas cuotas quedan después de esta y cuánto suman, al mismo importe. */
export function cuotasRestantes(
  cuota: Cuota,
  montoPesos: number | null
): { cantidad: number; pesos: number | null } {
  const cantidad = Math.max(cuota.total - cuota.numero, 0);
  return {
    cantidad,
    pesos: montoPesos === null ? null : Number((cantidad * montoPesos).toFixed(2)),
  };
}

const PREFIJOS_NO_CONSUMO = [
  "SALDO",
  "PAGOS",
  "PAGO ",
  "TOTAL TARJETA",
  "TOTAL ",
  "TARJETA No",
  "TARJETA N",
  "SU PAGO",
  "CANCELACION",
  "PAGO MINIMO",
  "PAGO RECIBIDO",
];

const UMBRAL_USD_FALLBACK = 500;

const RE_FECHA = /^(\d{2})\/(\d{2})\/(\d{2})(?=\s|$)/;

const RE_MONTO = /^-?\s*[\d,]+\.\d{2}$/;

/**
 * Busca la X del encabezado de la columna de dólares para separar monedas.
 * @param filas filas del PDF
 * @returns la coordenada X umbral: a la derecha es USD, a la izquierda UYU
 */
export function detectarUmbralUSD(filas: FilaPdf[]): number {
  for (const fila of filas) {
    const usd = fila.fragmentos.find((f) => /^(USD|U\$S|DOLARES?|US\$)$/i.test(f.texto));
    if (!usd) continue;

    const pesos = fila.fragmentos.find(
      (f) => /^(\$|UYU|PESOS?|\$U)$/i.test(f.texto) && f.x < usd.x
    );
    return pesos ? (pesos.x + usd.x) / 2 : usd.x - 30;
  }
  return UMBRAL_USD_FALLBACK;
}

export function esNoConsumo(texto: string): boolean {
  const t = texto.toUpperCase().trimStart();
  return PREFIJOS_NO_CONSUMO.some((p) => t.startsWith(p.toUpperCase()));
}

export function parsearMonto(texto: string): number | null {
  if (!RE_MONTO.test(texto)) return null;
  const n = Number(texto.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function fechaISO(dd: string, mm: string, aa: string): string {
  return `20${aa}-${mm}-${dd}`;
}

function esFilaConFecha(fila: FilaPdf): boolean {
  return RE_FECHA.test(fila.texto);
}

/**
 * Las filas que siguen al encabezado de la tabla de movimientos (la que dice
 * "Fecha" y "Descripción"). Lo de arriba es la cabecera del resumen, con fechas
 * e importes que no son movimientos.
 * @returns todas las filas si el PDF no trae ese encabezado
 */
export function filasDelDetalle(filas: FilaPdf[]): FilaPdf[] {
  const encabezado = filas.findIndex(
    (f) => /\bFECHA\b/i.test(f.texto) && /DESCRIPCI/i.test(f.texto)
  );
  return encabezado === -1 ? filas : filas.slice(encabezado + 1);
}

function separacionTipica(conFecha: FilaPdf[]): number {
  const separaciones: number[] = [];
  for (let i = 1; i < conFecha.length; i++) {
    if (conFecha[i].pagina !== conFecha[i - 1].pagina) continue;
    separaciones.push(Math.abs(conFecha[i - 1].y - conFecha[i].y));
  }
  if (!separaciones.length) return 0;
  separaciones.sort((a, b) => a - b);
  return separaciones[Math.floor(separaciones.length / 2)];
}

export type RenglonEstadoCuenta = { conFecha: FilaPdf; filas: FilaPdf[] };

/**
 * Junta cada fila con fecha con las líneas en que el PDF partió sus celdas:
 * una celda que no entra en su columna se imprime en varias líneas, y la fecha
 * y el importe quedan en una sola de ellas. Una línea sin fecha se suma a la
 * fila con fecha más cercana si está a menos de media separación típica entre
 * filas; más lejos es otra fila (el número de tarjeta, un subtotal).
 * @returns un renglón por fila con fecha, con sus líneas de arriba a abajo
 */
export function agruparRenglones(filas: FilaPdf[]): RenglonEstadoCuenta[] {
  const conFecha = filas.filter(esFilaConFecha);
  const margen = separacionTipica(conFecha) / 2;
  const renglones = conFecha.map((f) => ({ conFecha: f, filas: [f] }));

  for (const fila of filas) {
    if (esFilaConFecha(fila)) continue;
    let cercano: RenglonEstadoCuenta | null = null;
    let distancia = Infinity;
    for (const renglon of renglones) {
      if (renglon.conFecha.pagina !== fila.pagina) continue;
      const d = Math.abs(renglon.conFecha.y - fila.y);
      if (d < distancia) {
        distancia = d;
        cercano = renglon;
      }
    }
    if (cercano && distancia < margen) cercano.filas.push(fila);
  }

  for (const renglon of renglones) renglon.filas.sort((a, b) => b.y - a.y);
  return renglones;
}

function esSignoDe(fragmento: FragmentoPdf, monto: FragmentoPdf): boolean {
  return (
    fragmento.texto === "-" &&
    fragmento.x >= monto.x - 15 &&
    fragmento.x <= monto.x + 3
  );
}

function movimientoDeRenglon(
  renglon: RenglonEstadoCuenta,
  umbralUSD: number
): MovimientoEstadoCuenta | null {
  const coincidencia = RE_FECHA.exec(renglon.conFecha.texto);
  if (!coincidencia) return null;

  const fragmentos = renglon.filas.flatMap((f) => f.fragmentos);
  const montos = fragmentos.flatMap((fragmento) => {
    const valor = parsearMonto(fragmento.texto);
    return valor === null ? [] : [{ fragmento, valor }];
  });
  const candidatos = montos.some((m) => m.valor !== 0)
    ? montos.filter((m) => m.valor !== 0)
    : montos;
  if (!candidatos.length) return null;
  const elegido = candidatos.reduce((mejor, m) =>
    m.fragmento.x > mejor.fragmento.x ? m : mejor
  );

  const signo = fragmentos.find((f) => esSignoDe(f, elegido.fragmento));
  const monto = signo && elegido.valor > 0 ? -elegido.valor : elegido.valor;

  const descripcion = renglon.filas
    .map((fila) => {
      const texto = fila.fragmentos
        .filter((f) => f.x < elegido.fragmento.x && f.texto !== "-")
        .map((f) => f.texto)
        .join(" ");
      return fila === renglon.conFecha ? texto.replace(RE_FECHA, "") : texto;
    })
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ");

  if (!descripcion || esNoConsumo(descripcion)) return null;

  return {
    fecha: fechaISO(coincidencia[1], coincidencia[2], coincidencia[3]),
    descripcion,
    monto,
    moneda: elegido.fragmento.x >= umbralUSD ? "USD" : "UYU",
  };
}

export function parsearEstadoCuenta(filas: FilaPdf[]): MovimientoEstadoCuenta[] {
  const umbralUSD = detectarUmbralUSD(filas);
  return agruparRenglones(filasDelDetalle(filas)).flatMap(
    (renglon) => movimientoDeRenglon(renglon, umbralUSD) ?? []
  );
}

export type ImportesResumen = { pesos: number | null; usd: number | null };

export type CabeceraEstadoCuenta = {
  banco: string | null;
  cierre: string | null;
  vencimiento: string | null;
  pagoContado: ImportesResumen;
  pagoMinimo: ImportesResumen;
  /** Los últimos 4 dígitos de la primera tarjeta del detalle: identifican la cuenta. */
  tarjeta: string | null;
};

const RE_FECHA_SUELTA = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/;

function fechaSuelta(texto: string): string | null {
  const m = RE_FECHA_SUELTA.exec(texto.trim());
  if (!m) return null;
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Lee un importe del cuadro de totales, que mezcla convenciones en la misma
 * página (`17,905.25`, `0,00`, `.36`): el último separador seguido de 1 o 2
 * dígitos es el decimal, el resto son miles.
 * @returns null si el texto no es un importe
 */
export function parsearImporteResumen(texto: string): number | null {
  const m = /^(-?)([\d.,]*\d)$/.exec(texto.replace(/[\s$]/g, ""));
  if (!m) return null;
  const decimal = /[.,](\d{1,2})$/.exec(m[2]);
  const entero =
    (decimal ? m[2].slice(0, decimal.index) : m[2]).replace(/[.,]/g, "") || "0";
  const n = Number(`${m[1]}${entero}${decimal ? `.${decimal[1]}` : ""}`);
  return Number.isFinite(n) ? n : null;
}

function valorDeEtiqueta<T>(
  filas: FilaPdf[],
  etiqueta: RegExp,
  leer: (texto: string) => T | null
): T | null {
  for (const fila of filas) {
    const indice = fila.fragmentos.findIndex((f) => etiqueta.test(f.texto));
    if (indice === -1) continue;
    const rotulo = fila.fragmentos[indice];

    const resto = rotulo.texto.replace(etiqueta, "").trim();
    if (resto) return leer(resto);

    const siguiente = fila.fragmentos[indice + 1];
    const enLaFila = siguiente ? leer(siguiente.texto) : null;
    if (enLaFila !== null) return enLaFila;

    const vecinas = filas
      .filter(
        (f) =>
          f !== fila && f.pagina === fila.pagina && Math.abs(f.y - fila.y) <= 20
      )
      .sort((a, b) => Math.abs(a.y - fila.y) - Math.abs(b.y - fila.y));
    for (const vecina of vecinas) {
      const fragmento = vecina.fragmentos.find(
        (f) => Math.abs(f.x - rotulo.x) <= 15
      );
      const valor = fragmento ? leer(fragmento.texto) : null;
      if (valor !== null) return valor;
    }
  }
  return null;
}

function importesDeColumna(filas: FilaPdf[], etiqueta: RegExp): ImportesResumen {
  const importes: ImportesResumen = { pesos: null, usd: null };
  const indice = filas.findIndex((f) =>
    f.fragmentos.some((x) => etiqueta.test(x.texto))
  );
  if (indice === -1) return importes;
  const filaRotulo = filas[indice];
  const rotulo = filaRotulo.fragmentos.find((x) => etiqueta.test(x.texto))!;

  for (const fila of filas.slice(indice + 1, indice + 7)) {
    if (fila.pagina > filaRotulo.pagina + 1) break;
    const moneda = fila.fragmentos[0]?.texto.toUpperCase();
    const clave =
      moneda === "$" ? "pesos" : moneda === "USD" || moneda === "U$S" ? "usd" : null;
    if (!clave || importes[clave] !== null) continue;
    const celda = fila.fragmentos
      .slice(1)
      .filter((f) => Math.abs(f.x - rotulo.x) <= 40)
      .sort((a, b) => Math.abs(a.x - rotulo.x) - Math.abs(b.x - rotulo.x))[0];
    importes[clave] = celda ? parsearImporteResumen(celda.texto) : null;
    if (importes.pesos !== null && importes.usd !== null) break;
  }
  return importes;
}

/**
 * La tarjeta del estado de cuenta, por los últimos 4 dígitos de la primera
 * línea "TARJETA No": las adicionales vienen en el mismo estado de cuenta, así
 * que la primera alcanza para saber de qué cuenta es.
 */
function tarjetaDe(filas: FilaPdf[]): string | null {
  for (const fila of filas) {
    const m = /TARJETA\s+N[^\s:]*\s*:?\s*([\d*xX\s-]{4,})/i.exec(fila.texto);
    const digitos = m?.[1].replace(/\D/g, "");
    if (digitos && digitos.length >= 4) return digitos.slice(-4);
  }
  return null;
}

/**
 * Los datos del resumen que no son movimientos: banco, cierre, vencimiento y
 * lo que hay que pagar. Un formato que no los trae, o los trae con otro
 * rótulo, deja el campo en null.
 */
export function parsearCabeceraEstadoCuenta(
  filas: FilaPdf[]
): CabeceraEstadoCuenta {
  return {
    banco: valorDeEtiqueta(filas, /^banco:?/i, (t) =>
      t && !t.endsWith(":") ? t : null
    ),
    cierre: valorDeEtiqueta(filas, /^(fecha de )?cierre:?/i, fechaSuelta),
    vencimiento: valorDeEtiqueta(filas, /^vencimiento( actual)?:?/i, fechaSuelta),
    pagoContado: importesDeColumna(filas, /^pago contado/i),
    pagoMinimo: importesDeColumna(filas, /^pago m[ií]nimo/i),
    tarjeta: tarjetaDe(filas),
  };
}

/**
 * Separa las compras de los descuentos del resumen (importes negativos: la
 * reducción de IVA por pagar con tarjeta, bonificaciones del banco,
 * devoluciones). Un descuento no es un gasto a revisar ni a importar: sólo
 * se informa su suma junto al total.
 */
export function separarDescuentos(movimientos: MovimientoEstadoCuenta[]): {
  compras: MovimientoEstadoCuenta[];
  descuentos: MovimientoEstadoCuenta[];
} {
  return {
    compras: movimientos.filter((m) => m.monto > 0),
    descuentos: movimientos.filter((m) => m.monto < 0),
  };
}

export type LineaParaRegistro = {
  indice: number;
  fecha: string;
  descripcion: string;
  montoOriginal: number;
  moneda: "UYU" | "USD";
  montoPesos: number | null;
  gastoExistenteId: number | null;
  fechaCompra?: string | null;
};

export type MovimientoRegistrado = {
  fecha: string;
  descripcion: string;
  monto: number;
  moneda: "UYU" | "USD";
  montoPesos: number | null;
  tipo: "importado" | "ya_registrado" | "omitido" | "descuento";
  gastoId: number | null;
  cuotaNumero: number | null;
  cuotasTotal: number | null;
};

/**
 * Las filas del registro de un estado de cuenta: cada compra con el gasto que
 * le corresponde y cada descuento sin gasto. Una línea importada apunta al
 * gasto recién creado aunque también matcheara uno existente: si se importó
 * igual es porque el usuario decidió que eran compras distintas. Cada línea
 * guarda la fecha como la imprime el banco y, si es una cuota, cuál es: el
 * gasto de una cuota lleva la fecha de cierre, y es este registro el que dice
 * cuántas van y cuántas faltan.
 * @param creados gasto creado al importar, por índice de línea
 * @param descuentos los importes negativos, ya con su equivalente en pesos
 */
export function movimientosDelRegistro(
  lineas: LineaParaRegistro[],
  creados: Map<number, number>,
  descuentos: { movimiento: MovimientoEstadoCuenta; montoPesos: number | null }[]
): MovimientoRegistrado[] {
  const compras = lineas.map((l): MovimientoRegistrado => {
    const creado = creados.get(l.indice);
    const cuota = cuotaDe(l.descripcion);
    const base = {
      fecha: l.fechaCompra ?? l.fecha,
      descripcion: l.descripcion,
      monto: l.montoOriginal,
      moneda: l.moneda,
      montoPesos: l.montoPesos === null ? null : Number(l.montoPesos.toFixed(2)),
      cuotaNumero: cuota?.numero ?? null,
      cuotasTotal: cuota?.total ?? null,
    };
    if (creado !== undefined) return { ...base, tipo: "importado", gastoId: creado };
    if (l.gastoExistenteId !== null) {
      return { ...base, tipo: "ya_registrado", gastoId: l.gastoExistenteId };
    }
    return { ...base, tipo: "omitido", gastoId: null };
  });
  const negativos = descuentos.map(
    ({ movimiento, montoPesos }): MovimientoRegistrado => ({
      fecha: movimiento.fecha,
      descripcion: movimiento.descripcion,
      monto: movimiento.monto,
      moneda: movimiento.moneda,
      montoPesos,
      tipo: "descuento",
      gastoId: null,
      cuotaNumero: null,
      cuotasTotal: null,
    })
  );
  return [...compras, ...negativos].sort((a, b) => a.fecha.localeCompare(b.fecha));
}
