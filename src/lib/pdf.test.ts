import { describe, expect, it } from "vitest";
import { agruparEnFilas, redactarDatosPersonales, type FragmentoPdf } from "@/lib/pdf";

function frag(texto: string, x: number, y: number, pagina = 1): FragmentoPdf {
  return { texto, x, y, pagina };
}

describe("agruparEnFilas", () => {
  it("junta en una fila los fragmentos que comparten renglón", () => {
    const filas = agruparEnFilas([frag("ANCAP", 100, 500), frag("1,000.00", 400, 500)]);
    expect(filas).toHaveLength(1);
    expect(filas[0].texto).toBe("ANCAP 1,000.00");
  });

  it("ordena los fragmentos por X aunque lleguen desordenados", () => {
    const filas = agruparEnFilas([frag("1,000.00", 400, 500), frag("ANCAP", 100, 500)]);
    expect(filas[0].texto).toBe("ANCAP 1,000.00");
  });

  it("tolera el desalineo vertical mínimo del renglón", () => {
    expect(agruparEnFilas([frag("A", 100, 500), frag("B", 200, 501.5)])).toHaveLength(1);
    expect(agruparEnFilas([frag("A", 100, 500), frag("B", 200, 510)])).toHaveLength(2);
  });

  it("no mezcla renglones de páginas distintas aunque compartan la Y", () => {
    const filas = agruparEnFilas([frag("A", 100, 500, 1), frag("B", 100, 500, 2)]);
    expect(filas).toHaveLength(2);
  });

  it("devuelve las filas en orden de lectura: por página, y de arriba hacia abajo", () => {
    const filas = agruparEnFilas([
      frag("tercera", 100, 700, 2),
      frag("segunda", 100, 400, 1),
      frag("primera", 100, 700, 1),
    ]);
    expect(filas.map((f) => f.texto)).toEqual(["primera", "segunda", "tercera"]);
  });

  it("sobre una lista vacía devuelve una lista vacía", () => {
    expect(agruparEnFilas([])).toEqual([]);
  });
});

describe("redactarDatosPersonales", () => {
  it("tapa el número de tarjeta, enmascarado o completo", () => {
    expect(redactarDatosPersonales("TARJETA 123456****7890")).toBe("TARJETA [TARJETA]");
    expect(redactarDatosPersonales("4509 9535 6623 3704")).toBe("[TARJETA]");
    expect(redactarDatosPersonales("4509-9535-6623-3704")).toBe("[TARJETA]");
  });

  it("tapa mail, cédula y URLs", () => {
    expect(redactarDatosPersonales("escribime a juan.perez+x@mail.com.uy")).toBe(
      "escribime a [MAIL]"
    );
    expect(redactarDatosPersonales("CI 1.234.567-8")).toBe("CI [CI]");
    expect(redactarDatosPersonales("ver https://banco.uy/x?y=1 ahora")).toBe("ver [URL] ahora");
  });

  it("no toca los importes ni las fechas del estado de cuenta", () => {
    const linea = "03/09/26 SUPERMERCADOS ESTEFAN 1,234.56";
    expect(redactarDatosPersonales(linea)).toBe(linea);
  });
});
