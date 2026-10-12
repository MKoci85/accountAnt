# AccountAnt

Una aplicación personal para registrar y analizar los gastos del día a día, con dos preguntas concretas en el centro: **¿cuánto de lo que gasté fue superfluo** — un gasto hormiga, impulsivo, que no hacía falta — **y cuánto pagué de más** por algo que en otro lado (o en otro momento) salía más barato? El objetivo no es llevar una contabilidad exhaustiva ni reemplazar una app de finanzas personales genérica, sino tener visibilidad real de en qué se va la plata, con el mínimo de fricción posible al cargar cada gasto, para poder ahorrar con más criterio.

Está hecha a medida de Uruguay: aprovecha que la facturación electrónica (CFE) es obligatoria acá, así que la mayoría de los gastos se cargan **escaneando el QR del ticket** en vez de tipeando todo a mano, y convierte gastos en dólares a pesos usando la cotización oficial del Banco Central. No es un proyecto para publicar como producto — es 100% local, mono-usuario, sin login — pero está construido con el mismo cuidado que le pondría a algo que sí lo fuera: modelo de datos pensado, integraciones reales investigadas y verificadas contra sistemas en producción, y una lógica de detección de sobreprecios que resuelve un problema nada trivial (comparar precios de forma justa entre productos de peso variable).

## Cero configuración

No hay pantalla de setup ni onboarding: se instala, se corre `npm run db:migrate` y ya se puede cargar el primer gasto. Las migraciones siembran directamente en la base **19 categorías de uso cotidiano** ya pensadas para Uruguay (Almacén, Frutas y verduras, Carnes y pescados, Transporte, Suscripciones, Servicios, Vivienda, Farmacia, etc. — cada una con su propia descripción de palabras clave para que la app sugiera categoría sola al reconocer un ítem, y las que corresponde ya marcadas como *servicio*, lo que simplifica el formulario al cargarlas), un **comercio genérico "Varios"** para no tener que catalogar un local que se usa una sola vez, y los tres procesadores de facturación electrónica ya soportados (**Scanntech, Taface y uCFE**) precargados con su URL de consulta real, para que mapear el primer comercio sea elegir de una lista, no salir a buscar la URL a mano. Nada de esto bloquea nada: se puede seguir agregando, editando o borrando categorías y proveedores desde `/catalogos` como cualquier otro dato.

## Por qué existe

Los gastos hormiga son difíciles de ver porque son individualmente pequeños — un café, una changuita, algo de kiosco — y ninguna app de banco los agrupa de una forma que los haga visibles. Esta app parte de una idea simple: si cargar el gasto es tan fácil como sacarle una foto al ticket, es mucho más probable que efectivamente se cargue todo, y con datos completos recién se puede ver el patrón. A partir de ahí, todo el diseño gira en torno a bajar la fricción de carga (escaneo de QR, catálogo de ítems reutilizable, alta al vuelo de todo) y a que los reportes hagan preguntas útiles en vez de solo sumar números: ¿cuánto de lo que gasté fue impulsivo?, ¿qué productos estoy pagando más caros que en otro lado?, ¿cuánto me ahorraría si dejara de hacer ambas cosas?

## Funcionalidades

### Dashboard (`/`)
Vista rápida al entrar: total gastado en el mes, cuánto de eso fue gasto hormiga (monto y %), emisores/comercios pendientes de mapear a su procesador de facturación (para poder traer el detalle automáticamente la próxima vez), y los últimos gastos cargados. Si hay comprobantes esperando en la bandeja de entrada, o gastos que se guardaron solos y todavía no se miraron, lo avisa ahí mismo. Si la app encontró algo para ordenar —ítems del catálogo que parecen el mismo producto, o gastos que podrían ser una sola compra cargada en partes— aparece además un bloque **"Para revisar"** que lleva directo a resolverlo; si no hay nada pendiente, no se muestra.

### Carga de gastos (`/gastos`, `/gastos/nuevo`, `/gastos/[id]`, `/gastos/[id]/editar`)
- **Escaneo de comprobante**: con la cámara del celular/compu o subiendo una foto ya sacada. Decodifica el QR client-side (sin subir la imagen a ningún lado), valida el comprobante contra DGI, resuelve el comercio por RUC y — si ese comercio ya tiene mapeado su procesador de facturación (Scanntech y similares) — trae automáticamente **todos los ítems del ticket con sus precios**, no solo el total. Un comprobante que DGI no confirma (o que no se puede verificar) se frena ahí, antes de crear nada, y el formulario manual sigue disponible. Si el ticket trae el link de DGI impreso como texto en vez de QR, se puede pegar a mano (aunque venga cortado en varios renglones) o subir la foto: si no se detecta un QR, la app **pregunta antes** de mandarla a la IA para leer el link, y el resultado pasa por la misma validación que un QR decodificado (avisando que conviene revisar fecha y total contra el papel).- **Foto de un ticket sin QR** (o de una nota de pedido escrita a mano): marcando "Leer con IA" en `/gastos/nuevo`, la foto se manda a un modelo (ver `/ajustes`) que interpreta comercio, fecha e ítems y completa las líneas del formulario — igual que el escaneo de QR, pero para el caso en que no hay QR que leer. Es una sola compra con varios ítems, así que llena un solo gasto (a diferencia de `/estado-cuenta`, pensado para movimientos que sí son compras independientes entre sí). La foto se puede sacar con la cámara ahí mismo o subir una ya guardada; en los dos casos se reescala y se comprime en el navegador antes de salir. El comercio se busca pero nunca se crea solo: si no hay una coincidencia exacta, queda el texto tipeado para que el usuario lo resuelva. La IA también reconoce los productos vendidos por peso (fiambre, queso, verdura) y los completa como línea por kilo, no por unidad, y si un mismo ítem aparece repetido en el ticket (dos pasadas por caja del mismo producto) se suma en una sola línea en vez de quedar duplicado.
- **Carga manual** para cuando no hay ticket (efectivo, sin factura) o el procesador del comercio no está soportado, con un atajo de "compra puntual" para no tener que catalogar un comercio que se usa una sola vez.
- Buscador con autocompletado y alta al vuelo de comercios, ítems de catálogo y categorías directamente desde el formulario, sin perder lo que ya se cargó.
- Cada línea de gasto se puede marcar como **hormiga** o necesaria, y se categoriza (con la posibilidad de pisar la categoría default del ítem para ese gasto puntual).
- **Manejo correcto de productos de peso variable** (fruta, verdura, fiambre, queso, pan): la cantidad y el precio de la línea son el peso real de esa compra y el precio por kilo/litro, no un ítem de catálogo nuevo por cada compra — así "0,150 kg de cebolla" y "0,400 kg de cebolla" son comparables entre sí. Si el ticket no imprimió el peso, la línea se puede marcar como **"sin peso"**: el gasto se guarda igual, pero queda afuera de la comparación de precios en vez de ensuciarla con un dato inventado.
- **Servicios y compras puntuales, sin inventar un ítem de catálogo**: el botón "+ Agregar sin catálogo" agrega una línea cuyo nombre se escribe a mano, para lo que no vale la pena catalogar — una consulta odontológica, un mes de UTE, o un uniforme deportivo que se compra una sola vez en la vida. Si además la categoría está marcada como de servicio, la línea se reduce a dos campos —qué y cuánto—, porque un alquiler no se vende por unidad, kilo ni litro y el formulario no lo pregunta; si no lo está, conserva la cantidad. Qué categorías se comportan así lo decide un flag editable en `/catalogos` (no una lista fija en el código), y todas estas líneas quedan naturalmente fuera de la comparación de precios: no tiene sentido buscarle "sobreprecio" a una consulta médica.
- Listado completo con filtros por categoría, comercio y fecha, y búsqueda de texto libre, con un modo para **combinar gastos** duplicados (mismo comercio y fecha) en uno solo — útil cuando el mismo consumo termina cargado dos veces por vías distintas (QR y estado de cuenta). No hace falta buscarlos a mano: la app detecta sola los grupos que se podrían combinar y los ofrece desde un aviso arriba del listado, mostrando cuánto sumaría el gasto resultante. Si en realidad son dos compras distintas del mismo día, se marcan como tales y dejan de aparecer.

