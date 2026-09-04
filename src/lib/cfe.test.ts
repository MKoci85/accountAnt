import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const { parsearQR, parsearNombreItem } = await import("@/lib/cfe");

const PAYLOAD = "212345670012,101,A,1234,500.00,2026-09-03,ABC123";

describe("parsearQR", () => {
  it("lee los siete campos del CFE uruguayo", () => {
    expect(parsearQR(PAYLOAD)).toEqual({
      ruc: "212345670012",
      tipoCfe: "101",
      serie: "A",
      numero: "1234",
      monto: "500.00",
      fecha: "2026-09-03",
      hash: "ABC123",
    });
  });

  it("descarta el prefijo de la URL de consulta de DGI", () => {
    const url = `https://www.efactura.dgi.gub.uy/consultaQRPublica/qr?${PAYLOAD}`;
    expect(parsearQR(url)).toEqual(parsearQR(PAYLOAD));
  });

  it("decodifica el payload escapado y recorta los espacios de cada campo", () => {
    const qr = parsearQR("212345670012,101,%20A%20,1234,500.00,2026-09-03,ABC%2B123");
    expect(qr.serie).toBe("A");
    expect(qr.hash).toBe("ABC+123");
  });

  it("rechaza un QR que no sea de un CFE", () => {
    expect(() => parsearQR("https://ejemplo.com")).toThrow(/formato esperado/);
    expect(() => parsearQR("212345670012,101,A")).toThrow(/formato esperado/);
    expect(() => parsearQR(`${PAYLOAD},sobrante`)).toThrow(/formato esperado/);
  });

  it("rechaza un QR con un campo vacío en vez de devolverlo a medias", () => {
    expect(() => parsearQR("212345670012,101,,1234,500.00,2026-09-03,ABC123")).toThrow(
      /formato esperado/
    );
  });
});

describe("parsearNombreItem", () => {
  it("separa el peso o volumen que el POS pega al nombre, normalizado a la unidad base", () => {
    expect(parsearNombreItem("COCA COLA 1.5L")).toEqual({
      nombre: "COCA COLA",
      tamano: "1.5L",
      unidades: null,
    });
    expect(parsearNombreItem("MANZANA 500 GR")).toEqual({
      nombre: "MANZANA",
      tamano: "0.5kg",
      unidades: null,
    });
    expect(parsearNombreItem("AGUA 330ML")).toMatchObject({ tamano: "0.33L" });
  });

  it("no deja decimales de relleno en el tamaño", () => {
    expect(parsearNombreItem("AZUCAR 1KG")).toMatchObject({ tamano: "1kg" });
  });

  it("acepta la coma decimal y el decimal sin cero adelante", () => {
    expect(parsearNombreItem("QUESO 0,250 KG")).toMatchObject({ tamano: "0.25kg" });
    expect(parsearNombreItem("JAMON .5KG")).toMatchObject({ tamano: "0.5kg" });
  });

  it("separa el conteo de piezas, que no es un tamaño", () => {
    expect(parsearNombreItem("HUEVOS X6")).toEqual({
      nombre: "HUEVOS",
      tamano: null,
      unidades: 6,
    });
    expect(parsearNombreItem("YOGUR PACK 4 UN")).toMatchObject({ unidades: 4 });
  });

  it("normaliza los espacios y deja el nombre intacto si no hay medida", () => {
    expect(parsearNombreItem("  BANANA   ECUADOR  ")).toEqual({
      nombre: "BANANA ECUADOR",
      tamano: null,
      unidades: null,
    });
  });

  it("no confunde una letra final del nombre con una unidad", () => {
    expect(parsearNombreItem("AGUA MINERAL")).toEqual({
      nombre: "AGUA MINERAL",
      tamano: null,
      unidades: null,
    });
  });

  it("no parsea una medida que se coma todo el nombre", () => {
    expect(parsearNombreItem("500 GR")).toMatchObject({ nombre: "500 GR", tamano: null });
  });
});
