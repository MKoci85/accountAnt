"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  FileUp,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Fuel,
  Store,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import type { ProveedorIA } from "@/lib/proveedores-ia";
import {
  analizarEstadoCuenta,
  analizarEstadoCuentaConIA,
  importarMovimientos,
  type AnalisisEstadoCuenta,
  type LineaAnalizada,
} from "@/app/actions/estado-cuenta";
import type { categorias } from "@/db/schema";
import { formatearMonto, formatearFechaCorta, parsearMonto } from "@/lib/formato";
import { EsperandoIA, BloqueoIA } from "@/components/esperando-ia";
import {
  LIMITE_SUBIDA_BYTES,
  excedeLimite,
  formatearTamano,
} from "@/lib/subidas";

function formatearPesos(monto: number) {
  return formatearMonto(monto, { decimales: 2 });
}

type Categoria = typeof categorias.$inferSelect;

type LineaEditable = LineaAnalizada & {
  incluir: boolean;
  descripcionEditada: string;
  montoEditado: string;
};

const GRUPOS = [
  {
    estado: "directo" as const,
    titulo: "Rubros directos",
    descripcion:
      "Combustible, telepeaje y suscripciones: se reconocen solos y no matchean con nada ya cargado.",
    icono: Fuel,
  },
  {
    estado: "faltante" as const,
    titulo: "Faltantes",
    descripcion:
      "No matchean con ningún gasto ya cargado. Se importan como gasto sin detalle de ítems.",
    icono: Store,
  },
  {
    estado: "ya_registrada" as const,
    titulo: "Ya registradas",
    descripcion:
      "Matchean con un gasto que ya está en la base. Se omiten salvo que las marques.",
    icono: CheckCircle2,
  },
  {
    estado: "sin_cotizacion" as const,
    titulo: "Sin cotización",
    descripcion:
      "Compras en dólares que el BCU no pudo convertir. Ingresá el monto en pesos a mano.",
    icono: CircleAlert,
  },
];