### Bandeja de entrada (`/bandeja`)
Para cargar un comprobante sin sentarse frente al formulario: se sube la foto ahí (o se manda por WhatsApp, ver más abajo) y la app la lee sola, del lado del servidor.

- **Lee por el camino más confiable que encuentre**: primero el QR; si no hay, el link de DGI impreso (leído con IA y validado igual que un QR); y recién al final el ticket entero leído con IA.
- **Un comprobante validado que llega sin ítems puede tomarlos de la foto.** Si el comercio no tiene procesador mapeado, o el procesador no contestó, el comprobante queda en la bandeja sin ítems: la foto está guardada, así que se abre con "Ver ticket" y se carga el detalle a mano. Activando "Leer los ítems con IA" en `/ajustes` (apagado por defecto), en ese caso los ítems se leen de la foto con IA. El comercio, la fecha, el número y el total siguen siendo los del QR — lo que lee el modelo no los pisa — y el total del QR queda como referencia para cotejar la suma de los ítems. Si la IA tampoco puede (sin API key, sin cuota), el comprobante queda igual en la bandeja, sin ítems, con el motivo a la vista, para completarlo a mano o volver a leerlo.
- **Se guarda solo únicamente cuando no queda nada por decidir**: vino de un QR que DGI validó, el procesador devolvió el detalle sin avisos, todos los ítems ya están en el catálogo y la suma coincide con el total. Cualquier cosa leída con IA queda siempre para revisar. Los que se guardaron solos se marcan y se listan aparte hasta que se miran.
- **Lo demás espera revisión**: "Revisar y guardar" abre el formulario de gasto precargado, y hasta que no se guarda no es un gasto — no aparece en reportes ni cuenta como precio de referencia.
- **La foto se conserva mientras el comprobante esté en la bandeja** (`data/entrantes/`), con un botón **"Ver ticket"** que la abre en otra pestaña para cotejarla contra lo leído, y "Volver a leer" para reintentar. Se borra cuando el gasto se guarda o el comprobante se descarta.
- **La marca de hormiga se hereda por ítem + comercio**: el mismo café es hormiga en el bar de la esquina y no en una parada de ruta.
- **Un comprobante de un mes anterior sin resolver frena la carga manual** de gastos nuevos hasta que se revise o se descarte, para que no quede colgado. Recibir fotos nunca se frena. Tanto esto como el guardado automático se apagan desde `/ajustes`.
- **La importación del estado de cuenta se detiene** si una línea de la tarjeta coincide con un comprobante pendiente: importarla dejaría el gasto duplicado al confirmarlo. Se retoma después de resolver la bandeja, sin volver a analizar el PDF.

### Gastos fijos (`/gastos-fijos`)
Lo que se paga todos los meses —UTE, OSE, Antel, alquiler, mutualista, Netflix— guardado como plantilla, para que registrar el pago sea un toque y no volver a llenar el formulario entero. No es un concepto nuevo en el modelo: una plantilla es una línea de servicio guardada, y el pago que genera es **un gasto normal**, así que aparece en `/gastos`, entra en `/reportes` por su categoría y `/estado-cuenta` lo reconoce contra la línea de la tarjeta con la misma lógica de siempre.

- **Tarjetas agrupadas por categoría** —que acá hace de "tipo": Servicios, Vivienda, Suscripciones, Salud— con el estado del mes a la vista: **"Pagado el 3/9"** o **"Pendiente"**, y arriba un contador de cuántos van pagados y por cuánto.
- **El importe viene precargado con el del último pago.** Para el alquiler o Netflix el modal es una confirmación; para UTE o Antel, que varían, la diferencia contra el mes anterior se muestra explícita ("el último fue $637 — $603 más"), que es justamente la señal útil.
- **Aviso de duplicado**: si ya hay un pago de esa plantilla en el mes en curso, se advierte antes de guardar (con fecha e importe del anterior) en vez de dejar dos gastos idénticos en silencio — algo fácil de hacer desde el celular con doble toque.
- **Archivar en vez de borrar**: se da de baja Netflix y el historial sigue explicándose; las archivadas quedan en su propia sección con "Reactivar", así que archivar nunca es una trampa de una sola dirección. El borrado real también está, y avisa cuántos gastos ya registrados van a perder el vínculo con la plantilla (los gastos sobreviven, solo pierden la referencia).

### Catálogos (`/catalogos`)
Administración de **categorías** (con color asignado para los gráficos y un flag **"es un servicio"** que saca la unidad y la cantidad del formulario para las líneas de esa categoría), **ítems reutilizables** (para no repetir "Leche 1L" con nombre distinto cada vez) y **emisores/comercios** — incluyendo el mapeo manual comercio → procesador de facturación electrónica que habilita traer el detalle de ítems al escanear. Todas las bajas verifican que no haya datos dependientes antes de borrar, y avisan con un mensaje claro si los hay.

**Ítems duplicados.** No se puede crear (ni renombrar un ítem a) uno idéntico a otro existente: la comparación ignora mayúsculas, tildes, espacios y puntuación, y lee el tamaño por lo que significa, así que "1.5L" y "1500 ml" son lo mismo. Los que están escritos distinto pero parecen el mismo producto —por nombre (tolerando errores de tipeo y abreviaturas de ticket), marca y presentación— no se bloquean, porque podrían no serlo: la app los detecta sola y muestra un botón en la pestaña de ítems. Desde ahí se elige cuál se conserva y con qué nombre; las compras de los demás pasan a ese y los otros se borran. El nombre de cada ítem borrado queda como alias, para que el próximo escaneo del mismo comercio lo siga reconociendo. Lo que no es un duplicado se marca como tal y no vuelve a ofrecerse. El campo de peso/tamaño entiende también cantidades de piezas y packs (`x12`, `12 un`, `pack 6`, `6x330ml`) y muestra cómo lo interpretó.

