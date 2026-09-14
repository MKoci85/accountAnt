import { describe, expect, it } from "vitest";
import {
  detectarUmbralUSD,
  parsearEstadoCuenta,
  parsearMonto,
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
