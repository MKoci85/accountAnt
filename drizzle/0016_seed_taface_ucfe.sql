INSERT INTO `proveedores_cfe` ("nombre", "url_consulta", "formato")
SELECT 'Taface', 'https://consulta.taface.com.uy/wpcomprobanteview.aspx', 'taface'
WHERE NOT EXISTS (SELECT 1 FROM `proveedores_cfe` WHERE "nombre" = 'Taface');--> statement-breakpoint
INSERT INTO `proveedores_cfe` ("nombre", "url_consulta", "formato")
SELECT 'uCFE (Uruware)', 'https://www.ucfe.com.uy/ConsultaCfe/ConsultarCFE.aspx', 'ucfe'
WHERE NOT EXISTS (SELECT 1 FROM `proveedores_cfe` WHERE "nombre" = 'uCFE (Uruware)');
