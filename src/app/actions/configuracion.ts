"use server";

import { revalidatePath } from "next/cache";
import {
  configDe,
  esProveedorValido,
  PROVEEDORES,
  type ModeloCatalogo,
  type ProveedorIA,
} from "@/lib/proveedores-ia";
import {
  CLAVE_API_KEY_LEGACY,
  CLAVE_PROVEEDOR,
  borrarConfig,
  claveApiKey,
  claveModelo,
  escribirCatalogoModelos,
  leerCatalogoModelos,
  escribirConfig,
  escribirLimitadorActivo,
  escribirRpdEfectivo,
  escribirTpmEfectivo,
  leerApiKeyIA,
  leerLimitadorActivo,
  leerModeloIA,
  leerProveedorIA,
  leerProveedoresConKey,
  leerRpdEfectivo,
  leerTpmEfectivo,
  escribirDiasHaciaAtrasBcu,
  escribirMargenSobreprecioPeso,
  escribirOpenRouterReferer,
  escribirTimeoutBcuMs,
  escribirTimeoutIaChatMs,
  escribirTimeoutIaMs,
  escribirUrlBcu,
  escribirUrlDgi,
  escribirUrlIA,
  escribirVentanaMesesReferencia,
  leerDiasHaciaAtrasBcu,
  leerMargenSobreprecioPeso,
  leerOpenRouterReferer,
  leerTimeoutBcuMs,
  leerTimeoutIaChatMs,
  leerTimeoutIaMs,
  leerUrlBcu,
  leerUrlDgi,
  leerUrlIA,
  leerVentanaMesesReferencia,
  BCU_DIAS_HACIA_ATRAS_DEFAULT,
  BCU_TIMEOUT_MS_DEFAULT,
  BCU_URL_DEFAULT,
  DGI_URL_DEFAULT,
  IA_TIMEOUT_CHAT_MS_DEFAULT,
  IA_TIMEOUT_MS_DEFAULT,
  OPENROUTER_REFERER_DEFAULT,
} from "@/lib/config-server";
import {
  MARGEN_SOBREPRECIO_POR_PESO_DEFAULT,
  MESES_VENTANA_PRECIO_REFERENCIA_DEFAULT,
} from "@/lib/precios-referencia";

export async function obtenerProveedorIA(): Promise<ProveedorIA> {
  return leerProveedorIA();
}

/**
 * @returns Si el proveedor de IA activo tiene una API key configurada.
 */
export async function hayApiKeyIAConfigurada(): Promise<boolean> {
  return (await leerApiKeyIA(await leerProveedorIA())) !== null;
}

function enmascarar(key: string): string {
  const puntos = "•".repeat(Math.max(8, Math.min(key.length - 4, 24)));
  return `${puntos}${key.slice(-4)}`;
}

export type EstadoProveedorIA = {
  proveedor: ProveedorIA;
  guardada: boolean;
  enmascarada: string | null;
  modelo: string;
  modeloPorDefecto: string;
  url: string;
  urlPorDefecto: string;
  tpm: number | null;
  tpmPorDefecto: number | null;
  rpd: number | null;
  rpdPorDefecto: number | null;
  rpmPorDefecto: number | null;
  catalogo: {
    modelos: string[];
    actualizadoEn: string;
    urlListado: string;
  } | null;
};

export async function obtenerEstadoProveedoresIA(): Promise<
  EstadoProveedorIA[]
> {
  const conKey = await leerProveedoresConKey();

  return Promise.all(
    PROVEEDORES.map(async ({ id }) => {
      const guardada = conKey.has(id);
      const key = guardada ? await leerApiKeyIA(id) : null;
      const modelo = await leerModeloIA(id);
      const config = configDe(id);
      return {
        proveedor: id,
        guardada: key !== null,
        enmascarada: key ? enmascarar(key) : null,
        modelo,
        modeloPorDefecto: config.modelo,
        url: (await leerUrlIA(id)) ?? "",
        urlPorDefecto: config.baseUrl ?? "",
        tpm: await leerTpmEfectivo(id, modelo),
        tpmPorDefecto: config.tpmGratuito ?? null,
        rpd: await leerRpdEfectivo(id),
        rpdPorDefecto: config.rpdGratuito ?? null,
        rpmPorDefecto: config.rpmGratuito ?? null,
        catalogo: config.catalogo
          ? {
              ...((await leerCatalogoModelos(id)) ?? {
                modelos: [],
                actualizadoEn: "",
              }),
              urlListado: config.catalogo.urlListado,
            }
          : null,
      };
    }),
  );
}

export type ProveedorDisponibleIA = {
  id: ProveedorIA;
  nombre: string;
  modelo: string;
  modelosSugeridos: string[];
};

