"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, ChevronDown, ChevronLeft, ChevronRight, Combine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { combinarGastos, type GastoResumen } from "@/app/actions/gastos";
import { formatearMonto, formatearFechaCorta } from "@/lib/formato";
import { GastoRow } from "@/components/gasto-row";
import {
  VerGastoAccion,
  EditarGastoAccion,
  BorrarGastoAccion,
} from "@/components/gasto-row-acciones";

function notaGasto(g: GastoResumen) {
  if (g.emisorPendiente) return "comercio pendiente de mapear";
  if (g.sinComprobante) return "sin comprobante";
  return null;
}

const rangosFecha = [
  { key: "todas", label: "Todas las fechas", dias: null },
  { key: "7d", label: "Últimos 7 días", dias: 7 },
  { key: "30d", label: "Últimos 30 días", dias: 30 },
  { key: "mes", label: "Este mes", dias: null },
  { key: "personalizado", label: "Período personalizado", dias: null },
] as const;

type RangoFechaKey = (typeof rangosFecha)[number]["key"];

const opcionesPorPagina = [10, 25, 50, 100] as const;

function fechaEnRango(
  fechaISO: string,
  rango: RangoFechaKey,
  hoy: Date,
  periodo: { desde: string; hasta: string }
) {
  if (rango === "todas") return true;

  if (rango === "personalizado") {
    if (periodo.desde && fechaISO < periodo.desde) return false;
    if (periodo.hasta && fechaISO > periodo.hasta) return false;
    return true;
  }

  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const fecha = new Date(anio, mes - 1, dia);

  if (rango === "mes") {
    return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth();
  }

  const dias = rangosFecha.find((r) => r.key === rango)?.dias ?? null;
  if (dias === null) return true;

  const limite = new Date(hoy);
  limite.setDate(limite.getDate() - dias);
  limite.setHours(0, 0, 0, 0);
  return fecha >= limite;
}

