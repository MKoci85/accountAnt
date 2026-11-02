CREATE TABLE `compras_en_cuotas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gasto_id` integer NOT NULL,
	`cantidad_cuotas` integer NOT NULL,
	`interes_pct` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`tarjeta` text,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`gasto_id`) REFERENCES `gastos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compras_en_cuotas_gasto_id_unique` ON `compras_en_cuotas` (`gasto_id`);--> statement-breakpoint
CREATE TABLE `cuotas_compra` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`compra_id` integer NOT NULL,
	`numero` integer NOT NULL,
	`importe_calculado` real NOT NULL,
	`importe_pagado` real,
	`pagada` integer DEFAULT false NOT NULL,
	`gasto_id` integer,
	FOREIGN KEY (`compra_id`) REFERENCES `compras_en_cuotas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gasto_id`) REFERENCES `gastos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cuotas_compra_numero_unico` ON `cuotas_compra` (`compra_id`,`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `cuotas_compra_gasto_unico` ON `cuotas_compra` (`gasto_id`) WHERE "cuotas_compra"."gasto_id" is not null;--> statement-breakpoint
ALTER TABLE `estados_cuenta` ADD `tarjeta` text;--> statement-breakpoint
CREATE TRIGGER `cuotas_compra_gasto_borrado` BEFORE DELETE ON `gastos`
BEGIN
	UPDATE `cuotas_compra` SET `pagada` = 0, `importe_pagado` = NULL, `gasto_id` = NULL WHERE `gasto_id` = OLD.`id`;
END;
