CREATE TABLE `errores_recepcion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ocurrido_en` text NOT NULL,
	`origen` text NOT NULL,
	`mensaje_whatsapp_id` text,
	`paso` text NOT NULL,
	`detalle` text NOT NULL
);
