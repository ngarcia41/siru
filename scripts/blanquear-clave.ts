/**
 * SIRU — scripts/blanquear-clave.ts
 * El administrador técnico blanquea la contraseña de una cuenta (por
 * ejemplo, bloqueada tras 3 bloqueos en 24 horas): genera una clave
 * temporal, desbloquea la cuenta, cierra sus sesiones y exige cambiarla.
 * Nadie puede ver la contraseña anterior: solo se reemplaza.
 *
 * Uso: npm run admin:blanquear-clave -- vecino@correo.com
 */
import "dotenv/config";
import { pool } from "../src/lib/servidor/db";
import { hashear } from "../src/lib/servidor/clave";
import { claveTemporal, emailDeArgumentos } from "./admin-comun";

async function main() {
  const email = emailDeArgumentos();
  const clave = claveTemporal(email);
  const hash = await hashear(clave);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      `UPDATE usuario
          SET hash_contrasena = $2, debe_cambiar_clave = TRUE, fecha_cambio_clave = now(),
              estado_cuenta = CASE WHEN estado_cuenta = 'BLOQUEADA' THEN 'ACTIVA' ELSE estado_cuenta END,
              intentos_fallidos = 0, bloqueado_hasta = NULL
        WHERE email = $1 RETURNING usuario_id`,
      [email, hash]
    );
    if (!rows[0]) throw new Error(`No existe una cuenta con el correo ${email}.`);
    const id = rows[0].usuario_id;
    await c.query("INSERT INTO historial_contrasena (usuario_id, hash_contrasena) VALUES ($1, $2)", [id, hash]);
    await c.query("UPDATE sesion SET revocada_en = now() WHERE usuario_id = $1 AND revocada_en IS NULL", [id]);
    await c.query("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'BLANQUEO_CLAVE', $2::jsonb)",
      [id, JSON.stringify({ origen: "administrador técnico" })]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  console.log(`Contraseña blanqueada para ${email}. Sesiones abiertas cerradas.`);
  console.log(`Contraseña temporal (se pide cambiarla al ingresar): ${clave}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
