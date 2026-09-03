"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Check,
  Copy,
  MessageSquare,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  obtenerReporte,
  exportarReporteJSON,
  type FiltrosReporte,
  type Reporte,
} from "@/app/actions/reportes";
import {
  GraficoCategorias,
  GraficoEvolucion,
  GraficoAhorroPotencial,
  categoriasVisibles,
} from "@/components/reportes-graficos";
import { DialogoAnalizarIA } from "@/components/dialogo-analizar-ia";
import type { ProveedorDisponibleIA } from "@/app/actions/configuracion";
import type { ProveedorIA } from "@/lib/proveedores-ia";
import { aISO, formatearMonto, hoyISO } from "@/lib/formato";
import type { categorias as categoriasSchema, emisores as emisoresSchema } from "@/db/schema";

type Categoria = typeof categoriasSchema.$inferSelect;
type Emisor = typeof emisoresSchema.$inferSelect;

const rangos = [
  { key: "mes", label: "Este mes" },
  { key: "3m", label: "Últimos 3 meses" },
  { key: "6m", label: "Últimos 6 meses" },
  { key: "anio", label: "Este año" },
  { key: "todo", label: "Todo" },
] as const;

type RangoKey = (typeof rangos)[number]["key"];

function resolverRango(rango: RangoKey): { desde: string; hasta: string } {
  const hoy = new Date();
  const iso = aISO;
  const hasta = iso(hoy);

  switch (rango) {
    case "mes":
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta };
    case "3m":
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1)), hasta };
    case "6m":
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1)), hasta };
    case "anio":
      return { desde: iso(new Date(hoy.getFullYear(), 0, 1)), hasta };
    case "todo":
      return { desde: "1900-01-01", hasta };
  }
}

function atajoDe(periodo: { desde: string; hasta: string }) {
  return rangos.find((r) => {
    const { desde, hasta } = resolverRango(r.key);
    return desde === periodo.desde && hasta === periodo.hasta;
  });
}

function etiquetaPeriodo(periodo: { desde: string; hasta: string }) {
  return atajoDe(periodo)?.label ?? "Personalizado";
}

