import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const dbPath =
  process.env.DATABASE_PATH ??
  path.join(process.cwd(), "data", "control-gastos.db");
mkdirSync(path.dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/**
 * En la instalación empaquetada no hay `drizzle-kit` (es devDependency) ni red
 * para `npx`, así que las migraciones se aplican al abrir la conexión. Va detrás
 * de una env var para que `npm run dev` siga migrando a mano con `db:migrate`.
 * `migrate()` es idempotente: lee la misma tabla `__drizzle_migrations` que
 * escribe `drizzle-kit`, por lo que una base ya migrada no vuelve a tocarse.
 */
if (process.env.ACCOUNTANT_MIGRAR_AL_INICIAR === "1") {
  const carpetaMigraciones =
    process.env.DRIZZLE_DIR ?? path.join(process.cwd(), "drizzle");
  if (existsSync(carpetaMigraciones)) {
    migrate(db, { migrationsFolder: carpetaMigraciones });
  }
}
