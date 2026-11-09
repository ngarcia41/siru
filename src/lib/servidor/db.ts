/**
 * SIRU — lib/servidor/db.ts
 * Conexión a PostgreSQL con PostGIS mediante el controlador node-postgres.
 *
 * Todas las consultas del sistema son parametrizadas ($1, $2, ...): los
 * valores nunca se concatenan al texto SQL, lo que evita la inyección SQL.
 * Este módulo solo debe importarse desde código de servidor (API Routes).
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __siruPool: Pool | undefined;
}

function crearPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL en el archivo .env");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
}

/** Pool único por proceso (en desarrollo sobrevive a las recargas en caliente). */
export const pool: Pool = globalThis.__siruPool ?? crearPool();
if (process.env.NODE_ENV !== "production") globalThis.__siruPool = pool;

export async function consulta<T extends QueryResultRow = QueryResultRow>(
  texto: string,
  valores: unknown[] = []
): Promise<T[]> {
  const r = await pool.query<T>(texto, valores);
  return r.rows;
}

/** Ejecuta una función dentro de una transacción (COMMIT o ROLLBACK automático). */
export async function transaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await fn(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}
