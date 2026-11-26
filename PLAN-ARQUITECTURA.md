# Plan de mejoras de arquitectura

Resultado de revisar `src/` completo (149 archivos, ~33.500 líneas). La base es sólida: convenciones que se respetan (`accion`/`desenvolver`, `DialogFormulario` + `useEnvioDialog`, `ComboboxBusqueda`, `VistaCamara`/`useCamara`), configuración como datos (`PROVEEDORES`, `FORMATOS_PROVEEDOR_CFE`, `AJUSTES`) y reglas de negocio puras y testeadas en `src/lib/`. Los problemas están en **las fronteras entre capas** y en **archivos que crecieron de más**, no en el diseño de cada pieza.

Los pasos están ordenados para que cada uno deje la app funcionando y prepare el siguiente: primero lo que no cambia comportamiento y desbloquea el resto (tipos, helpers), después mover lógica entre capas, después componentes, y al final lo que sí cambia comportamiento.

**Verificación de cada paso:** `npm test` (desde PowerShell: desde Git Bash Vitest falla en todas las suites por la ruta `/f/...`), `npm run lint`, `npx tsc --noEmit`, y recorrer a mano los flujos que toca el paso con `npm run dev`.

---

## Paso 0 — Limpieza rápida

Cosas sueltas, sin riesgo, que conviene sacar antes de mover código.

- **Borrar `borrarSecretoWhatsapp`** (`src/app/actions/whatsapp.ts`): nadie la usa, y es una escritura exportada desde un `"use server"` sin `accion`, o sea un endpoint sin dueño.
- **Mover `shadcn` a `devDependencies`**: es la CLI que copia componentes, no se usa en runtime.
- **Sacar los comentarios `//`** (112 líneas en 21 archivos). Lo que valga la pena conservar pasa a JSDoc de la función o a la documentación; el resto se borra.
- **Decidir `registrarAliasTicket` / `borrarAliasTicket`**: son escrituras llamadas desde el cliente sin `accion`. Si es a propósito (fire-and-forget), dejarlo escrito como excepción a la regla; si no, envolverlas.

**Hecho cuando:** `grep -rnE "^\s*//" src` no devuelve nada fuera de tests, y no queda ningún export de `"use server"` sin uso.

**Estado: hecho.** Los alias se envolvieron con `accion`: siguen siendo fire-and-forget (el formulario no espera el resultado), y la regla "toda escritura llamada desde el cliente pasa por `accion`" queda sin excepciones. También se sacaron los comentarios al final de línea y el `{/* */}` de JSX, que el `grep` del criterio no ve.

---

## Paso 1 — Tipos de dominio en un solo lugar

Hoy hay tipos de dominio definidos dentro de componentes, y `lib/` y `app/actions/` los importan desde ahí: la dependencia apunta al revés.

- `ItemCatalogoConCategoria` vive en `components/nuevo-item-dialog.tsx` y lo importan 9 archivos, actions y lib incluidos.
- `LineaDesdeTicket` vive en `components/escaner-comprobante.tsx` y lo importan `lib/lineas-gasto.ts` y `actions/entrantes.ts`. Es casi idéntico a `ItemTicket` de `actions/cfe.ts`: unificarlos (uno extiende al otro con `bloqueada`/`esHormiga`).
- `type Categoria = typeof categorias.$inferSelect` está redeclarado 12 veces, `Emisor` 9, `ProveedorCfe` 4, `Entrante` 2.

**Qué hacer:** crear `src/db/tipos.ts` con los `$inferSelect` de uso común y los tipos compuestos de dominio (`ItemCatalogoConCategoria`, la línea de ticket). Reemplazar todas las redeclaraciones e imports.

**Regla que queda:** `lib/` nunca importa de `components/` ni de `app/`.

**Hecho cuando:** `grep -rn "from \"@/components\|from \"@/app" src/lib` sólo devuelve tests (o nada), y no queda ningún `type X = typeof y.$inferSelect` fuera de `src/db/tipos.ts`.

---

## Paso 2 — Helpers compartidos

Antes de partir archivos grandes, juntar lo que está copiado en varios, para que la división no lo multiplique.

