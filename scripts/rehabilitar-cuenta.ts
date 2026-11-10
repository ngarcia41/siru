/**
 * SIRU — scripts/rehabilitar-cuenta.ts
 * El administrador técnico levanta la suspensión de una cuenta (D-09), a
 * pedido de la sociedad de fomento. La cuenta vuelve a ACTIVA y la acción se
 * audita. Los reportes desestimados antes de la rehabilitación ya no cuentan
 * para una nueva suspensión.
 *
 * Uso: npm run admin:rehabilitar-cuenta -- vecino@correo.com
 */
import "dotenv/config";
import { pool } from "../src/lib/servidor/db";
import { emailDeArgumentos } from "./admin-comun";

async function main() {
  const email = emailDeArgumentos();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const u = (await c.query("SELECT usuario_id, estado_cuenta FROM usuario WHERE email = $1 FOR UPDATE", [email])).rows[0];
    if (!u) throw new Error(`No existe una cuenta con el correo ${email}.`);
    if (u.estado_cuenta !== "SUSPENDIDA") throw new Error(`La cuenta ${email} no está suspendida (estado: ${u.estado_cuenta}).`);
    await c.query("UPDATE usuario SET estado_cuenta = 'ACTIVA' WHERE usuario_id = $1", [u.usuario_id]);
    await c.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'REHABILITA_CUENTA', $2::jsonb)",
      [u.usuario_id, JSON.stringify({ origen: "administrador técnico", estadoAnterior: "SUSPENDIDA", estadoNuevo: "ACTIVA" })]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  console.log(`Cuenta ${email} rehabilitada: vuelve a estar ACTIVA.`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