export async function obtenerProveedoresDisponiblesIA(): Promise<{
  activo: ProveedorIA;
  disponibles: ProveedorDisponibleIA[];
}> {
  const conKey = await leerProveedoresConKey();
  const activo = await leerProveedorIA();

  const disponibles: ProveedorDisponibleIA[] = [];
  for (const { id, nombre } of PROVEEDORES) {
    if (!conKey.has(id)) continue;
    if (!(await leerApiKeyIA(id))) continue;
    const modelo = await leerModeloIA(id);
    const catalogo = (await leerCatalogoModelos(id))?.modelos ?? [];
    disponibles.push({
      id,
      nombre,
      modelo,
      modelosSugeridos: [...new Set([modelo, ...catalogo])],
    });
  }

  return { activo, disponibles };
}

export async function obtenerLimitadorIA(): Promise<boolean> {
  return leerLimitadorActivo();
}

export async function guardarLimitadorIA(activo: boolean) {
  await escribirLimitadorActivo(activo);
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
}

export async function guardarApiKeyIA(proveedor: ProveedorIA, apiKey: string) {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  const key = apiKey.trim();
  if (!key) throw new Error("La API key no puede estar vacía");

  await escribirConfig(claveApiKey(proveedor), key);
  await limpiarLegacySi(proveedor);

  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
}

export async function borrarApiKeyIA(proveedor: ProveedorIA) {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  await borrarConfig(claveApiKey(proveedor));
  await limpiarLegacySi(proveedor);
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
}

async function limpiarLegacySi(proveedor: ProveedorIA) {
  if ((await leerProveedorIA()) === proveedor) {
    await borrarConfig(CLAVE_API_KEY_LEGACY);
  }
}

export async function guardarModeloIA(proveedor: ProveedorIA, modelo: string) {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  const valor = modelo.trim();
  if (valor) await escribirConfig(claveModelo(proveedor), valor);
  else await borrarConfig(claveModelo(proveedor));

  revalidatePath("/ajustes");
}

export async function guardarTpmIA(
  proveedor: ProveedorIA,
  modelo: string,
  tpm: number | null,
) {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  if (tpm !== null && (!Number.isFinite(tpm) || tpm <= 0)) {
    throw new Error("El TPM tiene que ser un número mayor que cero");
  }
  await escribirTpmEfectivo(proveedor, modelo.trim() || (await leerModeloIA(proveedor)), tpm);
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
  revalidatePath("/reportes/asistente");
}

export async function guardarRpdIA(proveedor: ProveedorIA, rpd: number | null) {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  if (rpd !== null && (!Number.isFinite(rpd) || rpd <= 0)) {
    throw new Error("El límite diario tiene que ser un número mayor que cero");
  }
  await escribirRpdEfectivo(proveedor, rpd);
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
  revalidatePath("/reportes/asistente");
}

export async function guardarProveedorActivoIA(proveedor: ProveedorIA) {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  await leerApiKeyIA(await leerProveedorIA());

  await escribirConfig(CLAVE_PROVEEDOR, proveedor);
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
}

export type ConfigAvanzada = {
  margenSobreprecioPeso: number;
  margenSobreprecioPesoPorDefecto: number;
  ventanaMesesReferencia: number;
  ventanaMesesReferenciaPorDefecto: number;
  bcuDiasHaciaAtras: number;
  bcuDiasHaciaAtrasPorDefecto: number;
  bcuUrl: string;
  bcuUrlPorDefecto: string;
  bcuTimeoutMs: number;
  bcuTimeoutMsPorDefecto: number;
  dgiUrl: string;
  dgiUrlPorDefecto: string;
  iaTimeoutMs: number;
  iaTimeoutMsPorDefecto: number;
  iaTimeoutChatMs: number;
  iaTimeoutChatMsPorDefecto: number;
  openRouterReferer: string;
  openRouterRefererPorDefecto: string;
};

export async function obtenerConfigAvanzada(): Promise<ConfigAvanzada> {
  return {
    margenSobreprecioPeso: await leerMargenSobreprecioPeso(),
    margenSobreprecioPesoPorDefecto: MARGEN_SOBREPRECIO_POR_PESO_DEFAULT,
    ventanaMesesReferencia: await leerVentanaMesesReferencia(),
    ventanaMesesReferenciaPorDefecto: MESES_VENTANA_PRECIO_REFERENCIA_DEFAULT,
    bcuDiasHaciaAtras: await leerDiasHaciaAtrasBcu(),
    bcuDiasHaciaAtrasPorDefecto: BCU_DIAS_HACIA_ATRAS_DEFAULT,
    bcuUrl: await leerUrlBcu(),
    bcuUrlPorDefecto: BCU_URL_DEFAULT,
    bcuTimeoutMs: await leerTimeoutBcuMs(),
    bcuTimeoutMsPorDefecto: BCU_TIMEOUT_MS_DEFAULT,
    dgiUrl: await leerUrlDgi(),
    dgiUrlPorDefecto: DGI_URL_DEFAULT,
    iaTimeoutMs: await leerTimeoutIaMs(),
    iaTimeoutMsPorDefecto: IA_TIMEOUT_MS_DEFAULT,
    iaTimeoutChatMs: await leerTimeoutIaChatMs(),
    iaTimeoutChatMsPorDefecto: IA_TIMEOUT_CHAT_MS_DEFAULT,
    openRouterReferer: await leerOpenRouterReferer(),
    openRouterRefererPorDefecto: OPENROUTER_REFERER_DEFAULT,
  };
}

