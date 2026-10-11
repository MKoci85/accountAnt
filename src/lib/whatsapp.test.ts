import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  firmaValida,
  mensajesDeWebhook,
  normalizarNumero,
  parsearNumeros,
  textoRespuesta,
} from "@/lib/whatsapp";

const SECRETO = "secreto-de-la-app";
const firmar = (cuerpo: string, secreto = SECRETO) =>
  `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;

describe("firmaValida", () => {
  const cuerpo = '{"entry":[]}';

  it("acepta el cuerpo firmado con el secreto de la app", () => {
    expect(firmaValida(cuerpo, firmar(cuerpo), SECRETO)).toBe(true);
  });

  it("rechaza otro secreto, un cuerpo alterado o una firma mal formada", () => {
    expect(firmaValida(cuerpo, firmar(cuerpo, "otro"), SECRETO)).toBe(false);
    expect(firmaValida(`${cuerpo} `, firmar(cuerpo), SECRETO)).toBe(false);
    expect(firmaValida(cuerpo, "sha256=abc", SECRETO)).toBe(false);
    expect(firmaValida(cuerpo, firmar(cuerpo).slice(7), SECRETO)).toBe(false);
  });

  it("sin cabecera o sin secreto configurado no pasa nada", () => {
    expect(firmaValida(cuerpo, null, SECRETO)).toBe(false);
    expect(firmaValida(cuerpo, firmar(cuerpo, ""), "")).toBe(false);
  });
});

describe("números", () => {
  it("normaliza a dígitos", () => {
    expect(normalizarNumero("+598 99 123-456")).toBe("59899123456");
  });

  it("parsea una lista sin repetidos ni vacíos", () => {
    expect(parsearNumeros("+598 99 123 456; 59891000111\n59892000222")).toEqual([
      "59899123456",
      "59891000111",
      "59892000222",
    ]);
    expect(parsearNumeros("59899123456,59899123456, ")).toEqual(["59899123456"]);
  });
});

describe("mensajesDeWebhook", () => {
  const ID_NUMERO = "111";
  const webhook = (messages: unknown[], phoneNumberId = ID_NUMERO) => ({
    entry: [
      {
        changes: [
          { value: { metadata: { phone_number_id: phoneNumberId }, messages } },
        ],
      },
    ],
  });

  it("saca la imagen con su remitente", () => {
    expect(
      mensajesDeWebhook(
        webhook([{ id: "wamid.1", from: "59899123456", type: "image", image: { id: "M1" } }]),
        ID_NUMERO
      )
    ).toEqual([{ id: "wamid.1", remitente: "59899123456", mediaId: "M1" }]);
  });

  it("una foto mandada como documento cuenta; un PDF no", () => {
    const [foto, pdf] = mensajesDeWebhook(
      webhook([
        { id: "a", from: "1", document: { id: "D1", mime_type: "image/jpeg" } },
        { id: "b", from: "1", document: { id: "D2", mime_type: "application/pdf" } },
      ]),
      ID_NUMERO
    );
    expect(foto.mediaId).toBe("D1");
    expect(pdf.mediaId).toBeNull();
  });

  it("un texto llega sin mediaId, para poder contestar que sólo se leen fotos", () => {
    expect(
      mensajesDeWebhook(
        webhook([{ id: "t", from: "1", type: "text", text: { body: "hola" } }]),
        ID_NUMERO
      )
    ).toEqual([{ id: "t", remitente: "1", mediaId: null }]);
  });

  it("ignora los mensajes dirigidos a otro número", () => {
    expect(
      mensajesDeWebhook(webhook([{ id: "x", from: "1", image: { id: "M" } }], "999"), ID_NUMERO)
    ).toEqual([]);
  });

  it("un aviso de estado o un cuerpo con otra forma no trae mensajes", () => {
    expect(
      mensajesDeWebhook(
        { entry: [{ changes: [{ value: { statuses: [{ id: "s" }] } }] }] },
        ID_NUMERO
      )
    ).toEqual([]);
    expect(mensajesDeWebhook(null, ID_NUMERO)).toEqual([]);
    expect(mensajesDeWebhook({ entry: "no" }, ID_NUMERO)).toEqual([]);
  });
});

describe("textoRespuesta", () => {
  const guardado = { tipo: "guardado", comercio: "Bar", total: 100 } as const;
  const pendiente = { tipo: "pendiente", motivo: "Hay 2 ítems sin reconocer." } as const;
  const problema = { tipo: "problema", motivo: "Ese comprobante ya está cargado como gasto." } as const;

  it("en modo problemas calla lo que salió bien y avisa lo que pide acción", () => {
    expect(textoRespuesta(guardado, "problemas")).toBeNull();
    expect(textoRespuesta({ tipo: "en-bandeja" }, "problemas")).toBeNull();
    expect(textoRespuesta(pendiente, "problemas")).toContain("2 ítems sin reconocer");
    expect(textoRespuesta(problema, "problemas")).toBe(problema.motivo);
  });

  it("en modo siempre también confirma", () => {
    expect(textoRespuesta(guardado, "siempre")).toContain("Bar");
    expect(textoRespuesta({ tipo: "en-bandeja" }, "siempre")).toContain("bandeja");
  });

  it("en modo nunca no contesta ni los problemas", () => {
    expect(textoRespuesta(problema, "nunca")).toBeNull();
    expect(textoRespuesta(pendiente, "nunca")).toBeNull();
  });
});
