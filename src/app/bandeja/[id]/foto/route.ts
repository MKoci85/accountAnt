import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { gastosEntrantes } from "@/db/schema";
import { leerImagenEntrante } from "@/lib/entrantes-server";

// La foto guardada de un comprobante de la bandeja, para mirarla al lado del
// formulario. Vive dentro de la tailnet como el resto de la app: lo único
// publicado a internet es el webhook, que no llega hasta acá.

export const dynamic = "force-dynamic";

const NO_EXISTE = () => new Response(null, { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NO_EXISTE();

  const entrante = db
    .select({ imagenRuta: gastosEntrantes.imagenRuta })
    .from(gastosEntrantes)
    .where(eq(gastosEntrantes.id, id))
    .get();
  if (!entrante?.imagenRuta) return NO_EXISTE();

  const imagen = await leerImagenEntrante(entrante.imagenRuta);
  if (!imagen) return NO_EXISTE();

  // El archivo se guarda tal como llegó, sin saber su formato: se sirve como
  // JPEG ya enderezado según el EXIF, que es lo que cualquier navegador muestra.
  try {
    const jpeg = await sharp(imagen).rotate().jpeg({ quality: 90 }).toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `inline; filename="comprobante-${id}.jpg"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NO_EXISTE();
  }
}
