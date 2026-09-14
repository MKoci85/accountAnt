import { describe, expect, it } from "vitest";
import {
  CATEGORIA_COMBUSTIBLE,
  CATEGORIA_FALLBACK,
  CATEGORIA_SUSCRIPCION,
  clasificarLinea,
  sugerirCategoriaComercio,
  CATEGORIA_BANCARIO,
} from "@/lib/clasificacion-comercios";

describe("clasificarLinea: combustible", () => {
  it("reconoce las marcas de estación, incluidas las discontinuadas que el POS sigue imprimiendo", () => {
    for (const texto of ["ANCAP RUTA 5", "DUCSA CENTRO", "AXION SAYAGO", "ESSO POCITOS", "PETROBRAS 8 DE OCTUBRE"]) {
      expect(clasificarLinea(texto, false, 1500)?.rubro).toBe("combustible");
    }
  });

  it("matchea la marca pegada al número de surtidor", () => {
    expect(clasificarLinea("ANCAP3140", false, 1500)?.rubro).toBe("combustible");
  });

  it("no matchea la marca embebida en otra palabra", () => {
    expect(clasificarLinea("PARADISA SRL", false, 1500)).toBeNull();
    expect(clasificarLinea("MERCADO ANCAPITAL", false, 1500)).toBeNull();
  });

  it("conserva la estación como emisor en vez de colapsar la marca", () => {
    const linea = clasificarLinea("  ANCAP RUTA 5 KM 30  ", false, 1500);
    expect(linea?.emisor).toBe("ANCAP RUTA 5 KM 30");
    expect(linea?.categoria).toBe(CATEGORIA_COMBUSTIBLE);
  });

  it("reconoce la marca escrita en minúscula", () => {
    expect(clasificarLinea("Estacion Ancap Centro", false, 1500)?.rubro).toBe("combustible");
  });
});

describe("clasificarLinea: ajustes del resumen", () => {
  it("manda cualquier importe negativo a gastos bancarios", () => {
    expect(clasificarLinea("DTO.BROU- ANCAP", false, -181.5)).toMatchObject({
      rubro: "bancario",
      categoria: CATEGORIA_BANCARIO,
    });
  });

  it("le gana a la marca de combustible, que si no se lleva el descuento", () => {
    expect(clasificarLinea("DTO.BROU- ANCAP", false, -181.5)?.rubro).not.toBe(
      "combustible"
    );
    expect(clasificarLinea("ANCAP RUTA 5", false, 1500)?.rubro).toBe(
      "combustible"
    );
  });

  it("reconoce los cargos del banco por su texto, con importe positivo", () => {
    expect(clasificarLinea("SEGURO SALDO DEUDOR", false, 81.78)).toMatchObject({
      rubro: "bancario",
      emisor: "Banco",
      categoria: CATEGORIA_BANCARIO,
    });
    expect(clasificarLinea("INTERESES", false, 250)?.rubro).toBe("bancario");
  });
});

describe("clasificarLinea: telepeaje", () => {
  it("mapea CVU y TELEPEAJE a un único emisor canónico", () => {
    expect(clasificarLinea("CVU 12345", false, 167)).toMatchObject({
      rubro: "telepeaje",
      emisor: "CVU",
    });
    expect(clasificarLinea("TELEPEAJE RUTA IB", false, 167)?.emisor).toBe("CVU");
  });

  it("no confunde CVU con una palabra que lo contenga", () => {
    expect(clasificarLinea("SERVICIOS CVUNIDOS", false, 500)).toBeNull();
  });
});

describe("clasificarLinea: suscripciones", () => {
  it("canoniza el nombre de las suscripciones conocidas", () => {
    expect(clasificarLinea("NETFLIX.COM 866-579", false, 590)).toMatchObject({
      rubro: "suscripcion",
      emisor: "Netflix",
      categoria: CATEGORIA_SUSCRIPCION,
    });
    expect(clasificarLinea("APPLE.COM/BILL ITUNES", true, 8.99)?.emisor).toBe("Apple");
    expect(clasificarLinea("spotify ab", false, 590)?.emisor).toBe("Spotify");
  });

  it("asume suscripción para cualquier consumo en dólares sin reconocer", () => {
    expect(clasificarLinea("SOMEVENDOR *SUB 4839", true, 12)).toMatchObject({
      rubro: "suscripcion",
      emisor: "SOMEVENDOR",
    });
  });

  it("no asume nada para un consumo en pesos sin reconocer", () => {
    expect(clasificarLinea("KIOSCO DE LA ESQUINA", false, 250)).toBeNull();
  });

  it("la marca de combustible gana sobre el fallback de dólares", () => {
    expect(clasificarLinea("ANCAP RUTA 1", true, 40)?.rubro).toBe("combustible");
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