- **Fechas → `src/lib/fechas.ts`**, con una sola convención (fechas ISO tratadas al mediodía UTC, como ya hace la mayoría):
  - `diasEntre` está tres veces (`lib/cuotas.ts`, `lib/compras-cuotas-server.ts`, `lib/entrantes.ts`).
  - `sumarDias` (`actions/estado-cuenta.ts`) y `restarDias` (`lib/bcu.ts`) son la misma función.
  - `fechaLimiteVentanaPrecio` (`lib/precios-referencia.ts`) usa otra convención: parsea en UTC y resta meses en hora local, así que un fin de mes se corre (30/06 − 4 meses da 2026-03-02 en vez de 28/02). Al pasarla a la convención única, agregar un test: es aritmética que decide qué compras cuentan como referencia.
  - `aISO`/`hoyISO`/`mesEnCurso` pueden quedarse en `lib/formato.ts` o mudarse acá; lo importante es que no haya dos lugares que calculen lo mismo.
- **Redondeo a centavos → `redondearCentavos`** en un solo lugar: hoy están `redondear` (`lib/cuotas.ts`), `redondearMonto` (`actions/reportes.ts`) y tres `Math.round(x * 100) / 100` sueltos en `lib/cfe.ts` y `actions/cfe.ts`.
- **Mensajes de error → `mensajeDe(e, porDefecto)`** en `lib/resultado.ts`: el patrón `e instanceof Error ? e.message : "..."` aparece 47 veces en 22 archivos. Además `actions/catalogos.ts` tiene su propio `mensajeError` que detecta duplicados buscando `"UNIQUE"` en el texto: reemplazarlo por `mensajeDeError` de `lib/acciones-server.ts`, que ya traduce los errores de SQLite por código.
- **Revalidación por dominio**: `revalidatePath("/gastos")` + `revalidatePath("/")` se repite 7 veces en `actions/gastos.ts`. Sólo catálogos tiene `revalidarCatalogos()`. Crear el equivalente por dominio (`revalidarGastos`, `revalidarBandeja`, …) para que agregar una página que muestra gastos sea un cambio en un lugar.

**Hecho cuando:** cada uno de esos helpers existe una sola vez y no quedan copias.

---

## Paso 3 — Lógica de dominio fuera de las actions

Es el cambio más importante. Resuelve dos problemas a la vez.

**Problema A: funciones internas expuestas al navegador.** Todo lo que se exporta de un `"use server"` es un endpoint, y hoy hay funciones pensadas sólo para el servidor que quedan llamables sin `accion` ni validación:

| Función | Archivo | Por qué importa |
|---|---|---|
| `guardarGasto` | `actions/gastos.ts` | Escribe un gasto salteándose el bloqueo por mes de `crearGasto` y la revalidación |
| `crearEmisorPorRuc` | `actions/catalogos.ts` | Escritura |
| `interpretarTicketConIA`, `interpretarEstadoCuentaConIA` | `actions/ia.ts` | Gastan cuota de IA |
| `resolverItemContraCatalogo` | `actions/cfe.ts` | Interna del flujo de QR |
| `obtenerEmisorPorRuc`, `obtenerEmisorConProveedor`, `buscarItemPorNombreExacto`, `sugerirCategoriaPorTexto`, `listarProveedoresParaProbar` | `actions/catalogos.ts` | Lecturas internas, no las usa ningún componente |

**Problema B: ciclos de imports.** `lib/entrantes-recepcion.ts` importa `guardarGasto`, `consultarCFE` e `interpretarLinkCfeConIA` desde `app/actions/`. La separación entre `entrantes-server.ts` y `entrantes-recepcion.ts` se hizo para romper un ciclo que existe sólo porque `guardarGasto` vive en una action.

**Capas objetivo:**

```
src/db/                 schema + tipos
src/lib/*.ts            puro: parsers, reglas, cálculos (testeable sin DB)
src/lib/*-server.ts     dominio con DB/red/disco; empieza con `import "server-only"`
src/app/actions/*.ts    fino: accion(...), validar la entrada, llamar al dominio, revalidar
src/components/         UI; llama sólo a actions
```

Cuotas, bandeja, WhatsApp y configuración ya siguen esto (`compras-cuotas-server.ts`, `entrantes-server.ts`, `whatsapp-server.ts`, `config-server.ts`). Faltan:

1. **Gastos** → `lib/gastos-server.ts`: `guardarGasto`, `conSobreprecioDetectado`, referencias de precio, `obtenerHormigaHeredada`, `listarGastosConDetalle`.
2. **Catálogo** → `lib/catalogo-server.ts` (o uno por entidad): búsqueda por nombre/alias, sugerencia de categoría, emisores por RUC, verificaciones de nombre y RUC libres.
3. **CFE** → `lib/cfe-server.ts`: la orquestación de `consultarCFE` (validar, emisor, detalle, conversión de moneda). La action `consultarCFE` queda como envoltorio.
   - Acá se corrige la duplicación que entró con "probar proveedores sin mapeo": `nombreLibre` en `actions/cfe.ts` copia `verificarNombreLibre`, y `completarEmisor` escribe en `emisores` por fuera del módulo de catálogo. Las dos pasan a usar el dominio de catálogo.
