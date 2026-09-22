import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const {
  parsearQR,
  parsearNombreItem,
  parsearComprobantePdfFacturalista,
  parsearComprobantePdfIjserv,
} = await import("@/lib/cfe");

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

const PDF_FACTURALISTA = [
  "DRESUR SA",
  "SUAREZ, JOAQUIN",
  "DURAZNO, Uruguay",
  "RUT EMISOR TIPO DOCUMENTO",
  "216171830015 e-Ticket",
  "SERIE NUMERO FORMA DE PAGO VENCIMIENTO",
  "B 5815221 Contado 16/09/2026",
  "RECEPTOR DOCUMENTO",
  "CONSUMO FINAL",
  "NOMBRE DOMICILIO",
  "FECHA DE DOCUMENTO MONEDA",
  "16/09/2026 Peso Uruguayo",
  "CANT NOMBRE DESCRIPCIÓN PU DESC IMPORTE",
  "1,00 HAAS PASAS CON CHOCOLATE 70 GS HAAS PASAS CON CHOCOLATE 70 GS 110,00 0,00 110,00",
  "Exp.Servicios 0,00",
  "Subtotal gravado (22%) 90,16 Total iva (22%) 19,84",
  "Subtotal no gravado 0,00 Total a pagar 110,00",
  "Codigo de Seguridad: aEzv5E",
].join("\n");

describe("parsearComprobantePdfFacturalista", () => {
  it("lee emisor, total, moneda e ítems del PDF", () => {
    const detalle = parsearComprobantePdfFacturalista(PDF_FACTURALISTA);

    expect(detalle).toMatchObject({
      emisorNombre: "DRESUR SA",
      direccion: "SUAREZ, JOAQUIN, DURAZNO, Uruguay",
      total: 110,
      moneda: "UYU",
    });
    expect(detalle.items).toEqual([
      {
        nombre: "HAAS PASAS CON CHOCOLATE 70 GS",
        tamano: null,
        unidades: null,
        precio: 110,
        pesoTicket: null,
        precioPorKiloTicket: null,
      },
    ]);
  });

  it("colapsa la descripción repetida pero respeta una distinta", () => {
    const conDescripcionPropia = PDF_FACTURALISTA.replace(
      "HAAS PASAS CON CHOCOLATE 70 GS HAAS PASAS CON CHOCOLATE 70 GS",
      "COCA COLA RETORNABLE FRIA 1,5 LT"
    );

    expect(
      parsearComprobantePdfFacturalista(conDescripcionPropia).items[0]
    ).toMatchObject({ nombre: "COCA COLA RETORNABLE FRIA", tamano: "1.5L" });
  });

  it("no toma el bloque de totales como ítems", () => {
    const sinItems = PDF_FACTURALISTA.replace(
      "1,00 HAAS PASAS CON CHOCOLATE 70 GS HAAS PASAS CON CHOCOLATE 70 GS 110,00 0,00 110,00\n",
      ""
    );

    expect(() => parsearComprobantePdfFacturalista(sinItems)).toThrow(
      /no encontrado/i
    );
  });

  it("rechaza un PDF sin el encabezado de ítems", () => {
    expect(() => parsearComprobantePdfFacturalista("otra cosa")).toThrow(
      /formato esperado/i
    );
  });
});

const PDF_IJSERV = [
  "2026-09-21",
  "Xiviller HNOS LTDA",
  "Xiviller HNOS LTDA",
  "PUIG 661",
  "RUT: 060003240014",
  "e-Ticket",
  "A-4089198",
  "CONTADO",
  "CONSUMO FINAL",
  "Producto Cantidad Precio Monto IVA",
  "001001 SUPER 38.350 88.67 3400.49",
  "Tipo moneda: UYU",
  "Total monto no gravado: 3401.00",
  "Tasa mínima IVA: 10.000",
  "Tasa básica IVA: 22.000",
  "TOTAL: 3401.00",
  "Res. Nro.",
  "Puede verificar comprobante en: http://www.ijserv.com/eFactura",
  "Nro. CAE: 90260465092",
  "Código de seguridad: qj5G/R",
].join("\n");

describe("parsearComprobantePdfIjserv", () => {
  it("lee emisor, total, moneda e ítems del PDF", () => {
    const detalle = parsearComprobantePdfIjserv(PDF_IJSERV);

    expect(detalle).toMatchObject({
      emisorNombre: "Xiviller HNOS LTDA",
      direccion: "PUIG 661",
      total: 3401,
      moneda: "UYU",
    });
    expect(detalle.items).toEqual([
      {
        nombre: "SUPER",
        tamano: null,
        unidades: null,
        precio: 3400.49,
        pesoTicket: null,
        precioPorKiloTicket: null,
      },
    ]);
  });

  it("toma la cantidad como unidades sólo cuando es entera", () => {
    const porUnidad = PDF_IJSERV.replace(
      "001001 SUPER 38.350 88.67 3400.49",
      "002010 COCA COLA 1.5 LT 2.000 110.00 220.00"
    );

    expect(parsearComprobantePdfIjserv(porUnidad).items[0]).toMatchObject({
      nombre: "COCA COLA",
      tamano: "1.5L",
      unidades: 2,
      precio: 220,
    });
  });

  it("lee el monto aunque la fila traiga la columna de IVA", () => {
    const conIva = PDF_IJSERV.replace(
      "001001 SUPER 38.350 88.67 3400.49",
      "002010 GALLETITAS 1.000 180.41 180.41 22.000"
    );

    expect(parsearComprobantePdfIjserv(conIva).items[0]).toMatchObject({
      unidades: 1,
      precio: 180.41,
    });
  });

  it("no toma el bloque de totales como ítems", () => {
    const sinItems = PDF_IJSERV.replace(
      "001001 SUPER 38.350 88.67 3400.49\n",
      ""
    );

    expect(() => parsearComprobantePdfIjserv(sinItems)).toThrow(/no encontrado/i);
  });

  it("rechaza un PDF sin el encabezado de ítems", () => {
    expect(() => parsearComprobantePdfIjserv("otra cosa")).toThrow(
      /formato esperado/i
    );
  });
});
