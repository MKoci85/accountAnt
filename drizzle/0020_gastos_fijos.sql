CREATE TABLE `gastos_fijos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`categoria_id` integer NOT NULL,
	`emisor_id` integer,
	`importe` real,
	`activo` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emisor_id`) REFERENCES `emisores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `gastos` ADD `gasto_fijo_id` integer REFERENCES gastos_fijos(id) ON DELETE set null;