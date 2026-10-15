"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MessageCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  guardarActivoWhatsapp,
  guardarCampoWhatsapp,
  guardarRespuestaWhatsapp,
  probarWhatsapp,
  reintentarMensajesWhatsapp,
  type EstadoWhatsapp,
} from "@/app/actions/whatsapp";
import type { ModoRespuesta } from "@/lib/whatsapp";
import { SeccionColapsable } from "@/components/seccion-colapsable";
import { CampoTexto } from "@/components/configuracion-endpoints-dialog";

const RUTA_WEBHOOK = "/api/whatsapp";

function Copiable({ etiqueta, valor, ayuda }: { etiqueta: string; valor: string; ayuda: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 px-3.5 py-3">
      <span className="text-[12.5px] font-medium">{etiqueta}</span>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2.5 py-1.5 font-mono text-[12px]">
          {valor}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(valor);
            setCopiado(true);
          }}
        >
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p className="text-[11.5px] text-muted-foreground">{ayuda}</p>
    </div>
  );
}

export function ConfiguracionWhatsapp({ inicial }: { inicial: EstadoWhatsapp }) {
  const [activo, setActivo] = useState(inicial.activo);
  const [respuesta, setRespuesta] = useState(inicial.respuesta);
  const [prueba, setPrueba] = useState<{ ok: boolean; texto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, startTransition] = useTransition();

  function guardar<T>(previo: T, restaurar: (v: T) => void, accion: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await accion();
      } catch (e) {
        restaurar(previo);
        setError(e instanceof Error ? e.message : "No se pudo guardar");
      }
    });
  }

  return (
    <SeccionColapsable
      icono={MessageCircle}
      titulo="WhatsApp"
      descripcion="Recibir fotos de comprobantes por WhatsApp. Cada foto recorre el mismo camino que una subida a la bandeja de entrada. Necesita una app de Meta con el producto WhatsApp y esta ruta abierta a internet (Tailscale Funnel); los pasos están en el README."
    >
      <div className="flex flex-col gap-3">
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 px-3 py-2.5">
          <input
            type="checkbox"
            checked={activo}
            disabled={ocupado}
            onChange={(e) => {
              const nuevo = e.target.checked;
              setActivo(nuevo);
              guardar(activo, setActivo, () => guardarActivoWhatsapp(nuevo));
            }}
            className="mt-0.5 h-3.5 w-3.5 accent-primary"
          />
          <span>
            <span className="text-[12.5px] font-medium">Recibir por WhatsApp</span>
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
              Apagado, la ruta del webhook responde como si no existiera: ni
              verifica la suscripción ni acepta mensajes.
            </span>
          </span>
        </label>

        <Copiable
          etiqueta="URL del webhook"
          valor={`https://<tu-equipo>.<tu-tailnet>.ts.net:8443${RUTA_WEBHOOK}`}
          ayuda={`Va en "URL de devolución de llamada" en Meta. Reemplazá el dominio por el de tu equipo en Tailscale; el puerto es el que abras con Funnel (8443 en los pasos del README) y la ruta es siempre ${RUTA_WEBHOOK}.`}
        />
        <Copiable
          etiqueta="Token de verificación"
          valor={inicial.verifyToken}
          ayuda='Va en "Identificador de verificación" en Meta. Lo generó la app y no cambia.'
        />

        <CampoTexto
          etiqueta="Token de acceso"
          valor=""
          porDefecto={inicial.tokenEnmascarado ?? "sin configurar"}
          ayuda="El token permanente del usuario del sistema. Se guarda acá y no vuelve a mostrarse completo; para cambiarlo, pegá el nuevo."
          onGuardar={(v) => guardarCampoWhatsapp("token", v)}
        />
        <CampoTexto
          etiqueta="Clave secreta de la app"
          valor=""
          porDefecto={inicial.appSecretEnmascarado ?? "sin configurar"}
          ayuda="Con esto se comprueba que cada mensaje viene de Meta. Sin ella no se acepta ninguno."
          onGuardar={(v) => guardarCampoWhatsapp("appSecret", v)}
        />
        <CampoTexto
          etiqueta="Identificador del número de teléfono"
          valor={inicial.phoneNumberId}
          porDefecto=""
          ayuda="El id que Meta le da al número de la API (no es el teléfono). Sólo se procesan los mensajes dirigidos a él."
          permiteVacio
          onGuardar={(v) => guardarCampoWhatsapp("phoneNumberId", v)}
        />
        <CampoTexto
          etiqueta="Números autorizados"
          valor={inicial.numeros}
          porDefecto=""
          ayuda="De quién se aceptan fotos, con código de país y separados por coma (59899123456). Un mensaje de cualquier otro número se ignora sin contestar."
          permiteVacio
          onGuardar={(v) => guardarCampoWhatsapp("numeros", v)}
        />

        <div className="flex flex-col gap-2 rounded-lg border border-border/60 px-3.5 py-3">
          <label htmlFor="whatsapp-respuesta" className="text-[12.5px] font-medium">
            Respuesta por WhatsApp
          </label>
          <Select
            id="whatsapp-respuesta"
            value={respuesta}
            disabled={ocupado}
            onChange={(e) => {
              const nuevo = e.target.value as ModoRespuesta;
              setRespuesta(nuevo);
              guardar(respuesta, setRespuesta, () => guardarRespuestaWhatsapp(nuevo));
            }}
            className="h-9 w-auto self-start text-[12.5px]"
          >
            <option value="problemas">Sólo si hay algo para hacer</option>
            <option value="siempre">Siempre</option>
            <option value="nunca">Nunca</option>
          </Select>
          <p className="text-[11.5px] text-muted-foreground">
            A lo sumo un mensaje por foto. &quot;Algo para hacer&quot; es que no
            se pudo leer, que ya estaba cargada o que quedó en la bandeja para
            revisar.
          </p>
        </div>

        <CampoTexto
          etiqueta="URL de la API de Meta"
          valor={inicial.urlBase}
          porDefecto={inicial.urlBasePorDefecto}
          ayuda="Sin versión usa la que la app de Meta tenga por defecto. Para fijar una: https://graph.facebook.com/v23.0"
          permiteVacio
          onGuardar={(v) => guardarCampoWhatsapp("urlBase", v)}
        />
        <CampoTexto
          etiqueta="Timeout de Meta (ms)"
          valor={String(inicial.timeoutMs)}
          porDefecto={String(inicial.timeoutPorDefecto)}
          permiteVacio
          onGuardar={(v) => guardarCampoWhatsapp("timeoutMs", v)}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() => {
              setPrueba(null);
              startTransition(async () => setPrueba(await probarWhatsapp()));
            }}
          >
            Probar conexión
          </Button>
          {prueba && (
            <span
              className={`flex items-center gap-1.5 text-xs ${prueba.ok ? "text-primary" : "text-destructive"}`}
            >
              {prueba.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {prueba.texto}
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          Probar conexión comprueba el token y el id del número contra Meta; no
          manda ningún mensaje.{" "}
          {inicial.ultimoMensaje
            ? `Último mensaje recibido: ${new Date(inicial.ultimoMensaje.recibidoEn).toLocaleString("es-UY")} — ${inicial.ultimoMensaje.resultado ?? "procesando"}.`
            : "Todavía no llegó ningún mensaje."}{" "}
          <Link href="/bandeja#registro" className="text-primary underline-offset-2 hover:underline">
            Ver el registro de recepción
          </Link>
        </p>
        {inicial.interrumpidos > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3.5 py-3">
            <p className="min-w-0 flex-1 text-[12.5px]">
              {inicial.interrumpidos === 1
                ? "Hay 1 mensaje que quedó a medio procesar"
                : `Hay ${inicial.interrumpidos} mensajes que quedaron a medio procesar`}{" "}
              (la app se reinició mientras lo leía).
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={ocupado}
              onClick={() => {
                setPrueba(null);
                startTransition(async () =>
                  setPrueba(await reintentarMensajesWhatsapp())
                );
              }}
            >
              Reintentar
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </SeccionColapsable>
  );
}
