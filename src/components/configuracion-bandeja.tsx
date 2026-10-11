"use client";

import { useState, useTransition } from "react";
import { Inbox } from "lucide-react";
import {
  guardarAjusteBandeja,
  obtenerAjustesBandeja,
} from "@/app/actions/configuracion";
import { SeccionColapsable } from "@/components/seccion-colapsable";

type AjustesBandeja = Awaited<ReturnType<typeof obtenerAjustesBandeja>>;

const OPCIONES: {
  ajuste: keyof AjustesBandeja;
  titulo: string;
  ayuda: string;
}[] = [
  {
    ajuste: "guardadoAutomatico",
    titulo: "Guardar solo lo que no deja nada por decidir",
    ayuda:
      "Un comprobante que llega con QR validado por DGI, con el detalle del proveedor, todos los ítems reconocidos en el catálogo y una suma que da el total se guarda directo como gasto, marcado para que lo mires después. Cualquier otro queda en la bandeja. Apagado, todos pasan por la bandeja.",
  },
  {
    ajuste: "bloqueoPorMes",
    titulo: "Bloquear la carga manual con pendientes de un mes anterior",
    ayuda:
      "Mientras quede en la bandeja un comprobante de un mes anterior no se pueden cargar gastos nuevos a mano, para que ese mes no quede incompleto. No frena la recepción de comprobantes, los gastos fijos ni el estado de cuenta.",
  },
  {
    ajuste: "itemsConIA",
    titulo: "Leer los ítems con IA cuando el comprobante llega sin detalle",
    ayuda:
      "Un comprobante con QR de un comercio sin proveedor de CFE mapeado (o cuyo proveedor no contestó) llega sin ítems. Activado, se leen de la foto con el proveedor de IA activo y quedan para revisar. Apagado, queda en la bandeja sin ítems: la foto se guarda igual, así que se puede abrir con \"Ver ticket\" y cargar el detalle a mano. No cambia la lectura de una foto sin QR, que siempre usa IA.",
  },
];

export function ConfiguracionBandeja({ inicial }: { inicial: AjustesBandeja }) {
  const [ajustes, setAjustes] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startGuardado] = useTransition();

  function cambiar(ajuste: keyof AjustesBandeja, activo: boolean) {
    const previo = ajustes;
    setAjustes({ ...ajustes, [ajuste]: activo });
    setError(null);
    startGuardado(async () => {
      try {
        await guardarAjusteBandeja(ajuste, activo);
      } catch (e) {
        setAjustes(previo);
        setError(e instanceof Error ? e.message : "No se pudo guardar");
      }
    });
  }

  return (
    <SeccionColapsable
      icono={Inbox}
      titulo="Bandeja de entrada"
      descripcion="Qué pasa con los comprobantes que llegan por foto antes de convertirse en gastos."
    >
      <div className="flex flex-col gap-2.5">
        {OPCIONES.map(({ ajuste, titulo, ayuda }) => (
          <label
            key={ajuste}
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 px-3 py-2.5"
          >
            <input
              type="checkbox"
              checked={ajustes[ajuste]}
              disabled={guardando}
              onChange={(e) => cambiar(ajuste, e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-primary"
            />
            <span>
              <span className="text-[12.5px] font-medium">{titulo}</span>
              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                {ayuda}
              </span>
            </span>
          </label>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </SeccionColapsable>
  );
}
