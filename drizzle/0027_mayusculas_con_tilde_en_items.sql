-- Completa lo que 0010 dejó a medias: el UPPER() de SQLite sólo convierte
-- ASCII, así que las vocales con tilde, la diéresis y la eñe de los ítems que
-- ya existían quedaron en minúscula dentro de un texto en mayúsculas. Desde
-- entonces se escribe con toUpperCase() de JS, que sí las convierte; esto
-- arregla sólo las filas viejas. Cada UPDATE toca únicamente las filas que
-- tienen alguna de esas letras en minúscula.
UPDATE `items_catalogo`
SET `nombre` = replace(replace(replace(replace(replace(replace(replace(`nombre`, 'á', 'Á'), 'é', 'É'), 'í', 'Í'), 'ó', 'Ó'), 'ú', 'Ú'), 'ü', 'Ü'), 'ñ', 'Ñ')
WHERE `nombre` GLOB '*[áéíóúüñ]*';
--> statement-breakpoint
UPDATE `items_catalogo`
SET `marca` = replace(replace(replace(replace(replace(replace(replace(`marca`, 'á', 'Á'), 'é', 'É'), 'í', 'Í'), 'ó', 'Ó'), 'ú', 'Ú'), 'ü', 'Ü'), 'ñ', 'Ñ')
WHERE `marca` GLOB '*[áéíóúüñ]*';
--> statement-breakpoint
UPDATE `items_catalogo`
SET `tamano` = replace(replace(replace(replace(replace(replace(replace(`tamano`, 'á', 'Á'), 'é', 'É'), 'í', 'Í'), 'ó', 'Ó'), 'ú', 'Ú'), 'ü', 'Ü'), 'ñ', 'Ñ')
WHERE `tamano` GLOB '*[áéíóúüñ]*';
