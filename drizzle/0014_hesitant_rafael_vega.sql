CREATE TABLE `reportes_adjuntos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversacion_id` integer NOT NULL,
	`json` text NOT NULL,
	`etiqueta` text NOT NULL,
	`filtros` text NOT NULL,
	`tokens_estimados` integer NOT NULL,
	`pendiente` integer DEFAULT false NOT NULL,
	`usado_en` text,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`conversacion_id`) REFERENCES `conversaciones_ia`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reportes_adjuntos_conversacion_idx` ON `reportes_adjuntos` (`conversacion_id`,`pendiente`);