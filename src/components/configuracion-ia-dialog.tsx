"use client";

import { useState, useTransition } from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SeccionColapsable } from "@/components/seccion-colapsable";
import {
  guardarApiKeyIA,
  borrarApiKeyIA,
  guardarLimitadorIA,
  guardarModeloIA,
  guardarProveedorActivoIA,
  guardarRpdIA,
  guardarTpmIA,
  guardarUrlProveedorIA,
  actualizarModelosProveedor,
  type EstadoProveedorIA,
} from "@/app/actions/configuracion";
import { PROVEEDORES, configDe, type ProveedorIA } from "@/lib/proveedores-ia";
import { probarConexionIA } from "@/app/actions/ia";
import { EsperandoIA, BloqueoIA } from "@/components/esperando-ia";

type Mensaje = { ok: boolean; texto: string };

function formatearActualizado(iso: string): string {
  if (!iso) return "sin actualizar";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "sin actualizar";
  return `actualizado el ${d.toLocaleDateString("es-UY", {
    day: "numeric",
    month: "short",
  })}`;
}


export function ConfiguracionIaDialog({
  proveedorInicial,
  estados,
  limitadorInicial,
}: {
  proveedorInicial: ProveedorIA;
  estados: EstadoProveedorIA[];
  limitadorInicial: boolean;
}) {
  const [limitador, setLimitador] = useState(limitadorInicial);
  const [guardandoLimitador, startLimitador] = useTransition();
  const [proveedorActivo, setProveedorActivo] =
    useState<ProveedorIA>(proveedorInicial);
  const [mensajeGlobal, setMensajeGlobal] = useState<Mensaje | null>(null);
  const [cambiandoActivo, startCambioActivo] = useTransition();

  function handleCambiarActivo(proveedor: ProveedorIA) {
    const previo = proveedorActivo;
    setProveedorActivo(proveedor);
    setMensajeGlobal(null);
    startCambioActivo(async () => {
      try {
        await guardarProveedorActivoIA(proveedor);
        setMensajeGlobal({
          ok: true,
          texto: `Proveedor activo: ${configDe(proveedor).nombre}.`,
        });
      } catch (e) {
        setProveedorActivo(previo);
        setMensajeGlobal({
          ok: false,
          texto: e instanceof Error ? e.message : "No se pudo cambiar",
        });
      }
    });
  }

  function handleLimitador(activo: boolean) {
    const previo = limitador;
    setLimitador(activo);
    setMensajeGlobal(null);
    startLimitador(async () => {
      try {
        await guardarLimitadorIA(activo);
      } catch (e) {
        setLimitador(previo);
        setMensajeGlobal({
          ok: false,
          texto: e instanceof Error ? e.message : "No se pudo guardar",
        });
      }
    });
  }

  const estadoActivo = estados.find((e) => e.proveedor === proveedorActivo);

  return (
    <SeccionColapsable
      icono={Sparkles}
      titulo="Interpretación con IA"
      descripcion="Opcional. El estado de cuenta se lee con un parser propio; la IA es una red de seguridad por si aparece un formato distinto. Antes de cualquier consulta se quitan el número de tarjeta y los datos de contacto."
      abiertaPorDefecto
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Proveedor activo
        </label>
        <Select
          value={proveedorActivo}
          disabled={cambiandoActivo}
          onChange={(e) => handleCambiarActivo(e.target.value as ProveedorIA)}
          className="text-[13px]"
        >
          {PROVEEDORES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Select>
        <p className="text-[11.5px] text-muted-foreground">
          El que se usa al analizar en Importar. Las keys de los demás quedan
          guardadas.
        </p>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 px-3 py-2.5">
        <input
          type="checkbox"
          checked={limitador}
          disabled={guardandoLimitador}
          onChange={(e) => handleLimitador(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-primary"
        />
        <span>
          <span className="text-[12.5px] font-medium">
            Frenar antes de pasarse de la cuota
          </span>
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
            Cuenta consultas por minuto y por día, y tokens por minuto, contra
            los límites de cada proveedor: así una consulta que el proveedor iba
            a rechazar no se gasta. Desactivarlo saca el freno pero el consumo
            se sigue contando.
          </span>
        </span>
      </label>

      {estadoActivo && !estadoActivo.guardada && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-[12px] text-muted-foreground">
            El proveedor activo no tiene API key configurada: el análisis con IA
            no aparece en Importar hasta que cargues una acá abajo.
          </p>
        </div>
      )}

      {mensajeGlobal && (
        <MensajeLinea mensaje={mensajeGlobal} className="mt-3" />
      )}

      <Tabs defaultValue={proveedorActivo} className="mt-5">
        <TabsList variant="line" className="flex-wrap">
          {estados.map((estado) => (
            <TabsTrigger key={estado.proveedor} value={estado.proveedor}>
              {configDe(estado.proveedor).nombre}
              {estado.proveedor === proveedorActivo && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              )}
              {!estado.guardada && (
                <span className="ml-1 text-[10.5px] text-muted-foreground">
                  sin key
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {estados.map((estado) => (
          <TabsContent key={estado.proveedor} value={estado.proveedor}>
            <FilaProveedor
              estado={estado}
              esActivo={estado.proveedor === proveedorActivo}
            />
          </TabsContent>
        ))}
      </Tabs>
    </SeccionColapsable>
  );
}

function FilaProveedor({
  estado,
  esActivo,
}: {
  estado: EstadoProveedorIA;
  esActivo: boolean;
}) {
  const config = configDe(estado.proveedor);
  const [apiKey, setApiKey] = useState("");
  const [modelo, setModelo] = useState(estado.modelo);
  const [url, setUrl] = useState(estado.url || estado.urlPorDefecto);
  const [tpm, setTpm] = useState(estado.tpm ? String(estado.tpm) : "");
  const [rpd, setRpd] = useState(estado.rpd ? String(estado.rpd) : "");
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [guardando, startGuardado] = useTransition();
  const [probando, startPrueba] = useTransition();
  const [modelosSugeridos, setModelosSugeridos] = useState(
    estado.catalogo?.modelos ?? [],
  );
  const [actualizadoEn, setActualizadoEn] = useState(
    estado.catalogo?.actualizadoEn ?? "",
  );
  const [actualizando, startActualizacion] = useTransition();
  const idDatalist = `modelos-${estado.proveedor}`;

  function handleActualizarModelos() {
    setMensaje(null);
    startActualizacion(async () => {
      const r = await actualizarModelosProveedor(estado.proveedor);
      if (r.ok) {
        setModelosSugeridos(r.modelos);
        setActualizadoEn(new Date().toISOString());
      }
      setMensaje({ ok: r.ok, texto: r.mensaje });
    });
  }

  function handleGuardar() {
    setMensaje(null);
    startGuardado(async () => {
      try {
        const key = apiKey.trim();
        if (key) await guardarApiKeyIA(estado.proveedor, key);
        if (modelo.trim() !== estado.modelo) {
          await guardarModeloIA(estado.proveedor, modelo);
        }
        if (url.trim() !== (estado.url || estado.urlPorDefecto)) {
          await guardarUrlProveedorIA(estado.proveedor, url);
          if (!url.trim()) setUrl(estado.urlPorDefecto);
        }
        if (numeroOVacio(tpm) !== estado.tpm) {
          await guardarTpmIA(
            estado.proveedor,
            modelo.trim() || estado.modeloPorDefecto,
            numeroOVacio(tpm),
          );
        }
        if (numeroOVacio(rpd) !== estado.rpd) {
          await guardarRpdIA(estado.proveedor, numeroOVacio(rpd));
        }
        setApiKey("");
        setMensaje({
          ok: true,
          texto: key ? "Key y ajustes guardados." : "Cambios guardados.",
        });
      } catch (e) {
        setMensaje({
          ok: false,
          texto: e instanceof Error ? e.message : "No se pudo guardar",
        });
      }
    });
  }

  function handleProbar() {
    setMensaje(null);
    startPrueba(async () => {
      const r = await probarConexionIA({
        proveedor: estado.proveedor,
        apiKey: apiKey.trim() || undefined,
      });
      setMensaje({ ok: r.ok, texto: r.mensaje });
    });
  }

  function handleBorrar() {
    setMensaje(null);
    startGuardado(async () => {
      try {
        await borrarApiKeyIA(estado.proveedor);
        setApiKey("");
        setMensaje({ ok: true, texto: "API key borrada." });
      } catch (e) {
        setMensaje({
          ok: false,
          texto: e instanceof Error ? e.message : "No se pudo borrar",
        });
      }
    });
  }

  const modeloEsDefault = estado.modelo === estado.modeloPorDefecto;
  const urlEsDefault = url.trim() === estado.urlPorDefecto;

  return (
    <div
      className={`relative flex flex-col gap-2.5 rounded-lg border px-3.5 py-3 ${
        esActivo ? "border-primary/40 bg-primary/[0.03]" : "border-border/60"
      }`}
    >
      {probando && <BloqueoIA texto="Probando conexión…" />}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{config.nombre}</span>
        {esActivo && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">
            activo
          </span>
        )}
        <span className="text-[11.5px] text-muted-foreground">
          {estado.guardada ? `key ${estado.enmascarada}` : "sin key"}
        </span>
        {config.urlKeys && (
          <a
            href={config.urlKeys}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            obtener key <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="grid items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11.5px] text-muted-foreground">API key</label>
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              estado.guardada
                ? "Dejar vacío para conservar la actual"
                : "API key"
            }
            className="text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11.5px] text-muted-foreground">Modelo</label>
          <Input
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder={estado.modeloPorDefecto}
            spellCheck={false}
            className="font-mono text-[12px]"
            list={estado.catalogo ? idDatalist : undefined}
            autoComplete="off"
          />
          {estado.catalogo && (
            <datalist id={idDatalist}>
              {modelosSugeridos.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          {!modeloEsDefault && (
            <p className="text-[11.5px] text-muted-foreground">
              Default:{" "}
              <span className="font-mono">{estado.modeloPorDefecto}</span> —
              vaciá el campo y guardá para volver a él.
            </p>
          )}
          {estado.catalogo && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                onClick={handleActualizarModelos}
                disabled={actualizando}
                className="flex items-center gap-1 text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3 w-3 ${actualizando ? "animate-spin" : ""}`}
                />
                {actualizando ? "Actualizando…" : "Actualizar modelos"}
              </button>
              <a
                href={estado.catalogo.urlListado}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                ver catálogo <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-[11.5px] text-muted-foreground">
                {modelosSugeridos.length > 0
                  ? `${modelosSugeridos.length} gratuitos · ${formatearActualizado(actualizadoEn)}`
                  : "sin sugerencias todavía"}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <label className="text-[11.5px] text-muted-foreground">
            Endpoint
            {estado.proveedor === "gemini" && (
              <>
                {" "}
                — base, se le agrega{" "}
                <span className="font-mono">/modelo:generateContent</span>
              </>
            )}
          </label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={estado.urlPorDefecto}
            spellCheck={false}
            className="font-mono text-[12px]"
          />
          {!urlEsDefault && (
            <p className="text-[11.5px] break-all text-muted-foreground">
              Default por código:{" "}
              <span className="font-mono">{estado.urlPorDefecto}</span> — vaciá
              el campo y guardá para volver a él.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleGuardar} disabled={guardando || probando}>
          {guardando ? "Guardando..." : "Guardar"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleProbar}
          disabled={probando || (!apiKey.trim() && !estado.guardada)}
        >
          {probando ? <EsperandoIA texto="Probando…" /> : "Probar conexión"}
        </Button>
        {estado.guardada && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleBorrar}
            disabled={guardando || probando}
          >
            Borrar key
          </Button>
        )}
      </div>

      {(estado.tpmPorDefecto !== null ||
        estado.rpdPorDefecto !== null ||
        estado.rpmPorDefecto !== null) && (
        <div className="grid items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {estado.tpmPorDefecto !== null && (
            <div className="flex flex-col gap-1">
              <label className="text-[11.5px] text-muted-foreground">
                Tokens por minuto
              </label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={tpm}
                onChange={(e) => setTpm(e.target.value)}
                placeholder={String(estado.tpmPorDefecto)}
                className="text-[13px] tabular-nums"
              />
              <p className="text-[11.5px] text-muted-foreground">
                Varía por modelo. Default para{" "}
                <span className="font-mono">{estado.modeloPorDefecto}</span>:{" "}
                {estado.tpmPorDefecto.toLocaleString("es-UY")} — vaciá el campo
                para volver a él.
              </p>
            </div>
          )}
          {estado.rpdPorDefecto !== null && (
            <div className="flex flex-col gap-1">
              <label className="text-[11.5px] text-muted-foreground">
                Consultas por día
              </label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={rpd}
                onChange={(e) => setRpd(e.target.value)}
                placeholder={String(estado.rpdPorDefecto)}
                className="text-[13px] tabular-nums"
              />
              <p className="text-[11.5px] text-muted-foreground">
                Default: {estado.rpdPorDefecto.toLocaleString("es-UY")}
                {estado.proveedor === "openrouter" &&
                  " — sube a 1.000 con US$10 de créditos por única vez"}
                .
              </p>
            </div>
          )}
          {estado.rpmPorDefecto !== null && (
            <div className="flex flex-col gap-1">
              <label className="text-[11.5px] text-muted-foreground">
                Consultas por minuto
              </label>
              <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 text-[13px] tabular-nums text-muted-foreground">
                {estado.rpmPorDefecto}
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                Fijo por el proveedor: no se puede subir.
              </p>
            </div>
          )}
        </div>
      )}

      {config.avisoPrivacidad && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-[11.5px] text-muted-foreground">
            {config.avisoPrivacidad}
          </p>
        </div>
      )}

      {mensaje && <MensajeLinea mensaje={mensaje} />}
    </div>
  );
}

function numeroOVacio(valor: string): number | null {
  const limpio = valor.trim();
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function MensajeLinea({
  mensaje,
  className = "",
}: {
  mensaje: Mensaje;
  className?: string;
}) {
  return (
    <p
      className={`flex items-center gap-1.5 text-xs ${
        mensaje.ok ? "text-primary" : "text-destructive"
      } ${className}`}
    >
      {mensaje.ok ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" />
      )}
      {mensaje.texto}
    </p>
  );
}
