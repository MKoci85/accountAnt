import { describe, expect, it } from "vitest";
import {
  detectarUmbralUSD,
  parsearCabeceraEstadoCuenta,
  parsearImporteResumen,
  movimientosDelRegistro,
  cuotaCompatible,
  cuotaDe,
  cuotasRestantes,
  fecharCuotas,
  sinCuota,
  parsearEstadoCuenta,
  parsearMonto,
  separarDescuentos,
} from "@/lib/estado-cuenta";
import type { FilaPdf, FragmentoPdf } from "@/lib/pdf";

let y = 800;

function fila(fragmentos: [string, number][]): FilaPdf {
  y -= 12;
  const frags: FragmentoPdf[] = fragmentos.map(([texto, x]) => ({
    texto,
    x,
    y,
    pagina: 1,
  }));
  return {
    pagina: 1,
    y,
    fragmentos: frags,
    texto: frags.map((f) => f.texto).join(" "),
  };
}

describe("detectarUmbralUSD", () => {
  it("parte al medio entre el encabezado de pesos y el de dólares", () => {
    expect(detectarUmbralUSD([fila([["$", 400], ["USD", 500]])])).toBe(450);
  });

  it("retrocede un margen fijo cuando solo aparece el encabezado de dólares", () => {
    expect(detectarUmbralUSD([fila([["FECHA", 50], ["USD", 500]])])).toBe(470);
  });

  it("acepta las variantes de escritura del encabezado", () => {
    expect(detectarUmbralUSD([fila([["$U", 300], ["U$S", 460]])])).toBe(380);
    expect(detectarUmbralUSD([fila([["PESOS", 300], ["DOLARES", 460]])])).toBe(380);
  });

  it("ignora un encabezado de pesos que esté a la derecha del de dólares", () => {
    expect(detectarUmbralUSD([fila([["USD", 400], ["$", 500]])])).toBe(370);
  });

  it("cae en el umbral por defecto si el PDF no trae encabezado", () => {
    expect(detectarUmbralUSD([fila([["COMPRA", 100], ["1,000.00", 400]])])).toBe(500);
  });
});

describe("parsearMonto", () => {
  it("lee el formato del estado de cuenta: miles con coma y dos decimales", () => {
    expect(parsearMonto("1,234.56")).toBe(1234.56);
    expect(parsearMonto("0.00")).toBe(0);
    expect(parsearMonto("-50.00")).toBe(-50);
    expect(parsearMonto("1,000,000.00")).toBe(1000000);
  });

  it("acepta el signo separado del número, como lo imprime el resumen", () => {
    expect(parsearMonto("- 181.50")).toBe(-181.5);
    expect(parsearMonto("- 11,726.44")).toBe(-11726.44);
  });

  it("exige los dos decimales para no confundir un número suelto con un importe", () => {
    expect(parsearMonto("1234")).toBeNull();
    expect(parsearMonto("12.5")).toBeNull();
    expect(parsearMonto("03/09/26")).toBeNull();
    expect(parsearMonto("ANCAP")).toBeNull();
  });
});

