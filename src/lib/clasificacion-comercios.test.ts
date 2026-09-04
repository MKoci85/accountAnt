import { describe, expect, it } from "vitest";
import {
  CATEGORIA_COMBUSTIBLE,
  CATEGORIA_FALLBACK,
  CATEGORIA_SUSCRIPCION,
  clasificarLinea,
  sugerirCategoriaComercio,
} from "@/lib/clasificacion-comercios";

describe("clasificarLinea: combustible", () => {
  it("reconoce las marcas de estación, incluidas las discontinuadas que el POS sigue imprimiendo", () => {
    for (const texto of ["ANCAP RUTA 5", "DUCSA CENTRO", "AXION SAYAGO", "ESSO POCITOS", "PETROBRAS 8 DE OCTUBRE"]) {
      expect(clasificarLinea(texto, false)?.rubro).toBe("combustible");
    }
  });

  it("matchea la marca pegada al número de surtidor", () => {
    expect(clasificarLinea("ANCAP3140", false)?.rubro).toBe("combustible");
  });

  it("no matchea la marca embebida en otra palabra", () => {
    expect(clasificarLinea("PARADISA SRL", false)).toBeNull();
    expect(clasificarLinea("MERCADO ANCAPITAL", false)).toBeNull();
  });

  it("conserva la estación como emisor en vez de colapsar la marca", () => {
    const linea = clasificarLinea("  ANCAP RUTA 5 KM 30  ", false);
    expect(linea?.emisor).toBe("ANCAP RUTA 5 KM 30");
    expect(linea?.categoria).toBe(CATEGORIA_COMBUSTIBLE);
  });

  it("reconoce la marca escrita en minúscula", () => {
    expect(clasificarLinea("Estacion Ancap Centro", false)?.rubro).toBe("combustible");
  });
});

describe("clasificarLinea: telepeaje", () => {
  it("mapea CVU y TELEPEAJE a un único emisor canónico", () => {
    expect(clasificarLinea("CVU 12345", false)).toMatchObject({
      rubro: "telepeaje",
      emisor: "CVU",
    });
    expect(clasificarLinea("TELEPEAJE RUTA IB", false)?.emisor).toBe("CVU");
  });

  it("no confunde CVU con una palabra que lo contenga", () => {
    expect(clasificarLinea("SERVICIOS CVUNIDOS", false)).toBeNull();
  });
});

describe("clasificarLinea: suscripciones", () => {
  it("canoniza el nombre de las suscripciones conocidas", () => {
    expect(clasificarLinea("NETFLIX.COM 866-579", false)).toMatchObject({
      rubro: "suscripcion",
      emisor: "Netflix",
      categoria: CATEGORIA_SUSCRIPCION,
    });
    expect(clasificarLinea("APPLE.COM/BILL ITUNES", true)?.emisor).toBe("Apple");
    expect(clasificarLinea("spotify ab", false)?.emisor).toBe("Spotify");
  });

  it("asume suscripción para cualquier consumo en dólares sin reconocer", () => {
    expect(clasificarLinea("SOMEVENDOR *SUB 4839", true)).toMatchObject({
      rubro: "suscripcion",
      emisor: "SOMEVENDOR",
    });
  });

  it("no asume nada para un consumo en pesos sin reconocer", () => {
    expect(clasificarLinea("KIOSCO DE LA ESQUINA", false)).toBeNull();
  });

  it("la marca de combustible gana sobre el fallback de dólares", () => {
    expect(clasificarLinea("ANCAP RUTA 1", true)?.rubro).toBe("combustible");
  });
});

describe("sugerirCategoriaComercio", () => {
  it("mapea los rubros conocidos", () => {
    expect(sugerirCategoriaComercio("TIENDA INGLESA POCITOS")).toBe("Almacén");
    expect(sugerirCategoriaComercio("FARMASHOP 42")).toBe("Salud");
    expect(sugerirCategoriaComercio("PEDIDOSYA")).toBe("Comida fuera de casa");
    expect(sugerirCategoriaComercio("UBER *TRIP")).toBe("Transporte");
    expect(sugerirCategoriaComercio("CINE MOVIE")).toBe("Ocio");
  });

  it("ignora mayúsculas y tildes", () => {
    expect(sugerirCategoriaComercio("servicio médico integral")).toBe("Salud");
  });

  it("cae en la categoría por defecto cuando no reconoce nada", () => {
    expect(sugerirCategoriaComercio("XYZ SRL")).toBe(CATEGORIA_FALLBACK);
  });
});