### Reportes (`/reportes`)
Filtrable por período (con presets rápidos), categoría y comercio. Muestra:
- Resumen del período y evolución mensual.
- Gasto por categoría y por comercio.
- **Ítems con sobreprecio**: productos que se están pagando por encima del precio más bajo históricamente registrado para ese ítem — comparado siempre contra la base completa, no solo el período filtrado, porque el precio de referencia no deja de ser válido porque el filtro lo excluya.
- Una matriz cruzando gasto hormiga × sobreprecio, y el **potencial de ahorro** del período (evitando contar dos veces la plata de una compra que es a la vez hormiga y cara).
- **"Copiar JSON para IA"**: exporta el reporte completo (con los filtros aplicados) a un JSON autoexplicativo — con su propio glosario de términos como "hormiga" o "sobreprecio" — pensado para pegar en cualquier chat de IA (ChatGPT, Claude, Gemini, lo que sea) y pedirle un plan de ahorro concreto. Sin API keys, sin integraciones, solo copiar y pegar.
- **"Analizar con IA"**: manda ese mismo recorte al asistente integrado (`/reportes/asistente`) sin que el JSON pase por el navegador. Se elige a qué conversación va — una nueva (con su propio proveedor y modelo) o una ya existente — y si el destino elegido no tiene lugar para todo el reporte en su contexto, se avisa antes de mandarlo.

### Asistente (`/reportes/asistente`)
El mismo reporte, pero conversando dentro de la app en vez de copiarlo afuera. Es opcional y requiere una API key configurada en `/ajustes`.

- **Conversaciones persistentes**, tipo ChatGPT: se crean, se listan, se renombran, se continúan y se borran. Como las APIs de LLM no tienen memoria entre llamadas, el historial vive en la base y se reenvía completo en cada mensaje.
- **Proveedor y modelo se eligen al crear cada conversación**, no en `/ajustes` — arrancan en el proveedor activo por defecto, pero cambiarlo ahí no mueve las conversaciones ya creadas. Cambiar de proveedor a mitad de un hilo mezclaría comportamientos, así que para usar otro hay que empezar una conversación nueva.
- **El reporte no se inyecta solo, y su JSON nunca llega al navegador**: se genera y se guarda del lado del servidor, y el chat solo maneja una referencia. Hay dos formas de adjuntarlo — el clip del propio chat exporta el mes en curso en un click (o reutiliza uno ya usado en el hilo, sin recalcularlo), y "Analizar con IA" desde `/reportes` manda el recorte que se tenga filtrado en ese momento. El adjunto aparece como un chip arriba del cuadro de texto y se concatena del lado del servidor.
- **El historial se poda por request, nunca se borra**: los mensajes que no entran en el límite del proveedor no se mandan, pero siguen vivos en la base y vuelven si la conversación se acorta. Eso es lo que garantiza que ningún mensaje falle por tamaño.
- **Una respuesta cortada por el proveedor se marca como tal.** Si un modelo se queda sin presupuesto de tokens a mitad de frase, lo que llegó se guarda igual (ya se pagó y sirve) pero con un aviso visible, en vez de mostrarse como si estuviera completa.
- Dos indicadores a la vista: **contexto usado** (contra el techo del proveedor) y **consultas restantes hoy** (contra la cuota diaria), que son los dos límites que hacen fallar un mensaje.
- El alcance está acotado a propósito: finanzas personales, gastos, precios y ahorro. Cualquier otro tema lo redirige en una frase.

### Estado de cuenta (`/estado-cuenta`)
Cubre lo que queda fuera del escaneo de QR y de la foto de ticket de `/gastos/nuevo`: el **estado de cuenta de la tarjeta**, para gastos que nunca van a tener un ticket con QR (combustible, telepeaje, suscripciones online, mutualista). Acepta **solo el PDF descargado del homebanking** —una foto no entra por acá: en un estado de cuenta cada línea es una compra distinta, mientras que la foto de un ticket es UNA compra con varios ítems, y ese caso se resuelve en `/gastos/nuevo`— y se procesa siempre con un parser heurístico propio (nunca con IA, salvo que el usuario la pida a propósito porque el layout no fue reconocido):

- Extrae cada movimiento por posición real dentro del PDF y distingue automáticamente **pesos de dólares por la columna en la que cae el importe**.
- Clasifica cada línea en tres vías: **rubros directos** (combustible, telepeaje, suscripciones — se importan siempre, con emisor y categoría ya resueltos; en combustible el emisor es la estación tal como figura en el resumen, no una marca genérica, así que el histórico de comercios no la pierde), **gastos que podrían ya estar cargados por QR** (se cotejan contra la base por fecha ±1 día y monto, contando ocurrencias para no perder compras repetidas el mismo día) y **gastos faltantes** (se ofrecen para importar como gasto general, con categoría sugerida según el tipo de comercio).
- Convierte automáticamente los montos en dólares a pesos usando la **cotización oficial del Banco Central del Uruguay** del día (con manejo de fines de semana/feriados, que el BCU no cotiza — busca hacia atrás hasta la última cotización disponible en vez de arriesgar una conversión en cero).
- Si el parser no reconoce el layout del PDF, se avisa con un mensaje; recién ahí se puede pedir a propósito que lo interprete un modelo de IA en su lugar. Si hay más de un proveedor de IA con key configurada, aparece un selector para elegir **con cuál analizar este archivo puntual**, sin cambiar el proveedor activo de `/ajustes`.

Nada se escribe en la base hasta que el usuario revisa y confirma la importación; se puede reimportar el mismo estado sin duplicar.

### Ajustes (`/ajustes`)
Configuración de los proveedores de IA opcionales, usados en la lectura de tickets sin QR de `/gastos/nuevo`, en `/estado-cuenta` (cuando el PDF tiene un layout no reconocido) y en el asistente de reportes. Hay cinco soportados (**Anthropic, Google Gemini, OpenAI, Groq y OpenRouter**, los dos últimos con tier gratuito) y se puede tener **una API key guardada por cada uno en simultáneo**: cambiar de proveedor no obliga a repegar la key. Cada fila permite guardar su key, probar la conexión, borrarla, y **editar el modelo y el endpoint** — el modelo es editable porque el catálogo de modelos gratuitos rota seguido, así que el default de código es solo un punto de partida. Un selector arriba fija cuál es el proveedor activo por defecto. Los proveedores cuyo tier gratuito entrena con el contenido enviado muestran un aviso de privacidad.

