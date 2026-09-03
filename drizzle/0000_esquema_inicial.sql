CREATE TABLE `categorias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categorias_nombre_unique` ON `categorias` (`nombre`);--> statement-breakpoint
CREATE TABLE `emisores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`ruc` text,
	`procesador` text,
	`url_consulta` text,
	`es_generico` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emisores_ruc_unique` ON `emisores` (`ruc`);--> statement-breakpoint
CREATE TABLE `items_catalogo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`marca` text,
	`tamano` text,
	`categoria_id` integer NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `gasto_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gasto_id` integer NOT NULL,
	`item_catalogo_id` integer NOT NULL,
	`categoria_id` integer NOT NULL,
	`cantidad` integer DEFAULT 1 NOT NULL,
	`precio` integer NOT NULL,
	`es_hormiga` integer NOT NULL,
	FOREIGN KEY (`gasto_id`) REFERENCES `gastos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_catalogo_id`) REFERENCES `items_catalogo`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `gastos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`emisor_id` integer NOT NULL,
	`tipo_cfe` text,
	`serie` text,
	`numero` text,
	FOREIGN KEY (`emisor_id`) REFERENCES `emisores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gastos_comprobante_unico` ON `gastos` (`emisor_id`,`serie`,`numero`) WHERE "gastos"."serie" is not null;