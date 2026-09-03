CREATE TABLE `conversaciones_ia` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`titulo` text NOT NULL,
	`proveedor` text NOT NULL,
	`modelo` text NOT NULL,
	`creada_en` text NOT NULL,
	`actualizada_en` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mensajes_ia` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversacion_id` integer NOT NULL,
	`rol` text NOT NULL,
	`contenido` text NOT NULL,
	`tokens_estimados` integer NOT NULL,
	`es_resumen` integer DEFAULT false NOT NULL,
	`archivado_en` text,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`conversacion_id`) REFERENCES `conversaciones_ia`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mensajes_ia_conversacion_idx` ON `mensajes_ia` (`conversacion_id`,`archivado_en`);