**Sugerencia de modelos**: los proveedores cuyos modelos se retiran o rotan (OpenRouter y Gemini) tienen un botón **"Actualizar modelos"** que trae la lista al día desde su endpoint. OpenRouter es público (solo gratuitos, sin API key); el de Gemini necesita la key guardada. Se usa para autocompletar el campo, pero sigue aceptando texto libre: la lista sugiere, nunca restringe, así que un catálogo desactualizado no puede volverse una jaula. Los otros tres proveedores no muestran el botón.

**Modelos de respaldo**: la lectura de fotos y PDFs, si el modelo principal falla por su cuenta (5xx o modelo retirado, no por cuota ni timeout), prueba con otros del mismo proveedor, y siempre avisa cuál respondió porque un modelo más liviano puede leer peor. La cantidad de respaldos (0–5) y la lista son editables por proveedor; al cambiar el modelo, la app prueba candidatos y guarda solo los que realmente responden. El chat nunca cambia de modelo en medio de una conversación.

**Limitador de cuota** (activado por defecto). No hay un único límite que modelar: cada proveedor está atado por un eje distinto — **consultas por minuto**, **consultas por día** o **tokens por minuto** — así que se cuentan los tres y se respeta el más restrictivo. El de consultas por día es el que de verdad importa cuando se conversa (50 diarias en OpenRouter sin créditos, 250 en Gemini), y por eso el asistente muestra cuántas quedan. Los límites son **editables por proveedor**, porque los proveedores los cambian sin avisar y porque el de tokens por minuto varía **por modelo** (es el caso de Groq). Desactivar el limitador saca el freno pero **el consumo se sigue contando**: apagar el freno no debería apagar el contador de cuánto queda.

Las API keys nunca se exponen al cliente ni se loguean: la UI solo recibe una versión enmascarada.

**Bandeja de entrada y WhatsApp**: los interruptores del guardado automático, del bloqueo por mes y de la lectura de ítems con IA cuando un comprobante llega sin detalle (este último apagado por defecto), y toda la configuración de WhatsApp (token, clave secreta, números autorizados, cuándo contestar), con el último mensaje recibido y qué pasó con él. El token y la clave secreta se muestran enmascarados, igual que las API keys.

## Cómo se resuelve la lectura de comprobantes (CFE)

Uruguay tiene facturación electrónica obligatoria: el QR de cualquier ticket trae `RUC_emisor,tipoCFE,serie,numero,monto,fecha,hash`. La fecha no viene siempre igual: lo usual es `dd/mm/aaaa`, pero hay emisores que mandan `aaaammdd` o la ISO, y se leen las tres. La URL pública de DGI solo sirve para validar que el comprobante es auténtico — no da detalle de ítems. El detalle real hay que pedírselo al **procesador de facturación** que usa cada comercio (Scanntech es el más común, pero no el único), y cada uno tiene su propio protocolo, nada documentado públicamente:

- **Scanntech**: protocolo confirmado e implementado end-to-end contra tickets reales — POST con los datos del QR, sigue un redirect, y devuelve un HTML (formularios GeneXus, sin clases ni selectores, hay que parsear por estructura) con el comercio, la dirección y cada ítem con su precio. Incluye el caso especial de productos pesables, que en el HTML de Scanntech ocupan dos filas (una para el ítem, otra con `(peso × precio por kilo)` en una celda aparte).
- **Taface**: también confirmado e implementado contra un comprobante real. También es GeneXus, pero no hace falta reproducir el formulario de búsqueda (que sí es una SPA con sesión y tokens) — su página de resultado acepta los mismos datos por GET, en otro orden y sin fecha, y devuelve los ítems ya como JSON en un input oculto en vez de filas de tabla para parsear. El importe de cada línea viene neto de IVA (no es lo que se pagó por esa línea), así que se regrosa con el %IVA de esa misma línea antes de guardar el gasto.
- **uCFE (Uruware)**: tercer procesador confirmado, con un flujo distinto a los otros dos. Es un WebForms de ASP.NET clásico: hay que sacar el `__VIEWSTATE`/`__EVENTVALIDATION` de una primera consulta y volver a postear esos mismos valores junto con los datos del QR, arrastrando la cookie de sesión entre ambos pedidos. El detalle de ítems no viene en ese HTML — hay que descargar aparte el PDF del comprobante y extraerlo posicionalmente (con la misma herramienta, `unpdf`, que usa `/estado-cuenta` para los resúmenes de tarjeta).
- **FacturaLista**: un solo POST sin sesión, y la respuesta *es* el PDF del comprobante (si no existe, devuelve el formulario de nuevo). El PDF no trae columna de unidad, así que una línea por peso no se puede distinguir de una por pieza.
- **iJServ**: misma forma que FacturaLista con otros nombres de campo. Imprime los importes con punto decimal y sin separador de miles, al revés del resto.
- **SICFE/FEMI**: protocolo más simple (un POST sin sesión) pero es un servicio cerrado a un padrón fijo de mutualistas y entidades médicas — documentado, pendiente de un ticket real de ese padrón.

Como cada comercio puede estar en cualquiera de estos procesadores (o en ninguno soportado), el mapeo comercio → procesador es manual y vive en el catálogo de emisores (`proveedoresCfe.formato` elige qué implementación usar); si no hay uno mapeado, el gasto igual se puede cargar completando los ítems a mano, o leyéndolos de la foto con IA (a pedido en el formulario; en la bandeja de entrada, sólo si se activó en `/ajustes`). Si el comprobante viene en dólares (Taface lo informa; Scanntech no lo expuso todavía en los tickets probados), se convierte solo con la cotización del BCU del día del comprobante — misma lógica y mismo caché (`cotizaciones`) que usa el import de estado de cuenta.

## Stack técnico

- **Next.js 16** (App Router) + TypeScript, **React 19**, Tailwind v4.
- **Drizzle ORM** sobre **SQLite** (`better-sqlite3`) como única capa de datos — 100% local, WAL mode, foreign keys activas.
- **shadcn/ui** (`style: base-nova`) para los componentes de interfaz, copiados directo al repo (no son una dependencia npm, se editan como código propio).
- **Recharts** para los gráficos de `/reportes`.
- **jsQR** para decodificar códigos QR client-side, desde cámara (`getUserMedia`) o desde una foto subida.
- **sharp** para leer del lado del servidor las fotos que llegan a la bandeja (endereza según EXIF y produce los píxeles que necesita jsQR).
- **unpdf** para extraer texto posicional de los PDFs de estado de cuenta (declarado en `serverExternalPackages` en `next.config.ts`, para que su bundling se resuelva en runtime y no en el build de Next).
- Integración opcional con **Anthropic, Google Gemini, OpenAI, Groq y OpenRouter** para interpretar layouts de estado de cuenta no reconocidos por la heurística, fotos de tickets sin QR, y el asistente de reportes. Groq y OpenRouter hablan el dialecto de OpenAI, así que comparten una sola rama de código parametrizada por datos (URL, headers, nombre del campo de tokens): sumar otro proveedor compatible es agregar una fila a una tabla, no escribir código.
- **Vitest** para los tests unitarios (ver más abajo). La verificación completa de un cambio es `npm test` + `npm run lint` + `npx tsc --noEmit` + probar el flujo real con `npm run dev` (y `npm run build`, porque algunos problemas —como el bundling de paquetes nativos o el renderizado estático de páginas dinámicas— solo aparecen ahí, no en dev).

