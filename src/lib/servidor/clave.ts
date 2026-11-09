/**
 * SIRU — lib/servidor/clave.ts
 * Hash de contraseñas con bcrypt (costo 12) e historial de las últimas 3.
 *
 * Se usa bcryptjs, una implementación en JavaScript del mismo algoritmo
 * bcrypt (Provos & Mazières, 1999): produce hashes $2a$/$2b$ compatibles y
 * no requiere compilar módulos nativos en Windows.
 */
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { CLAVES_ANTERIORES_PROHIBIDAS, COSTO_BCRYPT } from "../reglas";

export function hashear(clave: string): Promise<string> {
  return bcrypt.hash(clave, COSTO_BCRYPT);
}

export function coincide(clave: string, hash: string): Promise<boolean> {
  return bcrypt.compare(clave, hash);
}

let hashFicticio: string | null = null;
/** Compara contra un hash descartable para que un correo inexistente tarde lo mismo. */
export async function compararFicticio(clave: string): Promise<void> {
  hashFicticio ??= await bcrypt.hash("clave-ficticia-para-igualar-tiempos", COSTO_BCRYPT);
  await bcrypt.compare(clave, hashFicticio);
}

/** true si la clave coincide con alguna de las últimas 3 registradas. */
export async function usadaRecientemente(c: PoolClient, usuarioId: number, clave: string): Promise<boolean> {
  const { rows } = await c.query<{ hash_contrasena: string }>(
    `SELECT hash_contrasena FROM historial_contrasena
      WHERE usuario_id = $1 ORDER BY fecha_alta DESC, historial_id DESC LIMIT $2`,
    [usuarioId, CLAVES_ANTERIORES_PROHIBIDAS]
  );
  for (const r of rows) if (await bcrypt.compare(clave, r.hash_contrasena)) return true;
  return false;
}

/** Registra el nuevo hash en el historial y conserva solo los 3 más recientes. */
export async function guardarEnHistorial(c: PoolClient, usuarioId: number, hash: string): Promise<void> {
  await c.query("INSERT INTO historial_contrasena (usuario_id, hash_contrasena) VALUES ($1, $2)", [usuarioId, hash]);
  await c.query(
    `DELETE FROM historial_contrasena
      WHERE usuario_id = $1 AND historial_id NOT IN (
        SELECT historial_id FROM historial_contrasena WHERE usuario_id = $1
         ORDER BY fecha_alta DESC, historial_id DESC LIMIT $2)`,
    [usuarioId, CLAVES_ANTERIORES_PROHIBIDAS]
  );
}
