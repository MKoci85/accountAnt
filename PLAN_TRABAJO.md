# Plan de trabajo — revisión del informe externo

Resultado de contrastar el informe de revisión contra el código (commit `d9958ad`).
Quedan fuera por decisión: el respaldo de la base (se hace a mano, fuera del código)
y todo lo de `/reportes` (hallazgo 4 del informe: todavía no hay datos para validarlo).

Cada paso es independiente y se puede commitear solo. Verificación de cada uno:
`npm test`, `npm run lint`, `npx tsc --noEmit`.

Orden: primero lo que puede guardar un dato malo sin que nadie lo vea (1, 2),
después lo que puede perder o colgar una captura (3, 4), al final la higiene (5, 6).

---

## 1. Total de uCFE: que un total ilegible nunca pase el guardado automático

**Problema confirmado.** `consultarUcfe` (`src/lib/cfe.ts:504-505`) hace
`Number(texto.replace(",", "."))`. Con `1.285,00` o `1,285.00` da `NaN`. Ese `NaN`
atraviesa `??` en `leerDesdeQR` y en `motivoDeRevision` la comparación
`Math.abs(suma - NaN) > 1` es falsa: el control de "la suma coincide con el total"
queda anulado. Lo mismo pasa en el formulario (`nuevo-gasto-form.tsx:697-700`):
el aviso de diferencia no aparece.

No se sabe qué formato imprime uCFE en el HTML para totales de más de $1.000
(no hay fixture). Por eso el parser tiene que tolerar los dos.

- [x] Extraer de `consultarUcfe` una función pura `parsearResultadoUcfe(html)`
      (emisor, total, moneda) para poder testearla sin red.
- [x] Parser de monto tolerante para ese total: el último separador seguido de 1–2
      dígitos es el decimal, el resto son miles. Cubre `1285,00`, `1.285,00`,
      `1,285.00` y `1285.00`. No reusar `parsearMontoUY` a ciegas: rompería `1285.00`.
- [x] Si el total del HTML no es finito, usar el `TOTAL A PAGAR` del PDF
      (`parsearItemsPdfUcfe` ya lo lee con `parsearMontoUY` pero no lo devuelve);
      si tampoco, `null`.
- [x] Red de seguridad general, no sólo uCFE: en `consultarCFE`
      (`src/app/actions/cfe.ts`) normalizar `detalle.total` a `null` cuando no es
      finito. Así ningún proveedor (los otros usan `parsearMontoUY`, que también
      puede dar `NaN`) puede entregar un `NaN` al formulario ni a la bandeja.
- [x] `motivoDeRevision` (`src/lib/entrantes.ts`): tratar total no finito como
      "no trajo el total", y precio/cantidad no finitos como línea inválida
      (hoy `l.precio <= 0` no atrapa un `NaN`).
- [x] Tests: `parsearResultadoUcfe` con total < 1.000, con miles en ambos formatos
      y con texto basura; `motivoDeRevision` con `total: NaN` → exige revisión.
- [ ] Si aparece un ticket real de uCFE de más de $1.000, guardar el fragmento del
      HTML como fixture y fijar el formato real.

## 2. Identidad del comprobante: sumar `tipo_cfe`

**Problema confirmado.** `claveComprobante` usa RUC+tipo+serie+número, pero el
índice único de `gastos` (`src/db/schema/gastos.ts:42-44`) y la consulta de
`comprobanteRepetido` (`src/lib/entrantes-recepcion.ts:250-261`) omiten el tipo.
Un e-Ticket y una e-Factura (o una nota de crédito) del mismo emisor con igual
serie y número se rechazarían como duplicado.

Ampliar la clave no puede generar colisiones con datos existentes (es menos
restrictiva), así que no hay nada que "resolver" antes de migrar. Lo que sí hay
que mirar: SQLite trata los `NULL` como distintos en un índice único, así que una
fila con `serie` cargada y `tipo_cfe` nulo quedaría fuera del control.

- [x] Contar `SELECT count(*) FROM gastos WHERE serie IS NOT NULL AND tipo_cfe IS NULL`.
      Si hay filas, decidir: completarlas a mano o indexar `coalesce(tipo_cfe, '')`.
- [x] Cambiar el índice a `(emisorId, tipoCfe, serie, numero)` en el schema,
      `npm run db:generate` y **revisar el SQL generado a mano** (debe ser
      `DROP INDEX` + `CREATE UNIQUE INDEX ... WHERE serie is not null`, sin
      reconstruir la tabla).
- [x] Agregar `eq(gastos.tipoCfe, datos.tipoCfe)` en `comprobanteRepetido`.
- [x] `npm run db:migrate` y probar: reescanear un comprobante ya cargado sigue
      dando "ya fue cargado".
- [x] Actualizar la línea del índice en `CLAUDE.md` (sección Data model).

## 3. Timeouts en DGI y proveedores de CFE

**Problema confirmado**, con un matiz: no es "indefinido" — el `fetch` de Node
corta solo a los ~5 minutos — pero es demasiado para un escaneo, y en la vía de
WhatsApp un proveedor colgado frena los mensajes que vienen detrás.
Los 8 `fetch` de `src/lib/cfe.ts` (líneas 94, 251, 366, 449, 479, 513, 540, 657)
no llevan `signal`. BCU, IA, WhatsApp y el relay sí.

