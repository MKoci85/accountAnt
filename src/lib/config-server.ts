import { db } from "@/db";
import { configuracion } from "@/db/schema";
import { eq, like, sql } from "drizzle-orm";
import {
  configDe,
  esProveedorValido,
  PROVEEDOR_POR_DEFECTO,
  type ProveedorIA,
} from "@/lib/proveedores-ia";
import {
  MARGEN_SOBREPRECIO_POR_PESO_DEFAULT,
  MESES_VENTANA_PRECIO_REFERENCIA_DEFAULT,
} from "@/lib/precios-referencia";

export const CLAVE_PROVEEDOR = "ia_proveedor";
export const CLAVE_API_KEY_LEGACY = "ia_api_key";

const PREFIJO_API_KEY = "ia_api_key_";
const PREFIJO_MODELO = "ia_modelo_";

export function claveApiKey(proveedor: ProveedorIA) {
  return `${PREFIJO_API_KEY}${proveedor}`;
}

export function claveModelo(proveedor: ProveedorIA) {
  return `${PREFIJO_MODELO}${proveedor}`;
}

export async function leerConfig(clave: string): Promise<string | null> {
  const [fila] = await db
    .select({ valor: configuracion.valor })
    .from(configuracion)
    .where(eq(configuracion.clave, clave))
    .limit(1);
  const valor = fila?.valor?.trim();
  return valor ? valor : null;
}

export async function escribirConfig(clave: string, valor: string) {
  await db
    .insert(configuracion)
    .values({ clave, valor })
    .onConflictDoUpdate({ target: configuracion.clave, set: { valor } });
}

export async function borrarConfig(clave: string) {
  await db.delete(configuracion).where(eq(configuracion.clave, clave));
}

export async function leerProveedorIA(): Promise<ProveedorIA> {
  const valor = await leerConfig(CLAVE_PROVEEDOR);
  return esProveedorValido(valor) ? valor : PROVEEDOR_POR_DEFECTO;
}

async function migrarKeyLegacy(proveedor: ProveedorIA): Promise<string | null> {
  const legacy = await leerConfig(CLAVE_API_KEY_LEGACY);
  if (!legacy) return null;
  if ((await leerProveedorIA()) !== proveedor) return null;

  db.transaction((tx) => {
    tx.insert(configuracion)
      .values({ clave: claveApiKey(proveedor), valor: legacy })
      .onConflictDoUpdate({
        target: configuracion.clave,
        set: { valor: legacy },
      })
      .run();
    tx.delete(configuracion)
      .where(eq(configuracion.clave, CLAVE_API_KEY_LEGACY))
      .run();
  });

  return legacy;
}

/**
 * Lee la API key del proveedor, migrando la key legacy global si corresponde.
 * @param proveedor proveedor de IA
 * @returns la key, o null si no hay ninguna configurada
 */
export async function leerApiKeyIA(
  proveedor: ProveedorIA,
): Promise<string | null> {
  const propia = await leerConfig(claveApiKey(proveedor));
  if (propia) return propia;
  return migrarKeyLegacy(proveedor);
}

export async function leerModeloIA(proveedor: ProveedorIA): Promise<string> {
  return (
    (await leerConfig(claveModelo(proveedor))) ?? configDe(proveedor).modelo
  );
}

export const CLAVE_LIMITADOR = "ia_limitador_activo";

export async function leerLimitadorActivo(): Promise<boolean> {
  return (await leerConfig(CLAVE_LIMITADOR)) !== "0";
}

export async function escribirLimitadorActivo(activo: boolean) {
  await escribirConfig(CLAVE_LIMITADOR, activo ? "1" : "0");
}

export function claveTpm(proveedor: ProveedorIA, modelo: string) {
  return `ia_tpm_${proveedor}_${modelo}`;
}

export function claveRpd(proveedor: ProveedorIA) {
  return `ia_rpd_${proveedor}`;
}

async function leerCuota(
  clave: string,
  porDefecto: number | undefined,
): Promise<number | null> {
  const valor = await leerConfig(clave);
  const n = valor ? Number(valor) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return porDefecto ?? null;
}