4. **IA** → las lecturas `interpretar*ConIA` pasan a `lib/ia-server.ts`; en actions queda sólo lo que llama un componente.
5. **Estado de cuenta** → cotejo, registro y borrador a `lib/estado-cuenta-server.ts`.

Con esto, `entrantes-recepcion.ts` deja de importar actions y se puede reevaluar si la división en dos archivos sigue haciendo falta.

Verificar si Next 16 resuelve `import "server-only"` sin instalar el paquete; si no, `npm i server-only`.

**Hecho cuando:** ningún archivo de `src/lib/` importa de `@/app/actions`, cada export de un `"use server"` tiene un llamador en `src/components/` o `src/app/**/page.tsx`, y los flujos de QR, bandeja (subida y WhatsApp), estado de cuenta y gasto fijo funcionan igual que antes.

---

## Paso 4 — Partir los módulos grandes de servidor

Con la lógica ya en su capa, dividir por responsabilidad.

- **`lib/cfe.ts` (1096 líneas)** → `lib/cfe/`:
  - `qr.ts` — `parsearQR`, `fechaISODesdeQR`, `montoDesdeQR`, `detalleCorrespondeAlQR`.
  - `dgi.ts` — `validarConDgi`.
  - `procesadores/scanntech.ts`, `taface.ts`, `ucfe.ts`, `facturalista.ts`, `ijserv.ts`, `odoo.ts` — cada uno con su consulta y su parser.
  - `procesadores/index.ts` — `consultarProcesador` y el `switch` por formato.
  - Separar en cada procesador el parser (puro) del fetch (usa `pedir`, que lee `cfeTimeoutMs` de la DB). Con eso los tests de parsers no necesitan el `vi.mock("@/db")` de `cfe.test.ts`, y los tests se parten igual que los archivos.
- **`actions/catalogos.ts` (1116 líneas, 4 dominios)** → `actions/categorias.ts`, `actions/items-catalogo.ts`, `actions/proveedores-cfe.ts`, `actions/emisores.ts`.
- **`actions/estado-cuenta.ts` (1294 líneas)**: después del paso 3 debería quedar en las actions de entrada (`analizar*`, `importarMovimientos`, registro); si sigue grande, separar registro de importación.

**Hecho cuando:** ningún archivo de `src/lib/` ni de `src/app/actions/` supera ~600 líneas, y los tests pasan sin cambios de expectativa (sólo de ruta de import).

---

## Paso 5 — Hooks y componentes reutilizables

UI que hoy está copiada.

1. **`useBusquedaRemota(query, buscar, { suspendido })`** en `src/hooks/`: el combo `useDebounced` + `let cancelado` + `.then(...)` está 5 veces (`nuevo-gasto-form.tsx` ×2, `gasto-fijo-dialog.tsx`, `buscador-item.tsx`, más la carga de referencias). Ninguna tiene `catch`: un error de red termina en un rechazo no manejado. El hook lo resuelve una vez y devuelve `{ resultados, error }`.
2. **`SelectorComercio`**: buscar comercio + "+ Crear comercio" + suspender la búsqueda al elegir está idéntico en `nuevo-gasto-form.tsx` y `gasto-fijo-dialog.tsx`. Se arma sobre `ComboboxBusqueda` + `useBusquedaRemota`. (`ComercioDeLinea` de estado de cuenta filtra una lista local, no busca en el servidor: evaluar si encaja o queda aparte.)
3. **`DialogoPorGrupos`**: el marco de "Grupo n de m" con paginador, título, descripción y estado vacío está copiado entre `gastos-combinables-dialog.tsx` e `items-similares-dialog.tsx`. Recibe `grupos`, `titulo`, `descripcion`, `vacio` y un `render(grupo)`.
4. **`CamposProveedorCfe`**: el escáner (`escaner-comprobante.tsx`) rearma a mano el formulario de `ProveedorCfeDialog` (selector de procesadores conocidos, precarga de URL, nombre). Extraer los campos a un componente y usarlo en los dos; de paso el escáner gana el check "Probar con comercios sin proveedor", que hoy no tiene.

