/**
 * SIRU — scripts/crear-operador.ts
 * El administrador técnico crea la cuenta de un operador con una contraseña
 * temporal. En el primer ingreso el sistema obliga a cambiarla.
 *
 * Uso: npm run admin:crear-operador -- referente@fomento.org
 */
import "dotenv/config";
import { pool } from "../src/lib/servidor/db";
import { hashear } from "../src/lib/servidor/clave";
import { claveTemporal, emailDeArgumentos } from "./admin-comun";

async function main() {
  const email = emailDeArgumentos();
  const existe = await pool.query("SELECT 1 FROM usuario WHERE email = $1", [email]);
  if (existe.rowCount) throw new Error(`Ya existe una cuenta con el correo ${email}.`);

  const clave = claveTemporal(email);
  const hash = await hashear(clave);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      `INSERT INTO usuario (email, hash_contrasena, rol, estado_cuenta, debe_cambiar_clave)
       VALUES ($1, $2, 'OPERADOR', 'ACTIVA', TRUE) RETURNING usuario_id`,
      [email, hash]
    );
    const id = rows[0].usuario_id;
    await c.query("INSERT INTO historial_contrasena (usuario_id, hash_contrasena) VALUES ($1, $2)", [id, hash]);
    await c.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'CREA_OPERADOR', $2::jsonb)",
      [id, JSON.stringify({ origen: "administrador técnico" })]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  console.log(`Operador creado: ${email}`);
  console.log(`Contraseña temporal (entregala por un canal seguro; se pide cambiarla al ingresar): ${clave}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
