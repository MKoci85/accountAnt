import { describe, expect, it } from "vitest";
import {
  cadenaDeModelos,
  convieneOtroModelo,
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
});
