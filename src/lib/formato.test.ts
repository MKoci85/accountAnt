import { describe, expect, it } from "vitest";
import {
  aISO,
  esFechaISOValida,
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
});

describe("fechas", () => {
  it("serializa en hora local, sin correrse de día por UTC", () => {
    expect(aISO(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(aISO(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });
});

describe("esFechaISOValida", () => {
  it("acepta una fecha que existe", () => {
    expect(esFechaISOValida("2026-10-11")).toBe(true);
    expect(esFechaISOValida("2024-02-29")).toBe(true);
  });

  it("rechaza una fecha bien formada que no está en el calendario", () => {
    expect(esFechaISOValida("2026-02-31")).toBe(false);
    expect(esFechaISOValida("2026-13-01")).toBe(false);
    expect(esFechaISOValida("2026-00-10")).toBe(false);
    expect(esFechaISOValida("2026-04-31")).toBe(false);
    expect(esFechaISOValida("2026-02-29")).toBe(false);
  });
});
