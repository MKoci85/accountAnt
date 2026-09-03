CREATE TABLE `uso_ia` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proveedor` text NOT NULL,
	`modelo` text NOT NULL,
	`en_ms` integer NOT NULL,
	`tokens_estimados` integer NOT NULL,
	`origen` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uso_ia_ventana_idx` ON `uso_ia` (`proveedor`,`modelo`,`en_ms`);