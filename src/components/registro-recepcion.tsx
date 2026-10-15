import { AlertTriangle, ImageUp, MessageCircle, RotateCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { EventoRecepcion, FallaRecepcion } from "@/lib/entrantes-server";

const formatoHora = new Intl.DateTimeFormat("es-UY", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const ORIGEN = {
  whatsapp: { icono: MessageCircle, texto: "WhatsApp" },
  subida: { icono: ImageUp, texto: "Foto subida" },
  reintento: { icono: RotateCw, texto: "Volver a leer" },
} as const;

function Falla({ falla }: { falla: FallaRecepcion }) {
  return (
    <p className="flex items-start gap-1.5 text-destructive">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-medium">{falla.paso}:</span> {falla.detalle}
      </span>
    </p>
  );
}

/**
 * Registro de recepción: cada mensaje que llegó por WhatsApp y cada falla al
 * leer un comprobante. Un mensaje que no aparece acá no llegó a la app: el
 * webhook anota cada uno antes de contestarle a Meta.
 */
export function RegistroRecepcion({ eventos }: { eventos: EventoRecepcion[] }) {
  return (
    <section id="registro" className="flex scroll-mt-6 flex-col gap-2">
      <h2 className="text-sm font-semibold">Registro de recepción</h2>
      <p className="text-xs text-muted-foreground">
        Cada mensaje que llega por WhatsApp se anota acá, aunque no traiga foto
        o venga de un número no autorizado, junto con cualquier error al leerlo
        (QR, DGI, proveedor, modelos de IA). Si mandaste algo y no aparece, Meta
        no lo entregó.
      </p>
      {eventos.length === 0 ? (
        <Card className="px-5 py-6 text-center text-sm text-muted-foreground">
          Todavía no hay nada registrado.
        </Card>
      ) : (
        <Card className="gap-0 divide-y divide-border px-0 py-0">
          {eventos.map((ev) => {
            const { icono: Icono, texto } = ORIGEN[ev.tipo === "whatsapp" ? "whatsapp" : ev.origen];
            return (
              <div key={ev.id} className="flex flex-col gap-1 px-4 py-2.5 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Icono className="h-3.5 w-3.5" />
                    {texto}
                  </span>
                  <span>{formatoHora.format(new Date(ev.fecha))}</span>
                  {ev.tipo === "whatsapp" && <span>+{ev.remitente}</span>}
                </div>
                {ev.tipo === "whatsapp" ? (
                  <>
                    <div className={ev.resultado === null ? "text-muted-foreground" : undefined}>
                      {ev.resultado ?? "Procesando..."}
                    </div>
                    {ev.fallas.map((f, i) => (
                      <Falla key={i} falla={f} />
                    ))}
                  </>
                ) : (
                  <Falla falla={ev.falla} />
                )}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
