-- Normaliza a mayúsculas nombre/marca/tamaño de ítems de catálogo que se
-- cargaron antes de que `crearItemCatalogo`/`editarItemCatalogo` empezaran a
-- forzar mayúsculas. `descripcion` queda afuera a propósito: es texto libre
-- (notas, alias del proveedor para el match del QR) y no un campo normalizado.
-- Cada UPDATE solo toca las filas que difieren, para no ensuciar el historial
-- de `updated_at` (si la tabla lo tuviera) de filas ya normalizadas.
UPDATE `items_catalogo`
SET `nombre` = UPPER(`nombre`)
WHERE `nombre` != UPPER(`nombre`);
--> statement-breakpoint
UPDATE `items_catalogo`
SET `marca` = UPPER(`marca`)
WHERE `marca` IS NOT NULL AND `marca` != UPPER(`marca`);
--> statement-breakpoint
UPDATE `items_catalogo`
SET `tamano` = UPPER(`tamano`)
WHERE `tamano` IS NOT NULL AND `tamano` != UPPER(`tamano`);
