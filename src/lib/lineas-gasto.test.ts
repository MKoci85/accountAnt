import { describe, expect, it } from "vitest";
import {
  esLineaDeServicio,
  lineaLibreNueva,
  lineasDesdeTicket,
  montoDeLinea,
  normalizarLineasDeServicio,
  type LineaGasto,
} from "@/lib/lineas-gasto";
import type { LineaDesdeTicket } from "@/components/escaner-comprobante";
import type { categorias } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;

function categoria(id: number, nombre: string, esServicio = false): Categoria {
  return { id, nombre, color: null, descripcion: null, esServicio };
}

const ALMACEN = categoria(1, "Almacén");
const SERVICIOS = categoria(2, "Servicios", true);

function linea(parcial: Partial<LineaGasto> = {}): LineaGasto {
  return {
    key: "k1",
    item: {
      id: 10,
      nombre: "Leche",
      marca: null,
      tamano: "1L",
      descripcion: null,
      categoriaId: ALMACEN.id,
      categoriaNombre: ALMACEN.nombre,
    },
    categoriaId: ALMACEN.id,
    categoriaNombre: ALMACEN.nombre,
    cantidad: 1,
    precio: 55,
    unidad: "un",
    esHormiga: false,
    esSobreprecio: false,
    sobreprecioManual: false,
    esPrecioBase: false,
    esPesoDesconocido: false,
    sinCatalogo: false,
    bloqueada: false,
    ...parcial,
  };
}

function delTicket(parcial: Partial<LineaDesdeTicket> = {}): LineaDesdeTicket {
  return {
    nombreTicket: "Leche",
    precio: 100,
    tamanoTicket: null,
    unidadesTicket: null,
    pesoTicket: null,
    precioPorKiloTicket: null,
    itemCatalogo: null,
    categoriaSugerida: ALMACEN,
    bloqueada: false,
    ...parcial,
  };
}

describe("montoDeLinea", () => {
  it("colapsa el precio vacío a cero sin confundirlo con un cero tipeado", () => {
    expect(montoDeLinea("")).toBe(0);
    expect(montoDeLinea(0)).toBe(0);
    expect(montoDeLinea(150.5)).toBe(150.5);
  });
});

describe("esLineaDeServicio", () => {
  it("decide por la categoría de la línea, no por el ítem", () => {
    const cats = [ALMACEN, SERVICIOS];
    expect(esLineaDeServicio(linea({ categoriaId: SERVICIOS.id }), cats)).toBe(true);
    expect(esLineaDeServicio(linea({ categoriaId: ALMACEN.id }), cats)).toBe(false);
  });

  it("no es de servicio si la categoría no está en la lista", () => {
    expect(esLineaDeServicio(linea({ categoriaId: 99 }), [ALMACEN, SERVICIOS])).toBe(false);
  });
});

describe("lineaLibreNueva", () => {
  it("nace marcada como libre, que es lo que la exime de vincularse al catálogo", () => {
    const nueva = lineaLibreNueva(SERVICIOS);
    expect(nueva.sinCatalogo).toBe(true);
    expect(nueva.item.id).toBeLessThanOrEqual(0);
    expect(nueva.item.nombre).toBe("");
    expect(nueva.categoriaId).toBe(SERVICIOS.id);
    expect(nueva.cantidad).toBe(1);
    expect(nueva.unidad).toBe("un");
    expect(nueva.precio).toBe("");
  });

  it("no exige una categoría de servicio: una compra puntual también es libre", () => {
    const nueva = lineaLibreNueva(ALMACEN);
    expect(nueva.sinCatalogo).toBe(true);
    expect(esLineaDeServicio(nueva, [ALMACEN, SERVICIOS])).toBe(false);
  });
});

describe("normalizarLineasDeServicio", () => {
  const cats = [ALMACEN, SERVICIOS];

  it("colapsa 3 × $500 en 1 × $1.500 conservando la plata", () => {
    const { lineas, convertidas } = normalizarLineasDeServicio(
      [linea({ categoriaId: SERVICIOS.id, cantidad: 3, precio: 500 })],
      cats
    );
    expect(lineas[0]).toMatchObject({ cantidad: 1, unidad: "un", precio: 1500 });
    expect(convertidas).toEqual([
      { nombre: "Leche", cantidad: 3, unidad: "un", precio: 500, importe: 1500 },
    ]);
  });

  it("no toca las líneas que no son de servicio", () => {
    const original = linea({ cantidad: 3, precio: 500, unidad: "kg" });
    const { lineas, convertidas } = normalizarLineasDeServicio([original], cats);
    expect(lineas[0]).toBe(original);
    expect(convertidas).toEqual([]);
  });

  it("no reporta como convertida una línea de servicio que ya estaba normalizada", () => {
    const original = linea({ categoriaId: SERVICIOS.id, cantidad: 1, precio: 900 });
    const { lineas, convertidas } = normalizarLineasDeServicio([original], cats);
    expect(lineas[0]).toBe(original);
    expect(convertidas).toEqual([]);
  });

  it("normaliza también la unidad de una línea de servicio por peso", () => {
    const { lineas } = normalizarLineasDeServicio(
      [linea({ categoriaId: SERVICIOS.id, cantidad: 0.5, precio: 300, unidad: "kg" })],
      cats
    );
    expect(lineas[0]).toMatchObject({ cantidad: 1, unidad: "un", precio: 150 });
  });

  it("toma el precio como total cuando el peso es desconocido", () => {
    const { lineas, convertidas } = normalizarLineasDeServicio(
      [
        linea({
          categoriaId: SERVICIOS.id,
          cantidad: 1,
          precio: 640,
          unidad: "kg",
          esPesoDesconocido: true,
        }),
      ],
      cats
    );
    expect(lineas[0]).toMatchObject({ precio: 640, esPesoDesconocido: false, unidad: "un" });
    expect(convertidas[0].importe).toBe(640);
  });

  it("redondea a centavos en vez de arrastrar el resto de coma flotante", () => {
    const { lineas } = normalizarLineasDeServicio(
      [linea({ categoriaId: SERVICIOS.id, cantidad: 3, precio: 0.1 })],
      cats
    );
    expect(lineas[0].precio).toBe(0.3);
  });
});

