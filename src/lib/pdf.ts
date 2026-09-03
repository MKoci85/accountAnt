import { getDocumentProxy } from "unpdf";

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
