import { describe, expect, it } from "vitest";
import {
  MARGEN_OFERTA_DEFAULT,
  pareceOferta,
  claveReferencia,
  fechaLimiteVentanaPrecio,
  normalizarUnidad,
  parsearTamano,
  referenciasDePrecio,
  superaReferencia,
  MARGEN_SOBREPRECIO_POR_PESO_DEFAULT,
  type CompraParaReferencia,
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

describe("referenciasDePrecio", () => {
  let siguienteId = 1;
  function compra(
    fecha: string,
    precio: number,
    extra: Partial<CompraParaReferencia> = {}
  ): CompraParaReferencia {
    return {
      gastoItemId: siguienteId++,
      itemCatalogoId: 1,
      unidad: "un",
      precio,
      fecha,
      esPrecioBase: false,
      esOferta: false,
      esPesoDesconocido: false,
      ...extra,
    };
  }
  const LIMITE = "2026-01-01";
  const clave = claveReferencia(1, "un");
  const precioDe = (compras: CompraParaReferencia[]) =>
    referenciasDePrecio(compras, LIMITE).get(clave)?.precio;

  it("toma la compra más barata de la ventana cuando no hay suba marcada", () => {
    expect(
      precioDe([compra("2026-02-01", 60), compra("2026-03-01", 50), compra("2026-04-01", 55)])
    ).toBe(50);
  });

  it("una suba confirmada deja afuera las compras anteriores más baratas", () => {
    expect(
      precioDe([compra("2026-02-01", 50), compra("2026-03-01", 60, { esPrecioBase: true })])
    ).toBe(60);
  });

  it("una compra más barata posterior a la suba vuelve a ser la referencia", () => {
    expect(
      precioDe([
        compra("2026-02-01", 50),
        compra("2026-03-01", 60, { esPrecioBase: true }),
        compra("2026-04-01", 58),
      ])
    ).toBe(58);
  });

  it("sólo cuenta la última suba", () => {
    expect(
      precioDe([
        compra("2026-02-01", 60, { esPrecioBase: true }),
        compra("2026-03-01", 55),
        compra("2026-04-01", 70, { esPrecioBase: true }),
      ])
    ).toBe(70);
  });

  it("desempata dos compras del mismo día por orden de carga", () => {
    const anterior = compra("2026-03-01", 50);
    const base = compra("2026-03-01", 60, { esPrecioBase: true });
    expect(precioDe([base, anterior])).toBe(60);
  });

  it("nunca toma una oferta como referencia", () => {
    expect(
      precioDe([compra("2026-02-01", 60), compra("2026-03-01", 30, { esOferta: true })])
    ).toBe(60);
  });

  it("una suba marcada como oferta no reinicia el historial", () => {
    expect(
      precioDe([
        compra("2026-02-01", 50),
        compra("2026-03-01", 60, { esPrecioBase: true, esOferta: true }),
      ])
    ).toBe(50);
  });

  it("marcar una compra como oferta y desmarcarla deja la misma referencia", () => {
    const compras = [
      compra("2026-02-01", 50),
      compra("2026-03-01", 60, { esPrecioBase: true }),
      compra("2026-04-01", 40),
    ];
    const antes = referenciasDePrecio(compras, LIMITE).get(clave);
    const conOferta = compras.map((c) =>
      c.precio === 40 ? { ...c, esOferta: true } : c
    );
    expect(precioDe(conOferta)).toBe(60);
    const desmarcada = conOferta.map((c) => ({ ...c, esOferta: false }));
    expect(referenciasDePrecio(desmarcada, LIMITE).get(clave)?.gastoItemId).toBe(
      antes?.gastoItemId
    );
    expect(precioDe(desmarcada)).toBe(40);
  });

  it("ignora lo que está fuera de la ventana, sin peso o sin precio", () => {
    expect(
      precioDe([
        compra("2025-12-31", 10),
        compra("2026-02-01", 20, { esPesoDesconocido: true }),
        compra("2026-02-02", 0),
        compra("2026-02-03", 70),
      ])
    ).toBe(70);
  });

  it("separa el mismo ítem por unidad y descarta las líneas sin catálogo", () => {
    const referencias = referenciasDePrecio(
      [
        compra("2026-02-01", 300, { unidad: "kg" }),
        compra("2026-02-01", 90),
        compra("2026-02-01", 5, { itemCatalogoId: null }),
      ],
      LIMITE
    );
    expect(referencias.get(claveReferencia(1, "kg"))?.precio).toBe(300);
    expect(referencias.get(clave)?.precio).toBe(90);
    expect(referencias.size).toBe(2);
  });
});

describe("fechaLimiteVentanaPrecio", () => {
  it("retrocede la cantidad de meses pedida", () => {
    expect(fechaLimiteVentanaPrecio("2026-09-03", 4)).toBe("2026-05-03");
    expect(fechaLimiteVentanaPrecio("2026-02-10", 3)).toBe("2025-11-10");
  });
});