export function GastosView({
  gastos,
  categorias,
  emisores,
}: {
  gastos: GastoResumen[];
  categorias: { id: number; nombre: string }[];
  emisores: { id: number; nombre: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const desdeURL = params.get("desde") ?? "";
  const hastaURL = params.get("hasta") ?? "";

  const [busqueda, setBusqueda] = useState(() => params.get("q") ?? "");
  const [categoriaId, setCategoriaId] = useState<string>(
    () => params.get("categoria") ?? "todas"
  );
  const [emisorId, setEmisorId] = useState<string>(
    () => params.get("emisor") ?? "todos"
  );
  const [periodo, setPeriodo] = useState(() => ({
    desde: desdeURL,
    hasta: hastaURL,
  }));
  const [rangoFecha, setRangoFecha] = useState<RangoFechaKey>(() =>
    desdeURL || hastaURL ? "personalizado" : "todas"
  );
  const [porPagina, setPorPaginaState] = useState<number>(10);
  const [pagina, setPagina] = useState(1);
  const [modoCombinar, setModoCombinar] = useState(false);
  const [seleccionados, setSeleccionados] = useState<number[]>([]);
  const [combinando, startCombinar] = useTransition();
  const [errorCombinar, setErrorCombinar] = useState<string | null>(null);

  function activarModoCombinar() {
    setErrorCombinar(null);
    setSeleccionados([]);
    setModoCombinar(true);
  }

  function cancelarModoCombinar() {
    setErrorCombinar(null);
    setSeleccionados([]);
    setModoCombinar(false);
  }

  function alternarSeleccion(id: number) {
    setErrorCombinar(null);
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  const gastosSeleccionados = gastos.filter((g) => seleccionados.includes(g.id));
  const primerSeleccionado = gastosSeleccionados[0];
  const combinacionValida =
    gastosSeleccionados.length >= 2 &&
    gastosSeleccionados.every(
      (g) =>
        g.emisorId === primerSeleccionado.emisorId &&
        g.fecha === primerSeleccionado.fecha
    );

  function esSeleccionable(g: GastoResumen) {
    if (!primerSeleccionado) return true;
    return (
      g.emisorId === primerSeleccionado.emisorId &&
      g.fecha === primerSeleccionado.fecha
    );
  }

  function handleCombinar() {
    if (!modoCombinar) {
      activarModoCombinar();
      return;
    }
    if (!combinacionValida) return;
    setErrorCombinar(null);
    startCombinar(async () => {
      try {
        await combinarGastos(seleccionados);
        setSeleccionados([]);
        setModoCombinar(false);
        router.refresh();
      } catch (e) {
        setErrorCombinar(
          e instanceof Error ? e.message : "No se pudieron combinar los gastos"
        );
      }
    });
  }

  function conResetDePagina<T>(setter: (valor: T) => void) {
    return (valor: T) => {
      setter(valor);
      setPagina(1);
    };
  }
  const aplicarBusqueda = conResetDePagina(setBusqueda);
  const aplicarCategoria = conResetDePagina(setCategoriaId);
  const aplicarEmisor = conResetDePagina(setEmisorId);
  const aplicarRangoFecha = conResetDePagina(setRangoFecha);
  const aplicarPeriodo = conResetDePagina(
    (p: { desde: string; hasta: string }) => setPeriodo(p)
  );
  const aplicarPorPagina = conResetDePagina(setPorPaginaState);

  const categoriaSeleccionada = categorias.find((c) => String(c.id) === categoriaId);
  const emisorSeleccionado = emisores.find((e) => String(e.id) === emisorId);
  const rangoSeleccionado = rangosFecha.find((r) => r.key === rangoFecha)!;
  const etiquetaRango =
    rangoFecha === "personalizado" && (periodo.desde || periodo.hasta)
      ? `${
          periodo.desde ? formatearFechaCorta(periodo.desde) : "inicio"
        } – ${periodo.hasta ? formatearFechaCorta(periodo.hasta) : "hoy"}`
      : rangoSeleccionado.label;

  const gastosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const hoy = new Date();

    return gastos.filter((g) => {
      if (categoriaId !== "todas" && !g.categorias.some((c) => String(c.id) === categoriaId)) {
        return false;
      }
      if (emisorId !== "todos" && String(g.emisorId) !== emisorId) {
        return false;
      }
      if (!fechaEnRango(g.fecha, rangoFecha, hoy, periodo)) {
        return false;
      }
      if (q) {
        const enComercio = g.emisorNombre.toLowerCase().includes(q);
        const enItems = g.itemsNombres.some((n) => n.toLowerCase().includes(q));
        if (!enComercio && !enItems) return false;
      }
      return true;
    });
  }, [gastos, busqueda, categoriaId, emisorId, rangoFecha, periodo]);

  const totalPaginas = Math.max(1, Math.ceil(gastosFiltrados.length / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const gastosPagina = useMemo(() => {
    const inicio = (paginaActual - 1) * porPagina;
    return gastosFiltrados.slice(inicio, inicio + porPagina);
  }, [gastosFiltrados, paginaActual, porPagina]);

  return (
    <>
      <Card className="flex-row flex-wrap items-center gap-2.5 px-3.5 py-3.5">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar comercio o ítem..."
            className="pl-8"
            value={busqueda}
            onChange={(e) => aplicarBusqueda(e.target.value)}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" />
            }
          >
            Categoría:{" "}
            <span className="font-semibold text-foreground">
              {categoriaSeleccionada?.nombre ?? "Todas"}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={categoriaId} onValueChange={aplicarCategoria}>
              <DropdownMenuRadioItem value="todas" closeOnClick>
                Todas
              </DropdownMenuRadioItem>
              {categorias.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={String(c.id)} closeOnClick>
                  {c.nombre}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" />
            }
          >
            Comercio:{" "}
            <span className="font-semibold text-foreground">
              {emisorSeleccionado?.nombre ?? "Todos"}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={emisorId} onValueChange={aplicarEmisor}>
              <DropdownMenuRadioItem value="todos" closeOnClick>
                Todos
              </DropdownMenuRadioItem>
              {emisores.map((e) => (
                <DropdownMenuRadioItem key={e.id} value={String(e.id)} closeOnClick>
                  {e.nombre}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" />
            }
          >
            {etiquetaRango}
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={rangoFecha}
              onValueChange={(v) => aplicarRangoFecha(v as RangoFechaKey)}
            >
              {rangosFecha.map((r) => (
                <DropdownMenuRadioItem key={r.key} value={r.key} closeOnClick>
                  {r.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {rangoFecha === "personalizado" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Desde"
              value={periodo.desde}
              onChange={(e) =>
                aplicarPeriodo({ ...periodo, desde: e.target.value })
              }
              className="h-8 w-[150px] text-[13px]"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              aria-label="Hasta"
              value={periodo.hasta}
              onChange={(e) =>
                aplicarPeriodo({ ...periodo, hasta: e.target.value })
              }
              className="h-8 w-[150px] text-[13px]"
            />
          </div>
        )}
      </Card>

      {modoCombinar && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            {seleccionados.length === 0 && (
              <span className="text-muted-foreground">
                Elegí dos o más gastos del mismo comercio y fecha para combinarlos.
              </span>
            )}
            {seleccionados.length === 1 && (
              <span className="text-muted-foreground">
                Elegí otro gasto del mismo comercio y fecha para combinar.
              </span>
            )}
            {seleccionados.length >= 2 && (
              <span className="font-medium">{seleccionados.length} seleccionados</span>
            )}
            {errorCombinar && (
              <span className="ml-2 text-destructive">{errorCombinar}</span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={cancelarModoCombinar}>
            Cancelar
          </Button>
        </Card>
      )}

      {gastosFiltrados.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-muted-foreground">
          {gastos.length === 0
            ? "Todavía no cargaste ningún gasto."
            : "Ningún gasto coincide con los filtros."}
        </Card>
      ) : (
        <>
          <Card className="hidden py-0 md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {modoCombinar && <TableHead className="w-10 pl-5" />}
                  <TableHead className={modoCombinar ? undefined : "pl-5"}>Fecha</TableHead>
                  <TableHead>Comercio</TableHead>
                  <TableHead>Categorías</TableHead>
                  <TableHead>Ítems</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="pr-5 text-right" colSpan={3}>
                    <Button
                      variant={modoCombinar ? "default" : "outline"}
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs font-normal"
                      disabled={modoCombinar && (!combinacionValida || combinando)}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCombinar();
                      }}
                    >
                      <Combine className="h-3 w-3" />
                      {modoCombinar
                        ? combinando
                          ? "Guardando..."
                          : "Guardar"
                        : "Combinar"}
                    </Button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gastosPagina.map((g) => {
                  const nota = notaGasto(g);
                  return (
                    <GastoRow key={g.id} id={g.id}>
                      {modoCombinar && (
                        <TableCell
                          className="w-10 pl-5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={seleccionados.includes(g.id)}
                            disabled={!esSeleccionable(g)}
                            onChange={() => alternarSeleccion(g.id)}
                            className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Seleccionar para combinar"
                            title={
                              esSeleccionable(g)
                                ? undefined
                                : "Solo se puede combinar con gastos del mismo comercio y fecha"
                            }
                          />
                        </TableCell>
                      )}
                      <TableCell className={modoCombinar ? "text-muted-foreground" : "pl-5 text-muted-foreground"}>
                        {formatearFechaCorta(g.fecha)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{g.emisorNombre}</div>
                        {nota && (
                          <div className="text-xs font-medium text-destructive">
                            {nota}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {g.categorias.map((c) => (
                            <Badge
                              key={c.id}
                              variant="secondary"
                              style={
                                c.color
                                  ? { backgroundColor: `${c.color}22`, color: c.color }
                                  : undefined
                              }
                            >
                              {c.nombre}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {g.cantidadItems}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatearMonto(g.montoTotal)}
                      </TableCell>
                      <TableCell className="w-10">
                        <VerGastoAccion gastoId={g.id} />
                      </TableCell>
                      <TableCell className="w-10">
                        <EditarGastoAccion gastoId={g.id} />
                      </TableCell>
                      <TableCell className="w-10 pr-5">
                        <BorrarGastoAccion gastoId={g.id} />
                      </TableCell>
                    </GastoRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-col gap-2.5 md:hidden">
            {gastosPagina.map((g) => {
              const nota = notaGasto(g);
              return (
                <Link key={g.id} href={`/gastos/${g.id}`}>
                  <Card className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{g.emisorNombre}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {formatearFechaCorta(g.fecha)} · {g.cantidadItems} ítems
                        </div>
                        {nota && (
                          <div className="mt-0.5 text-xs font-medium text-destructive">
                            {nota}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {g.categorias.map((c) => (
                            <Badge
                              key={c.id}
                              variant="secondary"
                              style={
                                c.color
                                  ? { backgroundColor: `${c.color}22`, color: c.color }
                                  : undefined
                              }
                            >
                              {c.nombre}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-[15px] font-medium">
                        {formatearMonto(g.montoTotal)}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>

          <div className="flex flex-col items-start gap-3 px-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span>
                Mostrando {gastosPagina.length} de {gastosFiltrados.length}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" />
                  }
                >
                  Por página: <span className="font-semibold text-foreground">{porPagina}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup
                    value={String(porPagina)}
                    onValueChange={(v) => aplicarPorPagina(Number(v))}
                  >
                    {opcionesPorPagina.map((n) => (
                      <DropdownMenuRadioItem key={n} value={String(n)} closeOnClick>
                        {n}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={paginaActual <= 1}
                  onClick={() => setPagina(paginaActual - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>
                  Página {paginaActual} de {totalPaginas}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={paginaActual >= totalPaginas}
                  onClick={() => setPagina(paginaActual + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
