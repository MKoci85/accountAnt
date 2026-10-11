"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { emisores, gastosEntrantes } from "@/db/schema";
import { parsearQR } from "@/lib/cfe";
import { parsearItemsEntrante } from "@/lib/entrantes";
import { borrarEntrante, resumenDeBandeja } from "@/lib/entrantes-server";
import {
  recibirImagen,
  reprocesarEntrante,
  type ResultadoRecepcion,
} from "@/lib/entrantes-recepcion";
import { resolverItemContraCatalogo } from "@/app/actions/cfe";
import { buscarEmisores } from "@/app/actions/catalogos";
import { obtenerHormigaHeredada } from "@/app/actions/gastos";
import type { LineaDesdeTicket } from "@/components/escaner-comprobante";

type Entrante = typeof gastosEntrantes.$inferSelect;
type Emisor = typeof emisores.$inferSelect;

// La bandeja se ve desde el aviso del layout, y un comprobante puede haber
// terminado como gasto: se revalida todo.
function revalidarBandeja() {
  revalidatePath("/", "layout");
}

async function resolverItems(entrante: Entrante) {
  return Promise.all(
    parsearItemsEntrante(entrante.itemsJson).map((item) =>
      resolverItemContraCatalogo(item)
    )
  );
}

export type EntranteListado = {
  id: number;
  recibidoEn: string;
  canal: Entrante["canal"];
  estado: Entrante["estado"];
  lectura: Entrante["lectura"];
  comercio: string | null;
  fecha: string | null;
  total: number | null;
  cantidadItems: number;
  /** Ítems que todavía no matchean con nada del catálogo. */
  sinReconocer: number;
  aviso: string | null;
  error: string | null;
  tieneFoto: boolean;
};

/** La bandeja completa, lo más viejo primero: es lo que hay que resolver antes. */
export async function listarEntrantes(): Promise<EntranteListado[]> {
  const filas = await db
    .select({ entrante: gastosEntrantes, emisorNombre: emisores.nombre })
    .from(gastosEntrantes)
    .leftJoin(emisores, eq(gastosEntrantes.emisorId, emisores.id))
    .orderBy(asc(gastosEntrantes.recibidoEn), asc(gastosEntrantes.id));

  return Promise.all(
    filas.map(async ({ entrante, emisorNombre }) => {
      const items = await resolverItems(entrante);
      return {
        id: entrante.id,
        recibidoEn: entrante.recibidoEn,
        canal: entrante.canal,
        estado: entrante.estado,
        lectura: entrante.lectura,
        comercio: emisorNombre ?? entrante.comercio,
        fecha: entrante.fecha,
        // Sin total validado se muestra la suma de lo leído.
        total:
          entrante.total ??
          (items.length
            ? Number(items.reduce((acc, i) => acc + i.precio, 0).toFixed(2))
            : null),
        cantidadItems: items.length,
        sinReconocer: items.filter((i) => i.itemCatalogo === null).length,
        aviso: entrante.aviso,
        error: entrante.error,
        tieneFoto: entrante.imagenRuta !== null,
      };
    })
  );
}

export async function obtenerResumenBandeja() {
  return resumenDeBandeja();
}

/**
 * Sube una foto a la bandeja desde la app. Es el mismo camino que recorre una
 * foto llegada por WhatsApp, con la imagen ya achicada por el navegador.
 */
export async function subirFotoEntrante(foto: {
  base64: string;
}): Promise<ResultadoRecepcion> {
  const resultado = await recibirImagen(
    Buffer.from(foto.base64, "base64"),
    "manual"
  );
  revalidarBandeja();
  return resultado;
}

export async function reintentarEntrante(id: number) {
  const resultado = await reprocesarEntrante(id);
  revalidarBandeja();
  return resultado;
}

export async function descartarEntrante(id: number) {
  await borrarEntrante(id);
  revalidarBandeja();
}

export type EntranteParaRevision = {
  id: number;
  emisor: Emisor | null;
  comercio: string | null;
  fecha: string | null;
  total: number | null;
  datosCfe: { tipoCfe: string; serie: string; numero: string } | null;
  lineas: LineaDesdeTicket[];
  aviso: string | null;
  tieneFoto: boolean;
};

/**
 * Arma lo que el formulario de gasto necesita para precargarse desde un
 * entrante. Los ítems se resuelven contra el catálogo acá, no al recibir la
 * foto: un alias aprendido después de recibirla ya cuenta.
 * @returns null si el entrante no existe o todavía no se pudo leer.
 */
export async function obtenerEntranteParaRevision(
  id: number
): Promise<EntranteParaRevision | null> {
  const entrante = db
    .select()
    .from(gastosEntrantes)
    .where(eq(gastosEntrantes.id, id))
    .get();
  if (!entrante || entrante.estado !== "pendiente") return null;

  let emisor: Emisor | null = null;
  if (entrante.emisorId !== null) {
    emisor =
      db.select().from(emisores).where(eq(emisores.id, entrante.emisorId)).get() ??
      null;
  } else if (entrante.comercio) {
    // El nombre viene de una foto: se busca, nunca se crea.
    const nombre = entrante.comercio.toLowerCase();
    emisor =
      (await buscarEmisores(entrante.comercio)).find(
        (e) => e.nombre.toLowerCase() === nombre
      ) ?? null;
  }

  const items = await resolverItems(entrante);
  const hormigas = new Set(
    emisor
      ? await obtenerHormigaHeredada(
          emisor.id,
          items.flatMap((i) => (i.itemCatalogo ? [i.itemCatalogo.id] : []))
        )
      : []
  );

  let datosCfe: EntranteParaRevision["datosCfe"] = null;
  if (entrante.qrTexto && entrante.claveComprobante) {
    const { tipoCfe, serie, numero } = parsearQR(entrante.qrTexto);
    datosCfe = { tipoCfe, serie, numero };
  }

  return {
    id: entrante.id,
    emisor,
    comercio: entrante.comercio,
    fecha: entrante.fecha,
    total: entrante.total,
    datosCfe,
    aviso: entrante.aviso,
    tieneFoto: entrante.imagenRuta !== null,
    lineas: items.map((item) => ({
      nombreTicket: item.nombreTicket,
      precio: item.precio,
      tamanoTicket: item.tamanoTicket,
      unidadesTicket: item.unidadesTicket,
      pesoTicket: item.pesoTicket,
      precioPorKiloTicket: item.precioPorKiloTicket,
      itemCatalogo: item.itemCatalogo,
      categoriaSugerida: item.categoriaSugerida,
      bloqueada: item.itemCatalogo !== null,
      esHormiga:
        item.itemCatalogo !== null && hormigas.has(item.itemCatalogo.id),
    })),
  };
}
