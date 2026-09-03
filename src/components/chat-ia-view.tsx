"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  FileJson,
  MessageSquarePlus,
  Pencil,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmarBorradoDialog } from "@/components/confirmar-borrado-dialog";
import { DialogoNuevaConversacion } from "@/components/dialogo-nueva-conversacion";
import { EsperandoIA } from "@/components/esperando-ia";
import {
  borrarConversacion,
  descartarAdjuntoPendiente,
  enviarMensaje,
  prepararReporteParaChat,
  renombrarConversacion,
  reutilizarAdjunto,
  type ConversacionCompleta,
  type MensajeChat,
  type ResumenAdjunto,
  type ResumenConversacion,
} from "@/app/actions/chat-ia";
import type { ProveedorDisponibleIA } from "@/app/actions/configuracion";
import type { EstadoCuota } from "@/lib/limitador-ia";
import { separarReporteAdjunto, UMBRAL_AVISO_CONTEXTO } from "@/lib/chat-ia";
import type { ProveedorIA } from "@/lib/proveedores-ia";
import { formatearFechaLarga } from "@/lib/formato";
import { cn } from "@/lib/utils";

export function ChatIAView({
  conversaciones,
  conversacionActiva,
  proveedores,
  proveedorActivo,
}: {
  conversaciones: ResumenConversacion[];
  conversacionActiva: ConversacionCompleta | null;
  proveedores: ProveedorDisponibleIA[];
  proveedorActivo: ProveedorIA;
}) {
  const router = useRouter();

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <ListaConversaciones
        conversaciones={conversaciones}
        activaId={conversacionActiva?.id ?? null}
        proveedores={proveedores}
        proveedorActivo={proveedorActivo}
        onCreada={(id) => router.push(`/reportes/asistente/${id}`)}
      />

      {conversacionActiva ? (
        <PanelChat
          key={conversacionActiva.id}
          conversacion={conversacionActiva}
        />
      ) : (
        <Card className="flex min-h-[24rem] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium">
            {conversaciones.length
              ? "Elegí una conversación o empezá una nueva."
              : "Todavía no hay conversaciones."}
          </p>
          <p className="max-w-sm text-[12.5px] text-muted-foreground">
            Podés preguntar sobre tus gastos y adjuntar el reporte del período
            para que el modelo razone sobre esos números.
          </p>
        </Card>
      )}
    </div>
  );
}

function ListaConversaciones({
  conversaciones,
  activaId,
  proveedores,
  proveedorActivo,
  onCreada,
}: {
  conversaciones: ResumenConversacion[];
  activaId: number | null;
  proveedores: ProveedorDisponibleIA[];
  proveedorActivo: ProveedorIA;
  onCreada: (id: number) => void;
}) {
  const router = useRouter();
  const [creando, setCreando] = useState(false);
  const [aBorrar, setABorrar] = useState<ResumenConversacion | null>(null);
  const [renombrando, setRenombrando] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={() => setCreando(true)}
      >
        <MessageSquarePlus className="h-4 w-4" />
        Nueva conversación
      </Button>

      <div className="flex flex-col gap-1">
        {conversaciones.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1 rounded-lg border px-2.5 py-2 transition-colors",
              c.id === activaId
                ? "border-border bg-muted"
                : "border-transparent hover:bg-muted/50",
            )}
          >
            {renombrando === c.id ? (
              <TituloEditable
                id={c.id}
                titulo={c.titulo}
                onCerrar={() => setRenombrando(null)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => router.push(`/reportes/asistente/${c.id}`)}
                >
                  <div className="truncate text-[12.5px] font-medium">
                    {c.titulo}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {formatearFechaLarga(new Date(c.actualizadaEn))} · {c.modelo}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Renombrar ${c.titulo}`}
                  className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                  onClick={() => setRenombrando(c.id)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Borrar ${c.titulo}`}
                  className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  onClick={() => setABorrar(c)}
                >
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>

      {creando && (
        <DialogoNuevaConversacion
          open
          onOpenChange={setCreando}
          proveedores={proveedores}
          proveedorActivo={proveedorActivo}
          onCreada={onCreada}
        />
      )}

      <ConfirmarBorradoDialog
        open={aBorrar !== null}
        onOpenChange={(open) => !open && setABorrar(null)}
        titulo="¿Borrar esta conversación?"
        descripcion="Se borran todos sus mensajes. No se puede deshacer."
        onConfirmar={async () => {
          if (!aBorrar) return;
          const borrada = aBorrar.id;
          await borrarConversacion(borrada);
          setABorrar(null);
          if (borrada === activaId) router.push("/reportes/asistente");
          else router.refresh();
        }}
      />
    </div>
  );
}