describe("parsearEstadoCuenta", () => {
  it("arma el movimiento a partir de la fecha, la descripción y el importe", () => {
    const [movimiento] = parsearEstadoCuenta([
      fila([["03/09/26", 50], ["SUPERMERCADOS ESTEFAN", 100], ["1,234.56", 400]]),
    ]);
    expect(movimiento).toEqual({
      fecha: "2026-09-03",
      descripcion: "SUPERMERCADOS ESTEFAN",
      monto: 1234.56,
      moneda: "UYU",
    });
  });

  it("separa las monedas por la columna en la que cae el importe", () => {
    const movimientos = parsearEstadoCuenta([
      fila([["$", 300], ["USD", 500]]),
      fila([["03/09/26", 50], ["COMPRA LOCAL", 100], ["1,000.00", 320]]),
      fila([["04/09/26", 50], ["ANTHROPIC", 100], ["20.00", 520]]),
    ]);
    expect(movimientos.map((m) => m.moneda)).toEqual(["UYU", "USD"]);
  });

  it("descarta las líneas que no son consumo", () => {
    const movimientos = parsearEstadoCuenta([
      fila([["03/09/26", 50], ["SALDO ANTERIOR", 100], ["5,000.00", 400]]),
      fila([["03/09/26", 50], ["SU PAGO GRACIAS", 100], ["5,000.00", 400]]),
      fila([["03/09/26", 50], ["TOTAL TARJETA", 100], ["5,000.00", 400]]),
      fila([["03/09/26", 50], ["COMPRA REAL", 100], ["100.00", 400]]),
    ]);
    expect(movimientos.map((m) => m.descripcion)).toEqual(["COMPRA REAL"]);
  });

  it("descarta el pago del saldo anterior en sus distintas redacciones", () => {
    const movimientos = parsearEstadoCuenta([
      fila([["24/08/26", 50], ["PAGOS", 100], ["- 11,726.44", 400]]),
      fila([["24/08/26", 50], ["PAGO RECIBIDO", 100], ["- 5,000.00", 400]]),
      fila([["24/08/26", 50], ["PAGO MINIMO", 100], ["- 5,000.00", 400]]),
      fila([["24/08/26", 50], ["CANCELACION", 100], ["- 5,000.00", 400]]),
    ]);
    expect(movimientos).toEqual([]);
  });

  it("conserva los cargos del banco, que son gastos reales", () => {
    const movimientos = parsearEstadoCuenta([
      fila([["10/09/26", 50], ["SEGURO SALDO DEUDOR", 100], ["81.78", 400]]),
      fila([["10/09/26", 50], ["INTERESES", 100], ["250.00", 400]]),
    ]);
    expect(movimientos.map((m) => m.descripcion)).toEqual([
      "SEGURO SALDO DEUDOR",
      "INTERESES",
    ]);
  });

  it("conserva los importes negativos, que son descuentos del resumen", () => {
    const [movimiento] = parsearEstadoCuenta([
      fila([["14/08/26", 50], ["DTO.BROU- ANCAP", 100], ["- 181.50", 400]]),
    ]);
    expect(movimiento.monto).toBe(-181.5);
  });

  it("ignora las filas sin fecha, sin importe o sin descripción", () => {
    expect(
      parsearEstadoCuenta([
        fila([["DETALLE DE MOVIMIENTOS", 100]]),
        fila([["03/09/26", 50], ["SIN IMPORTE", 100]]),
        fila([["03/09/26", 50], ["100.00", 60]]),
      ])
    ).toEqual([]);
  });

  it("toma el importe de más a la derecha cuando la fila trae varias columnas numéricas", () => {
    const [movimiento] = parsearEstadoCuenta([
      fila([
        ["03/09/26", 50],
        ["CUOTA 1/6", 100],
        ["6,000.00", 300],
        ["1,000.00", 400],
      ]),
    ]);
    expect(movimiento.monto).toBe(1000);
    expect(movimiento.descripcion).toBe("CUOTA 1/6 6,000.00");
  });

  it("expande el año de dos dígitos al siglo actual", () => {
    const [movimiento] = parsearEstadoCuenta([
      fila([["31/12/25", 50], ["COMPRA", 100], ["10.00", 400]]),
    ]);
    expect(movimiento.fecha).toBe("2025-12-31");
  });
});

function filaEn(
  yFila: number,
  fragmentos: [string, number][],
  pagina = 1
): FilaPdf {
  const frags: FragmentoPdf[] = fragmentos.map(([texto, x]) => ({
    texto,
    x,
    y: yFila,
    pagina,
  }));
  return {
    pagina,
    y: yFila,
    fragmentos: frags,
    texto: frags.map((f) => f.texto).join(" "),
  };
}

