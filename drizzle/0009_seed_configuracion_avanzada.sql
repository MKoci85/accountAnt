-- Siembra los valores hoy hardcodeados en código como defaults en
-- `configuracion`, para que una base nueva funcione idéntico a como funcionaba
-- antes de hacerlos editables desde /ajustes (zero config).
--
-- No hace falta para que la app ande: todos tienen default de código y los
-- getters de `config-server.ts` caen en él si la clave no está. Se siembran
-- igual para que se vean en /ajustes y en Studio con su valor real en vez de
-- un campo vacío que el usuario tenga que adivinar.
--
-- Idempotente (WHERE NOT EXISTS) para no pisar un valor ya guardado por el
-- usuario ni duplicar sobre una base ya poblada.
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'precios_margen_sobreprecio_peso', '0.03'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'precios_margen_sobreprecio_peso');
--> statement-breakpoint
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'precios_ventana_meses_referencia', '4'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'precios_ventana_meses_referencia');
--> statement-breakpoint
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'bcu_dias_hacia_atras', '7'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'bcu_dias_hacia_atras');
--> statement-breakpoint
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'bcu_url_endpoint', 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'bcu_url_endpoint');
--> statement-breakpoint
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'bcu_timeout_ms', '15000'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'bcu_timeout_ms');
--> statement-breakpoint
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'dgi_url_consulta', 'https://www.efactura.dgi.gub.uy/consultaQR/cfe'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'dgi_url_consulta');
--> statement-breakpoint
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'ia_timeout_ms', '120000'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'ia_timeout_ms');
--> statement-breakpoint
INSERT INTO `configuracion` (`clave`, `valor`)
SELECT 'ia_openrouter_http_referer', 'http://localhost:3000'
WHERE NOT EXISTS (SELECT 1 FROM `configuracion` WHERE `clave` = 'ia_openrouter_http_referer');