Lo que el informe pide como "conservar el QR y seguir" ya existe: un fallo del
proveedor vuelve como `errorProveedor` con el emisor resuelto, y el entrante
guarda `qrTexto`.

- [x] Fila nueva en `AJUSTES` (`src/lib/config-server.ts`): `cfeTimeoutMs`,
      default 20000, más su campo en el diálogo de ajustes avanzados.
- [x] Un helper en `cfe.ts` que envuelva `fetch` con
      `AbortSignal.timeout(await leerAjuste("cfeTimeoutMs"))` y usarlo en los 8 sitios.
- [x] Traducir el `TimeoutError` a un mensaje legible ("El proveedor no respondió
      a tiempo"): hoy llegaría en inglés a `errorProveedor`. El de DGI ya cae en
      el mensaje genérico de `consultarCFE`.
- [x] En uCFE el timeout del PDF debe degradar a "sin ítems" (como ya hace con un
      PDF inválido), no tirar toda la consulta.

## 4. WhatsApp: no perder un mensaje si el proceso se reinicia

**Problema real pero acotado.** El caso "una excepción interrumpe y ya no se
reintenta" está casi cubierto: `desenlaceDe` tiene `try/catch`, anota el problema
y le contesta al remitente. Lo que queda es el reinicio del proceso (o un cuelgue)
entre el 200 y el final de la lectura. Dos agravantes que el informe no menciona:

- los mensajes de un mismo webhook se procesan en serie, así que el id del segundo
  no se registra hasta que termina el primero (minutos, si hay IA);
- `mensajes_whatsapp` no guarda el `mediaId`, así que aunque quede la fila con
  `resultado` nulo no hay con qué volver a bajar la foto.

No hace falta una cola con cuatro estados para un solo usuario. Alcanza con:

- [x] Migración: columna `media_id` (nullable) en `mensajes_whatsapp`.
- [x] Separar `procesarMensajeWhatsapp` en dos: `registrarMensaje` (el insert
      `onConflictDoNothing`, ahora con `mediaId`) y `procesarMensajeRegistrado`.
- [x] En `route.ts`, registrar **todos** los mensajes de forma síncrona antes de
      devolver el 200 (es un insert de SQLite: milisegundos). `after()` sólo procesa
      los que el insert devolvió como nuevos.
- [x] Recuperación: `resultado IS NULL` con más de N minutos = mensaje interrumpido.
      Reprocesarlos al inicio de cada `after()` del webhook y ofrecer un botón
      "Reintentar" en el registro de `/ajustes`. Antes de pensar en un hook de
      arranque, leer la guía de `instrumentation` en `node_modules/next/dist/docs/`.
- [x] Si Meta ya no entrega el media, anotar "No se pudo recuperar la foto" y
      avisar al remitente para que la reenvíe.
- [x] El relay (`webhook/servidor.mjs`) no se toca.
- [x] Test de la parte pura que se agregue (qué filas cuentan como interrumpidas).

## 5. Validación real de fechas

**Confirmado, prioridad baja.** `fechaISODesdeQR` acepta `31/02`, y tres sitios
validan sólo con la regex `^\d{4}-\d{2}-\d{2}$`: `actions/ia.ts:334` (movimientos),
`actions/ia.ts:597` (ticket) y `entrantes-recepcion.ts:203`. El riesgo real está
en las fechas leídas por IA, no en las del QR que DGI ya validó.

- [x] `esFechaISOValida(texto)` en `src/lib/formato.ts`: formato + que la fecha
      exista en el calendario (armar el `Date` y comparar ida y vuelta).
- [x] Usarla en los cuatro sitios. En `fechaISODesdeQR` sigue devolviendo `null`.
- [x] Tests: `2026-02-31`, `2026-13-01`, bisiesto válido e inválido.

## 6. Estado de cuenta: importes negativos según el camino de lectura

**Confirmado; es una decisión de dominio, no un bug.** El parser de PDF conserva
los negativos (descuentos tipo `DTO.BROU- ANCAP`, con test propio) y la pantalla
los muestra sin preseleccionar (`estado-cuenta-view.tsx:149`). La vía de IA los
descarta dos veces: el prompt pide "sólo compras" y `validarMovimientos` filtra
`monto <= 0`. Efecto visible: el total del resumen difiere según el camino.

- [x] Decisión: los descuentos no son filas a revisar. Se muestran sólo como
      suma junto al total ("Descuentos: $X"), sin detalle, y no se importan.
- [x] `separarDescuentos` (`src/lib/estado-cuenta.ts`) los saca antes del cotejo;
      `AnalisisEstadoCuenta.descuentos` lleva la suma (USD convertido con BCU,
      o aparte si no hay cotización).
- [x] La vía de IA los trae igual que el PDF: `validarMovimientos` descarta sólo
      `monto === 0` y `PROMPT_EXTRACCION` los pide con signo negativo (siguen
      excluidos pagos, saldos y totales).

---

## Lo que no se hace

- **Reportes / ahorro negativo** (hallazgo 4): fuera de alcance por ahora.
- **Respaldo de la base**: manual, fuera del código.
- **Tests de integración con SQLite temporal**: contradice una decisión ya tomada
  y documentada en `CLAUDE.md`. La alternativa de este plan es la de siempre:
  extraer la parte pura y testearla (pasos 1, 4 y 5).
- **Refactor de archivos grandes**: sin acción. Sólo la extracción puntual del paso 1.
