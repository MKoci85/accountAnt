import { eq } from "drizzle-orm";
import { db } from "@/db";
import { estadosCuenta } from "@/db/schema";
import { leerPdfEstadoCuenta } from "@/lib/estados-cuenta-server";

export const dynamic = "force-dynamic";

const NO_EXISTE = () => new Response(null, { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NO_EXISTE();

  const fila = db
    .select({ archivo: estadosCuenta.archivo })
    .from(estadosCuenta)
    .where(eq(estadosCuenta.id, id))
    .get();
  if (!fila?.archivo) return NO_EXISTE();

  const pdf = await leerPdfEstadoCuenta(fila.archivo);
  if (!pdf) return NO_EXISTE();

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="estado-de-cuenta-${id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