function FiltroDropdown({
  etiqueta,
  valor,
  opciones,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  opciones: { valor: string; label: string }[];
  onCambio: (valor: string) => void;
}) {
  const seleccionada = opciones.find((o) => o.valor === valor);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <span className="text-muted-foreground">{etiqueta}:</span>
            <span>{seleccionada?.label ?? valor}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup value={valor} onValueChange={onCambio}>
          {opciones.map((o) => (
            <DropdownMenuRadioItem key={o.valor} value={o.valor}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FiltroMultiple({
  etiqueta,
  etiquetaVacio,
  seleccionados,
  opciones,
  onCambio,
}: {
  etiqueta: string;
  etiquetaVacio: string;
  seleccionados: number[];
  opciones: { id: number; nombre: string }[];
  onCambio: (ids: number[]) => void;
}) {
  const resumen =
    seleccionados.length === 0
      ? etiquetaVacio
      : seleccionados.length === 1
        ? (opciones.find((o) => o.id === seleccionados[0])?.nombre ?? etiquetaVacio)
        : `${seleccionados.length} seleccionadas`;

  function alternar(id: number) {
    onCambio(
      seleccionados.includes(id)
        ? seleccionados.filter((s) => s !== id)
        : [...seleccionados, id]
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <span className="text-muted-foreground">{etiqueta}:</span>
            <span>{resumen}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {seleccionados.length > 0 && (
          <>
            <DropdownMenuItem onClick={() => onCambio([])}>
              Limpiar selección
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {opciones.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={seleccionados.includes(o.id)}
            onCheckedChange={() => alternar(o.id)}
          >
            {o.nombre}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MAX_FILAS_TABLA = 10;

function PieTabla({ mostradas, total }: { mostradas: number; total: number }) {
  if (total <= mostradas) return null;
  return (
    <p className="mt-2.5 text-[12px] text-muted-foreground">
      Mostrando {mostradas} de {total} — acotá el período o los filtros para ver
      el resto.
    </p>
  );
}

function enlaceAGastos(
  filtros: FiltrosReporte,
  extra: { emisor?: number; q?: string }
) {
  const params = new URLSearchParams({
    desde: filtros.desde,
    hasta: filtros.hasta,
  });
  if (extra.emisor !== undefined) params.set("emisor", String(extra.emisor));
  if (extra.q) params.set("q", extra.q);
  return `/gastos?${params.toString()}`;
}

function FilaNavegable({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(href)}>
      {children}
    </TableRow>
  );
}

function SeccionCard({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="py-0">
      <div className="border-b px-5 py-4">
        <div className="text-[15px] font-semibold">{titulo}</div>
        {descripcion && (
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{descripcion}</p>
        )}
      </div>
      <CardContent className="px-5 py-4">{children}</CardContent>
    </Card>
  );
}

export function ReportesView({
  reporteInicial,
  categorias,
  emisores,
  proveedoresIA,
  proveedorActivoIA,
}: {
  reporteInicial: Reporte;
  categorias: Categoria[];
  emisores: Emisor[];
  proveedoresIA: ProveedorDisponibleIA[];
  proveedorActivoIA: ProveedorIA;
}) {
  const [periodo, setPeriodo] = useState(() => resolverRango("mes"));
  const [categoriaIds, setCategoriaIds] = useState<number[]>([]);
  const [emisorIds, setEmisorIds] = useState<number[]>([]);
  const [reporte, setReporte] = useState(reporteInicial);
  const [cargando, startCarga] = useTransition();
  const [copiado, setCopiado] = useState(false);
  const [analizando, setAnalizando] = useState(false);

  const filtros: FiltrosReporte = {
    desde: periodo.desde || "1900-01-01",
    hasta: periodo.hasta || hoyISO(),
    categoriaIds,
    emisorIds,
  };

  const claveFiltros = JSON.stringify(filtros);
  useEffect(() => {
    startCarga(async () => {
      setReporte(await obtenerReporte(JSON.parse(claveFiltros)));
    });
  }, [claveFiltros]);

  async function copiarJSON() {
    const json = await exportarReporteJSON(filtros);
    await navigator.clipboard.writeText(json);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const { resumen, matriz } = reporte;
  const sinDatos = resumen.cantidadLineas === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <FiltroDropdown
            etiqueta="Período"
            valor={etiquetaPeriodo(periodo)}
            opciones={rangos.map((r) => ({ valor: r.label, label: r.label }))}
            onCambio={(label) => {
              const rango = rangos.find((r) => r.label === label);
              if (rango) setPeriodo(resolverRango(rango.key));
            }}
          />
          <FiltroMultiple
            etiqueta="Categorías"
            etiquetaVacio="Todas"
            seleccionados={categoriaIds}
            opciones={categorias.map((c) => ({ id: c.id, nombre: c.nombre }))}
            onCambio={setCategoriaIds}
          />
          <FiltroMultiple
            etiqueta="Comercios"
            etiquetaVacio="Todos"
            seleccionados={emisorIds}
            opciones={emisores.map((e) => ({ id: e.id, nombre: e.nombre }))}
            onCambio={setEmisorIds}
          />
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={periodo.desde}
              max={periodo.hasta || undefined}
              onChange={(e) => setPeriodo((p) => ({ ...p, desde: e.target.value }))}
              className="h-8 w-[9.5rem] text-[13px]"
            />
            <span className="text-[12.5px] text-muted-foreground">a</span>
            <Input
              type="date"
              value={periodo.hasta}
              min={periodo.desde || undefined}
              onChange={(e) => setPeriodo((p) => ({ ...p, hasta: e.target.value }))}
              className="h-8 w-[9.5rem] text-[13px]"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={copiarJSON}
            disabled={sinDatos}
          >
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiado ? "Copiado" : "Copiar JSON para IA"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setAnalizando(true)}
            disabled={sinDatos || proveedoresIA.length === 0}
            title={
              proveedoresIA.length === 0
                ? "No hay ninguna API key configurada. Cargá una en Ajustes."
                : "Mandar este reporte al asistente"
            }
          >
            <Sparkles className="h-4 w-4" />
            Analizar con IA
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            nativeButton={false}
            render={
              <Link href="/reportes/asistente">
                <MessageSquare className="h-4 w-4" />
                Asistente
              </Link>
            }
          />
        </div>
      </div>

      {analizando && (
        <DialogoAnalizarIA
          open
          onOpenChange={setAnalizando}
          filtros={filtros}
          proveedores={proveedoresIA}
          proveedorActivo={proveedorActivoIA}
        />
      )}

      {sinDatos ? (
        <Card>
          <CardContent className="px-5 py-12 text-center text-sm text-muted-foreground">
            No hay gastos cargados en este período.
          </CardContent>
        </Card>
      ) : (
        <div className={cargando ? "flex flex-col gap-5 opacity-60" : "flex flex-col gap-5"}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total gastado"
              value={formatearMonto(resumen.totalGastado)}
              hint={`${resumen.cantidadGastos} ${resumen.cantidadGastos === 1 ? "gasto" : "gastos"} · ${resumen.cantidadLineas} ítems`}
            />
            <StatCard
              label="Gasto hormiga"
              value={formatearMonto(resumen.totalHormiga)}
              hint={`${resumen.porcentajeHormiga}% del total`}
              tone="accent"
            />
            <StatCard
              label="Pagado de más"
              value={formatearMonto(resumen.totalSobreprecio)}
              hint={`${resumen.porcentajeSobreprecio}% del total`}
              tone="accent"
            />
            <StatCard
              label="Podrías ahorrar"
              value={formatearMonto(resumen.potencialAhorro)}
              hint={`${resumen.porcentajePotencialAhorro}% del total del período`}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SeccionCard
              titulo="En qué gastás"
              descripcion="Distribución por categoría, con cuánto de cada una es gasto hormiga."
            >
              <GraficoCategorias categorias={reporte.categorias} />
              <div className="mt-3 flex flex-col gap-2">
                {categoriasVisibles(reporte.categorias).map((c) => (
                  <div key={c.clave} className="flex items-center gap-2.5 text-[13px]">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="flex-1 truncate">{c.nombre}</span>
                    {c.porcentajeHormiga !== null && c.porcentajeHormiga > 0 && (
                      <span className="text-[11.5px] text-destructive">
                        {c.porcentajeHormiga}% hormiga
                      </span>
                    )}
                    <span className="font-medium">{formatearMonto(c.total)}</span>
                    <span className="w-9 text-right text-[11.5px] text-muted-foreground">
                      {c.porcentajeDelTotal}%
                    </span>
                  </div>
                ))}
              </div>
            </SeccionCard>

            <SeccionCard
              titulo="Cómo viene evolucionando"
              descripcion="Gasto necesario vs. hormiga, mes a mes."
            >
              <GraficoEvolucion evolucion={reporte.evolucionMensual} />
              <div className="mt-3 flex items-center justify-center gap-4 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: "var(--chart-1)" }}
                  />
                  Necesario
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: "var(--chart-2)" }}
                  />
                  Hormiga
                </span>
              </div>
            </SeccionCard>
          </div>

          {reporte.evolucionMensual.length > 1 && (
            <SeccionCard
              titulo="Cuánto dejaste de ahorrar"
              descripcion="Gasto hormiga + sobreprecio de cada mes: lo que se podría haber ahorrado comprando mejor."
            >
              <GraficoAhorroPotencial evolucion={reporte.evolucionMensual} />
              {(() => {
                const ultimo = reporte.evolucionMensual[reporte.evolucionMensual.length - 1];
                if (ultimo.ahorroVsMesAnterior == null) return null;
                const empeoro = ultimo.ahorroVsMesAnterior > 0;
                const sinCambio = ultimo.ahorroVsMesAnterior === 0;
                return (
                  <p className="mt-3 text-center text-[13px]">
                    {sinCambio ? (
                      <span className="text-muted-foreground">
                        Mismo ahorro potencial que el mes anterior.
                      </span>
                    ) : (
                      <>
                        <span className={empeoro ? "font-medium text-destructive" : "font-medium text-accent-foreground"}>
                          {empeoro ? "+" : "−"}
                          {formatearMonto(Math.abs(ultimo.ahorroVsMesAnterior))}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {empeoro
                            ? "más sobre la mesa que el mes anterior"
                            : "menos sobre la mesa que el mes anterior — buen mes"}
                        </span>
                      </>
                    )}
                  </p>
                );
              })()}
            </SeccionCard>
          )}

          <SeccionCard
            titulo="Dónde está el ahorro más fácil"
            descripcion="Cruce entre lo evitable (hormiga) y lo que se pagó caro. El cuadrante rojo es plata que se recupera sin resignar nada necesario."
          >
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Hormiga y caro", valor: matriz.hormigaCaro, destacar: true, nota: "evitable y mal comprado" },
                { label: "Hormiga, buen precio", valor: matriz.hormigaBuenPrecio, destacar: false, nota: "evitable" },
                { label: "Necesario, caro", valor: matriz.necesarioCaro, destacar: false, nota: "comprable más barato" },
                { label: "Necesario, buen precio", valor: matriz.necesarioBuenPrecio, destacar: false, nota: "gasto sano" },
              ].map((c) => (
                <div
                  key={c.label}
                  className={`rounded-lg px-4 py-3 ring-1 ${
                    c.destacar
                      ? "bg-destructive/10 ring-destructive/30"
                      : "bg-muted/40 ring-border"
                  }`}
                >
                  <div className="text-[12px] text-muted-foreground">{c.label}</div>
                  <div
                    className={`mt-1 text-xl font-semibold ${c.destacar ? "text-destructive" : ""}`}
                  >
                    {formatearMonto(c.valor)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{c.nota}</div>
                </div>
              ))}
            </div>
          </SeccionCard>

          {reporte.itemsSobreprecio.length > 0 && (
            <SeccionCard
              titulo="Qué estás pagando de más"
              descripcion="Productos comprados por encima de su precio más bajo conocido, y dónde conseguirlos mejor."
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ítem</TableHead>
                      <TableHead className="text-right">Compras caras</TableHead>
                      <TableHead className="text-right">Pagado</TableHead>
                      <TableHead className="text-right">De más</TableHead>
                      <TableHead>Más barato en</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reporte.itemsSobreprecio.slice(0, MAX_FILAS_TABLA).map((i) => (
                      <FilaNavegable
                        key={i.itemCatalogoId}
                        href={enlaceAGastos(filtros, { q: i.nombre })}
                      >
                        <TableCell>
                          <div className="font-medium">{i.nombre}</div>
                          {i.marca && (
                            <div className="text-[11.5px] text-muted-foreground">{i.marca}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {i.comprasConSobreprecio}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatearMonto(i.totalPagado)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-destructive">
                          +{formatearMonto(i.pagadoDeMas)}
                        </TableCell>
                        <TableCell>
                          <div className="text-[12.5px]">{i.dondeEstaMasBarato}</div>
                          <div className="text-[11.5px] text-muted-foreground">
                            a {formatearMonto(i.precioMinimoConocido)}{" "}
                            {i.unidadReferencia}
                          </div>
                        </TableCell>
                      </FilaNavegable>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PieTabla
                mostradas={MAX_FILAS_TABLA}
                total={reporte.itemsSobreprecio.length}
              />
            </SeccionCard>
          )}

          <SeccionCard
            titulo="Dónde comprás"
            descripcion="Cuánto dejás en cada comercio, con qué frecuencia y qué proporción es gasto hormiga."
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comercio</TableHead>
                    <TableHead className="text-right">Visitas</TableHead>
                    <TableHead className="text-right">Ticket prom.</TableHead>
                    <TableHead className="text-right">Hormiga</TableHead>
                    <TableHead className="text-right">De más</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reporte.comercios.slice(0, MAX_FILAS_TABLA).map((c) => (
                    <FilaNavegable
                      key={c.emisorId}
                      href={enlaceAGastos(filtros, { emisor: c.emisorId })}
                    >
                      <TableCell className="font-medium">{c.nombre}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {c.visitas}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatearMonto(c.ticketPromedio)}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.porcentajeHormiga > 0 ? (
                          <Badge
                            variant="secondary"
                            className="bg-destructive/10 text-destructive"
                          >
                            {c.porcentajeHormiga}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.pagadoDeMas > 0 ? (
                          <span className="text-destructive">
                            +{formatearMonto(c.pagadoDeMas)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatearMonto(c.total)}
                      </TableCell>
                    </FilaNavegable>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PieTabla
              mostradas={MAX_FILAS_TABLA}
              total={reporte.comercios.length}
            />
          </SeccionCard>

          <p className="flex items-center gap-2 px-1 text-[12.5px] text-muted-foreground">
            <TrendingDown className="h-3.5 w-3.5" />
            Copiá el JSON y pegalo en un chat con una IA para que te arme un plan de
            ahorro con estos datos.
          </p>
        </div>
      )}
    </div>
  );
}
