"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Reporte } from "@/app/actions/reportes";
import { formatearMonto } from "@/lib/formato";

const COLORES_FALLBACK = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export const MAX_CATEGORIAS_VISIBLES = 6;

export type CategoriaVisible = {
  clave: string;
  nombre: string;
  total: number;
  color: string;
  porcentajeDelTotal: number;
  porcentajeHormiga: number | null;
};

export function categoriasVisibles(
  categorias: Reporte["categorias"],
): CategoriaVisible[] {
  const visibles = categorias
    .slice(0, MAX_CATEGORIAS_VISIBLES)
    .map((c, i) => ({
      clave: String(c.categoriaId),
      nombre: c.nombre,
      total: c.total,
      color: c.color ?? COLORES_FALLBACK[i % COLORES_FALLBACK.length],
      porcentajeDelTotal: c.porcentajeDelTotal,
      porcentajeHormiga: c.porcentajeHormiga,
    }));

  const resto = categorias.slice(MAX_CATEGORIAS_VISIBLES);
  if (!resto.length) return visibles;

  return [
    ...visibles,
    {
      clave: "otras",
      nombre: `Otras (${resto.length})`,
      total: resto.reduce((acc, c) => acc + c.total, 0),
      color: "var(--muted-foreground)",
      porcentajeDelTotal: resto.reduce(
        (acc, c) => acc + c.porcentajeDelTotal,
        0,
      ),
      porcentajeHormiga: null,
    },
  ];
}

function nombreMes(mesISO: string) {
  const [anio, mes] = mesISO.split("-").map(Number);
  return new Date(anio, mes - 1, 1).toLocaleDateString("es-UY", {
    month: "short",
    year: "2-digit",
  });
}

const estiloTooltip = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  fontSize: "12.5px",
  color: "var(--popover-foreground)",
};

export function GraficoCategorias({
  categorias,
}: {
  categorias: Reporte["categorias"];
}) {
  if (!categorias.length) return null;

  const datos = categoriasVisibles(categorias);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={datos}
          dataKey="total"
          nameKey="nombre"
          innerRadius={55}
          outerRadius={95}
          paddingAngle={2}
          stroke="var(--card)"
        >
          {datos.map((d) => (
            <Cell key={d.clave} fill={d.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={estiloTooltip}
          formatter={(valor) => formatearMonto(Number(valor))}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function GraficoEvolucion({
  evolucion,
}: {
  evolucion: Reporte["evolucionMensual"];
}) {
  if (!evolucion.length) return null;

  const datos = evolucion.map((m) => ({
    mes: nombreMes(m.mes),
    Necesario: m.necesario,
    Hormiga: m.hormiga,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={datos}>
        <XAxis
          dataKey="mes"
          stroke="var(--muted-foreground)"
          fontSize={11.5}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="var(--muted-foreground)"
          fontSize={11.5}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) =>
            v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
          }
        />
        <Tooltip
          contentStyle={estiloTooltip}
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          formatter={(valor) => formatearMonto(Number(valor))}
        />
        <Bar dataKey="Necesario" stackId="g" fill="var(--chart-1)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Hormiga" stackId="g" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GraficoAhorroPotencial({
  evolucion,
}: {
  evolucion: Reporte["evolucionMensual"];
}) {
  if (!evolucion.length) return null;

  const datos = evolucion.map((m) => ({
    mes: nombreMes(m.mes),
    "Podrías haber ahorrado": m.potencialAhorro,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={datos}>
        <XAxis
          dataKey="mes"
          stroke="var(--muted-foreground)"
          fontSize={11.5}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="var(--muted-foreground)"
          fontSize={11.5}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) =>
            v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
          }
        />
        <Tooltip
          contentStyle={estiloTooltip}
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          formatter={(valor) => formatearMonto(Number(valor))}
        />
        <Bar
          dataKey="Podrías haber ahorrado"
          fill="var(--destructive)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