export function EstadoCuentaView({
  categorias,
  proveedoresIA,
  proveedorActivoIA,
}: {
  categorias: Categoria[];
  proveedoresIA: { id: ProveedorIA; nombre: string; modelo: string }[];
  proveedorActivoIA: ProveedorIA;
}) {
  const hayApiKeyIA = proveedoresIA.length > 0;
  const [analisis, setAnalisis] = useState<AnalisisEstadoCuenta | null>(null);
  const [lineas, setLineas] = useState<LineaEditable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const importadosURL = Number(useSearchParams().get("importados"));
  const [resultado, setResultado] = useState<string | null>(
    Number.isInteger(importadosURL) && importadosURL > 0
      ? `Listo: ${importadosURL} ${importadosURL === 1 ? "movimiento importado y revisado" : "movimientos importados y revisados"}.`
      : null,
  );
  const [analizando, setAnalizando] = useState(false);
  const [analizadoConIA, setAnalizadoConIA] = useState(false);
  const [usarIA, setUsarIA] = useState(false);
  const [proveedorIA, setProveedorIA] = useState<ProveedorIA>(
    proveedoresIA.some((p) => p.id === proveedorActivoIA)
      ? proveedorActivoIA
      : (proveedoresIA[0]?.id ?? proveedorActivoIA),
  );
  const iaHabilitada = usarIA && hayApiKeyIA;
  const [importando, startImportacion] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  async function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setResultado(null);
    setAnalizando(true);
    try {
      if (excedeLimite(file)) {
        setError(
          `El PDF pesa ${formatearTamano(file.size)} y el máximo es ${formatearTamano(LIMITE_SUBIDA_BYTES)}. Imprimí solo el detalle de movimientos, sin los adjuntos del resumen.`,
        );
        setAnalisis(null);
        return;
      }

      const conIA = usarIA && hayApiKeyIA;
      setAnalizadoConIA(conIA);
      let resultado: AnalisisEstadoCuenta & { errorIA?: string };

      if (conIA) {
        resultado = await analizarEstadoCuentaConIA(
          { buffer: await file.arrayBuffer() },
          proveedorIA,
        );

        if (resultado.errorIA) {
          setError(resultado.errorIA);
          setAnalisis(null);
          return;
        }
      } else {
        resultado = await analizarEstadoCuenta(await file.arrayBuffer());
      }

      if (!resultado.lineas.length) {
        setError(
          conIA
            ? "La IA no encontró movimientos en el PDF."
            : hayApiKeyIA
              ? 'No se encontraron movimientos en el PDF. ¿Es el detalle del estado de cuenta? Probá marcando "Analizar con IA".'
              : "No se encontraron movimientos en el PDF. ¿Es el detalle del estado de cuenta?",
        );
        setAnalisis(null);
        return;
      }
      setAnalisis(resultado);
      setLineas(
        resultado.lineas.map((l) => ({
          ...l,
          incluir: l.estado === "directo" || l.estado === "faltante",
          descripcionEditada: l.descripcion,
          montoEditado: l.montoPesos !== null ? String(l.montoPesos) : "",
        })),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo leer el PDF",
      );
      setAnalisis(null);
    } finally {
      setAnalizando(false);
    }
  }

  function marcarGrupo(estado: LineaAnalizada["estado"], incluir: boolean) {
    setLineas((prev) =>
      prev.map((l) => (l.estado === estado ? { ...l, incluir } : l)),
    );
  }

  function actualizar(indice: number, cambios: Partial<LineaEditable>) {
    setLineas((prev) =>
      prev.map((l) => (l.indice === indice ? { ...l, ...cambios } : l)),
    );
  }

  function montoFinal(linea: LineaEditable): number | null {
    const editado = parsearMonto(linea.montoEditado);
    return editado !== null && editado > 0 ? editado : null;
  }

  function montoInvalido(linea: LineaEditable) {
    return linea.incluir && montoFinal(linea) === null;
  }

  const seleccionadas = lineas.filter(
    (l) => l.incluir && montoFinal(l) !== null,
  );
  const totalSeleccionado = seleccionadas.reduce(
    (acc, l) => acc + (montoFinal(l) ?? 0),
    0,
  );
  const conMontoInvalido = lineas.filter(montoInvalido).length;

  function handleImportar() {
    setError(null);
    startImportacion(async () => {
      try {
        const seleccion = seleccionadas.map((l) => ({
          indice: l.indice,
          fecha: l.fecha,
          descripcion: l.descripcionEditada.trim() || l.descripcion,
          montoPesos: montoFinal(l)!,
          emisorNombre: l.emisorSugerido,
          categoriaId: l.categoriaId ?? categorias[0].id,
          aliasOriginal: l.emisorDesdeTexto ? l.descripcion : undefined,
        }));
        const r = await importarMovimientos(seleccion);
        if (!r.gastoIds.length) {
          setResultado(`Se importaron ${r.importados} movimientos.`);
          setAnalisis(null);
          setLineas([]);
          return;
        }
        const cola = r.gastoIds.join(",");
        router.push(
          `/gastos/${r.gastoIds[0]}/editar?revision=${cola}&paso=0${
            analizadoConIA ? "&detalle=1" : ""
          }`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo importar");
      }
    });
  }

  function handleCancelar() {
    setAnalisis(null);
    setLineas([]);
    setError(null);
    setResultado(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="relative px-5 py-4.5">
        {analizando && <BloqueoIA texto="Analizando con IA…" />}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="text-sm font-semibold">
            Estado de cuenta de la tarjeta
          </span>
          {hayApiKeyIA ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <input
                type="checkbox"
                checked={usarIA}
                onChange={(e) => setUsarIA(e.target.checked)}
                disabled={analizando}
                className="h-3.5 w-3.5 accent-primary"
              />
              <Sparkles className="h-3.5 w-3.5" />
              Analizar con IA
            </label>
          ) : (
            <span
              className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground/60"
              title="Requiere una API key de IA configurada en Ajustes"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Analizar con IA ·{" "}
              <Link
                href="/ajustes"
                className="font-medium text-primary hover:underline"
              >
                configurar
              </Link>
            </span>
          )}
        </div>

        {iaHabilitada && proveedoresIA.length > 1 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label
              htmlFor="proveedor-ia"
              className="text-[12px] text-muted-foreground"
            >
              Analizar con
            </label>
            <Select
              id="proveedor-ia"
              value={proveedorIA}
              disabled={analizando}
              onChange={(e) => setProveedorIA(e.target.value as ProveedorIA)}
              className="h-8 w-auto text-[12.5px]"
            >
              {proveedoresIA.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.id === proveedorActivoIA ? " (predeterminado)" : ""}
                </option>
              ))}
            </Select>
            <span className="font-mono text-[11px] text-muted-foreground/70">
              {proveedoresIA.find((p) => p.id === proveedorIA)?.modelo}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={analizando}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-3 py-7 text-center hover:bg-muted/60 disabled:opacity-60"
        >
          <FileUp className="h-6 w-6 text-muted-foreground" />
          <div className="text-[13px] font-medium text-muted-foreground">
            {analizando ? (
              <EsperandoIA texto="Analizando..." />
            ) : (
              "Subir el PDF del estado de cuenta"
            )}
          </div>
          <div className="text-[11px] text-muted-foreground/70">
            Imprimí solo el detalle, sin tus datos personales · máx.{" "}
            {formatearTamano(LIMITE_SUBIDA_BYTES)}
          </div>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleArchivo}
        />
        {iaHabilitada && (
          <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              El texto del PDF se manda a tu proveedor de IA, con el número de
              tarjeta, el mail y la cédula ocultos antes de salir.
            </p>
          </div>
        )}
        {error && <p className="mt-2.5 text-xs text-destructive">{error}</p>}
        {resultado && (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {resultado}
          </p>
        )}
      </Card>

      {analisis && (
        <>
          {analisis.gastosEnRango > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-[12.5px] text-muted-foreground">
                Ya hay <strong>{analisis.gastosEnRango} gastos</strong> cargados
                entre el {formatearFechaCorta(analisis.desde!)} y el{" "}
                {formatearFechaCorta(analisis.hasta!)}. Las líneas que matchean
                por fecha y monto aparecen abajo como <em>ya registradas</em> y
                vienen desmarcadas.
              </p>
            </div>
          )}

          {GRUPOS.map(({ estado, titulo, descripcion, icono: Icono }) => {
            const delGrupo = lineas.filter((l) => l.estado === estado);
            if (!delGrupo.length) return null;
            const marcadasDelGrupo = delGrupo.filter((l) => l.incluir).length;

            return (
              <Card key={estado} className="px-5 py-4.5">
                <div className="mb-1 flex items-center gap-2">
                  <Icono className="h-4 w-4 text-muted-foreground" />
                  <div className="text-sm font-semibold">{titulo}</div>
                  <Badge variant="secondary">{delGrupo.length}</Badge>
                </div>
                <p className="mb-3 text-[12px] text-muted-foreground">
                  {descripcion}
                </p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-0.5 pb-1.5 text-[11px] font-medium text-muted-foreground/70">
                  <input
                    type="checkbox"
                    aria-label={`Marcar o desmarcar las ${delGrupo.length} líneas de ${titulo.toLowerCase()}`}
                    checked={marcadasDelGrupo === delGrupo.length}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          marcadasDelGrupo > 0 &&
                          marcadasDelGrupo < delGrupo.length;
                      }
                    }}
                    onChange={(e) => marcarGrupo(estado, e.target.checked)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="w-12 shrink-0">Fecha</span>
                  <span className="min-w-0 flex-1">Descripción</span>
                  <span className="w-[7.5rem] shrink-0">Categoría</span>
                  <span className="w-24 shrink-0 text-right">Monto</span>
                </div>

                <div className="flex flex-col divide-y divide-border">
                  {delGrupo.map((linea) => (
                    <div
                      key={linea.indice}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
                    >
                      <input
                        type="checkbox"
                        checked={linea.incluir}
                        onChange={(e) =>
                          actualizar(linea.indice, {
                            incluir: e.target.checked,
                          })
                        }
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="w-12 shrink-0 text-[12px] text-muted-foreground">
                        {formatearFechaCorta(linea.fecha)}
                      </span>
                      <Input
                        value={linea.descripcionEditada}
                        onChange={(e) =>
                          actualizar(linea.indice, {
                            descripcionEditada: e.target.value,
                          })
                        }
                        className="h-7 min-w-0 flex-1 text-[13px]"
                      />

                      {linea.moneda === "USD" && (
                        <Badge variant="outline" className="shrink-0">
                          USD {linea.montoOriginal}
                        </Badge>
                      )}

                      <select
                        value={linea.categoriaId ?? ""}
                        onChange={(e) =>
                          actualizar(linea.indice, {
                            categoriaId: Number(e.target.value),
                          })
                        }
                        className="h-7 w-[7.5rem] shrink-0 rounded-md border border-input bg-background px-1.5 text-[12px]"
                      >
                        {categorias.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}
                          </option>
                        ))}
                      </select>

                      <Input
                        value={linea.montoEditado}
                        onChange={(e) =>
                          actualizar(linea.indice, {
                            montoEditado: e.target.value,
                          })
                        }
                        placeholder={
                          linea.montoPesos === null ? "$ a mano" : undefined
                        }
                        aria-invalid={montoInvalido(linea)}
                        title={
                          montoInvalido(linea)
                            ? "No se entiende el monto: no se va a importar"
                            : undefined
                        }
                        className={`h-7 w-24 shrink-0 text-right text-[12px] ${
                          montoInvalido(linea)
                            ? "border-destructive text-destructive"
                            : ""
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          <Card className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="text-[13px]">
              <div className="font-medium">
                {seleccionadas.length} movimientos seleccionados
              </div>
              <div className="text-muted-foreground">
                Total {formatearPesos(totalSeleccionado)}
              </div>
              {conMontoInvalido > 0 && (
                <div className="text-destructive">
                  {conMontoInvalido}{" "}
                  {conMontoInvalido === 1
                    ? "tildada sin monto válido queda afuera"
                    : "tildadas sin monto válido quedan afuera"}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleCancelar}
                disabled={importando}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleImportar}
                disabled={!seleccionadas.length || importando}
              >
                {importando ? "Importando..." : "Importar seleccionados"}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
