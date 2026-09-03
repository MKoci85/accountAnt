-- La URL de consulta es propiedad del proveedor de CFE (Scanntech, TA-Face,
-- SICFE/FEMI), no del comercio: todos los emisores de un mismo proveedor
-- pegan contra el mismo endpoint. Estaba duplicada por emisor, lo que dejaba
-- que dos comercios del mismo proveedor tuvieran URLs distintas.
--
-- Orden deliberado: crear tabla -> backfillear desde los datos que ya existen
-- -> recién ahí soltar las columnas viejas. Al revés se pierde el mapeo.
CREATE TABLE `proveedores_cfe` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`url_consulta` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proveedores_cfe_nombre_unique` ON `proveedores_cfe` (`nombre`);
--> statement-breakpoint
-- Un proveedor por cada `procesador` distinto ya cargado. Si el mismo
-- proveedor quedó con URLs distintas entre emisores, gana la más frecuente
-- (desempate por la más larga, que suele ser la completa y no una truncada).
INSERT INTO `proveedores_cfe` ("nombre", "url_consulta")
SELECT nombre, url_consulta FROM (
	SELECT
		TRIM("procesador") AS nombre,
		"url_consulta" AS url_consulta,
		ROW_NUMBER() OVER (
			PARTITION BY LOWER(TRIM("procesador"))
			ORDER BY COUNT(*) DESC, LENGTH("url_consulta") DESC
		) AS rn
	FROM `emisores`
	WHERE "procesador" IS NOT NULL AND TRIM("procesador") <> ''
	  AND "url_consulta" IS NOT NULL AND TRIM("url_consulta") <> ''
	GROUP BY LOWER(TRIM("procesador")), "url_consulta"
) WHERE rn = 1;
--> statement-breakpoint
ALTER TABLE `emisores` ADD `proveedor_cfe_id` integer REFERENCES proveedores_cfe(id) ON DELETE restrict;
--> statement-breakpoint
UPDATE `emisores` SET "proveedor_cfe_id" = (
	SELECT p."id" FROM `proveedores_cfe` p
	WHERE LOWER(p."nombre") = LOWER(TRIM(`emisores`."procesador"))
) WHERE "procesador" IS NOT NULL AND TRIM("procesador") <> '';
--> statement-breakpoint
ALTER TABLE `emisores` DROP COLUMN `procesador`;
--> statement-breakpoint
ALTER TABLE `emisores` DROP COLUMN `url_consulta`;
