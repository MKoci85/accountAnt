import { describe, expect, it } from "vitest";
import {
  MARGEN_OFERTA_DEFAULT,
  pareceOferta,
  claveReferencia,
  fechaLimiteVentanaPrecio,
  normalizarUnidad,
  parsearTamano,
  superaReferencia,
  MARGEN_SOBREPRECIO_POR_PESO_DEFAULT,
} from "@/lib/precios-referencia";

describe("parsearTamano", () => {
  it("normaliza gramos y mililitros a la unidad base", () => {
    expect(parsearTamano("500 gr")).toEqual({ cantidad: 0.5, unidad: "kg" });
    expect(parsearTamano("330ml")).toEqual({ cantidad: 0.33, unidad: "L" });
    expect(parsearTamano("250 cc")).toEqual({ cantidad: 0.25, unidad: "L" });
  });

  it("acepta coma decimal, mayúsculas y espacios sobrantes", () => {
    expect(parsearTamano("1,5 LT")).toEqual({ cantidad: 1.5, unidad: "L" });
    expect(parsearTamano("  0.400   kg ")).toEqual({ cantidad: 0.4, unidad: "kg" });
    expect(parsearTamano(".5kg")).toEqual({ cantidad: 0.5, unidad: "kg" });
  });

  it("trata un número sin sufijo como unidades", () => {
    expect(parsearTamano("6")).toEqual({ cantidad: 6, unidad: "un" });
    expect(parsearTamano("6 un")).toEqual({ cantidad: 6, unidad: "un" });
  });

  it("devuelve null cuando no hay nada que interpretar", () => {
    expect(parsearTamano(null)).toBeNull();
    expect(parsearTamano("")).toBeNull();
    expect(parsearTamano("   ")).toBeNull();
    expect(parsearTamano("grande")).toBeNull();
    expect(parsearTamano("12 pack")).toBeNull();
  });

  it("rechaza cantidades no positivas", () => {
    expect(parsearTamano("0 kg")).toBeNull();
  });
});

describe("normalizarUnidad", () => {
  it("mapea las variantes conocidas a la unidad canónica", () => {
    expect(normalizarUnidad("kg")).toBe("kg");
    expect(normalizarUnidad("KG")).toBe("kg");
    expect(normalizarUnidad(" l ")).toBe("L");
    expect(normalizarUnidad("L")).toBe("L");
  });

  it("cae en unidades ante un valor ausente o desconocido", () => {
    expect(normalizarUnidad(null)).toBe("un");
    expect(normalizarUnidad(undefined)).toBe("un");
    expect(normalizarUnidad("")).toBe("un");
    expect(normalizarUnidad("docena")).toBe("un");
  });
});

describe("superaReferencia", () => {
  const margen = MARGEN_SOBREPRECIO_POR_PESO_DEFAULT;

  it("no tolera margen alguno cuando el precio es por unidad", () => {
    expect(superaReferencia(101, 100, "un", margen)).toBe(true);
    expect(superaReferencia(100, 100, "un", margen)).toBe(false);
  });

  it("aplica el margen del 3% en las líneas por peso o volumen", () => {
    expect(superaReferencia(102, 100, "kg", margen)).toBe(false);
    expect(superaReferencia(103, 100, "kg", margen)).toBe(false);
    expect(superaReferencia(103.5, 100, "kg", margen)).toBe(true);
    expect(superaReferencia(104, 100, "L", margen)).toBe(true);
  });
});

describe("pareceOferta", () => {
  const margen = MARGEN_OFERTA_DEFAULT;

  it("sugiere la oferta sólo cuando el precio está bastante por debajo", () => {
    expect(pareceOferta(84, 100, margen)).toBe(true);
    expect(pareceOferta(85, 100, margen)).toBe(false);
    expect(pareceOferta(99, 100, margen)).toBe(false);
    expect(pareceOferta(120, 100, margen)).toBe(false);
  });

  it("ignora la línea sin precio cargado", () => {
    expect(pareceOferta(0, 100, margen)).toBe(false);
  });
});

describe("claveReferencia", () => {
  it("separa el mismo ítem comprado en unidades distintas", () => {
    expect(claveReferencia(7, "kg")).toBe("7|kg");
    expect(claveReferencia(7, "un")).not.toBe(claveReferencia(7, "kg"));
  });
});

describe("fechaLimiteVentanaPrecio", () => {
  it("retrocede la cantidad de meses pedida", () => {
    expect(fechaLimiteVentanaPrecio("2026-09-03", 4)).toBe("2026-05-03");
    expect(fechaLimiteVentanaPrecio("2026-02-10", 3)).toBe("2025-11-10");
  });
});
