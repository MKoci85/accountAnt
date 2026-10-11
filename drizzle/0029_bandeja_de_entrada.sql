CREATE TABLE `gastos_entrantes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recibido_en` text NOT NULL,
	`canal` text DEFAULT 'manual' NOT NULL,
	`estado` text NOT NULL,
	`lectura` text,
	`imagen_ruta` text,
	`qr_texto` text,
	`clave_comprobante` text,
	`emisor_id` integer,
	`comercio` text,
	`fecha` text,
	`total` real,
	`items_json` text DEFAULT '[]' NOT NULL,
	`aviso` text,
	`error` text,
	FOREIGN KEY (`emisor_id`) REFERENCES `emisores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gastos_entrantes_clave_comprobante_unique` ON `gastos_entrantes` (`clave_comprobante`);