## Modelo de datos, en breve

- **`categorias`** — con color para los gráficos, una descripción de texto libre usada para sugerir categoría automáticamente, y un flag de **servicio** (una consulta médica o un mes de UTE no llevan unidad ni cantidad).
- **`proveedoresCfe`** — los procesadores de facturación electrónica en sí (Scanntech, Taface, etc.), con su URL de consulta (para no duplicarla por cada comercio que la use) y su `formato`, que elige qué implementación de consulta/parseo usar.
- **`emisores`** — unifica "comercio" y "emisor de CFE": nombre, RUC (se completa cuando se mapea un ticket real), a qué procesador está mapeado, y un flag para el comercio genérico de compras puntuales.
- **`itemsCatalogo`** — catálogo reutilizable de productos, con una categoría *sugerida* (no vinculante — se puede pisar por línea de gasto).
- **`itemsSimilaresDescartados` / `gastosCombinablesDescartados`** — los pares de ítems o de gastos que el usuario ya dijo que *no* son el mismo, para que la detección de duplicados no los vuelva a ofrecer.
- **`gastos`** — un registro por compra, con los campos de CFE (tipo, serie, número) nullable para cuando no hay comprobante. Un índice único evita cargar el mismo ticket dos veces. Una referencia opcional a `gastosFijos` marca el gasto como el pago del mes de una plantilla. Un flag marca los que se guardaron solos desde la bandeja hasta que se revisan.
- **`gastosFijos`** — las plantillas de `/gastos-fijos`: nombre, categoría (que hace de "tipo"), comercio opcional, el importe *esperado* (nullable, porque para UTE no se sabe de antemano) y un flag de activo, para archivar sin borrar. Es la referencia desde `gastos` la que permite contestar "¿ya lo pagué este mes?" sin heurísticas de comercio + monto + mes.
- **`gastoItems`** — las líneas de cada gasto: ítem, categoría, cantidad, **unidad** (pieza / kg / litro — la clave para que el precio de peso variable sea comparable entre compras), precio, el flag de gasto hormiga y el flag de **peso desconocido** (para una línea por peso cuyo ticket no lo imprimió, que se guarda pero queda afuera de la comparación de precios).
- **`gastosEntrantes`** — la bandeja de entrada: un comprobante recibido que todavía no es un gasto, con cómo se leyó, el QR, los ítems tal como vinieron y el nombre de la foto guardada. Es una tabla aparte y no un gasto con un flag, para que ningún reporte ni comparación de precios tenga que acordarse de excluirlo.
- **`estadoCuentaBorrador`** — la importación de estado de cuenta que quedó en pausa por chocar con la bandeja (una sola fila).
- **`mensajesWhatsapp`** — los mensajes de WhatsApp ya atendidos, para no procesar dos veces los reintentos de Meta, con qué pasó con cada uno.
- **`configuracion`** — tabla clave/valor para la configuración de IA (una API key, un modelo, un endpoint y las cuotas editables por proveedor, el proveedor activo, el limitador y el catálogo de modelos sugeridos), los umbrales de precio (margen de sobreprecio por peso, ventana de meses de referencia) los endpoints y timeouts de los servicios externos (BCU, DGI, cada proveedor de IA), y los ajustes de la bandeja y de WhatsApp, todos editables desde `/ajustes`.
- **`conversacionesIA` / `mensajesIA`** — los hilos persistidos del asistente de reportes. La conversación fija su proveedor y modelo; cada mensaje guarda su rol y su costo estimado en tokens.
- **`reportesAdjuntos`** — un reporte exportado desde `/reportes` y preparado para mandarse (o ya mandado) en una conversación del asistente: el JSON en sí, una etiqueta legible del recorte, y si ya se usó. Existe para que el JSON nunca tenga que viajar como argumento del lado del navegador.
- **`usoIA`** — una fila por consulta a un proveedor, con su modelo, sus tokens y de qué flujo salió. Es lo que permite contar cuota por minuto y por día de verdad, en vez de mirar solo cuándo fue la última consulta.
- **`cotizaciones`** — caché de cotizaciones del BCU por fecha pedida, para no repegarle al servicio SOAP por cada línea en dólares del mismo estado de cuenta.
- **`emisorAlias`** — mapea el nombre de un comercio tal como aparece en el estado de cuenta (ej. "SUPERMERCADOS ESTEFAN") a su `emisor` ya cargado, para que la importación lo reconozca sola después del primer mapeo manual.

El detalle completo de cada decisión de diseño — por qué el peso no puede vivir en el catálogo, cómo se calcula el sobreprecio, por qué el emisor unifica comercio y CFE — está documentado en [CLAUDE.md](./CLAUDE.md) y en los comentarios de los módulos correspondientes (`src/lib/precios-referencia.ts`, `src/lib/cfe.ts`).

## Cómo correrlo

> **En Windows**, `better-sqlite3` compila un módulo nativo con `node-gyp` durante el `npm install`, lo que requiere tener instalado **Visual Studio Build Tools** con el workload **"Desktop development with C++"**. Si falta, el install falla con un error de `node-gyp`/`find-visualstudio`. Se instala una sola vez con:
> ```powershell
> winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
> ```
> Después, `npm install` compila sin problemas. En Mac/Linux no hace falta nada especial (Xcode Command Line Tools / build-essential suelen ya estar).

```bash
npm install
npm run db:migrate      # aplica las migraciones a ./data/control-gastos.db
npm run dev              # levanta el servidor de desarrollo (Turbopack)
```