export async function leerTpmEfectivo(
  proveedor: ProveedorIA,
  modelo: string,
): Promise<number | null> {
  return leerCuota(claveTpm(proveedor, modelo), configDe(proveedor).tpmGratuito);
}

export async function leerRpdEfectivo(
  proveedor: ProveedorIA,
): Promise<number | null> {
  return leerCuota(claveRpd(proveedor), configDe(proveedor).rpdGratuito);
}

export async function escribirTpmEfectivo(
  proveedor: ProveedorIA,
  modelo: string,
  tpm: number | null,
) {
  const clave = claveTpm(proveedor, modelo);
  if (tpm && tpm > 0) await escribirConfig(clave, String(Math.floor(tpm)));
  else await borrarConfig(clave);
}

export async function escribirRpdEfectivo(
  proveedor: ProveedorIA,
  rpd: number | null,
) {
  const clave = claveRpd(proveedor);
  if (rpd && rpd > 0) await escribirConfig(clave, String(Math.floor(rpd)));
  else await borrarConfig(clave);
}

export async function leerProveedoresConKey(): Promise<Set<ProveedorIA>> {
  const filas = await db
    .select({ clave: configuracion.clave, valor: configuracion.valor })
    .from(configuracion)
    .where(like(configuracion.clave, sql`${"ia\\_api\\_key\\_%"} ESCAPE '\\'`));

  const conKey = new Set<ProveedorIA>();
  for (const { clave, valor } of filas) {
    if (!valor.trim()) continue;
    const id = clave.slice(PREFIJO_API_KEY.length);
    if (esProveedorValido(id)) conKey.add(id);
  }

  if (await leerConfig(CLAVE_API_KEY_LEGACY)) {
    conKey.add(await leerProveedorIA());
  }

  return conKey;
}

