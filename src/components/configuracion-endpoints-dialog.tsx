"use client";

import { useState, useTransition } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  guardarOpenRouterReferer,
  guardarTimeoutBcuMs,
  guardarTimeoutIaChatMs,
  guardarTimeoutIaMs,
  guardarUrlBcu,
  guardarUrlDgi,
  type ConfigAvanzada,
} from "@/app/actions/configuracion";
import {
  CampoNumero,
  MensajeLinea,
} from "@/components/configuracion-umbrales-dialog";
import { SeccionColapsable } from "@/components/seccion-colapsable";

export function ConfiguracionEndpointsDialog({
  inicial,
}: {
  inicial: ConfigAvanzada;
}) {
  return (
    <SeccionColapsable
      icono={Link2}
      titulo="Endpoints y timeouts"
      descripcion="No hace falta tocar esto: son los valores con los que la app funciona hoy. Están acá para poder arreglar sin editar código una URL que el proveedor mueva, o un timeout corto para una conexión lenta. El endpoint de cada proveedor de IA se configura arriba, junto a su API key."
    >
      <div className="flex flex-col gap-4">
        <CampoTexto
          etiqueta="URL del servicio de cotizaciones del BCU"
          valor={inicial.bcuUrl}
          porDefecto={inicial.bcuUrlPorDefecto}
          ayuda="Endpoint SOAP del que se saca la cotización del dólar al importar un estado de cuenta en USD."
          onGuardar={guardarUrlBcu}
        />
        <CampoNumero
          etiqueta="Timeout del BCU"
          sufijo="ms"
          valor={inicial.bcuTimeoutMs}
          porDefecto={inicial.bcuTimeoutMsPorDefecto}
          ayuda="Cuánto se espera la respuesta del BCU antes de dar la cotización por perdida. Al vencerse, la línea queda para carga manual."
          onGuardar={guardarTimeoutBcuMs}
        />
        <CampoTexto
          etiqueta="URL de consulta de CFE de DGI"
          valor={inicial.dgiUrl}
          porDefecto={inicial.dgiUrlPorDefecto}
          ayuda="Con esta URL se valida que el QR de un ticket corresponda a un comprobante autorizado."
          onGuardar={guardarUrlDgi}
        />
        <CampoNumero
          etiqueta="Timeout de las consultas con IA"
          sufijo="ms"
          valor={inicial.iaTimeoutMs}
          porDefecto={inicial.iaTimeoutMsPorDefecto}
          ayuda="Compartido por todos los proveedores. Analizar una foto de un estado de cuenta puede tardar bastante: bajarlo mucho corta consultas que iban a responder."
          onGuardar={guardarTimeoutIaMs}
        />
        <CampoNumero
          etiqueta="Timeout del chat del asistente"
          sufijo="ms"
          valor={inicial.iaTimeoutChatMs}
          porDefecto={inicial.iaTimeoutChatMsPorDefecto}
          ayuda="Separado del anterior porque una respuesta de chat es corta: esperar dos minutos por ella no tiene sentido. Si el proveedor que usás es lento, subilo."
          onGuardar={guardarTimeoutIaChatMs}
        />
        <CampoTexto
          etiqueta="HTTP-Referer de OpenRouter"
          valor={inicial.openRouterReferer}
          porDefecto={inicial.openRouterRefererPorDefecto}
          ayuda="OpenRouter lo usa para atribuir el tráfico en tu cuenta. El default apunta a localhost: si servís la app por Tailscale, poné acá esa dirección para que las consultas se atribuyan bien."
          onGuardar={guardarOpenRouterReferer}
        />
      </div>
    </SeccionColapsable>
  );
}

export function CampoTexto({
  etiqueta,
  valor,
  porDefecto,
  ayuda,
  permiteVacio = false,
  onGuardar,
}: {
  etiqueta: string;
  valor: string;
  porDefecto: string;
  ayuda?: string;
  permiteVacio?: boolean;
  onGuardar: (valor: string) => Promise<void>;
}) {
  const [texto, setTexto] = useState(valor);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(
    null,
  );
  const [guardando, startGuardado] = useTransition();

  function handleGuardar() {
    setMensaje(null);
    const limpio = texto.trim();
    if (!limpio && !permiteVacio) {
      setMensaje({ ok: false, texto: "No puede estar vacío" });
      return;
    }
    startGuardado(async () => {
      try {
        await onGuardar(limpio);
        if (!limpio) setTexto(porDefecto);
        setMensaje({
          ok: true,
          texto: limpio ? "Guardado." : "Se volvió al default.",
        });
      } catch (e) {
        setMensaje({
          ok: false,
          texto: e instanceof Error ? e.message : "No se pudo guardar",
        });
      }
    });
  }

  const esDefault = texto.trim() === porDefecto;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 px-3.5 py-3">
      <label className="text-[12.5px] font-medium">{etiqueta}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={texto}
          spellCheck={false}
          placeholder={porDefecto}
          onChange={(e) => setTexto(e.target.value)}
          className="font-mono text-[12px] sm:flex-1"
        />
        <Button size="sm" onClick={handleGuardar} disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar"}
        </Button>
      </div>
      {ayuda && (
        <p className="text-[11.5px] text-muted-foreground">{ayuda}</p>
      )}
      {!esDefault && (
        <p className="text-[11.5px] break-all text-muted-foreground">
          Default: <span className="font-mono">{porDefecto}</span>
        </p>
      )}
      {mensaje && <MensajeLinea mensaje={mensaje} />}
    </div>
  );
}
