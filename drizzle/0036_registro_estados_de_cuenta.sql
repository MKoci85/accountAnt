CREATE TABLE `estados_cuenta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hash` text NOT NULL,
	`nombre_archivo` text NOT NULL,
	`archivo` text,
	`subido_en` text NOT NULL,
	`importado_en` text,
	`con_ia` integer DEFAULT false NOT NULL,
	`banco` text,
	`cierre` text,
	`vencimiento` text,
	`desde` text,
	`hasta` text,
	`pago_contado_pesos` real,
	`pago_contado_usd` real,
	`pago_minimo_pesos` real,
	`pago_minimo_usd` real,
	`movimientos_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estados_cuenta_hash_unique` ON `estados_cuenta` (`hash`);--> statement-breakpoint
CREATE TABLE `movimientos_estado_cuenta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estado_cuenta_id` integer NOT NULL,
	`fecha` text NOT NULL,
	`descripcion` text NOT NULL,
	`monto` real NOT NULL,
	`moneda` text NOT NULL,
	`monto_pesos` real,
	`tipo` text NOT NULL,
	`gasto_id` integer,
	FOREIGN KEY (`estado_cuenta_id`) REFERENCES `estados_cuenta`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gasto_id`) REFERENCES `gastos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `estado_cuenta_borrador` ADD `estado_cuenta_id` integer REFERENCES estados_cuenta(id) ON DELETE set null;