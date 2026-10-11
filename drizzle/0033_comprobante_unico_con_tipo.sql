DROP INDEX `gastos_comprobante_unico`;--> statement-breakpoint
CREATE UNIQUE INDEX `gastos_comprobante_unico` ON `gastos` (`emisor_id`,`tipo_cfe`,`serie`,`numero`) WHERE "gastos"."serie" is not null;