async function leerNumero(clave: string, porDefecto: number): Promise<number> {
  const valor = await leerConfig(clave);
  const n = valor ? Number(valor) : NaN;
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

export const CLAVE_MARGEN_SOBREPRECIO = "precios_margen_sobreprecio_peso";
export const CLAVE_VENTANA_MESES = "precios_ventana_meses_referencia";
export const CLAVE_BCU_DIAS = "bcu_dias_hacia_atras";
export const CLAVE_BCU_URL = "bcu_url_endpoint";
export const CLAVE_BCU_TIMEOUT = "bcu_timeout_ms";
export const CLAVE_DGI_URL = "dgi_url_consulta";
export const CLAVE_IA_TIMEOUT = "ia_timeout_ms";
export const CLAVE_IA_TIMEOUT_CHAT = "ia_timeout_chat_ms";
export const CLAVE_OPENROUTER_REFERER = "ia_openrouter_http_referer";

export const BCU_DIAS_HACIA_ATRAS_DEFAULT = 7;
export const BCU_URL_DEFAULT =
  "https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones";
export const BCU_TIMEOUT_MS_DEFAULT = 15000;
export const DGI_URL_DEFAULT = "https://www.efactura.dgi.gub.uy/consultaQR/cfe";
export const IA_TIMEOUT_MS_DEFAULT = 120000;
export const IA_TIMEOUT_CHAT_MS_DEFAULT = 45000;
export const OPENROUTER_REFERER_DEFAULT = "http://localhost:3000";

export async function leerMargenSobreprecioPeso(): Promise<number> {
  return leerNumero(CLAVE_MARGEN_SOBREPRECIO, MARGEN_SOBREPRECIO_POR_PESO_DEFAULT);
}

export async function escribirMargenSobreprecioPeso(valor: number) {
  await escribirConfig(CLAVE_MARGEN_SOBREPRECIO, String(valor));
}

export async function leerVentanaMesesReferencia(): Promise<number> {
  return leerNumero(CLAVE_VENTANA_MESES, MESES_VENTANA_PRECIO_REFERENCIA_DEFAULT);
}

export async function escribirVentanaMesesReferencia(valor: number) {
  await escribirConfig(CLAVE_VENTANA_MESES, String(valor));
}

export async function leerDiasHaciaAtrasBcu(): Promise<number> {
  return leerNumero(CLAVE_BCU_DIAS, BCU_DIAS_HACIA_ATRAS_DEFAULT);
}

export async function escribirDiasHaciaAtrasBcu(valor: number) {
  await escribirConfig(CLAVE_BCU_DIAS, String(valor));
}

export async function leerUrlBcu(): Promise<string> {
  return (await leerConfig(CLAVE_BCU_URL)) ?? BCU_URL_DEFAULT;
}

export async function escribirUrlBcu(url: string) {
  await escribirConfig(CLAVE_BCU_URL, url);
}

export async function leerTimeoutBcuMs(): Promise<number> {
  return leerNumero(CLAVE_BCU_TIMEOUT, BCU_TIMEOUT_MS_DEFAULT);
}

export async function escribirTimeoutBcuMs(ms: number) {
  await escribirConfig(CLAVE_BCU_TIMEOUT, String(ms));
}

export async function leerUrlDgi(): Promise<string> {
  return (await leerConfig(CLAVE_DGI_URL)) ?? DGI_URL_DEFAULT;
}

export async function escribirUrlDgi(url: string) {
  await escribirConfig(CLAVE_DGI_URL, url);
}

export async function leerTimeoutIaMs(): Promise<number> {
  return leerNumero(CLAVE_IA_TIMEOUT, IA_TIMEOUT_MS_DEFAULT);
}

export async function escribirTimeoutIaMs(ms: number) {
  await escribirConfig(CLAVE_IA_TIMEOUT, String(ms));
}

export async function leerTimeoutIaChatMs(): Promise<number> {
  return leerNumero(CLAVE_IA_TIMEOUT_CHAT, IA_TIMEOUT_CHAT_MS_DEFAULT);
}

export async function escribirTimeoutIaChatMs(ms: number) {
  await escribirConfig(CLAVE_IA_TIMEOUT_CHAT, String(ms));
}

export async function leerOpenRouterReferer(): Promise<string> {
  return (await leerConfig(CLAVE_OPENROUTER_REFERER)) ?? OPENROUTER_REFERER_DEFAULT;
}

export async function escribirOpenRouterReferer(valor: string) {
  await escribirConfig(CLAVE_OPENROUTER_REFERER, valor);
}

const PREFIJO_URL = "ia_url_";

export function claveUrlProveedor(proveedor: ProveedorIA) {
  return `${PREFIJO_URL}${proveedor}`;
}

export async function leerUrlIA(proveedor: ProveedorIA): Promise<string | null> {
  return (
    (await leerConfig(claveUrlProveedor(proveedor))) ??
    configDe(proveedor).baseUrl ??
    null
  );
}

export async function escribirUrlIA(proveedor: ProveedorIA, url: string) {
  const valor = url.trim();
  if (valor) await escribirConfig(claveUrlProveedor(proveedor), valor);
  else await borrarConfig(claveUrlProveedor(proveedor));
}

const PREFIJO_CATALOGO = "ia_modelos_";

export function claveCatalogo(proveedor: ProveedorIA) {
  return `${PREFIJO_CATALOGO}${proveedor}`;
}

export type CatalogoModelos = {
  modelos: string[];
  actualizadoEn: string;
};

export async function leerCatalogoModelos(
  proveedor: ProveedorIA,
): Promise<CatalogoModelos | null> {
  const crudo = await leerConfig(claveCatalogo(proveedor));
  if (!crudo) return null;
  try {
    const json = JSON.parse(crudo);
    if (!Array.isArray(json?.modelos)) return null;
    const modelos = json.modelos.filter(
      (m: unknown): m is string => typeof m === "string" && m.length > 0,
    );
    const actualizadoEn =
      typeof json.actualizadoEn === "string" ? json.actualizadoEn : "";
    return { modelos, actualizadoEn };
  } catch {
    return null;
  }
}

export async function escribirCatalogoModelos(
  proveedor: ProveedorIA,
  modelos: string[],
) {
  const valor: CatalogoModelos = {
    modelos,
    actualizadoEn: new Date().toISOString(),
  };
  await escribirConfig(claveCatalogo(proveedor), JSON.stringify(valor));
}