describe("parsearEstadoCuenta con celdas partidas en varias líneas", () => {
  const encabezado = filaEn(600, [
    ["Fecha", 40],
    ["Descripción", 190],
    ["$", 460],
    ["USD", 530],
  ]);

  it("une la descripción partida arriba y abajo de la línea con fecha e importe", () => {
    const movimientos = parsearEstadoCuenta([
      encabezado,
      filaEn(570, [["21/09/26", 40], ["COMPRA UNO", 190], ["3,401.00", 460]]),
      filaEn(549, [["TIENDA WEB", 190]]),
      filaEn(542, [["22/08/26", 40], ["6,603.77", 460]]),
      filaEn(535, [["CUOTA 02/04", 190]]),
      filaEn(514, [["25/09/26", 40], ["COMPRA DOS", 190], ["188.00", 460]]),
    ]);
    expect(movimientos.map((m) => [m.descripcion, m.monto])).toEqual([
      ["COMPRA UNO", 3401],
      ["TIENDA WEB CUOTA 02/04", 6603.77],
      ["COMPRA DOS", 188],
    ]);
  });

  it("no le pega a un movimiento una fila que está a una separación entera", () => {
    const movimientos = parsearEstadoCuenta([
      encabezado,
      filaEn(570, [["10/10/26", 40], ["SEGURO", 190], ["79.89", 460]]),
      filaEn(542, [["TARJETA No: 524663******7041", 190]]),
      filaEn(514, [["15/09/26", 40], ["COMPRA", 190], ["2,059.00", 460]]),
    ]);
    expect(movimientos.map((m) => m.descripcion)).toEqual(["SEGURO", "COMPRA"]);
  });

  it("recupera el signo que quedó en otra línea que el número", () => {
    const [movimiento] = parsearEstadoCuenta([
      encabezado,
      filaEn(570, [["21/09/26", 40], ["COMPRA", 190], ["100.00", 460]]),
      filaEn(549, [["-", 460]]),
      filaEn(542, [["22/09/26", 40], ["DTO.BANCO", 190]]),
      filaEn(535, [["170.05", 460]]),
      filaEn(514, [["25/09/26", 40], ["COMPRA", 190], ["188.00", 460]]),
    ]).filter((m) => m.descripcion === "DTO.BANCO");
    expect(movimiento.monto).toBe(-170.05);
  });

  it("un pago con el signo partido sigue descartado y no pasa por descuento", () => {
    const movimientos = parsearEstadoCuenta([
      encabezado,
      filaEn(570, [["21/09/26", 40], ["COMPRA", 190], ["100.00", 460]]),
      filaEn(549, [["-", 460], ["-", 530]]),
      filaEn(542, [["24/09/26", 40], ["PAGOS", 190]]),
      filaEn(535, [["11,696.71", 460], ["31.98", 530]]),
      filaEn(514, [["25/09/26", 40], ["COMPRA", 190], ["188.00", 460]]),
    ]);
    expect(movimientos.map((m) => m.descripcion)).toEqual(["COMPRA", "COMPRA"]);
  });

  it("ignora lo que está arriba del encabezado de la tabla", () => {
    const movimientos = parsearEstadoCuenta([
      filaEn(700, [["26/10/26, 15:55", 20], ["Sistarbanc", 330]]),
      filaEn(660, [["10/10/26", 40]]),
      filaEn(652, [["88,000.00", 40]]),
      encabezado,
      filaEn(570, [["05/10/26", 40], ["COMPRA", 190], ["1,292.51", 460]]),
    ]);
    expect(movimientos.map((m) => m.descripcion)).toEqual(["COMPRA"]);
  });

  it("no toma la fecha y hora del encabezado de impresión por un movimiento", () => {
    const movimientos = parsearEstadoCuenta([
      encabezado,
      filaEn(570, [["05/10/26", 40], ["COMPRA", 190], ["1,292.51", 460]]),
      filaEn(770, [["26/10/26, 15:55", 20], ["Sistarbanc", 330], ["1,000.00", 460]], 2),
      filaEn(700, [["06/10/26", 40], ["OTRA", 190], ["50.00", 460]], 2),
    ]);
    expect(movimientos.map((m) => m.descripcion)).toEqual(["COMPRA", "OTRA"]);
  });

  it("prefiere el importe distinto de cero cuando la otra columna trae 0.00", () => {
    const [movimiento] = parsearEstadoCuenta([
      encabezado,
      filaEn(570, [["10/10/26", 40], ["SEGURO", 190], ["79.89", 460], ["0.00", 530]]),
    ]);
    expect(movimiento).toMatchObject({ monto: 79.89, moneda: "UYU" });
  });
});

describe("parsearImporteResumen", () => {
  it("entiende las convenciones mezcladas del cuadro de totales", () => {
    expect(parsearImporteResumen("17,905.25")).toBe(17905.25);
    expect(parsearImporteResumen("0,00")).toBe(0);
    expect(parsearImporteResumen("$ 66.643,38")).toBe(66643.38);
    expect(parsearImporteResumen(".36")).toBe(0.36);
    expect(parsearImporteResumen("-170.05")).toBe(-170.05);
  });

  it("no lee un texto que no es importe", () => {
    expect(parsearImporteResumen("Pago contado")).toBeNull();
    expect(parsearImporteResumen("")).toBeNull();
  });
});