function numeroPositivo(valor: number, nombre: string): number {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`${nombre} tiene que ser un número mayor que cero`);
  }
  return valor;
}

function textoNoVacio(valor: string, nombre: string): string {
  const limpio = valor.trim();
  if (!limpio) throw new Error(`${nombre} no puede estar vacío`);
  return limpio;
}

export async function guardarMargenSobreprecioPeso(valor: number) {
  await escribirMargenSobreprecioPeso(
    numeroPositivo(valor, "El margen de sobreprecio"),
  );
  revalidatePath("/ajustes");
  revalidatePath("/reportes");
  revalidatePath("/gastos");
}

export async function guardarVentanaMesesReferencia(valor: number) {
  await escribirVentanaMesesReferencia(
    numeroPositivo(valor, "La ventana de meses"),
  );
  revalidatePath("/ajustes");
  revalidatePath("/reportes");
  revalidatePath("/gastos");
}

export async function guardarDiasHaciaAtrasBcu(valor: number) {
  await escribirDiasHaciaAtrasBcu(numeroPositivo(valor, "Los días hacia atrás"));
  revalidatePath("/ajustes");
}

export async function guardarUrlBcu(url: string) {
  await escribirUrlBcu(textoNoVacio(url, "La URL del BCU"));
  revalidatePath("/ajustes");
}

export async function guardarTimeoutBcuMs(ms: number) {
  await escribirTimeoutBcuMs(numeroPositivo(ms, "El timeout del BCU"));
  revalidatePath("/ajustes");
}

export async function guardarUrlDgi(url: string) {
  await escribirUrlDgi(textoNoVacio(url, "La URL de DGI"));
  revalidatePath("/ajustes");
}

export async function guardarTimeoutIaMs(ms: number) {
  await escribirTimeoutIaMs(numeroPositivo(ms, "El timeout de IA"));
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
}

export async function guardarTimeoutIaChatMs(ms: number) {
  await escribirTimeoutIaChatMs(numeroPositivo(ms, "El timeout del chat"));
  revalidatePath("/ajustes");
}

export async function guardarOpenRouterReferer(valor: string) {
  await escribirOpenRouterReferer(textoNoVacio(valor, "El HTTP-Referer"));
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
}

export async function guardarUrlProveedorIA(
  proveedor: ProveedorIA,
  url: string,
) {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  await escribirUrlIA(proveedor, url);
  revalidatePath("/ajustes");
  revalidatePath("/estado-cuenta");
}

/**
 * Refresca el catálogo de modelos gratuitos de un proveedor desde su
 * endpoint público de `/models`. No consume cuota del limitador.
 * @param proveedor Proveedor cuyo catálogo actualizar.
 * @returns Si se pudo actualizar, un mensaje descriptivo y los modelos encontrados.
 */
export async function actualizarModelosProveedor(
  proveedor: ProveedorIA,
): Promise<{ ok: boolean; mensaje: string; modelos: string[] }> {
  if (!esProveedorValido(proveedor)) {
    throw new Error("Proveedor de IA desconocido");
  }
  const config = configDe(proveedor);
  const { catalogo } = config;
  if (!catalogo) {
    return {
      ok: false,
      mensaje: `${config.nombre} no publica un catálogo de modelos actualizable.`,
      modelos: [],
    };
  }

  let filas: ModeloCatalogo[];
  try {
    const r = await fetch(catalogo.url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(await leerTimeoutIaMs()),
    });
    if (!r.ok) {
      return {
        ok: false,
        mensaje: `${config.nombre} respondió ${r.status} al pedir el catálogo. El modelo se puede escribir a mano igual.`,
        modelos: [],
      };
    }
    const json = await r.json();
    if (!Array.isArray(json?.data)) {
      return {
        ok: false,
        mensaje: `El catálogo de ${config.nombre} vino con un formato inesperado. El modelo se puede escribir a mano igual.`,
        modelos: [],
      };
    }
    filas = json.data;
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      mensaje: timeout
        ? `${config.nombre} tardó demasiado en responder el catálogo.`
        : `No se pudo consultar el catálogo de ${config.nombre}. El modelo se puede escribir a mano igual.`,
      modelos: [],
    };
  }

  const modelos = filas
    .filter((m) => catalogo.esGratuito(m))
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort();

  if (modelos.length === 0) {
    return {
      ok: false,
      mensaje: `${config.nombre} no está listando modelos gratuitos ahora mismo. Se dejan las sugerencias anteriores.`,
      modelos: [],
    };
  }

  await escribirCatalogoModelos(proveedor, modelos);
  revalidatePath("/ajustes");

  const plural = modelos.length === 1 ? "modelo gratuito" : "modelos gratuitos";
  return {
    ok: true,
    mensaje: `${modelos.length} ${plural} de ${config.nombre}.`,
    modelos,
  };
}
