import sharp from "sharp";
import jsQR from "jsqr";

// De mayor a menor: a diferencia del navegador, acá no hay apuro, así que se
// empieza por la foto casi entera — a 1600 px el QR de un ticket fotografiado
// de lejos queda en 3 px por módulo y `jsqr` ya no lo lee.
const LADOS_QR = [3200, 1600, 800];
const LADO_MAXIMO_IA = 1600;

/**
 * Busca un QR en una imagen, del lado del servidor. Es el equivalente de lo que
 * `EscanerComprobante` hace en el navegador con un canvas: `jsqr` no entiende
 * JPEG ni PNG, recibe píxeles crudos, y acá quien los produce es `sharp`.
 *
 * Prueba la imagen a varios tamaños porque no hay uno que sirva siempre: un QR
 * chico se pierde al reducir la foto, y uno que ocupa toda la imagen a veces
 * sólo se lee reducido.
 * @returns El texto del QR, o null si no se encontró ninguno.
 */
export async function buscarQREnImagen(imagen: Buffer): Promise<string | null> {
  // rotate() sin argumentos aplica la orientación EXIF: una foto vertical de
  // celular viene acostada en los píxeles.
  const base = sharp(imagen).rotate();
  const { width, height } = await base.metadata();
  if (!width || !height) return null;

  const ladoMax = Math.max(width, height);
  const lados = LADOS_QR.map((lado) => Math.min(lado, ladoMax)).filter(
    (lado, i, arr) => arr.indexOf(lado) === i
  );

  for (const lado of lados) {
    const { data, info } = await base
      .clone()
      .resize({
        width: lado,
        height: lado,
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const codigo = jsQR(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
      { inversionAttempts: "attemptBoth" }
    );
    if (codigo?.data) return codigo.data;
  }

  return null;
}

/**
 * Deja una imagen lista para mandar a la IA: enderezada, a lo sumo 1600 px de
 * lado y en JPEG. Mismo criterio que `prepararImagen` en el navegador — se baja
 * el peso, no la resolución que hace legibles los precios.
 */
export async function imagenParaIA(
  imagen: Buffer
): Promise<{ base64: string; mimeType: string }> {
  const jpeg = await sharp(imagen)
    .rotate()
    .resize({
      width: LADO_MAXIMO_IA,
      height: LADO_MAXIMO_IA,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { base64: jpeg.toString("base64"), mimeType: "image/jpeg" };
}
