-- Siembra el único proveedor de CFE con soporte real de traer detalle de
-- ítems (Scanntech, ver src/lib/procesadores.ts) para que una base nueva
-- pueda mapear un emisor sin tener que cargar la URL a mano de memoria.
-- Taface y SICFE/FEMI quedan afuera a propósito: no tienen parser de ítems
-- todavía (`soportado: false`), sembrarlos daría una URL que la app no usa.
-- Idempotente (WHERE NOT EXISTS) para no duplicar sobre una base ya poblada.
INSERT INTO `proveedores_cfe` ("nombre", "url_consulta")
SELECT 'Scanntech', 'https://efactura.scanntech.com/products.eticket.consultaQR/'
WHERE NOT EXISTS (SELECT 1 FROM `proveedores_cfe` WHERE "nombre" = 'Scanntech');