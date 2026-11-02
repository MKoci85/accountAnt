import { describe, expect, it } from "vitest";
import {
  aliasDeFusion,
  comercioAConservar,
  comprobantesRepetidos,
  datosDelFusionado,
  problemaParaFusionar,
  type EmisorParaFusion,
} from "@/lib/emisores";

function emisor(id: number, parcial: Partial<EmisorParaFusion> = {}): EmisorParaFusion {
  return {
    id,
    nombre: `Comercio ${id}`,
    ruc: null,
    esGenerico: false,
    proveedorCfeId: null,
    ...parcial,
  };
}

describe("comercioAConservar", () => {
  it("prefiere el que tiene RUC, que es como lo encuentra el QR", () => {
    expect(comercioAConservar([emisor(1), emisor(2, { ruc: "210000000019" })])?.id).toBe(2);
  });

  it("sin RUC en ninguno, conserva el primero", () => {
    expect(comercioAConservar([emisor(1), emisor(2)])?.id).toBe(1);
  });
});

describe("problemaParaFusionar", () => {
  it("permite fusionar un comercio con RUC y uno sin RUC", () => {
    expect(problemaParaFusionar(emisor(1, { ruc: "1" }), [emisor(2)])).toBeNull();
  });

  it("permite fusionar dos con el mismo RUC", () => {
    expect(problemaParaFusionar(emisor(1, { ruc: "1" }), [emisor(2, { ruc: "1" })])).toBeNull();
  });

  it("rechaza dos RUC distintos, que son dos empresas para DGI", () => {
    expect(
      problemaParaFusionar(emisor(1, { ruc: "1" }), [emisor(2, { ruc: "2" })])
    ).toMatch(/RUC distinto/);
  });

  it("rechaza el genérico, fusionarse consigo mismo y no elegir nada", () => {
    expect(problemaParaFusionar(emisor(1), [emisor(2, { esGenerico: true })])).toMatch(
      /genérico/
    );
    expect(problemaParaFusionar(emisor(1), [emisor(1)])).toMatch(/consigo mismo/);
    expect(problemaParaFusionar(emisor(1), [])).toMatch(/Elegí/);
  });
});

describe("datosDelFusionado", () => {
  it("el que queda conserva sus datos y completa los que le faltan", () => {
    expect(
      datosDelFusionado(emisor(1, { proveedorCfeId: 3 }), [emisor(2, { ruc: "9", proveedorCfeId: 4 })])
    ).toEqual({ ruc: "9", proveedorCfeId: 3 });
  });
});

describe("aliasDeFusion", () => {
  it("el nombre de cada absorbido queda como alias del que se conserva", () => {
    expect(
      aliasDeFusion(emisor(1, { nombre: "Tienda" }), [emisor(2, { nombre: "TIENDA WEB SUC" })], [])
    ).toEqual(["TIENDA WEB SUC"]);
  });

  it("omite lo que ya es su nombre o ya es alias, sin importar mayúsculas", () => {
    expect(
      aliasDeFusion(
        emisor(1, { nombre: "Tienda" }),
        [emisor(2, { nombre: "tienda" }), emisor(3, { nombre: "TIENDA WEB" }), emisor(4, { nombre: "Otra" })],
        ["Tienda Web"]
      )
    ).toEqual(["Otra"]);
  });
});

describe("comprobantesRepetidos", () => {
  it("detecta el mismo comprobante cargado bajo dos comercios", () => {
    expect(
      comprobantesRepetidos([
        { tipoCfe: "101", serie: "A", numero: "1" },
        { tipoCfe: "101", serie: "A", numero: "1" },
        { tipoCfe: "111", serie: "A", numero: "1" },
        { tipoCfe: null, serie: null, numero: null },
        { tipoCfe: null, serie: null, numero: null },
      ])
    ).toEqual(["101 A 1"]);
  });
});
