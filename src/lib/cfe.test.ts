import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const {
  parsearQR,
  fechaISODesdeQR,
  montoDesdeQR,
  parsearNombreItem,
  parsearComprobantePdfFacturalista,
  parsearComprobantePdfIjserv,
  parsearComprobantePdfOdoo,
  sinTextoDuplicado,
  parsearComprobanteTaface,
  lineasSinIvaTaface,
  parsearItemsPdfUcfe,
  parsearMontoFlexible,
  parsearResultadoUcfe,
  totalPdfUcfe,
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

  it("acepta el link impreso en el ticket copiado en varios renglones", () => {
    const copiado =
      "https://www.efactura.dgi.gub.uy/consultaQR/cfe?21\n2345670012,101,A,1234,500.00,2026-09-03,AB\r\n  C%2B123";
    expect(parsearQR(copiado)).toEqual({ ...parsearQR(PAYLOAD), hash: "ABC+123" });
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

describe("fechaISODesdeQR", () => {
  it("lee los tres formatos en que los emisores escriben la fecha", () => {
    expect(fechaISODesdeQR("27/05/2024")).toBe("2024-05-27");
    expect(fechaISODesdeQR("3/9/2026")).toBe("2026-09-03");
    expect(fechaISODesdeQR("20240527")).toBe("2024-05-27");
    expect(fechaISODesdeQR("2026-09-03")).toBe("2026-09-03");
  });

  it("devuelve null en vez de armar una fecha con lo que no entiende", () => {
    expect(fechaISODesdeQR("27-05-2024")).toBeNull();
    expect(fechaISODesdeQR("20241327")).toBeNull();
    expect(fechaISODesdeQR("31/02/2026")).toBeNull();
    expect(fechaISODesdeQR("")).toBeNull();
  });
});

describe("montoDesdeQR", () => {
  it("lee el monto con punto decimal y descarta lo que no es un importe", () => {
    expect(montoDesdeQR("1753.40")).toBe(1753.4);
    expect(montoDesdeQR("0")).toBeNull();
    expect(montoDesdeQR("1.753,40")).toBeNull();
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

function htmlTaface(filas: string[][], total: string): string {
  return [
    `<span id="span_vEMIRZNSOC">Comercio SA</span>`,
    `<span id="span_vTOTMNTTOTAL">${total}</span>`,
    `<input type="hidden" name="Grid1ContainerDataV" value='${JSON.stringify(filas)}'/>`,
  ].join("\n");
}

describe("parsearComprobanteTaface", () => {
  it("le suma el IVA a cada línea cuando vienen netas", () => {
    const html = htmlTaface(
      [
        ["1", "22.000%", "Galletitas", "", "1,00", "UNID", "177,87", "0,00", "177,87"],
        ["2", "10.000%", "Pan", "", "1,00", "UNID", "50,00", "0,00", "50,00"],
      ],
      "272,00"
    );

    expect(parsearComprobanteTaface(html).items.map((i) => i.precio)).toEqual([
      217, 55,
    ]);
  });

  it("deja los importes como vienen cuando ya incluyen IVA, aunque haya un descuento global", () => {
    const html = htmlTaface(
      [
        ["1", "22.000%", "Bermuda", "", "1,00", "UNID", "1590,00", "0,00", "1590,00"],
        ["2", "22.000%", "Remera", "", "1,00", "UNID", "499,00", "0,00", "499,00"],
      ],
      "1789,00"
    );

    expect(parsearComprobanteTaface(html).items.map((i) => i.precio)).toEqual([
      1590, 499,
    ]);
  });

  it("aplica el mismo criterio al precio por kilo de una línea pesada", () => {
    const html = htmlTaface(
      [["1", "10.000%", "Queso", "", "0,500", "KG", "400,00", "0,00", "200,00"]],
      "220,00"
    );

    expect(parsearComprobanteTaface(html).items[0]).toMatchObject({
      precio: 220,
      pesoTicket: 0.5,
      precioPorKiloTicket: 440,
    });
  });
});

describe("lineasSinIvaTaface", () => {
  it("elige la lectura cuya suma queda más cerca del total", () => {
    const lineas = [{ monto: 100, conIva: 122 }];
    expect(lineasSinIvaTaface(lineas, 122)).toBe(true);
    expect(lineasSinIvaTaface(lineas, 100)).toBe(false);
    expect(lineasSinIvaTaface(lineas, 90)).toBe(false);
  });

  it("sin total legible le suma el IVA, como antes", () => {
    expect(lineasSinIvaTaface([{ monto: 100, conIva: 122 }], null)).toBe(true);
    expect(lineasSinIvaTaface([{ monto: 100, conIva: 122 }], NaN)).toBe(true);
  });
});

const PDF_ODOO = [
  "MSC CAJA 3",
  "LUIS ALBERTO DE HERRERA 1290 LOCAL",
  "MONTEVIDEO SHOPPING",
  "MONTEVIDEO",
  "RACKS SAS RUT 214133790013",
  "www.laisla.com.uy",
  "TIPO: E-TICKET 101 NRO: 3553155",
  "SERIE: A PAGO: CONTADO",
  "CLIENTE: JUAN PEREZ / 1.234.567-8",
  "FECHA: 14/10/2026 HORA: 12:45:04 PM",
  "MONEDA: UYU",
  "CANT ARTÍCULO PRECIO DTO TOTAL",
  "1.0 1AKMOT-1163-44 1190.0 1190.0",
  "Ojotas Rip Curl Icons Of Surf Bloom Open Toe",
  "NETO 975.41 $ SUBTOTAL 1190.0 $",
  "IVA 214.59 $ DESCUENTO 0.0 $",
  "TOTAL 1190.0 $",
  "Master Debito 1190.0 $",
].join("\n");

describe("parsearComprobantePdfOdoo", () => {
  it("lee emisor, total, moneda e ítems del PDF", () => {
    const detalle = parsearComprobantePdfOdoo(PDF_ODOO);

    expect(detalle).toMatchObject({
      emisorNombre: "RACKS SAS",
      direccion:
        "LUIS ALBERTO DE HERRERA 1290 LOCAL, MONTEVIDEO SHOPPING, MONTEVIDEO",
      total: 1190,
      moneda: "UYU",
    });
    expect(detalle.items).toEqual([
      {
        nombre: "Ojotas Rip Curl Icons Of Surf Bloom Open Toe",
        tamano: null,
        unidades: 1,
        precio: 1190,
        pesoTicket: null,
        precioPorKiloTicket: null,
      },
    ]);
  });

  it("toma el total de la línea aunque traiga descuento, y junta la descripción partida", () => {
    const conDescuento = PDF_ODOO.replace(
      "1.0 1AKMOT-1163-44 1190.0 1190.0\nOjotas Rip Curl Icons Of Surf Bloom Open Toe",
      [
        "2.0 REM-001 800.0 160.0 1440.0",
        "Remera manga corta",
        "estampada",
        "1.0 MED-002 250.0 250.0",
        "Medias",
      ].join("\n")
    );

    expect(parsearComprobantePdfOdoo(conDescuento).items).toMatchObject([
      { nombre: "Remera manga corta estampada", unidades: 2, precio: 1440 },
      { nombre: "Medias", unidades: 1, precio: 250 },
    ]);
  });

  it("usa el código cuando la línea no trae descripción", () => {
    const sinDescripcion = PDF_ODOO.replace(
      "Ojotas Rip Curl Icons Of Surf Bloom Open Toe\n",
      ""
    );

    expect(parsearComprobantePdfOdoo(sinDescripcion).items[0].nombre).toBe(
      "1AKMOT-1163-44"
    );
  });

  it("no toma el bloque de totales como ítems", () => {
    const sinItems = PDF_ODOO.replace(
      "1.0 1AKMOT-1163-44 1190.0 1190.0\nOjotas Rip Curl Icons Of Surf Bloom Open Toe\n",
      ""
    );

    expect(() => parsearComprobantePdfOdoo(sinItems)).toThrow(/no encontrado/i);
  });

  it("rechaza un PDF sin el encabezado de ítems", () => {
    expect(() => parsearComprobantePdfOdoo("otra cosa")).toThrow(
      /formato esperado/i
    );
  });
});

describe("sinTextoDuplicado", () => {
  it("deja una sola copia de la negrita impresa dos veces", () => {
    expect(sinTextoDuplicado("CANTCANT")).toBe("CANT");
    expect(sinTextoDuplicado("IVA AL DÍA.IVA AL DÍA.")).toBe("IVA AL DÍA.");
  });

  it("no toca un texto que no son dos copias idénticas", () => {
    expect(sinTextoDuplicado("1190.0")).toBe("1190.0");
    expect(sinTextoDuplicado("TOTAL")).toBe("TOTAL");
  });
});

const PDF_UCFE = [
  "Subtotal gravado (22%): 516,40 Total IVA (22%): 113,60",
  "TOTAL A PAGAR: 630,00",
  "Descripción Uni * P. Unitario $ Desc Rec Cantidad Importe $",
  "Kids U 3 236,07 0,00 0,00 1 236,07",
  "Caliente U 3 280,33 0,00 0,00 1 280,33",
  "* 3- IVA tasa básica",
  "Código de seguridad: vizq0E",
].join("\n");

describe("parsearItemsPdfUcfe", () => {
  it("lee el nombre en la misma línea que la fila y suma el IVA a líneas netas", () => {
    const items = parsearItemsPdfUcfe(PDF_UCFE);

    expect(items.map((i) => i.nombre)).toEqual(["Kids", "Caliente"]);
    expect(items.map((i) => i.precio)).toEqual([288.01, 342]);
    expect(items.reduce((acc, i) => acc + i.precio, 0)).toBeCloseTo(630, 1);
  });

  it("no toca los importes cuando ya suman el total", () => {
    const items = parsearItemsPdfUcfe(
      PDF_UCFE.replace("630,00", "516,40")
    );

    expect(items.map((i) => i.precio)).toEqual([236.07, 280.33]);
  });

  it("sigue leyendo el nombre en líneas aparte", () => {
    const items = parsearItemsPdfUcfe(
      [
        "TOTAL A PAGAR: 100,00",
        "Descripción Uni * P. Unitario $ Desc Rec Cantidad Importe $",
        "Leche entera",
        "UN 1 50,00 0,00 0,00 2 100,00",
      ].join("\n")
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ nombre: "Leche entera", precio: 100 });
  });
});

describe("parsearMontoFlexible", () => {
  it("lee el mismo monto con cualquiera de las dos convenciones", () => {
    expect(parsearMontoFlexible("1285,00")).toBe(1285);
    expect(parsearMontoFlexible("1.285,00")).toBe(1285);
    expect(parsearMontoFlexible("1,285.00")).toBe(1285);
    expect(parsearMontoFlexible("1285.00")).toBe(1285);
    expect(parsearMontoFlexible("1.234.567,89")).toBe(1234567.89);
  });

  it("toma tres dígitos después del separador como miles, no como decimales", () => {
    expect(parsearMontoFlexible("1.285")).toBe(1285);
    expect(parsearMontoFlexible("630")).toBe(630);
    expect(parsearMontoFlexible("630,5")).toBe(630.5);
  });

  it("devuelve null para lo que no es un monto", () => {
    expect(parsearMontoFlexible("")).toBeNull();
    expect(parsearMontoFlexible(".,")).toBeNull();
    expect(parsearMontoFlexible("abc")).toBeNull();
  });
});

const htmlUcfe = (total: string) =>
  `<h3>PANADERIA EJEMPLO SA - RUT: 210000000019</h3>
   <p>Moneda: Peso Uruguayo<br/>Monto total a pagar: ${total}<br/></p>`;

describe("parsearResultadoUcfe", () => {
  it("lee emisor, moneda y un total de menos de mil", () => {
    expect(parsearResultadoUcfe(htmlUcfe("630,00"))).toEqual({
      emisorNombre: "PANADERIA EJEMPLO SA",
      total: 630,
      moneda: "UYU",
    });
  });

  it("lee un total con separador de miles en los dos formatos", () => {
    expect(parsearResultadoUcfe(htmlUcfe("1.285,00")).total).toBe(1285);
    expect(parsearResultadoUcfe(htmlUcfe("1,285.00")).total).toBe(1285);
  });

  it("deja el total en null, nunca en NaN, si no lo puede leer", () => {
    expect(parsearResultadoUcfe(htmlUcfe(".,")).total).toBeNull();
    expect(parsearResultadoUcfe("<p>otra cosa</p>")).toEqual({
      emisorNombre: "Comercio desconocido",
      total: null,
      moneda: null,
    });
  });
});

describe("totalPdfUcfe", () => {
  it("lee el total impreso, con o sin miles", () => {
    expect(totalPdfUcfe(PDF_UCFE)).toBe(630);
    expect(totalPdfUcfe("TOTAL A PAGAR: 1.285,00")).toBe(1285);
  });

  it("devuelve null si no está o no es un número", () => {
    expect(totalPdfUcfe("sin total")).toBeNull();
    expect(totalPdfUcfe("TOTAL A PAGAR: .,")).toBeNull();
  });
});
