ALTER TABLE `proveedores_cfe` ADD `formato` text DEFAULT 'otro' NOT NULL;--> statement-breakpoint
UPDATE `proveedores_cfe` SET `formato` = 'scanntech' WHERE lower(`nombre`) = 'scanntech';