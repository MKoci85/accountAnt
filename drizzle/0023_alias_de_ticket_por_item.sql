CREATE TABLE `items_alias_ticket` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_catalogo_id` integer NOT NULL,
	`texto` text NOT NULL,
	FOREIGN KEY (`item_catalogo_id`) REFERENCES `items_catalogo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_alias_ticket_unico` ON `items_alias_ticket` (`item_catalogo_id`,`texto`);