CREATE TABLE `configuracion` (
	`clave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cotizaciones` (
	`fecha` text PRIMARY KEY NOT NULL,
	`fecha_cotizacion` text NOT NULL,
	`compra` real NOT NULL,
	`venta` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `emisor_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`emisor_id` integer NOT NULL,
	`alias` text NOT NULL,
	FOREIGN KEY (`emisor_id`) REFERENCES `emisores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emisor_alias_alias_unique` ON `emisor_alias` (`alias`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gasto_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gasto_id` integer NOT NULL,
	`item_catalogo_id` integer,
	`categoria_id` integer NOT NULL,
	`descripcion` text,
	`cantidad` real DEFAULT 1 NOT NULL,
	`precio` real NOT NULL,
	`es_hormiga` integer DEFAULT false NOT NULL,
	`es_sobreprecio` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`gasto_id`) REFERENCES `gastos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_catalogo_id`) REFERENCES `items_catalogo`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_gasto_items`("id", "gasto_id", "item_catalogo_id", "categoria_id", "descripcion", "cantidad", "precio", "es_hormiga", "es_sobreprecio") SELECT "id", "gasto_id", "item_catalogo_id", "categoria_id", NULL, "cantidad", "precio", "es_hormiga", "es_sobreprecio" FROM `gasto_items`;--> statement-breakpoint
DROP TABLE `gasto_items`;--> statement-breakpoint
ALTER TABLE `__new_gasto_items` RENAME TO `gasto_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `gastos` ADD `monto_total` real;
