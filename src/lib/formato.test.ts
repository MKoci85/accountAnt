import { describe, expect, it } from "vitest";
import {
  aISO,
  formatearFechaCorta,
  formatearMonto,
  parsearMonto,
} from "@/lib/formato";

describe("parsearMonto", () => {
  it("interpreta la coma como separador decimal, no como miles", () => {
    expect(parsearMonto("1,240")).toBe(1.24);
    expect(parsearMonto("1.234,56")).toBe(1234.56);
    expect(parsearMonto("0,5")).toBe(0.5);
  });

  it("interpreta el punto como separador de miles solo cuando lo es", () => {
    expect(parsearMonto("1.240")).toBe(1240);
    expect(parsearMonto("1.234.567")).toBe(1234567);
    expect(parsearMonto("12.5")).toBe(12.5);
    expect(parsearMonto("12.50")).toBe(12.5);
  });

  it("descarta el signo de peso y los espacios, incluido el no separable", () => {
    expect(parsearMonto("$ 1.234,56")).toBe(1234.56);
    expect(parsearMonto("$1234")).toBe(1234);
    expect(parsearMonto("1\u00a0234")).toBe(1234);
  });

  it("devuelve null cuando no hay un número que leer", () => {
    expect(parsearMonto("")).toBeNull();
    expect(parsearMonto("   ")).toBeNull();
    expect(parsearMonto("$")).toBeNull();
    expect(parsearMonto("abc")).toBeNull();
  });
});

describe("formatearMonto", () => {
  it("absorbe el resto de coma flotante de cantidad × precio", () => {
    expect(parsearMonto(formatearMonto(225.01694000000001))).toBe(225.02);
  });

  it("es reversible con parsearMonto", () => {
    for (const monto of [0, 7.5, 1234.56, 1240, 1234567.89]) {
      expect(parsearMonto(formatearMonto(monto))).toBe(monto);
    }
  });

  it("fija los decimales cuando se los piden", () => {
    expect(formatearMonto(1234.5, { decimales: 2 })).toMatch(/50$/);
    expect(formatearMonto(1234, { decimales: 0 })).not.toContain(",");
  });
});

describe("fechas", () => {
  it("serializa en hora local, sin correrse de día por UTC", () => {
    expect(aISO(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(aISO(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });

  it("formatea la fecha corta desde el ISO sin construir un Date", () => {
    expect(formatearFechaCorta("2026-09-03")).toBe("03 sep");
    expect(formatearFechaCorta("2026-01-01")).toBe("01 ene");
    expect(formatearFechaCorta("2026-12-25")).toBe("25 dic");
  });
});
