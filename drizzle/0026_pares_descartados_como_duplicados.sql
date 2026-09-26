CREATE TABLE `items_similares_descartados` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_menor_id` integer NOT NULL,
	`item_mayor_id` integer NOT NULL,
	FOREIGN KEY (`item_menor_id`) REFERENCES `items_catalogo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_mayor_id`) REFERENCES `items_catalogo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_similares_descartados_unico` ON `items_similares_descartados` (`item_menor_id`,`item_mayor_id`);--> statement-breakpoint
CREATE TABLE `gastos_combinables_descartados` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gasto_menor_id` integer NOT NULL,
	`gasto_mayor_id` integer NOT NULL,
	FOREIGN KEY (`gasto_menor_id`) REFERENCES `gastos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gasto_mayor_id`) REFERENCES `gastos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gastos_combinables_descartados_unico` ON `gastos_combinables_descartados` (`gasto_menor_id`,`gasto_mayor_id`);