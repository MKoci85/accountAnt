CREATE TABLE `estado_cuenta_borrador` (
	`id` integer PRIMARY KEY NOT NULL,
	`creado_en` text NOT NULL,
	`movimientos_json` text NOT NULL,
	`con_ia` integer DEFAULT false NOT NULL
);
