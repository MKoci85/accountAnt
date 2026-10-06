import { describe, expect, it } from "vitest";
import {
  cadenaDeModelos,
  candidatosDeRespaldo,
  convieneOtroModelo,
  modelosDeGemini,
  modelosGratuitosOpenRouter,
  parsearModelosRespaldo,
  respaldosSinPrincipal,
} from "@/lib/proveedores-ia";

describe("convieneOtroModelo", () => {
  it("salta cuando el modelo está saturado, caído o ya no existe", () => {
    expect(convieneOtroModelo(503)).toBe(true);
    expect(convieneOtroModelo(500)).toBe(true);
    expect(convieneOtroModelo(404)).toBe(true);
  });

  it("no salta cuando el problema es del pedido, de la cuota o de la key", () => {
    expect(convieneOtroModelo(400)).toBe(false);
    expect(convieneOtroModelo(401)).toBe(false);
    expect(convieneOtroModelo(413)).toBe(false);
    expect(convieneOtroModelo(429)).toBe(false);
  });

  it("no salta si el proveedor no llegó a responder", () => {
    expect(convieneOtroModelo(undefined)).toBe(false);
  });
});

describe("cadenaDeModelos", () => {
  it("prueba primero el principal y después los respaldos en su orden", () => {
    expect(cadenaDeModelos("a", ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("no repite el principal si también figura como respaldo", () => {
    expect(cadenaDeModelos("b", ["a", "b", "a"])).toEqual(["b", "a"]);
  });

  it("sin respaldos queda sólo el principal", () => {
    expect(cadenaDeModelos("a", [])).toEqual(["a"]);
  });
});

describe("respaldosSinPrincipal", () => {
  it("quita el principal de los respaldos y conserva el orden", () => {
    expect(respaldosSinPrincipal("b", ["a", "b", "c"])).toEqual(["a", "c"]);
  });

  it("deja la lista igual cuando el principal no está en ella", () => {
    expect(respaldosSinPrincipal("x", ["a", "b"])).toEqual(["a", "b"]);
  });

  it("devuelve vacío cuando el único respaldo es el principal", () => {
    expect(respaldosSinPrincipal("a", ["a"])).toEqual([]);
  });
});

describe("candidatosDeRespaldo", () => {
  it("prueba primero los que más se parecen al modelo que dejó el lugar", () => {
    expect(
      candidatosDeRespaldo(
        ["otro-9-pro", "familia-2-rapido", "familia-3-lento", "familia-3-rapido"],
        "familia-3-rapido-viejo",
        [],
      ),
    ).toEqual([
      "familia-3-rapido",
      "familia-2-rapido",
      "familia-3-lento",
      "otro-9-pro",
    ]);
  });

  it("deja afuera los excluidos y los repetidos", () => {
    expect(candidatosDeRespaldo(["a-1", "b-1", "a-1", "c-1"], "a-1", ["b-1"])).toEqual([
      "a-1",
      "c-1",
    ]);
  });

  it("devuelve vacío sin catálogo", () => {
    expect(candidatosDeRespaldo([], "a-1", [])).toEqual([]);
  });
});

describe("parsearModelosRespaldo", () => {
  it("separa por coma, espacio o salto de línea y descarta repetidos", () => {
    expect(parsearModelosRespaldo(" modelo-a,modelo-b\n modelo-a ; modelo-c ")).toEqual([
      "modelo-a",
      "modelo-b",
      "modelo-c",
    ]);
  });

  it("un texto vacío no deja ningún modelo", () => {
    expect(parsearModelosRespaldo("  ,  ")).toEqual([]);
  });
});

describe("modelosDeGemini", () => {
  it("devuelve los modelos que generan contenido, sin el prefijo", () => {
    const json = {
      models: [
        { name: "models/gemini-x-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-x-embedding", supportedGenerationMethods: ["embedContent"] },
        { name: "models/gemini-x-flash-tts", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-x-flash-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/otra-familia", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-sin-metodos" },
      ],
    };
    expect(modelosDeGemini(json)).toEqual(["gemini-x-flash"]);
  });

  it("devuelve null si la respuesta no trae el listado", () => {
    expect(modelosDeGemini({ error: { message: "API key not valid" } })).toBeNull();
    expect(modelosDeGemini(null)).toBeNull();
  });
});

describe("modelosGratuitosOpenRouter", () => {
  it("deja sólo los gratuitos que emiten nada más que texto", () => {
    const json = {
      data: [
        { id: "a:free", pricing: { prompt: "0" } },
        { id: "b", pricing: { prompt: "0.000001" } },
        {
          id: "c:free",
          pricing: { prompt: "0" },
          architecture: { output_modalities: ["text", "audio"] },
        },
        {
          id: "d:free",
          pricing: { prompt: "0" },
          architecture: { output_modalities: ["text"] },
        },
      ],
    };
    expect(modelosGratuitosOpenRouter(json)).toEqual(["a:free", "d:free"]);
  });

  it("devuelve null si la respuesta no trae el listado", () => {
    expect(modelosGratuitosOpenRouter({ data: "no" })).toBeNull();
  });
});