**Hecho cuando:** no queda ningún `let cancelado = false` fuera de los hooks, y los dos diálogos de duplicados y los dos selectores de comercio usan el componente compartido.

---

## Paso 6 — Partir los componentes grandes

Con las piezas del paso 5 disponibles, achicar las dos vistas más grandes.

- **`nuevo-gasto-form.tsx` (1284 líneas, ~30 `useState`, ~40 funciones):**
  - `useLineasGasto` — un `useReducer` con las operaciones sobre líneas (agregar, quitar, renombrar, resolver provisoria, desvincular, actualizar, sumar captura). Hoy son una docena de funciones que escriben `lineas` con `setLineas`; como reducer quedan testeables como funciones puras si alguna lo merece.
  - `useReferenciasPrecio` — carga de referencias y márgenes, `referenciaDeLinea`, `sobreprecioDeLinea`, `ofertaSugeridaDeLinea`.
  - `SelectorComercio` (paso 5) reemplaza el bloque de emisor.
  - `useAvisoSalida` — la huella del formulario + `beforeunload` + `confirmarSalida`.
- **`catalogos-view.tsx` (893 líneas, 4 pestañas):** un componente por pestaña (`CategoriasTab`, `ItemsTab`, `ComerciosTab`, `ProveedoresTab`) y la vista sólo elige cuál mostrar.
- **`estado-cuenta-view.tsx` (883 líneas):** revisar después de lo anterior; candidatos naturales son la tabla de revisión y el panel de totales.

**Hecho cuando:** ningún componente supera ~500 líneas y el flujo de carga de un ticket de muchas líneas se comporta igual (mismo foco, mismos avisos, mismo aviso al salir).

---

## Paso 7 — Una sola estrategia de sincronización cliente/servidor

Hoy conviven dos:

- `catalogos-view.tsx` (y `nuevo-gasto-form.tsx` para categorías) copia las props en `useState(…Iniciales)` y las parchea a mano con callbacks después de cada mutación. Las props nuevas que llegan tras un `revalidatePath` se ignoran: hay dos fuentes de verdad.
- `gastos-combinables-dialog.tsx` llama `router.refresh()` y deja que el servidor mande.

**Qué hacer:** adoptar `router.refresh()` como default (el servidor es la verdad, y las acciones ya revalidan). Mantener el parche local sólo donde la latencia se nota (por ejemplo, una categoría recién creada que hay que poder elegir en el mismo formulario), y documentar esas excepciones.

**Hecho cuando:** ninguna vista copia una lista del servidor a estado local salvo las excepciones escritas.

---

## Paso 8 — Escala de las consultas

Es el único paso que cambia cómo se leen los datos, por eso va al final.

- **`listarGastos`** trae todos los gastos con todas sus líneas, y `GastosView` filtra en el cliente. Con años de tickets de supermercado esto crece en cada carga de `/gastos`. Pasar los filtros de fecha (y comercio/búsqueda si conviene) al servidor, y paginar.
- **`obtenerResumenDashboard`** también recorre `listarGastosConDetalle` entero para calcular el mes. Reemplazar por consultas agregadas en SQL (`sum`, `group by`) acotadas al período.
- Mantener intacto el criterio de `noEsCompraEnCuotas` en las consultas nuevas: es lo que evita contar dos veces una compra en cuotas.

**Hecho cuando:** `/` y `/gastos` no leen gastos fuera del período que muestran, y los totales coinciden con los de antes del cambio sobre la misma base.

---

## Paso 9 — Reorganizar la documentación

`CLAUDE.md` pesa 126 KB y se carga en cada sesión de Claude Code. Es muy valioso, pero hoy es más bitácora de decisiones que guía.

- Dejar en `CLAUDE.md` los comandos, el mapa de capas (el del paso 3), las invariantes que no se pueden romper (API keys nunca exportadas, `accion` en toda escritura del cliente, `force-dynamic`, `ORDER BY id` en el historial del chat, nada de `UPPER()`/`LOWER()` de SQLite, etc.) y un índice.
- Mover el porqué de cada flujo a `docs/<area>.md` (QR/CFE, estado de cuenta, cuotas, bandeja y WhatsApp, IA, formulario de gasto) o al JSDoc de la función que lo implementa.
- Actualizar las rutas de archivo que hayan cambiado en los pasos 3 a 6.

Va último a propósito: hacerlo antes obligaría a reescribir las rutas dos veces.

**Hecho cuando:** `CLAUDE.md` entra en unas pocas páginas y cada decisión documentada vive en un solo lugar.