describe("lineasDesdeTicket", () => {
  it("reparte el total del renglón entre las unidades: 2 Leche $110 es 2 × $55", () => {
    const [l] = lineasDesdeTicket([
      delTicket({ nombreTicket: "Leche", precio: 110, unidadesTicket: 2 }),
    ]);
    expect(l).toMatchObject({ cantidad: 2, precio: 55, unidad: "un" });
  });

  it("usa el peso del ticket como cantidad y deriva el precio por kilo", () => {
    const [l] = lineasDesdeTicket([delTicket({ precio: 160, pesoTicket: 0.4 })]);
    expect(l.unidad).toBe("kg");
    expect(l.cantidad).toBe(0.4);
    expect(l.precio).toBeCloseTo(400, 6);
  });

  it("prefiere el precio por kilo impreso antes que dividir", () => {
    const [l] = lineasDesdeTicket([
      delTicket({ precio: 160, pesoTicket: 0.4, precioPorKiloTicket: 399 }),
    ]);
    expect(l.precio).toBe(399);
  });

  it("deduce el peso cuando solo viene el precio por kilo", () => {
    const [l] = lineasDesdeTicket([delTicket({ precio: 217, precioPorKiloTicket: 434 })]);
    expect(l).toMatchObject({ cantidad: 0.5, precio: 434, unidad: "kg" });
  });

  it("multiplica el tamaño del envase por las piezas: 2 × 1.5L es 3 L", () => {
    const [l] = lineasDesdeTicket([
      delTicket({ precio: 300, tamanoTicket: "1.5L", unidadesTicket: 2 }),
    ]);
    expect(l).toMatchObject({ cantidad: 3, precio: 100, unidad: "L" });
  });

  it("cae en 1 unidad al precio del renglón cuando el ticket no dice nada", () => {
    const [l] = lineasDesdeTicket([delTicket({ precio: 90 })]);
    expect(l).toMatchObject({ cantidad: 1, precio: 90, unidad: "un" });
  });

  it("agrupa el mismo ítem escaneado dos veces sumando la cantidad", () => {
    const lineas = lineasDesdeTicket([
      delTicket({ nombreTicket: "Coca Cola 1.5L", precio: 120 }),
      delTicket({ nombreTicket: "Coca Cola 1.5L", precio: 120 }),
    ]);
    expect(lineas).toHaveLength(1);
    expect(lineas[0].cantidad).toBe(2);
  });

  it("no agrupa el mismo ítem a distinto precio: son decisiones de compra distintas", () => {
    const lineas = lineasDesdeTicket([
      delTicket({ nombreTicket: "Coca Cola 1.5L", precio: 120 }),
      delTicket({ nombreTicket: "Coca Cola 1.5L", precio: 95 }),
    ]);
    expect(lineas).toHaveLength(2);
  });

  it("no agrupa líneas de distinta unidad ni de distinta categoría", () => {
    expect(
      lineasDesdeTicket([
        delTicket({ nombreTicket: "Queso", precio: 200 }),
        delTicket({ nombreTicket: "Queso", precio: 200, pesoTicket: 1 }),
      ])
    ).toHaveLength(2);

    expect(
      lineasDesdeTicket([
        delTicket({ nombreTicket: "Alcohol", precio: 80 }),
        delTicket({
          nombreTicket: "Alcohol",
          precio: 80,
          categoriaSugerida: categoria(3, "Farmacia"),
        }),
      ])
    ).toHaveLength(2);
  });

  it("nunca marca una línea como libre, tenga el id provisorio que tenga", () => {
    const lineas = lineasDesdeTicket([
      delTicket({ nombreTicket: "Algo raro" }),
      delTicket({ nombreTicket: "Otra cosa" }),
    ]);
    expect(lineas.map((l) => l.sinCatalogo)).toEqual([false, false]);
  });

  it("manda a Sin asignar el ítem sin catálogo ni categoría sugerida", () => {
    const [l] = lineasDesdeTicket([
      delTicket({ nombreTicket: "Algo raro", categoriaSugerida: null }),
    ]);
    expect(l.categoriaNombre).toBe("Sin asignar");
    expect(l.item.nombre).toBe("Algo raro");
    expect(l.item.id).toBeLessThan(0);
  });

  it("conserva el ítem del catálogo y su categoría cuando el renglón ya resolvió", () => {
    const [l] = lineasDesdeTicket([
      delTicket({
        itemCatalogo: {
          id: 42,
          nombre: "Leche Conaprole 1L",
          marca: "Conaprole",
          tamano: "1L",
          descripcion: null,
          categoriaId: 5,
          categoriaNombre: "Lácteos",
        },
        bloqueada: true,
      }),
    ]);
    expect(l.item.id).toBe(42);
    expect(l.categoriaId).toBe(5);
    expect(l.bloqueada).toBe(true);
  });
});
