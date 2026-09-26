import { describe, expect, it } from "vitest";
import {
  agruparGastosCombinables,
  agruparItemsSimilares,
  claveItemExacta,
  clavePar,
  clavePresentacion,
  describirPresentacion,
  nombresParecidos,
  paresDe,
  parsearPresentacion,
  separarPresentacion,
  sonItemsSimilares,
  type GastoComparable,
  type ItemComparable,
} from "@/lib/duplicados";

function clave(texto: string) {
  const p = parsearPresentacion(texto);
  return p ? clavePresentacion(p) : null;
}

describe("parsearPresentacion", () => {
  it("interpreta peso o volumen de una sola pieza", () => {
    expect(parsearPresentacion("1,5 LT")).toEqual({
      unidades: 1,
      contenido: { cantidad: 1.5, unidad: "L" },
    });
    expect(clave("500 GRS.")).toBe("1x0.5kg");
  });

  it("trata igual las distintas formas de escribir cantidad de piezas", () => {
    for (const texto of ["x12", "X 12", "12 un", "12 UNIDADES", "12", "pack 12", "12 pack", "docena"]) {
      expect(clave(texto)).toBe("12");
    }
    expect(clave("media docena")).toBe("6");
  });

  it("combina piezas y contenido en un multipack", () => {
    expect(clave("6 x 330ml")).toBe("6x0.33L");
    expect(clave("6x330ml")).toBe("6x0.33L");
    expect(clave("330 ml x 6")).toBe("6x0.33L");
    expect(clave("pack x 6 de 1.5L")).toBe("6x1.5L");
  });

  it("devuelve null para un tamaño sin nada reconocible", () => {
    expect(parsearPresentacion("grande")).toBeNull();
    expect(parsearPresentacion(null)).toBeNull();
    expect(parsearPresentacion("")).toBeNull();
  });
});

describe("separarPresentacion", () => {
  it("saca el tamaño del nombre y deja el resto", () => {
    const { presentacion, resto } = separarPresentacion("COCA COLA 1,5 LT RET");
    expect(presentacion && clavePresentacion(presentacion)).toBe("1x1.5L");
    expect(resto).toBe("coca cola ret");
  });

  it("no toma un número suelto de un nombre como cantidad de piezas", () => {
    expect(separarPresentacion("7 UP").presentacion).toBeNull();
    expect(separarPresentacion("LECHE 3").presentacion).toBeNull();
  });

  it("reconoce las piezas pegadas a la x dentro de un nombre", () => {
    const { presentacion, resto } = separarPresentacion("PAPEL HIGIENICO X4");
    expect(presentacion && clavePresentacion(presentacion)).toBe("4");
    expect(resto).toBe("papel higienico");
  });
});

describe("describirPresentacion", () => {
  it("describe piezas y contenido en texto legible", () => {
    expect(describirPresentacion(parsearPresentacion("6x330ml")!)).toBe(
      "6 unidades de 330 ml"
    );
    expect(describirPresentacion(parsearPresentacion("x12")!)).toBe("12 unidades");
    expect(describirPresentacion(parsearPresentacion("1,5 LT")!)).toBe("1,5 L");
  });
});

describe("nombresParecidos", () => {
  it("acepta errores de tipeo, abreviaturas y palabras pegadas", () => {
    expect(nombresParecidos(["galletas", "maria"], ["galletitas", "maria"])).toBe(true);
    expect(nombresParecidos(["leche", "desc"], ["leche", "descremada"])).toBe(true);
    expect(nombresParecidos(["cocacola"], ["coca", "cola"])).toBe(true);
  });

  it("rechaza variantes distintas del mismo producto", () => {
    expect(nombresParecidos(["leche", "entera"], ["leche", "descremada"])).toBe(false);
    expect(nombresParecidos(["yogur", "frutilla"], ["yogur", "durazno"])).toBe(false);
    expect(nombresParecidos(["arroz"], ["arroz", "integral"])).toBe(false);
  });

  it("separa por una palabra de variante presente en uno solo", () => {
    expect(
      nombresParecidos(["galletitas", "agua"], ["galletitas", "agua", "sin", "sal"])
    ).toBe(false);
    expect(nombresParecidos(["coca", "cola"], ["coca", "cola", "zero"])).toBe(false);
    expect(
      nombresParecidos(["galletitas", "agua"], ["galletitas", "agua", "triguena"])
    ).toBe(true);
  });
});

function item(
  id: number,
  nombre: string,
  marca: string | null = null,
  tamano: string | null = null
): ItemComparable {
  return { id, nombre, marca, tamano };
}

describe("sonItemsSimilares", () => {
  it("junta el mismo producto con el tamaño en el nombre o en su campo", () => {
    expect(
      sonItemsSimilares(item(1, "COCA COLA 1,5 LT RET"), item(2, "COCA COLA RET", null, "1.5L"))
    ).toBe(true);
  });

  it("usa la marca aunque esté en el nombre de uno y en el campo del otro", () => {
    expect(
      sonItemsSimilares(item(1, "LECHE ENTERA CONAPROLE"), item(2, "LECHE ENTERA", "CONAPROLE"))
    ).toBe(true);
  });

  it("no junta presentaciones distintas", () => {
    expect(
      sonItemsSimilares(item(1, "COCA COLA", null, "1.5L"), item(2, "COCA COLA", null, "2L"))
    ).toBe(false);
    expect(
      sonItemsSimilares(item(1, "CERVEZA", "PILSEN", "1L"), item(2, "CERVEZA", "PILSEN", "6 x 1L"))
    ).toBe(false);
  });

  it("no junta marcas distintas", () => {
    expect(
      sonItemsSimilares(item(1, "LECHE ENTERA", "CONAPROLE"), item(2, "LECHE ENTERA", "CLALDY"))
    ).toBe(false);
  });

  it("junta cuando a uno le falta el tamaño", () => {
    expect(
      sonItemsSimilares(item(1, "HUEVOS", null, "x12"), item(2, "HUEVOS"))
    ).toBe(true);
  });

  it("compara tamaños no interpretables como texto", () => {
    expect(
      sonItemsSimilares(item(1, "PIZZA", null, "GRANDE"), item(2, "PIZZA", null, "CHICA"))
    ).toBe(false);
  });
});

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

  it("respeta los pares descartados", () => {
    expect(agruparItemsSimilares(items, new Set([clavePar(3, 1)]))).toEqual([]);
  });
});

describe("paresDe", () => {
  it("genera cada par una sola vez, ordenado", () => {
    expect(paresDe([3, 1, 2, 1])).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
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

  it("ignora el comercio genérico y los pares descartados", () => {
    expect(
      agruparGastosCombinables(
        [
          gasto(1, 99, "2026-09-01", true, true),
          gasto(2, 99, "2026-09-01", true, true),
          gasto(3, 10, "2026-09-01"),
          gasto(4, 10, "2026-09-01"),
        ],
        new Set([clavePar(3, 4)])
      )
    ).toEqual([]);
  });
});