function TituloEditable({
  id,
  titulo,
  onCerrar,
}: {
  id: number;
  titulo: string;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(titulo);
  const [guardando, startGuardado] = useTransition();

  function guardar() {
    const limpio = texto.trim();
    if (!limpio || limpio === titulo) {
      onCerrar();
      return;
    }
    startGuardado(async () => {
      await renombrarConversacion(id, limpio);
      onCerrar();
      router.refresh();
    });
  }

  return (
    <Input
      autoFocus
      value={texto}
      disabled={guardando}
      aria-label="Nombre de la conversación"
      className="h-7 text-[12.5px]"
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          guardar();
        }
        if (e.key === "Escape") onCerrar();
      }}
    />
  );
}

function PanelChat({ conversacion }: { conversacion: ConversacionCompleta }) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>(conversacion.mensajes);
  const [texto, setTexto] = useState("");
  const [adjunto, setAdjunto] = useState<ResumenAdjunto | null>(
    conversacion.adjuntoPendiente,
  );
  const [previos, setPrevios] = useState<ResumenAdjunto[]>(
    conversacion.adjuntosPrevios,
  );
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tokensContexto, setTokensContexto] = useState(
    conversacion.tokensContexto,
  );
  const [cuota, setCuota] = useState<EstadoCuota>(conversacion.cuota);
  const [enviando, startEnvio] = useTransition();
  const [adjuntando, startAdjunto] = useTransition();
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes.length, enviando]);

  function handleEnviar() {
    const pregunta = texto.trim();
    if (!pregunta || enviando) return;
    setError(null);
    setAviso(null);
    setTexto("");

    startEnvio(async () => {
      const r = await enviarMensaje(conversacion.id, pregunta, adjunto?.id);
      if (!r.ok) {
        setError(r.error);
        if (r.textoDevuelto !== undefined) setTexto(r.textoDevuelto);
        if (r.cuota) setCuota(r.cuota);
        return;
      }
      setMensajes((prev) => [...prev, r.mensajeUsuario, r.respuesta]);
      setTokensContexto(r.tokensContexto);
      setCuota(r.cuota);
      if (adjunto) {
        setPrevios((p) => [
          { ...adjunto, usadoEn: new Date().toISOString() },
          ...p.filter((x) => x.id !== adjunto.id),
        ]);
      }
      setAdjunto(null);
      if (r.omitidos > 0) {
        setAviso(
          `La conversación superó el contexto que entra en un mensaje: ${r.omitidos} mensaje${r.omitidos === 1 ? "" : "s"} más viejo${r.omitidos === 1 ? "" : "s"} no se ${r.omitidos === 1 ? "envió" : "enviaron"} al modelo. Siguen guardados acá.`,
        );
      }
    });
  }

  function handleAdjuntarMes() {
    setError(null);
    startAdjunto(async () => {
      const hoy = new Date();
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      try {
        const { adjunto: nuevo } = await prepararReporteParaChat(
          {
            desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
            hasta: iso(hoy),
          },
          { tipo: "existente", conversacionId: conversacion.id },
        );
        setAdjunto(nuevo);
      } catch {
        setError("No se pudo generar el reporte para adjuntar.");
      }
    });
  }

  function handleReutilizar(id: number) {
    setError(null);
    startAdjunto(async () => {
      try {
        const nuevo = await reutilizarAdjunto(id);
        setAdjunto(nuevo);
        setPrevios((p) => p.filter((x) => x.id !== id));
      } catch {
        setError("Ese reporte ya no está disponible.");
      }
    });
  }

  function handleQuitarAdjunto() {
    const quitado = adjunto;
    setAdjunto(null);
    startAdjunto(async () => {
      await descartarAdjuntoPendiente(conversacion.id);
      if (quitado?.usadoEn) {
        setPrevios((p) =>
          p.some((x) => x.id === quitado.id) ? p : [quitado, ...p],
        );
      }
    });
  }

  const fraccion =
    conversacion.limiteContexto > 0
      ? tokensContexto / conversacion.limiteContexto
      : 0;
  const cercaDelLimite = fraccion >= UMBRAL_AVISO_CONTEXTO;

  return (
    <Card className="flex min-h-[32rem] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">
            {conversacion.titulo}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {conversacion.modelo}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <div
            className={cn(
              "text-[11px] tabular-nums",
              cercaDelLimite
                ? "font-medium text-amber-500"
                : "text-muted-foreground",
            )}
            title="Tokens del historial contra lo que entra en un mensaje. Al pasarse, los más viejos dejan de mandarse al modelo (siguen guardados)."
          >
            {tokensContexto.toLocaleString("es-UY")} /{" "}
            {conversacion.limiteContexto.toLocaleString("es-UY")} tokens
          </div>
          <CuotaDiaria cuota={cuota} />
        </div>
      </div>

      {conversacion.avisoChat && mensajes.length === 0 && (
        <p className="border-b border-border/60 bg-muted/40 px-4 py-2.5 text-[11.5px] text-muted-foreground">
          {conversacion.avisoChat}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {mensajes.length === 0 ? (
          <p className="py-10 text-center text-[12.5px] text-muted-foreground">
            Preguntá algo sobre tus gastos. Con el botón de adjuntar le pasás el
            reporte de este mes; para otro período (o con filtros), usá
            &ldquo;Analizar con IA&rdquo; en Reportes.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {mensajes.map((m) => (
              <Burbuja key={m.id} mensaje={m} />
            ))}
          </div>
        )}
        {enviando && (
          <div className="mt-3 text-[12.5px] text-muted-foreground">
            <EsperandoIA texto="Pensando..." />
          </div>
        )}
        <div ref={finRef} />
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        {cuota.agotadoHastaManana && (
          <p className="mb-2 text-[11.5px] text-amber-500">
            Se agotó la cuota diaria de este proveedor
            {cuota.limiteDiario !== null &&
              ` (${cuota.limiteDiario.toLocaleString("es-UY")} consultas por día)`}
            . Esperar no alcanza: vuelve mañana, o podés empezar una conversación
            nueva con otro proveedor desde Ajustes.
          </p>
        )}
        {aviso && (
          <p className="mb-2 text-[11.5px] text-amber-500">{aviso}</p>
        )}
        {error && (
          <p className="mb-2 text-[11.5px] text-destructive">{error}</p>
        )}

        {adjunto && (
          <div className="mb-2 flex flex-col gap-1">
            <div
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-full border py-1 pr-1 pl-2.5 text-[11.5px]",
                adjunto.excedeContexto
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-border/60 bg-muted/60",
              )}
            >
              <FileJson className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                {adjunto.etiqueta} · ~
                {adjunto.tokensEstimados.toLocaleString("es-UY")} tokens
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Quitar el reporte adjunto"
                className="text-muted-foreground hover:text-foreground"
                onClick={handleQuitarAdjunto}
              >
                <X />
              </Button>
            </div>
            {adjunto.excedeContexto && (
              <p className="flex items-start gap-1.5 text-[11.5px] text-amber-500">
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  El reporte no entra entero en el contexto de{" "}
                  {conversacion.modelo}: se va a mandar recortado. Conviene
                  exportar un período más corto desde Reportes.
                </span>
              </p>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            value={texto}
            rows={2}
            placeholder="Preguntá sobre tus gastos…"
            disabled={enviando}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleEnviar();
              }
            }}
            className="max-h-40 flex-1 text-[13px]"
          />
          <div className="flex flex-col gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Adjuntar un reporte"
                    title="Adjuntar un reporte"
                    disabled={adjuntando || enviando || adjunto !== null}
                  >
                    <FileJson />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="max-w-72">
                <DropdownMenuItem onClick={handleAdjuntarMes}>
                  Reporte de este mes
                </DropdownMenuItem>
                {previos.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    {previos.map((a) => (
                      <DropdownMenuItem
                        key={a.id}
                        onClick={() => handleReutilizar(a.id)}
                      >
                        <span className="truncate">{a.etiqueta}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="icon"
              aria-label="Enviar"
              disabled={enviando || !texto.trim() || cuota.agotadoHastaManana}
              onClick={handleEnviar}
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CuotaDiaria({ cuota }: { cuota: EstadoCuota }) {
  if (cuota.requestsRestantesHoy === null || cuota.limiteDiario === null) {
    return null;
  }

  const fraccion = cuota.requestsRestantesHoy / cuota.limiteDiario;

  return (
    <div
      className={cn(
        "text-[11px] tabular-nums",
        cuota.agotadoHastaManana
          ? "font-medium text-destructive"
          : fraccion <= 0.2
            ? "font-medium text-amber-500"
            : "text-muted-foreground",
      )}
      title="Consultas que quedan hoy contra el límite diario del proveedor. Cuenta todo el consumo de la app (chat, importaciones y pruebas de conexión), porque el proveedor no los distingue. Es una estimación por día calendario local: el proveedor puede contar la ventana distinto."
    >
      {cuota.requestsRestantesHoy.toLocaleString("es-UY")} /{" "}
      {cuota.limiteDiario.toLocaleString("es-UY")} consultas hoy
    </div>
  );
}

function Burbuja({ mensaje }: { mensaje: MensajeChat }) {
  const esUsuario = mensaje.rol === "user";
  const { reporte, pregunta } = esUsuario
    ? separarReporteAdjunto(mensaje.contenido)
    : { reporte: null, pregunta: mensaje.contenido };

  return (
    <div className={cn("flex", esUsuario ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] whitespace-pre-wrap",
          esUsuario
            ? "bg-primary/10 text-foreground"
            : "border border-border/60 bg-muted/40",
        )}
      >
        {reporte && (
          <details className="mb-1.5">
            <summary className="cursor-pointer text-[11.5px] text-muted-foreground marker:text-muted-foreground">
              Reporte adjunto ({reporte.length.toLocaleString("es-UY")}{" "}
              caracteres)
            </summary>
            <pre className="mt-1.5 max-h-64 overflow-auto rounded-md bg-background/60 p-2 text-[10.5px] leading-relaxed">
              {reporte}
            </pre>
          </details>
        )}
        {esUsuario ? pregunta : <TextoConEnfasis texto={pregunta} />}
      </div>
    </div>
  );
}

function TextoConEnfasis({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
  return (
    <>
      {partes.map((parte, i) => {
        if (parte.startsWith("**") && parte.endsWith("**") && parte.length > 4) {
          return <strong key={i}>{parte.slice(2, -2)}</strong>;
        }
        if (parte.startsWith("*") && parte.endsWith("*") && parte.length > 2) {
          return <em key={i}>{parte.slice(1, -1)}</em>;
        }
        return parte;
      })}
    </>
  );
}
