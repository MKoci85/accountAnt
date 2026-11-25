import { describe, expect, it } from "vitest";
import {
  agruparGastosCombinables,
  agruparItemsSimilares,
  claveItemExacta,
  paresHeredados,
  type GastoComparable,
  type ItemComparable,
} from "@/lib/duplicados";

function item(
  id: number,
  nombre: string,
  marca: string | null = null,
  tamano: string | null = null
): ItemComparable {
  return { id, nombre, marca, tamano };
}

describe("claveItemExacta", () => {
  it("iguala lo que sólo difiere en mayúsculas, tildes, espacios o forma de escribir el tamaño", () => {
    expect(claveItemExacta({ nombre: "Limón ", marca: null, tamano: "1.5L" })).toBe(
      claveItemExacta({ nombre: "LIMON", marca: "", tamano: "1500 ml" })
    );
    expect(claveItemExacta({ nombre: "ZANAHORIA", marca: null, tamano: null })).toBe(
      claveItemExacta({ nombre: "zanahoria", marca: null, tamano: "" })
    );
  });

  it("distingue marca, tamaño o nombre distintos", () => {
    const base = claveItemExacta({ nombre: "LECHE", marca: "CONAPROLE", tamano: "1L" });
    expect(claveItemExacta({ nombre: "LECHE", marca: null, tamano: "1L" })).not.toBe(base);
    expect(claveItemExacta({ nombre: "LECHE", marca: "CONAPROLE", tamano: "2L" })).not.toBe(base);
    expect(claveItemExacta({ nombre: "LECHE ENTERA", marca: "CONAPROLE", tamano: "1L" })).not.toBe(base);
  });
});

describe("agruparItemsSimilares", () => {
  const items = [
    item(1, "HUEVOS", null, "12 un"),
    item(2, "HUEVOS COLORADOS"),
    item(3, "HUEVO", null, "x12"),
    item(4, "LECHE ENTERA"),
    item(5, "LECHE DESCREMADA"),
  ];

  it("agrupa transitivamente y deja afuera lo que no se parece", () => {
    expect(agruparItemsSimilares(items, new Set())).toEqual([[1, 3]]);
  });
});

function gasto(
  id: number,
  emisorId: number,
  fecha: string,
  sinComprobante = true,
  emisorGenerico = false
): GastoComparable {
  return { id, emisorId, fecha, sinComprobante, emisorGenerico };
}

describe("agruparGastosCombinables", () => {
  it("agrupa mismo comercio y misma fecha", () => {
    expect(
      agruparGastosCombinables(
        [gasto(1, 10, "2026-09-01"), gasto(2, 10, "2026-09-01"), gasto(3, 10, "2026-09-02")],
        new Set()
      )
    ).toEqual([[1, 2]]);
  });

  it("no ofrece juntar dos gastos que ya tienen comprobante propio", () => {
    expect(
      agruparGastosCombinables(
        [gasto(1, 10, "2026-09-01", false), gasto(2, 10, "2026-09-01", false)],
        new Set()
      )
    ).toEqual([]);
  });

  it("no ofrece juntar una compra en cuotas ni la cuota de una", () => {
    expect(
      agruparGastosCombinables(
        [gasto(1, 10, "2026-09-01"), { ...gasto(2, 10, "2026-09-01"), enCuotas: true }],
        new Set()
      )
    ).toEqual([]);
  });
});

describe("paresHeredados", () => {
  it("pierde los pares entre los que se combinan y no repite", () => {
    expect(
      paresHeredados(
        [
          [3, 5],
          [5, 9],
          [5, 7],
          [7, 9],
        ],
        [5, 9],
        3
      )
    ).toEqual([[3, 7]]);
  });
});
