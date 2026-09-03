-- Borra las claves `ia_ultimo_uso_<proveedor>_<modelo>` de `configuracion`, que
-- eran el estado del limitador viejo: un único timestamp por proveedor+modelo,
-- pisado en cada consulta. Ese esquema solo podía contestar "¿pasó un minuto
-- desde la última llamada?", y por eso se reemplazó por la tabla `uso_ia`, que
-- anota una fila por request y permite contar contra RPM, RPD y TPM.
--
-- Nada las lee ya (`esperaRestanteMs`/`registrarUsoIA` se borraron junto con
-- ellas), así que quedarían como filas muertas en la tabla de ajustes para
-- siempre. `_` es comodín en LIKE: el prefijo va escapado para no barrer, por
-- ejemplo, una hipotética `ia_ultimoXuso...`.
DELETE FROM `configuracion`
WHERE `clave` LIKE 'ia\_ultimo\_uso\_%' ESCAPE '\';
