import { describe, expect, it } from "vitest";
import {
  ENCABEZADO_REPORTE,
  LIMITE_CONTEXTO_TOKENS_DEFAULT,
  MARCA_RECORTE,
  limiteContexto,
  limpiarRespuestaChat,
  podarHistorial,
  separarReporteAdjunto,
} from "@/lib/chat-ia";
import { techoRespuestaChat } from "@/lib/proveedores-ia";

type Mensaje = { rol: "user" | "assistant"; contenido: string; tokensEstimados: number };

function mensaje(contenido: string, tokensEstimados: number, rol: Mensaje["rol"] = "user"): Mensaje {
  return { rol, contenido, tokensEstimados };
}

describe("separarReporteAdjunto", () => {
  it("parte el reporte de la pregunta cuando el mensaje trae el encabezado", () => {
    const json = '{"resumen":{"total":1000}}';
    const { reporte, pregunta } = separarReporteAdjunto(
      `${ENCABEZADO_REPORTE}\n${json}\n\n¿En qué gasté de más?`
    );
    expect(reporte).toBe(json);
    expect(pregunta).toBe("¿En qué gasté de más?");
  });

  it("corta en la última llave, no en la primera, para no mutilar el JSON", () => {
    const json = '{"a":{"b":1},"c":{"d":2}}';
    const { reporte } = separarReporteAdjunto(`${ENCABEZADO_REPORTE} ${json} y la pregunta`);
    expect(reporte).toBe(json);
    expect(() => JSON.parse(reporte as string)).not.toThrow();
  });

  it("devuelve el mensaje entero cuando no hay reporte adjunto", () => {
    const { reporte, pregunta } = separarReporteAdjunto("¿Cuánto gasté en agosto?");
    expect(reporte).toBeNull();
    expect(pregunta).toBe("¿Cuánto gasté en agosto?");
  });

  it("no inventa un reporte si el encabezado está pero el JSON no cierra", () => {
    const contenido = `${ENCABEZADO_REPORTE} {"roto":`;
    const { reporte, pregunta } = separarReporteAdjunto(contenido);
    expect(reporte).toBeNull();
    expect(pregunta).toBe(contenido);
  });

  it("tolera una pregunta vacía después del reporte", () => {
    const { reporte, pregunta } = separarReporteAdjunto(`${ENCABEZADO_REPORTE}\n{"a":1}`);
    expect(reporte).toBe('{"a":1}');
    expect(pregunta).toBe("");
  });
});

describe("limpiarRespuestaChat", () => {
  it("saca los bloques de razonamiento en cualquiera de sus dos nombres", () => {
    expect(limpiarRespuestaChat("<think>mmm a ver</think>\nGastaste $500.")).toBe("Gastaste $500.");
    expect(limpiarRespuestaChat("<thinking>x</thinking> Gastaste $500.")).toBe("Gastaste $500.");
    expect(limpiarRespuestaChat("<THINK>x</THINK>ok")).toBe("ok");
  });

  it("saca varios bloques sin comerse lo que hay en el medio", () => {
    expect(limpiarRespuestaChat("<think>a</think>Uno.<think>b</think>Dos.")).toBe("Uno.Dos.");
  });

  it("desenvuelve el cerco de código solo si envuelve toda la respuesta", () => {
    expect(limpiarRespuestaChat("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(limpiarRespuestaChat("```\nhola\n```")).toBe("hola");
  });

  it("respeta un cerco de código en el medio del texto", () => {
    const texto = "Probá esto:\n```sql\nSELECT 1\n```\nY contame.";
    expect(limpiarRespuestaChat(texto)).toBe(texto);
  });

  it("deja intacta una respuesta normal", () => {
    expect(limpiarRespuestaChat("  En agosto gastaste $4.200.  ")).toBe(
      "En agosto gastaste $4.200."
    );
  });
});

describe("podarHistorial", () => {
  it("manda todo el historial cuando entra en el límite", () => {
    const mensajes = [mensaje("a", 10), mensaje("b", 10, "assistant"), mensaje("c", 10)];
    const podado = podarHistorial(mensajes, 100);
    expect(podado.mensajes).toEqual(mensajes);
    expect(podado.tokensEnviados).toBe(30);
    expect(podado.omitidos).toBe(0);
    expect(podado.recortado).toBe(false);
  });

  it("se queda con lo más reciente y descarta lo viejo, en orden", () => {
    const mensajes = [mensaje("viejo", 60), mensaje("medio", 20, "assistant"), mensaje("nuevo", 20)];
    const podado = podarHistorial(mensajes, 50);
    expect(podado.mensajes.map((m) => m.contenido)).toEqual(["medio", "nuevo"]);
    expect(podado.tokensEnviados).toBe(40);
    expect(podado.omitidos).toBe(1);
  });

  it("recorta el mensaje más nuevo en vez de dejarlo afuera si no entra solo", () => {
    const largo = "x".repeat(5000);
    const podado = podarHistorial([mensaje(largo, 2000)], 100);
    expect(podado.mensajes).toHaveLength(1);
    expect(podado.recortado).toBe(true);
    expect(podado.mensajes[0].contenido.endsWith(MARCA_RECORTE)).toBe(true);
    expect(podado.mensajes[0].contenido.length).toBeLessThan(largo.length);
    expect(podado.tokensEnviados).toBe(100);
  });

  it("no recorta un mensaje viejo: el recorte es solo para el último", () => {
    const podado = podarHistorial([mensaje("y".repeat(5000), 2000), mensaje("nuevo", 30)], 50);
    expect(podado.mensajes.map((m) => m.contenido)).toEqual(["nuevo"]);
    expect(podado.recortado).toBe(false);
    expect(podado.omitidos).toBe(1);
  });

  it("no devuelve nada cuando no hay presupuesto", () => {
    const podado = podarHistorial([mensaje("a", 10), mensaje("b", 10)], 0);
    expect(podado.mensajes).toEqual([]);
    expect(podado.omitidos).toBe(2);
    expect(podado.tokensEnviados).toBe(0);
  });

  it("sobre un historial vacío no explota", () => {
    expect(podarHistorial([], 100)).toEqual({
      mensajes: [],
      tokensEnviados: 0,
      omitidos: 0,
      recortado: false,
    });
  });
});

describe("limiteContexto", () => {
  it("reserva el techo de respuesta y un 5% del TPM", () => {
    expect(limiteContexto("groq", 8000)).toBe(Math.floor(8000 * 0.95) - techoRespuestaChat("groq"));
  });

  it("descuenta el techo de respuesta propio del proveedor", () => {
    expect(limiteContexto("gemini", 250_000)).toBe(
      Math.floor(250_000 * 0.95) - techoRespuestaChat("gemini")
    );
    expect(techoRespuestaChat("gemini")).toBeGreaterThan(techoRespuestaChat("groq"));
  });

  it("usa el default cuando el proveedor no declara TPM", () => {
    expect(limiteContexto("groq", null)).toBe(LIMITE_CONTEXTO_TOKENS_DEFAULT);
    expect(limiteContexto("anthropic")).toBe(LIMITE_CONTEXTO_TOKENS_DEFAULT);
  });

  it("nunca devuelve un límite negativo", () => {
    expect(limiteContexto("gemini", 100)).toBe(0);
  });
});