describe("parsearCabeceraEstadoCuenta", () => {
  it("lee banco, cierre, vencimiento y lo que hay que pagar", () => {
    const cabecera = parsearCabeceraEstadoCuenta([
      filaEn(700, [["Cuenta: 1", 40], ["Banco:", 400], ["BANCO TARJETA", 440]]),
      filaEn(670, [["Fecha de cierre:", 40], ["10/10/26", 120], ["Vencimiento actual:", 190], ["26/10/26", 300]]),
      filaEn(300, [["Atrasos", 80], ["Pago contado", 370], ["Pago mínimo (*)", 470]]),
      filaEn(280, [["$", 40], ["0,00", 80], ["17,905.25", 370], ["1,800.00", 470]]),
      filaEn(260, [["USD", 40], ["0,00", 80], ["22.99", 370], ["22.99", 470]]),
    ]);
    expect(cabecera).toEqual({
      banco: "BANCO TARJETA",
      cierre: "2026-10-10",
      vencimiento: "2026-10-26",
      pagoContado: { pesos: 17905.25, usd: 22.99 },
      pagoMinimo: { pesos: 1800, usd: 22.99 },
      tarjeta: null,
    });
  });

  it("toma la tarjeta de la primera línea TARJETA No, por sus últimos 4 dígitos", () => {
    const cabecera = parsearCabeceraEstadoCuenta([
      filaEn(600, [["TARJETA No: 524663******7041", 190]]),
      filaEn(500, [["TARJETA No: 524663******9999", 190]]),
    ]);
    expect(cabecera.tarjeta).toBe("7041");
  });

  it("encuentra el valor que el PDF partió en la línea de abajo del rótulo", () => {
    const cabecera = parsearCabeceraEstadoCuenta([
      filaEn(653, [["Fecha de cierre:", 40]]),
      filaEn(646, [["Vencimiento actual:", 190], ["26/10/26", 300]]),
      filaEn(639, [["10/10/26", 40]]),
    ]);
    expect(cabecera.cierre).toBe("2026-10-10");
  });

  it("sigue a la página siguiente cuando el salto separa rótulos y valores", () => {
    const cabecera = parsearCabeceraEstadoCuenta([
      filaEn(57, [["Pago contado", 370]], 1),
      filaEn(749, [["$", 40], ["17,905.25", 370]], 2),
      filaEn(725, [["USD", 40], ["22.99", 370]], 2),
    ]);
    expect(cabecera.pagoContado).toEqual({ pesos: 17905.25, usd: 22.99 });
  });

  it("deja en null lo que el formato no trae", () => {
    expect(parsearCabeceraEstadoCuenta([filaEn(700, [["COMPRA", 100]])])).toEqual({
      banco: null,
      cierre: null,
      vencimiento: null,
      pagoContado: { pesos: null, usd: null },
      pagoMinimo: { pesos: null, usd: null },
      tarjeta: null,
    });
  });
});

describe("separarDescuentos", () => {
  const mov = (descripcion: string, monto: number) => ({
    fecha: "2026-08-14",
    descripcion,
    monto,
    moneda: "UYU" as const,
  });

  it("los importes negativos son descuentos y no quedan entre las compras", () => {
    const compra = mov("ANCAP 3140", 2000);
    const descuento = mov("DTO.BROU- ANCAP", -181.5);
    expect(separarDescuentos([compra, descuento])).toEqual({
      compras: [compra],
      descuentos: [descuento],
    });
  });

  it("un movimiento en cero no es ninguna de las dos cosas", () => {
    expect(separarDescuentos([mov("AJUSTE", 0)])).toEqual({
      compras: [],
      descuentos: [],
    });
  });
});

describe("movimientosDelRegistro", () => {
  const linea = (indice: number, gastoExistenteId: number | null) => ({
    indice,
    fecha: `2026-09-1${indice}`,
    descripcion: `COMPRA ${indice}`,
    montoOriginal: 100,
    moneda: "UYU" as const,
    montoPesos: 100,
    gastoExistenteId,
  });

  it("vincula cada línea con el gasto creado, el que ya estaba o ninguno", () => {
    const filas = movimientosDelRegistro(
      [linea(1, null), linea(2, 50), linea(3, null)],
      new Map([[1, 900]]),
      []
    );
    expect(filas.map((f) => [f.tipo, f.gastoId])).toEqual([
      ["importado", 900],
      ["ya_registrado", 50],
      ["omitido", null],
    ]);
  });

  it("redondea a centavos el equivalente en pesos de una compra en dólares", () => {
    const [fila] = movimientosDelRegistro(
      [{ ...linea(1, null), moneda: "USD", montoOriginal: 2.99, montoPesos: 119.87508 }],
      new Map(),
      []
    );
    expect(fila.montoPesos).toBe(119.88);
  });

  it("una línea importada a pesar de matchear apunta al gasto nuevo", () => {
    const [fila] = movimientosDelRegistro([linea(1, 50)], new Map([[1, 900]]), []);
    expect(fila).toMatchObject({ tipo: "importado", gastoId: 900 });
  });

  it("suma los descuentos sin gasto y ordena todo por fecha", () => {
    const filas = movimientosDelRegistro(
      [linea(2, null)],
      new Map(),
      [
        {
          movimiento: {
            fecha: "2026-09-10",
            descripcion: "DTO",
            monto: -170.05,
            moneda: "UYU",
          },
          montoPesos: -170.05,
        },
      ]
    );
    expect(filas.map((f) => [f.descripcion, f.tipo, f.gastoId])).toEqual([
      ["DTO", "descuento", null],
      ["COMPRA 2", "omitido", null],
    ]);
  });
});