Abrí [http://localhost:3000](http://localhost:3000).

Otros comandos útiles:

```bash
npm run build            # build de producción
npm start                 # sirve el build de producción
npm run serve             # build + start, en un solo comando
npm run webhook           # proceso aparte que recibe el webhook de WhatsApp (ver más abajo)
npm run servicio          # la app (ya compilada) y el webhook juntos: lo que ejecuta un servicio del sistema
npm run lint              # ESLint
npx tsc --noEmit          # chequeo de tipos
npm test                  # tests unitarios (Vitest)
npm run test:watch        # tests en modo watch

npm run db:generate       # genera una migración de Drizzle a partir de cambios en el schema
npm run db:studio         # Drizzle Studio (GUI para explorar la base)
```

## Tests

```bash
npm test
```

Los tests son unitarios y puros: cubren las funciones de `src/lib/` que no tocan la base, la red ni el DOM. Viven al lado del módulo que prueban (`src/lib/lineas-gasto.test.ts`, etc.).

El criterio para elegirlos fue **qué puede romperse en silencio**: un error de aritmética o de parseo no tira una excepción, guarda un número equivocado y el usuario se entera meses después mirando un reporte que no cierra. Eso es lo que está cubierto:

| Módulo | Qué se verifica |
|---|---|
| `lineas-gasto` | Que el precio vacío no sea un cero, que una línea de servicio de 3 × $500 se colapse en 1 × $1.500 **sin perder plata**, y que un renglón de ticket se convierta bien a cantidad + unidad + precio unitario (por peso, por precio/kilo, por tamaño de envase) además de agrupar repetidos. |
| `precios-referencia` | El parseo de tamaños libres ("500 gr" → 0.5 kg), la normalización de unidades, y que el margen del 3% se aplique solo a las líneas por peso y nunca a las de unidad. |
| `formato` | `parsearMonto` / `formatearMonto` en formato es-UY, incluido que sean reversibles entre sí y que la coma se lea como decimal (que es lo que teclea el celular). |
| `estado-cuenta` | La detección de la columna de dólares, el parseo de importes del PDF y el armado de movimientos: fecha, descripción, importe de más a la derecha, y el descarte de las líneas que no son consumo. |
| `cfe` | El parseo del QR de un comprobante uruguayo (y su rechazo cuando no lo es), la fecha del QR en los tres formatos en que la escriben los emisores, y la separación del peso/volumen o el conteo que el POS pega al nombre del producto. |
| `proveedores-ia` | La elección de modelos de respaldo (qué errores justifican probar otro), el parseo de las listas guardadas y la extracción de modelos disponibles de Gemini y OpenRouter. |
| `chat-ia` | La poda del historial contra el límite de contexto (que nunca deje un mensaje afuera sin avisar, y que recorte el último en vez de descartarlo), la separación del reporte adjunto de la pregunta, y la limpieza de la respuesta del modelo. |
| `clasificacion-comercios` | Que "PARADISA" no se clasifique como combustible por contener "DISA", que "ANCAP3140" sí, y el mapeo de suscripciones y rubros. |
| `pdf` | El agrupado de fragmentos en renglones por coordenadas, y la redacción de datos personales antes de mandar un texto a un proveedor de IA. |
| `entrantes` | Cuándo un comprobante recibido se puede guardar solo y cuándo tiene que revisarse (una lectura con IA nunca pasa), qué cuenta como "de un mes anterior", y qué comprobantes de la bandeja chocan con un movimiento del estado de cuenta. |
| `whatsapp` | La firma de Meta sobre el cuerpo del webhook, qué mensajes se extraen (una foto mandada como documento cuenta, un PDF no) y cuándo corresponde contestar. |
| `duplicados` | La lectura de presentaciones (peso, volumen, piezas y packs escritos de formas distintas), qué ítems cuentan como similares y cuáles no (variantes como "sin sal" o "zero" los separan), la igualdad exacta que bloquea el alta, y qué gastos se ofrecen para combinar. |

**Lo que deliberadamente no hay** son tests de componentes, de server actions ni de la base. Necesitarían un DOM o un archivo SQLite levantado, y para una app de un solo usuario el costo de mantenerlos no se justifica; la verificación de esas capas sigue siendo `npm run dev` y usar el flujo.

## Uso desde el celular (Tailscale)

La forma recomendada de usar la app desde el celular — incluso fuera de casa — es [Tailscale](https://tailscale.com): arma una red privada (WireGuard) entre tus propios dispositivos, **sin abrir ningún puerto en el router** y sin exponer nada a internet. Como la app corre en la compu con la base SQLite local, no hace falta ni hosting ni login: solo los dispositivos de tu cuenta pueden llegar.

Instalación (una sola vez):

```bash
brew install --cask tailscale     # o descargar de tailscale.com/download
```

Iniciá sesión en la app de la compu y en la app de Tailscale del celular, **con la misma cuenta**.

Después, para levantar la app:

```bash
npm run serve                     # build + start en localhost:3000
tailscale serve --bg 3000         # la publica por HTTPS dentro de tu red Tailscale
tailscale serve status            # muestra la URL https://<tu-maquina>.<tailnet>.ts.net
```

Desde el celular entrás a esa URL `https://….ts.net`. Tailscale gestiona el certificado, así que es HTTPS válido de verdad: **la cámara para escanear el QR funciona sin advertencias**, a diferencia del certificado local de mkcert.

Para dejar de publicarlo: `tailscale serve --https=443 off`.

## Cargar gastos por WhatsApp

Se le manda la foto de un comprobante a un número de WhatsApp y la app la lee igual que una foto subida a la bandeja de entrada (`/bandeja`): si no deja nada por decidir se guarda sola como gasto, y si no, queda esperando revisión. Es opcional y se configura entero desde **Ajustes → WhatsApp**.

Usa la API oficial (WhatsApp Cloud API de Meta). Recibir es gratis, y la respuesta dentro de las 24 h del mensaje también.

**No sirve el chat "Mensaje a ti mismo"**: ese chat no pasa por la API. Las fotos se mandan a otro número — el de prueba que da Meta alcanza — que se guarda como un contacto más.

### 1. En Meta

1. En [developers.facebook.com](https://developers.facebook.com) crear una app y agregarle el producto **WhatsApp**. Pide un portfolio comercial; si no hay, lo crea ahí.
2. En *WhatsApp → Configuración de la API* anotar el **identificador del número de teléfono** (no es el teléfono), agregar el número personal como destinatario verificado y mandarse el mensaje de prueba.
3. En *Configuración del negocio → Usuarios del sistema* crear un usuario administrador, asignarle la app y la cuenta de WhatsApp, y generar un **token sin vencimiento** con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. El token que muestra el panel de la API vence a las 24 h y no sirve para dejarlo andando.
4. En *Configuración → Básica* copiar la **clave secreta de la app**.

### 2. En la app

En **Ajustes → WhatsApp** pegar el token, la clave secreta, el identificador del número y el número personal en "Números autorizados" (con código de país: `59899123456`). **Probar conexión** comprueba el token contra Meta sin mandar nada. Activar "Recibir por WhatsApp".

### 3. Abrir la ruta del webhook

Meta tiene que poder llamar a la app desde internet. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) publica un puerto de la compu sin tocar el router. Hay que habilitarlo una vez en el panel de administración de la tailnet (HTTPS y Funnel).

Funnel se prende **por puerto, no por ruta**: todo lo que se sirva en ese puerto queda público. Por eso **Funnel no apunta a la app**, sino a un proceso aparte (`webhook/servidor.mjs`) que es lo único que queda de cara a internet. Apuntarlo a Next, aunque sea con una sola ruta montada, deja expuesto todo lo que Next atiende antes de llegar a esa ruta (server actions, RSC, páginas de error), y la app no tiene login.

Ese proceso no tiene dependencias, no abre la base y no guarda ningún secreto. Acepta únicamente `GET` y `POST` a `/api/whatsapp`, exige que el `POST` traiga una firma con forma de firma de Meta y pese menos de 1 MB, y arma de cero el pedido hacia la app: de lo que llegó de afuera sólo pasan el cuerpo y la firma (o los tres parámetros de verificación). La firma la sigue comprobando la app, que es la que tiene la clave.

```bash
npm run webhook                                         # escucha en 127.0.0.1:8787
tailscale funnel --bg --https=8443 http://127.0.0.1:8787
tailscale funnel status
```

Tiene que quedar corriendo junto con la app (`npm run serve`). `npm run servicio` levanta los dos de una vez sobre un build ya hecho, y si uno se cae corta el otro y termina con error — pensado para que un único servicio del sistema los reinicie juntos, en vez de mantener un servicio por proceso; el resto de la app sigue en el 443 de `tailscale serve`, que sólo ven tus dispositivos. Si la app está en otro puerto u otra máquina de la tailnet, `WEBHOOK_DESTINO` dice a dónde reenviar (por defecto `http://127.0.0.1:3000/api/whatsapp`) y `WEBHOOK_PUERTO` cambia el puerto de escucha.

Comprobarlo desde fuera de la tailnet (por ejemplo con los datos del celular): `https://<tu-maquina>.<tailnet>.ts.net:8443/api/whatsapp` tiene que responder **403** (la ruta existe y rechaza un pedido sin token), y cualquier otra ruta en ese puerto tiene que responder **404** vacío.

Para cerrarlo: `tailscale funnel --https=8443 off`.

### 4. Suscribir el webhook

En la app de Meta, *WhatsApp → Configuración → Webhooks*:

- **URL de devolución de llamada**: `https://<tu-maquina>.<tailnet>.ts.net:8443/api/whatsapp`
- **Identificador de verificación**: el "Token de verificación" que muestra Ajustes → WhatsApp.

"Verificar y guardar", y después suscribirse al campo **`messages`**.

Mientras la app de Meta no esté **publicada** (modo activo), Meta sólo entrega los webhooks de prueba del panel: las fotos reales no llegan. Para publicarla pide completar la configuración básica (en particular una URL de política de privacidad).

**La cuenta de WhatsApp Business también tiene que estar suscrita a la app**, y eso es aparte de lo anterior: el webhook puede estar verificado y con `messages` activo sin que Meta le mande nada, porque la cuenta no sabe que sus eventos van a esa app. El panel a veces lo hace solo y a veces no. Se consulta y se corrige con el token del paso 1 y el **identificador de la cuenta de WhatsApp Business** (en *WhatsApp → Configuración de la API*, debajo del identificador del número):

```bash
curl -H "Authorization: Bearer <token>" https://graph.facebook.com/<id-de-la-cuenta>/subscribed_apps          # tiene que listar tu app
curl -X POST -H "Authorization: Bearer <token>" https://graph.facebook.com/<id-de-la-cuenta>/subscribed_apps  # la suscribe
```

### Si no llega nada

"Probar conexión" sólo comprueba la salida (la app hablándole a Meta); que entren mensajes es otro camino. En orden:

1. **"Meta respondió 401 … Session has expired"**: venció el token. Generar uno de usuario del sistema sin vencimiento (paso 1.3) y pegarlo en ajustes.
2. **El registro de Ajustes → WhatsApp no muestra el mensaje**: no llegó a la app. Un número no autorizado igual queda anotado como ignorado, así que no es la lista de números. Revisar que `npm run webhook` y Funnel estén andando (el 403 de más arriba), que el campo `messages` esté suscrito, y que la cuenta esté suscrita a la app (`subscribed_apps`).
3. **El mensaje figura pero no hay respuesta**: mirar qué dice el registro; por defecto sólo se contesta cuando hay algo para hacer.

Las fotos mandadas mientras la cuenta no estaba suscrita no llegan después: Meta nunca intentó entregarlas, hay que mandarlas de nuevo.

### Cómo se comporta

- Sólo acepta mensajes con la firma de Meta, dirigidos al número configurado y enviados desde un número autorizado. A cualquier otro no le contesta.
- Contesta a lo sumo un mensaje por foto, según "Respuesta por WhatsApp" en ajustes. Por defecto sólo cuando hay algo para hacer: no se pudo leer, ya estaba cargada o quedó para revisar.
- Con la compu apagada (o la app caída: el webhook responde 502) no se pierde nada: Meta reintenta la entrega, y un mensaje repetido no se procesa dos veces.
- Las fotos recibidas se guardan en `data/entrantes/` hasta que el comprobante se guarda o se descarta; mientras tanto se pueden abrir con "Ver ticket" desde la bandeja.
- Un comprobante con QR de un comercio sin procesador mapeado queda en la bandeja sin ítems, para cargarlos mirando la foto; con "Leer los ítems con IA" activado en ajustes, se leen de la foto y quedan para revisar.

> La app queda disponible solo mientras la compu esté encendida con el servidor corriendo. Si en algún momento se quiere disponibilidad permanente, el mismo esquema funciona igual en una Raspberry Pi.

### Alternativa: red local con mkcert

Si preferís no usar Tailscale y te alcanza con estar en la misma WiFi, se puede servir por HTTPS con un certificado local. Los navegadores solo habilitan la cámara (`getUserMedia`) en contextos seguros, así que `http://192.168.x.x:3000` no alcanza:

```bash
npm run dev:https        # usa los certificados en certs/
```

Si la carpeta `certs/` no existe todavía, instalá [mkcert](https://github.com/FiloSottile/mkcert) y generá un certificado local:

```bash
mkdir certs
mkcert -install                                    # instala la CA local (una sola vez)
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost <IP-local>
```

Reemplazá `<IP-local>` por la IP de la compu en la red local (`ipconfig getifaddr en0` en Mac). Los `.pem` quedan fuera del repo (ver `.gitignore`).

Luego, desde el celular entrá a `https://<IP-local>:3000`. Si el certificado no fue confiado también en el teléfono (la CA de mkcert solo se instaló en la compu), el navegador va a mostrar una advertencia de certificado no confiable — se puede aceptar manualmente para uso personal en red local.

Next.js además bloquea por defecto requests cross-origin en dev (el celular pidiéndole assets a la compu por IP). Para permitirlo, definí `DEV_LAN_IP` en un `.env.local` (no se commitea) con esa misma `<IP-local>`:

```bash
echo "DEV_LAN_IP=<IP-local>" >> .env.local
```

## Por qué no

Tan importante como lo que hace es lo que se decidió **no** hacer, a propósito:

- **No hay presupuestos ni límites por categoría.** Ponerle un tope a "Comida fuera de casa" convierte la app en algo para vigilarse a uno mismo con culpa, y ese no es el objetivo — el objetivo es *ver* el patrón de gasto hormiga, no imponerse una meta que se termina abandonando a la tercera semana. Los reportes muestran el potencial de ahorro; qué hacer con esa información es decisión del usuario, no una barra de progreso que se pone en rojo.
- **Los gastos fijos no se generan solos cada mes.** Sería el paso "obvio" siguiente, y es justamente lo que convertiría el registro en ficción: la app estaría afirmando que se pagó algo que quizá no se pagó, o por un importe que en UTE o Antel cambia todos los meses. La plantilla ahorra el tipeo y el badge dice qué falta; apretar "Pagar" —una vez, con el número real— sigue siendo del usuario.
- **No hay login ni multiusuario.** No porque fuera difícil, sino porque agregarían una capa entera de complejidad (sesiones, permisos, aislar datos entre usuarios) para un caso de uso que es, por diseño, de una sola persona en una sola compu. El acceso remoto se resuelve con Tailscale (ver más arriba): la red privada *es* el control de acceso. Lo único que se publica a internet, y sólo si se activa WhatsApp, es el webhook — en un proceso aparte que no ve la base.
- **No hay conexión directa al banco ni a la tarjeta (open banking / scraping).** Es la solución "automática" obvia para no tener que importar el estado de cuenta a mano, pero implica entregarle las credenciales bancarias a un tercero o mantener un scraper contra un sitio que puede cambiar en cualquier momento, por una ganancia de comodidad menor frente a subir un PDF una vez por mes.
- **La IA nunca es un fallback automático en lo que se carga desde el formulario — es una decisión explícita del usuario.** El estado de cuenta de tarjeta siempre se procesa con el parser heurístico (extracción posicional del PDF, sin red ni terceros de por medio); si falla, se avisa con un mensaje claro en vez de mandar el archivo a un modelo sin que el usuario lo haya pedido, y recién ahí se puede pedir el análisis con IA a propósito. La foto de un ticket sin QR (o de un comercio sin procesador soportado) en `/gastos/nuevo` también es una acción explícita del usuario ("Leer con IA"), no algo que se dispare solo. La excepción, a propósito, es la **bandeja de entrada**: mandar una foto ahí (o por WhatsApp) *es* pedir que se lea sin estar presente, así que una foto sin QR legible se lee con IA sola. Cuando el QR sí se leyó y sólo faltan los ítems, la IA es opcional y viene apagada: el comprobante queda sin detalle y la foto a la vista. Lo compensa de otra forma: nada leído con IA se guarda sin revisión.
- **No hay OCR.** Cuando el dato es exacto y estructurado (el QR de un ticket, el texto de un PDF de estado de cuenta), leerlo tal cual es siempre mejor que un OCR que puede confundir `3.140,00` con `3,140.00` o un `8` con una `B` — para eso están el decodificador de QR y la extracción posicional del PDF. Y cuando el dato **no** es estructurado — un ticket sin QR, o de un comercio cuyo procesador no está soportado — la respuesta tampoco es OCR: es mandarle la foto a un modelo de IA (en `/gastos/nuevo`, para una foto de ticket; o en `/estado-cuenta` → "Analizar con IA", para un PDF con layout no reconocido), que entiende la boleta completa —nombre del comercio, ítems, precios— en vez de devolver texto plano sin estructura que después hay que volver a interpretar a mano.
- **No se sube ninguna imagen ni PDF a un servidor de terceros para analizarlo, salvo a la IA cuando se la usa.** El QR se decodifica en el navegador (`canvas`/`ImageData`) o en el proceso local, y el PDF del estado de cuenta se extrae en el proceso local. Lo único que se guarda en disco es la foto de un comprobante mientras espera en la bandeja de entrada, en la misma compu, y se borra al resolverlo.
- **No se apunta a Vercel ni a ningún hosting serverless.** Se evaluó y se descartó explícitamente: SQLite con `better-sqlite3` necesita filesystem persistente y un solo proceso de larga duración, algo que el modelo serverless no ofrece (filesystem efímero, sin estado compartido entre invocaciones). Migrar a Turso o Postgres para poder desplegar ahí habría sumado una dependencia de red y de un proveedor externo a cambio de nada, para una app que un solo usuario corre en su propia compu.

## Privacidad y alcance

Todo el procesamiento por defecto (decodificación de QR, lectura del PDF del estado de cuenta) pasa por el navegador o el proceso local — nunca se sube una imagen ni un PDF a un servicio externo. Las salidas de datos hacia afuera son todas opcionales:

- **Exportar el reporte a JSON** (para pegarlo a mano en el chat de IA que uno quiera). No sale nada de la app: copia al portapapeles.
- **"Analizar con IA" en `/estado-cuenta`** (para un PDF con layout no reconocido) **o "Leer con IA" en `/gastos/nuevo`** (para una foto de ticket sin QR): manda el PDF o la foto al proveedor elegido (el activo de `/ajustes`, o el que se seleccione en el momento). En el PDF, los datos identificatorios (número de tarjeta, cuenta de correo) se redactan del texto antes de enviarlo; una foto de un ticket, en cambio, viaja tal cual se ve — recortar lo que no se quiera enviar queda a criterio del usuario.
- **La bandeja de entrada** (`/bandeja`, y las fotos que llegan por WhatsApp): es el único lugar donde la foto se manda a la IA sin un botón de por medio — cuando no tiene QR legible, o cuando lo tiene pero el comprobante llegó sin ítems y se activó esa lectura en `/ajustes`. Va al proveedor activo de `/ajustes`, tal cual se ve.
- **WhatsApp**, si se activa: la foto pasa por Meta antes de llegar, como cualquier mensaje de WhatsApp, y las respuestas (a lo sumo una por foto) también.
- **El asistente de reportes** (`/reportes/asistente`): cada mensaje viaja al proveedor de esa conversación, y si se adjunta el reporte, va el JSON completo del período filtrado — o sea el detalle de en qué se gastó. Es la salida de datos más sustancial de la app, y por eso es explícita en dos pasos: hay que configurar una key y después adjuntar el reporte a propósito. Conviene tener presente qué proveedor está en uso: los que entrenan con el contenido enviado lo avisan en `/ajustes`.

Vale la pena remarcar que **el proveedor de IA es un tercero**, y lo que se le manda sale del dispositivo. Sin key configurada, ninguna de las salidas hacia un proveedor de IA existe: la bandeja sigue leyendo los QR y deja lo demás para completar a mano.

Es un proyecto personal, hecho para uso propio y sin pretensión de convertirse en un producto comercial. Corre enteramente en local, en un solo proceso (más uno mínimo y opcional para el webhook de WhatsApp), sin autenticación, porque no está pensado para múltiples usuarios ni para desplegarse como servicio. Dicho esto, la base — modelo de datos, integración con la facturación electrónica uruguaya, flujo de escaneo de comprobantes, importación de estados de cuenta — está armada con cuidado, y bien podría servir como punto de partida para quien quiera construir algo más ambicioso sobre la misma idea.

Para el detalle de arquitectura y del modelo de datos, ver [CLAUDE.md](./CLAUDE.md).
