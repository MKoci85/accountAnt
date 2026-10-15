import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

export type FragmentoPdf = {
  texto: string;
  x: number;
  y: number;
  pagina: number;
};

export type FilaPdf = {
  pagina: number;
  y: number;
  fragmentos: FragmentoPdf[];
  texto: string;
};

const TOLERANCIA_Y = 2;

export async function extraerFragmentos(
  buffer: ArrayBuffer
): Promise<FragmentoPdf[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const fragmentos: FragmentoPdf[] = [];

  for (let numeroPagina = 1; numeroPagina <= pdf.numPages; numeroPagina++) {
    const pagina = await pdf.getPage(numeroPagina);
    const contenido = await pagina.getTextContent();

    for (const item of contenido.items) {
      if (!("str" in item) || !("transform" in item)) continue;
      const texto = item.str.trim();
      if (!texto) continue;

      const [, , , , x, y] = item.transform as number[];
      fragmentos.push({ texto, x, y, pagina: numeroPagina });
    }
  }

  return fragmentos;
}

type Matriz = [number, number, number, number, number, number];

const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0];

function multiplicar(a: Matriz, b: Matriz): Matriz {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/**
 * Extrae un fragmento por objeto de texto (`BT`…`ET`) armando su contenido con
 * los glifos tal como están en el PDF, en vez de con `getTextContent`. Sirve
 * para los PDF que posicionan cada letra por separado: ahí pdf.js toma cada
 * hueco entre letras por un espacio y devuelve "O j ot a s", mientras que los
 * espacios reales vienen como glifo propio.
 * @param buffer contenido del PDF
 * @returns fragmentos con la posición del primer glifo de cada objeto de texto
 */
export async function extraerFragmentosPorGlifo(
  buffer: ArrayBuffer
): Promise<FragmentoPdf[]> {
  const { OPS } = await getResolvedPDFJS();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const fragmentos: FragmentoPdf[] = [];

  for (let numeroPagina = 1; numeroPagina <= pdf.numPages; numeroPagina++) {
    const pagina = await pdf.getPage(numeroPagina);
    const { fnArray, argsArray } = await pagina.getOperatorList();

    let ctm: Matriz = IDENTIDAD;
    const pila: Matriz[] = [];
    let tm: Matriz = IDENTIDAD;
    let texto = "";
    let origen: { x: number; y: number } | null = null;

    for (let i = 0; i < fnArray.length; i++) {
      const args = argsArray[i];
      switch (fnArray[i]) {
        case OPS.save:
          pila.push(ctm);
          break;
        case OPS.restore:
          ctm = pila.pop() ?? IDENTIDAD;
          break;
        case OPS.transform:
          ctm = multiplicar(args as Matriz, ctm);
          break;
        case OPS.beginText:
          tm = IDENTIDAD;
          texto = "";
          origen = null;
          break;
        case OPS.setTextMatrix:
          tm = Array.from(
            typeof args[0] === "number" ? args : args[0]
          ) as Matriz;
          break;
        case OPS.moveText:
          tm = multiplicar([1, 0, 0, 1, args[0], args[1]], tm);
          break;
        case OPS.showText:
        case OPS.showSpacedText: {
          if (!origen) {
            const [, , , , x, y] = multiplicar(tm, ctm);
            origen = { x, y };
          }
          for (const glifo of args[0] as unknown[]) {
            if (glifo && typeof glifo === "object" && "unicode" in glifo) {
              texto += String(glifo.unicode);
            }
          }
          break;
        }
        case OPS.endText:
          if (origen && texto.trim()) {
            fragmentos.push({
              texto: texto.trim(),
              x: origen.x,
              y: origen.y,
              pagina: numeroPagina,
            });
          }
          break;
      }
    }
  }

  return fragmentos;
}

export function agruparEnFilas(fragmentos: FragmentoPdf[]): FilaPdf[] {
  const filas: FilaPdf[] = [];

  for (const fragmento of fragmentos) {
    const fila = filas.find(
      (f) =>
        f.pagina === fragmento.pagina &&
        Math.abs(f.y - fragmento.y) <= TOLERANCIA_Y
    );
    if (fila) {
      fila.fragmentos.push(fragmento);
    } else {
      filas.push({
        pagina: fragmento.pagina,
        y: fragmento.y,
        fragmentos: [fragmento],
        texto: "",
      });
    }
  }

  for (const fila of filas) {
    fila.fragmentos.sort((a, b) => a.x - b.x);
    fila.texto = fila.fragmentos.map((f) => f.texto).join(" ");
  }

  return filas.sort((a, b) => a.pagina - b.pagina || b.y - a.y);
}

export async function extraerFilasPdf(buffer: ArrayBuffer): Promise<FilaPdf[]> {
  return agruparEnFilas(await extraerFragmentos(buffer));
}

/**
 * Redacta datos personales de un texto antes de mandarlo a un proveedor de IA externo.
 * @param texto texto original
 * @returns el texto con tarjetas, mails, cédulas y URLs reemplazados por placeholders
 */
export function redactarDatosPersonales(texto: string): string {
  return (
    texto
      .replace(/\b\d{6}\*+\d{4}\b/g, "[TARJETA]")
      .replace(/\b(?:\d[ -]?){13,19}\b/g, "[TARJETA]")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[MAIL]")
      .replace(/\b\d\.\d{3}\.\d{3}-\d\b/g, "[CI]")
      .replace(/https?:\/\/\S+/g, "[URL]")
  );
}
