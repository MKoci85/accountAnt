"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ProveedorDisponibleIA } from "@/app/actions/configuracion";
import type { ProveedorIA } from "@/lib/proveedores-ia";

export type EleccionModelo = { proveedor: ProveedorIA; modelo: string };

export function SelectorModeloIA({
  proveedores,
  valor,
  onCambio,
  deshabilitado,
  idPrefijo,
}: {
  proveedores: ProveedorDisponibleIA[];
  valor: EleccionModelo;
  onCambio: (valor: EleccionModelo) => void;
  deshabilitado?: boolean;
  idPrefijo: string;
}) {
  const elegido = proveedores.find((p) => p.id === valor.proveedor);
  const listaId = `${idPrefijo}-modelos`;

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="flex flex-1 flex-col gap-1">
        <label
          htmlFor={`${idPrefijo}-proveedor`}
          className="text-[11.5px] text-muted-foreground"
        >
          Proveedor
        </label>
        <Select
          id={`${idPrefijo}-proveedor`}
          value={valor.proveedor}
          disabled={deshabilitado || proveedores.length <= 1}
          onChange={(e) => {
            const proveedor = e.target.value as ProveedorIA;
            const nuevo = proveedores.find((p) => p.id === proveedor);
            onCambio({ proveedor, modelo: nuevo?.modelo ?? "" });
          }}
          className="h-9 text-[13px]"
        >
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <label
          htmlFor={`${idPrefijo}-modelo`}
          className="text-[11.5px] text-muted-foreground"
        >
          Modelo
        </label>
        <Input
          id={`${idPrefijo}-modelo`}
          list={listaId}
          value={valor.modelo}
          disabled={deshabilitado}
          placeholder={elegido?.modelo ?? ""}
          onChange={(e) => onCambio({ ...valor, modelo: e.target.value })}
          className="h-9 text-[13px]"
        />
        <datalist id={listaId}>
          {(elegido?.modelosSugeridos ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

export function eleccionInicial(
  proveedores: ProveedorDisponibleIA[],
  activo: ProveedorIA,
): EleccionModelo {
  const elegido =
    proveedores.find((p) => p.id === activo) ?? proveedores[0] ?? null;
  return { proveedor: elegido?.id ?? activo, modelo: elegido?.modelo ?? "" };
}
