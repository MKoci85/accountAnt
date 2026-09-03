"use server";

import { db } from "@/db";
import {
  categorias,
  emisores,
  proveedoresCfe,
  itemsCatalogo,
  gastos,
  gastoItems,
  gastosFijos,
} from "@/db/schema";
import { and, asc, eq, like, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { FormatoProveedorCfe } from "@/lib/procesadores";

function revalidarCatalogos() {
  revalidatePath("/gastos/nuevo");
  revalidatePath("/catalogos");
  revalidatePath("/gastos");
  revalidatePath("/");
}

function mensajeError(e: unknown, fallback: string) {
  if (e instanceof Error) {
    if (e.message.includes("UNIQUE")) return "duplicado";
    return e.message;
  }
  return fallback;
}

export async function listarCategorias() {
  return db.select().from(categorias).orderBy(asc(categorias.nombre));
}

export async function crearCategoria(datos: {
  nombre: string;
  color?: string;
  descripcion?: string;
  esServicio?: boolean;
}) {
  const nombreLimpio = datos.nombre.trim();
  if (!nombreLimpio) throw new Error("El nombre de la categoría es obligatorio");

  try {
    const [categoria] = await db
      .insert(categorias)
      .values({
        nombre: nombreLimpio,
        color: datos.color?.trim() || null,
        descripcion: datos.descripcion?.trim() || null,
        esServicio: datos.esServicio ?? false,
      })
      .returning();

    revalidarCatalogos();
    return categoria;
  } catch (e) {
    if (mensajeError(e, "") === "duplicado") {
      throw new Error(`Ya existe una categoría llamada "${nombreLimpio}"`);
    }
    throw e;
  }
}

export async function editarCategoria(
  id: number,
  datos: {
    nombre: string;
    color?: string;
    descripcion?: string;
    esServicio?: boolean;
  }
) {
  const nombreLimpio = datos.nombre.trim();
  if (!nombreLimpio) throw new Error("El nombre de la categoría es obligatorio");

  try {
    const [categoria] = await db
      .update(categorias)
      .set({
        nombre: nombreLimpio,
        color: datos.color?.trim() || null,
        descripcion: datos.descripcion?.trim() || null,
        esServicio: datos.esServicio ?? false,
      })
      .where(eq(categorias.id, id))
      .returning();

    revalidarCatalogos();
    return categoria;
  } catch (e) {
    if (mensajeError(e, "") === "duplicado") {
      throw new Error(`Ya existe una categoría llamada "${nombreLimpio}"`);
    }
    throw e;
  }
}

/**
 * Sugiere una categoría a partir de un texto libre, buscando palabra por
 * palabra contra la descripción de cada categoría.
 * @param texto Texto a analizar (p. ej. una línea de ticket).
 * @returns La categoría sugerida, o null si ninguna coincide.
 */
export async function sugerirCategoriaPorTexto(texto: string) {
  const palabras = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3);
  if (palabras.length === 0) return null;

  const conDescripcion = await db
    .select()
    .from(categorias)
    .where(sql`${categorias.descripcion} is not null`);

  for (const categoria of conDescripcion) {
    const descripcionNormalizada = (categoria.descripcion ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    const coincide = palabras.some((palabra) =>
      new RegExp(`\\b${palabra}\\b`).test(descripcionNormalizada)
    );
    if (coincide) return categoria;
  }

  return null;
}

export async function borrarCategoria(id: number) {
  const [enItems] = await db
    .select({ id: itemsCatalogo.id })
    .from(itemsCatalogo)
    .where(eq(itemsCatalogo.categoriaId, id))
    .limit(1);
  if (enItems) {
    throw new Error(
      "No se puede borrar: hay ítems del catálogo que usan esta categoría"
    );
  }

  const [enGastoItems] = await db
    .select({ id: gastoItems.id })
    .from(gastoItems)
    .where(eq(gastoItems.categoriaId, id))
    .limit(1);
  if (enGastoItems) {
    throw new Error(
      "No se puede borrar: hay gastos cargados con esta categoría"
    );
  }

  const [enGastosFijos] = await db
    .select({ nombre: gastosFijos.nombre })
    .from(gastosFijos)
    .where(eq(gastosFijos.categoriaId, id))
    .limit(1);
  if (enGastosFijos) {
    throw new Error(
      `No se puede borrar: la usa el gasto fijo "${enGastosFijos.nombre}"`
    );
  }

  await db.delete(categorias).where(eq(categorias.id, id));
  revalidarCatalogos();
}

export async function listarItemsCatalogo() {
  return db
    .select({
      id: itemsCatalogo.id,
      nombre: itemsCatalogo.nombre,
      marca: itemsCatalogo.marca,
      tamano: itemsCatalogo.tamano,
      descripcion: itemsCatalogo.descripcion,
      categoriaId: itemsCatalogo.categoriaId,
      categoriaNombre: categorias.nombre,
    })
    .from(itemsCatalogo)
    .innerJoin(categorias, eq(itemsCatalogo.categoriaId, categorias.id))
    .orderBy(asc(itemsCatalogo.nombre));
}

/**
 * Busca un ítem de catálogo por nombre exacto (case-insensitive) o, si no hay
 * match, por coincidencia de substring contra su descripción.
 * @param nombre Nombre a buscar.
 * @returns El ítem con su categoría, o null si no hay match.
 */
export async function buscarItemPorNombreExacto(nombre: string) {
  const seleccion = {
    id: itemsCatalogo.id,
    nombre: itemsCatalogo.nombre,
    marca: itemsCatalogo.marca,
    tamano: itemsCatalogo.tamano,
    descripcion: itemsCatalogo.descripcion,
    categoriaId: itemsCatalogo.categoriaId,
    categoriaNombre: categorias.nombre,
  };

  const [porNombre] = await db
    .select(seleccion)
    .from(itemsCatalogo)
    .innerJoin(categorias, eq(itemsCatalogo.categoriaId, categorias.id))
    .where(sql`lower(${itemsCatalogo.nombre}) = lower(${nombre})`)
    .limit(1);
  if (porNombre) return porNombre;

  const [porDescripcion] = await db
    .select(seleccion)
    .from(itemsCatalogo)
    .innerJoin(categorias, eq(itemsCatalogo.categoriaId, categorias.id))
    .where(
      sql`${itemsCatalogo.descripcion} is not null and (
        instr(lower(${itemsCatalogo.descripcion}), lower(${nombre})) > 0
        or instr(lower(${nombre}), lower(${itemsCatalogo.descripcion})) > 0
      )`
    )
    .limit(1);
  return porDescripcion ?? null;
}

export async function crearItemCatalogo(datos: {
  nombre: string;
  marca?: string;
  tamano?: string;
  descripcion?: string;
  categoriaId: number;
}) {
  const nombreLimpio = datos.nombre.trim().toUpperCase();
  if (!nombreLimpio) throw new Error("El nombre del ítem es obligatorio");

  const [item] = await db
    .insert(itemsCatalogo)
    .values({
      nombre: nombreLimpio,
      marca: datos.marca?.trim().toUpperCase() || null,
      tamano: datos.tamano?.trim().toUpperCase() || null,
      descripcion: datos.descripcion?.trim() || null,
      categoriaId: datos.categoriaId,
    })
    .returning();

  revalidarCatalogos();
  return item;
}

export async function editarItemCatalogo(
  id: number,
  datos: {
    nombre: string;
    marca?: string;
    tamano?: string;
    descripcion?: string;
    categoriaId: number;
  }
) {
  const nombreLimpio = datos.nombre.trim().toUpperCase();
  if (!nombreLimpio) throw new Error("El nombre del ítem es obligatorio");

  const [itemActual] = await db
    .select({ categoriaId: itemsCatalogo.categoriaId })
    .from(itemsCatalogo)
    .where(eq(itemsCatalogo.id, id))
    .limit(1);

  const item = db.transaction((tx) => {
    const [actualizado] = tx
      .update(itemsCatalogo)
      .set({
        nombre: nombreLimpio,
        marca: datos.marca?.trim().toUpperCase() || null,
        tamano: datos.tamano?.trim().toUpperCase() || null,
        descripcion: datos.descripcion?.trim() || null,
        categoriaId: datos.categoriaId,
      })
      .where(eq(itemsCatalogo.id, id))
      .returning()
      .all();

    if (itemActual && itemActual.categoriaId !== datos.categoriaId) {
      tx.update(gastoItems)
        .set({ categoriaId: datos.categoriaId })
        .where(
          and(
            eq(gastoItems.itemCatalogoId, id),
            eq(gastoItems.categoriaId, itemActual.categoriaId)
          )
        )
        .run();
    }

    return actualizado;
  });

  revalidarCatalogos();
  return item;
}

export async function borrarItemCatalogo(id: number) {
  const [enUso] = await db
    .select({ id: gastoItems.id })
    .from(gastoItems)
    .where(eq(gastoItems.itemCatalogoId, id))
    .limit(1);
  if (enUso) {
    throw new Error("No se puede borrar: hay gastos cargados con este ítem");
  }

  await db.delete(itemsCatalogo).where(eq(itemsCatalogo.id, id));
  revalidarCatalogos();
}

export async function buscarItemsCatalogo(query: string) {
  const q = query.trim();
  if (!q) return [];

  const patron = `%${q}%`;
  return db
    .select({
      id: itemsCatalogo.id,
      nombre: itemsCatalogo.nombre,
      marca: itemsCatalogo.marca,
      tamano: itemsCatalogo.tamano,
      descripcion: itemsCatalogo.descripcion,
      categoriaId: itemsCatalogo.categoriaId,
      categoriaNombre: categorias.nombre,
    })
    .from(itemsCatalogo)
    .innerJoin(categorias, eq(itemsCatalogo.categoriaId, categorias.id))
    .where(
      or(
        like(itemsCatalogo.nombre, patron),
        like(itemsCatalogo.marca, patron),
        like(itemsCatalogo.descripcion, patron)
      )
    )
    .orderBy(asc(itemsCatalogo.nombre))
    .limit(10);
}

export async function listarProveedoresCfe() {
  return db.select().from(proveedoresCfe).orderBy(asc(proveedoresCfe.nombre));
}

/**
 * Busca un proveedor de CFE por nombre (case-insensitive) o lo crea si no existe.
 * @returns El proveedor existente o el recién creado.
 */
export async function obtenerOCrearProveedorCfe(datos: {
  nombre: string;
  urlConsulta: string;
  formato: FormatoProveedorCfe;
}) {
  const nombreLimpio = datos.nombre.trim();
  const urlLimpia = datos.urlConsulta.trim();
  if (!nombreLimpio) throw new Error("El nombre del proveedor es obligatorio");
  if (!urlLimpia) throw new Error("La URL de consulta es obligatoria");

  const [existente] = await db
    .select()
    .from(proveedoresCfe)
    .where(sql`lower(${proveedoresCfe.nombre}) = lower(${nombreLimpio})`)
    .limit(1);
  if (existente) return existente;

  const [creado] = await db
    .insert(proveedoresCfe)
    .values({ nombre: nombreLimpio, urlConsulta: urlLimpia, formato: datos.formato })
    .returning();

  revalidarCatalogos();
  return creado;
}

export async function editarProveedorCfe(
  id: number,
  datos: { nombre: string; urlConsulta: string; formato: FormatoProveedorCfe }
) {
  const nombreLimpio = datos.nombre.trim();
  const urlLimpia = datos.urlConsulta.trim();
  if (!nombreLimpio) throw new Error("El nombre del proveedor es obligatorio");
  if (!urlLimpia) throw new Error("La URL de consulta es obligatoria");

  const [choque] = await db
    .select({ nombre: proveedoresCfe.nombre })
    .from(proveedoresCfe)
    .where(
      and(
        sql`lower(${proveedoresCfe.nombre}) = lower(${nombreLimpio})`,
        ne(proveedoresCfe.id, id)
      )
    )
    .limit(1);
  if (choque) {
    throw new Error(`Ya existe un proveedor de CFE llamado "${choque.nombre}"`);
  }

  const [proveedor] = await db
    .update(proveedoresCfe)
    .set({ nombre: nombreLimpio, urlConsulta: urlLimpia, formato: datos.formato })
    .where(eq(proveedoresCfe.id, id))
    .returning();

  revalidarCatalogos();
  return proveedor;
}

export async function borrarProveedorCfe(id: number) {
  const enUso = await db
    .select({ nombre: emisores.nombre })
    .from(emisores)
    .where(eq(emisores.proveedorCfeId, id));

  if (enUso.length > 0) {
    const nombres = enUso.slice(0, 3).map((e) => e.nombre).join(", ");
    const resto = enUso.length > 3 ? ` y ${enUso.length - 3} más` : "";
    throw new Error(
      `No se puede borrar: lo usan ${enUso.length} comercio(s) (${nombres}${resto})`
    );
  }

  await db.delete(proveedoresCfe).where(eq(proveedoresCfe.id, id));
  revalidarCatalogos();
}

export async function listarEmisores() {
  return db.select().from(emisores).orderBy(asc(emisores.nombre));
}

export async function buscarEmisores(query: string) {
  const q = query.trim();
  if (!q) return [];

  return db
    .select()
    .from(emisores)
    .where(and(like(emisores.nombre, `%${q}%`), eq(emisores.esGenerico, false)))
    .orderBy(asc(emisores.nombre))
    .limit(10);
}

function normalizarRuc(ruc: string) {
  return ruc.replace(/\D/g, "");
}

async function verificarRucLibre(ruc: string, idExcluido?: number) {
  const condicion =
    idExcluido === undefined
      ? eq(emisores.ruc, ruc)
      : and(eq(emisores.ruc, ruc), ne(emisores.id, idExcluido));

  const [duenio] = await db
    .select({ nombre: emisores.nombre })
    .from(emisores)
    .where(condicion)
    .limit(1);

  if (duenio) {
    throw new Error(
      `El RUC "${ruc}" ya pertenece al emisor "${duenio.nombre}"`
    );
  }
}

export async function crearEmisor(datos: {
  nombre: string;
  ruc?: string;
  proveedorCfeId?: number | null;
}) {
  const nombreLimpio = datos.nombre.trim();
  if (!nombreLimpio) throw new Error("El nombre es obligatorio");

  const rucLimpio = normalizarRuc(datos.ruc ?? "") || null;
  if (rucLimpio) await verificarRucLibre(rucLimpio);

  const [emisor] = await db
    .insert(emisores)
    .values({
      nombre: nombreLimpio,
      ruc: rucLimpio,
      proveedorCfeId: datos.proveedorCfeId ?? null,
    })
    .returning();

  revalidarCatalogos();
  return emisor;
}

export async function obtenerEmisorPorRuc(ruc: string) {
  const [emisor] = await db
    .select()
    .from(emisores)
    .where(eq(emisores.ruc, normalizarRuc(ruc)))
    .limit(1);
  return emisor ?? null;
}

/**
 * @returns La fila completa del emisor, o null si no existe.
 */
export async function obtenerEmisor(id: number) {
  const [emisor] = await db
    .select()
    .from(emisores)
    .where(eq(emisores.id, id))
    .limit(1);
  return emisor ?? null;
}

/**
 * @returns El emisor junto con nombre, URL de consulta y formato de su proveedor de CFE.
 */
export async function obtenerEmisorConProveedor(id: number) {
  const [fila] = await db
    .select({
      emisor: emisores,
      proveedorNombre: proveedoresCfe.nombre,
      urlConsulta: proveedoresCfe.urlConsulta,
      formato: proveedoresCfe.formato,
    })
    .from(emisores)
    .leftJoin(proveedoresCfe, eq(emisores.proveedorCfeId, proveedoresCfe.id))
    .where(eq(emisores.id, id))
    .limit(1);
  return fila ?? null;
}

export async function crearEmisorPorRuc(datos: { ruc: string; nombre: string }) {
  const rucLimpio = normalizarRuc(datos.ruc);
  await verificarRucLibre(rucLimpio);

  const [emisor] = await db
    .insert(emisores)
    .values({ nombre: datos.nombre, ruc: rucLimpio })
    .returning();

  revalidarCatalogos();
  return emisor;
}

/**
 * Mapea un emisor a su proveedor de CFE, creando el proveedor si no existe.
 */
export async function guardarProveedorEmisor(
  id: number,
  datos: { nombre: string; urlConsulta: string; formato: FormatoProveedorCfe }
) {
  const proveedor = await obtenerOCrearProveedorCfe(datos);

  const [emisor] = await db
    .update(emisores)
    .set({ proveedorCfeId: proveedor.id })
    .where(eq(emisores.id, id))
    .returning();

  revalidarCatalogos();
  return emisor;
}

export async function obtenerOCrearEmisorGenerico() {
  const [existente] = await db
    .select()
    .from(emisores)
    .where(eq(emisores.esGenerico, true))
    .limit(1);
  if (existente) return existente;

  const [creado] = await db
    .insert(emisores)
    .values({ nombre: "Varios", esGenerico: true })
    .returning();
  revalidarCatalogos();
  return creado;
}

export async function editarEmisor(
  id: number,
  datos: { nombre: string; ruc?: string; proveedorCfeId?: number | null }
) {
  const nombreLimpio = datos.nombre.trim();
  if (!nombreLimpio) throw new Error("El nombre es obligatorio");

  const rucLimpio = normalizarRuc(datos.ruc ?? "") || null;
  if (rucLimpio) await verificarRucLibre(rucLimpio, id);

  const [emisor] = await db
    .update(emisores)
    .set({
      nombre: nombreLimpio,
      ruc: rucLimpio,
      proveedorCfeId: datos.proveedorCfeId ?? null,
    })
    .where(eq(emisores.id, id))
    .returning();

  revalidarCatalogos();
  return emisor;
}

export async function borrarEmisor(id: number) {
  const [enUso] = await db
    .select({ id: gastos.id })
    .from(gastos)
    .where(eq(gastos.emisorId, id))
    .limit(1);
  if (enUso) {
    throw new Error("No se puede borrar: hay gastos cargados con este emisor");
  }

  const [enGastosFijos] = await db
    .select({ nombre: gastosFijos.nombre })
    .from(gastosFijos)
    .where(eq(gastosFijos.emisorId, id))
    .limit(1);
  if (enGastosFijos) {
    throw new Error(
      `No se puede borrar: lo usa el gasto fijo "${enGastosFijos.nombre}"`
    );
  }

  await db.delete(emisores).where(eq(emisores.id, id));
  revalidarCatalogos();
}