describe("cuotas", () => {
  const cuota = (descripcion: string, fecha = "2026-08-22") => ({
    fecha,
    descripcion,
    monto: 6603.77,
    moneda: "UYU" as const,
  });

  it("reconoce la marca de cuota y la saca del nombre del comercio", () => {
    expect(cuotaDe("TIENDA WEB CUOTA 02/04")).toEqual({ numero: 2, total: 4 });
    expect(cuotaDe("TIENDA CUOTAS 3/12")).toEqual({ numero: 3, total: 12 });
    expect(cuotaDe("TIENDA WEB")).toBeNull();
    expect(sinCuota("TIENDA ( WEB) CUOTA 02/04")).toBe("TIENDA ( WEB)");
  });

  it("no toma por cuota una fecha suelta en la descripción", () => {
    expect(cuotaDe("PAGO 22/08")).toBeNull();
  });

  it("pasa cada cuota al cierre y guarda la fecha de compra impresa", () => {
    const [enCuotas, contado] = fecharCuotas(
      [cuota("TIENDA CUOTA 02/04"), cuota("SUPERMERCADO", "2026-10-02")],
      "2026-10-10"
    );
    expect(enCuotas).toMatchObject({ fecha: "2026-10-10", fechaCompra: "2026-08-22" });
    expect(contado).toEqual(cuota("SUPERMERCADO", "2026-10-02"));
  });

  it("sin fecha de cierre deja las cuotas como vienen", () => {
    const movimientos = [cuota("TIENDA CUOTA 02/04")];
    expect(fecharCuotas(movimientos, null)).toEqual(movimientos);
  });

  it("una cuota sólo se cruza con un gasto de la misma cuota", () => {
    expect(cuotaCompatible("TIENDA CUOTA 02/04", ["TIENDA CUOTA 01/04", ""])).toBe(false);
    expect(cuotaCompatible("TIENDA CUOTA 02/04", ["TIENDA", "ARTICULO CUOTA 02/04"])).toBe(true);
  });

  it("un gasto sin marca de cuota, o una línea sin cuota, no se descartan", () => {
    expect(cuotaCompatible("TIENDA CUOTA 02/04", ["TIENDA", "ARTICULO"])).toBe(true);
    expect(cuotaCompatible("SUPERMERCADO", ["TIENDA CUOTA 01/04"])).toBe(true);
  });

  it("cuenta las cuotas que faltan después de esta y cuánto suman", () => {
    expect(cuotasRestantes({ numero: 2, total: 4 }, 6603.77)).toEqual({
      cantidad: 2,
      pesos: 13207.54,
    });
    expect(cuotasRestantes({ numero: 4, total: 4 }, 6603.77)).toEqual({
      cantidad: 0,
      pesos: 0,
    });
    expect(cuotasRestantes({ numero: 1, total: 3 }, null)).toEqual({
      cantidad: 2,
      pesos: null,
    });
  });

  it("el registro guarda qué cuota es y la fecha como la imprime el banco", () => {
    const [fila] = movimientosDelRegistro(
      [
        {
          indice: 0,
          fecha: "2026-10-10",
          fechaCompra: "2026-08-22",
          descripcion: "TIENDA CUOTA 02/04",
          montoOriginal: 6603.77,
          moneda: "UYU",
          montoPesos: 6603.77,
          gastoExistenteId: 58,
        },
      ],
      new Map(),
      []
    );
    expect(fila).toMatchObject({
      fecha: "2026-08-22",
      gastoId: 58,
      cuotaNumero: 2,
      cuotasTotal: 4,
    });
  });
});
