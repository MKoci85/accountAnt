export const LIMITE_SUBIDA_BYTES = 900 * 1024;

const LADO_MAXIMO = 1600;
const CALIDADES_JPEG = [0.8, 0.6, 0.45];

export function formatearTamano(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function excedeLimite(file: File) {
  return file.size > LIMITE_SUBIDA_BYTES;
}

function leerBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

export type ImagenParaIA = { base64: string; mimeType: string };

/**
 * Reescala y re-encodea una imagen en JPEG para que entre en el límite de subida.
 * @param file imagen original
 * @returns base64 y mimeType listos para enviar a la IA
 */
export async function prepararImagen(file: File): Promise<ImagenParaIA> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (excedeLimite(file)) {
      throw new Error(
        `No se pudo procesar la imagen y pesa ${formatearTamano(file.size)}. El máximo es ${formatearTamano(LIMITE_SUBIDA_BYTES)}.`,
      );
    }
    return { base64: await leerBase64(file), mimeType: file.type };
  }

  const imagen = comprimir(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return imagen;
}

export function capturarVideo(video: HTMLVideoElement): ImagenParaIA {
  return comprimir(video, video.videoWidth, video.videoHeight);
}

function comprimir(
  fuente: CanvasImageSource,
  ancho: number,
  alto: number,
): ImagenParaIA {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  canvas.getContext("2d")?.drawImage(fuente, 0, 0, canvas.width, canvas.height);

  let base64 = "";
  for (const calidad of CALIDADES_JPEG) {
    base64 = canvas.toDataURL("image/jpeg", calidad).split(",")[1] ?? "";
    if (base64.length <= LIMITE_SUBIDA_BYTES) break;
  }
  if (base64.length > LIMITE_SUBIDA_BYTES) {
    throw new Error(
      `La imagen sigue pesando ${formatearTamano(base64.length)} después de comprimirla. El máximo es ${formatearTamano(LIMITE_SUBIDA_BYTES)}: recortala y probá de nuevo.`,
    );
  }
  return { base64, mimeType: "image/jpeg" };
}
