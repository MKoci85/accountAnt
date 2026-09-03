"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DialogFormulario,
  CampoFormulario,
} from "@/components/dialog-formulario";
import { ComboboxBusqueda } from "@/components/combobox-busqueda";
import { useEnvioDialog } from "@/hooks/use-envio-dialog";
import { useDebounced } from "@/hooks/use-debounced";
import { buscarEmisores, crearEmisor } from "@/app/actions/catalogos";
import {
  crearGastoFijo,
  editarGastoFijo,
  type GastoFijoConEstado,
} from "@/app/actions/gastos-fijos";
import { parsearMonto } from "@/lib/formato";
import type { categorias, emisores } from "@/db/schema";

type Categoria = typeof categorias.$inferSelect;
type Emisor = typeof emisores.$inferSelect;

function ordenarPorTipo(lista: Categoria[]) {
  return [...lista].sort((a, b) => {
    if (a.esServicio !== b.esServicio) return a.esServicio ? -1 : 1;
    return a.nombre.localeCompare(b.nombre);
  });
}

export function GastoFijoDialog({
  open,
  onOpenChange,
  categorias: categoriasList,
  plantillaExistente,
  onGuardado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categorias: Categoria[];
  plantillaExistente?: GastoFijoConEstado | null;
  onGuardado: () => void;
}) {
  const modoEdicion = !!plantillaExistente;
  const ordenadas = ordenarPorTipo(categoriasList);

  const [nombre, setNombre] = useState(plantillaExistente?.nombre ?? "");
  const [categoriaId, setCategoriaId] = useState(
    plantillaExistente?.categoriaId ?? ordenadas[0]?.id ?? 0
  );
  const [importe, setImporte] = useState(
    plantillaExistente?.importe != null ? String(plantillaExistente.importe) : ""
  );
  const [emisorQuery, setEmisorQuery] = useState(
    plantillaExistente?.emisorNombre ?? ""
  );
  const [emisorId, setEmisorId] = useState<number | null>(
    plantillaExistente?.emisorId ?? null
  );
  const [resultados, setResultados] = useState<Emisor[]>([]);
  const emisorQueryDebounced = useDebounced(emisorQuery);

  const { error, setError, isPending, enviar } = useEnvioDialog(
    "No se pudo guardar el gasto fijo"
  );

  useEffect(() => {
    const query = emisorQueryDebounced.trim();
    if (!query || emisorId !== null) return;
    let cancelado = false;
    buscarEmisores(query).then((r) => {
      if (!cancelado) setResultados(r);
    });
    return () => {
      cancelado = true;
    };
  }, [emisorQueryDebounced, emisorId]);

  function handleOpenChange(next: boolean) {
    if (next) {
      setNombre(plantillaExistente?.nombre ?? "");
      setCategoriaId(plantillaExistente?.categoriaId ?? ordenadas[0]?.id ?? 0);
      setImporte(
        plantillaExistente?.importe != null
          ? String(plantillaExistente.importe)
          : ""
      );
      setEmisorQuery(plantillaExistente?.emisorNombre ?? "");
      setEmisorId(plantillaExistente?.emisorId ?? null);
      setResultados([]);
      setError(null);
    }
    onOpenChange(next);
  }

  function elegirEmisor(elegido: Emisor) {
    setEmisorId(elegido.id);
    setEmisorQuery(elegido.nombre);
  }

  function limpiarEmisor() {
    setEmisorId(null);
    setEmisorQuery("");
  }

  const importeParseado = importe.trim() ? parsearMonto(importe) : null;
  const importeInvalido =
    importe.trim().length > 0 &&
    (importeParseado === null || importeParseado <= 0);

  function handleSubmit() {
    enviar(async () => {
      const datos = {
        nombre,
        categoriaId,
        emisorId,
        importe: importeParseado,
      };
      if (plantillaExistente) {
        await editarGastoFijo(plantillaExistente.id, datos);
      } else {
        await crearGastoFijo(datos);
      }
      onGuardado();
      onOpenChange(false);
    });
  }

  return (
    <DialogFormulario
      open={open}
      onOpenChange={handleOpenChange}
      titulo={modoEdicion ? "Editar gasto fijo" : "Nuevo gasto fijo"}
      etiquetaGuardar={modoEdicion ? "Guardar cambios" : "Crear gasto fijo"}
      puedeGuardar={!!nombre.trim() && !!categoriaId && !importeInvalido}
      isPending={isPending}
      error={error}
      onGuardar={handleSubmit}
    >
      <CampoFormulario label="Nombre" htmlFor="gasto-fijo-nombre">
        <Input
          id="gasto-fijo-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: UTE, Alquiler, Netflix"
          autoFocus
        />
      </CampoFormulario>

      <CampoFormulario label="Tipo" htmlFor="gasto-fijo-tipo">
        <Select
          id="gasto-fijo-tipo"
          value={categoriaId}
          onChange={(e) => setCategoriaId(Number(e.target.value))}
        >
          {ordenadas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Select>
      </CampoFormulario>

      <CampoFormulario
        label="Importe esperado (opcional)"
        htmlFor="gasto-fijo-importe"
      >
        <Input
          id="gasto-fijo-importe"
          value={importe}
          inputMode="decimal"
          onChange={(e) => setImporte(e.target.value)}
          placeholder="Ej: 1.240"
        />
        <p className="text-[11.5px] text-muted-foreground">
          Se usa como valor por defecto al pagar. Si el monto cambia todos los
          meses, dejalo vacío: se guarda solo el del último pago.
        </p>
      </CampoFormulario>

      <CampoFormulario
        label="Comercio (opcional)"
        htmlFor="gasto-fijo-emisor"
        accion={
          emisorId !== null ? (
            <button
              type="button"
              onClick={limpiarEmisor}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Quitar
            </button>
          ) : undefined
        }
      >
        <ComboboxBusqueda
          id="gasto-fijo-emisor"
          query={emisorQuery}
          onQueryChange={(valor) => {
            setEmisorQuery(valor);
            setEmisorId(null);
          }}
          resultados={emisorId === null ? resultados : []}
          claveOpcion={(e) => e.id}
          etiquetaOpcion={(e) => e.nombre}
          onElegir={elegirEmisor}
          accionFinal={{
            etiqueta: `+ Crear comercio "${emisorQuery.trim()}"`,
            onElegir: async () => {
              const nombreEmisor = emisorQuery.trim();
              if (!nombreEmisor) return;
              elegirEmisor(await crearEmisor({ nombre: nombreEmisor }));
            },
          }}
          placeholder="Buscar comercio..."
          suspendido={emisorId !== null}
          inputClassName="pl-8"
        />
        <p className="text-[11.5px] text-muted-foreground">
          {emisorId !== null
            ? "El pago se registra a nombre de este comercio."
            : "Sin comercio, el pago se registra como compra puntual (Varios)."}
        </p>
      </CampoFormulario>
    </DialogFormulario>
  );
}
