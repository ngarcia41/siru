/**
 * SIRU — scripts/migrar.ts
 * Crea la base de datos si no existe y aplica, en orden, las migraciones
 * de db/migraciones que todavía no se aplicaron.
 *
 * Uso: npm run db:migrar
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL en el archivo .env");

  const destino = new URL(url);
  const nombreBase = decodeURIComponent(destino.pathname.replace(/^\//, ""));
  if (!/^[a-z_][a-z0-9_]*$/.test(nombreBase)) {
    throw new Error(`Nombre de base inválido: "${nombreBase}" (usá minúsculas, números y guion bajo)`);
  }

  // 1. Crear la base si no existe (conectando a la base "postgres" del servidor)
  const servidor = new URL(url);
  servidor.pathname = "/postgres";
  const admin = new Client({ connectionString: servidor.toString() });
  await admin.connect();
  const existe = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [nombreBase]);
  if (existe.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${nombreBase}`);
    console.log(`Base de datos "${nombreBase}" creada.`);
  }
  await admin.end();

  // 2. Aplicar migraciones pendientes
  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query(`CREATE TABLE IF NOT EXISTS migracion (
    nombre   VARCHAR(120) PRIMARY KEY,
    aplicada TIMESTAMPTZ  NOT NULL DEFAULT now()
  )`);
  const aplicadas = new Set(
    (await db.query<{ nombre: string }>("SELECT nombre FROM migracion")).rows.map((r) => r.nombre)
  );

  const carpeta = join(process.cwd(), "db", "migraciones");
  const archivos = readdirSync(carpeta).filter((f) => f.endsWith(".sql")).sort();
  let nuevas = 0;
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const sql = readFileSync(join(carpeta, archivo), "utf8");
    try {
      await db.query("BEGIN");
      await db.query(sql);
      await db.query("INSERT INTO migracion (nombre) VALUES ($1)", [archivo]);
      await db.query("COMMIT");
      console.log(`Aplicada: ${archivo}`);
      nuevas++;
    } catch (e) {
      await db.query("ROLLBACK");
      throw new Error(`Falló la migración ${archivo}: ${(e as Error).message}`);
    }
  }
  if (nuevas === 0) console.log("La base ya estaba actualizada.");
  await db.end();
}

main().catch((e) => {
  console.error(e.message ?? e);
  if (String(e.message).includes("postgis")) {
    console.error("Revisá que PostGIS esté instalado (Stack Builder → Spatial Extensions → PostGIS).");
  }
  process.exit(1);
});
