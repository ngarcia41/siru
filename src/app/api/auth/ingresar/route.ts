/**
 * SIRU — POST /api/auth/ingresar (HU-01 y HU-08)
 *
 * - Mensaje genérico ante credenciales inválidas (no revela si el correo existe).
 * - 3 intentos fallidos consecutivos → bloqueo de 15 minutos.
 * - 3 bloqueos en 24 horas → cuenta BLOQUEADA hasta que se blanquee la clave.
 * - Contraseña vencida (90 días operador, 180 vecino) → cambio obligatorio.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/servidor/db";
import { coincide, compararFicticio } from "@/lib/servidor/clave";
import { auditar } from "@/lib/servidor/auditoria";
import { crearSesion, guardarCookie } from "@/lib/servidor/sesion";
import { error, ipDe, leerJson } from "@/lib/servidor/http";
import {
  BLOQUEOS_PARA_BLOQUEO_PERMANENTE, INTENTOS_ANTES_DE_BLOQUEO, MINUTOS_DE_BLOQUEO, VIGENCIA_CLAVE_DIAS, type Rol,
} from "@/lib/reglas";

export const dynamic = "force-dynamic";

const GENERICO = () => error(401, "CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos.");

export async function POST(req: NextRequest) {
  const ip = ipDe(req);
  const body = await leerJson<{ email?: string; clave?: string }>(req);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const clave = String(body?.clave ?? "");
  if (!email || !clave) return GENERICO();

  const u = (await pool.query(
    `SELECT usuario_id, hash_contrasena, rol, estado_cuenta,
            CEIL(EXTRACT(EPOCH FROM (bloqueado_hasta - now())) / 60) AS min_bloqueo
       FROM usuario WHERE email = $1`,
    [email]
  )).rows[0];

  if (!u) {
    await compararFicticio(clave);
    return GENERICO();
  }
  if (u.estado_cuenta === "BLOQUEADA" || u.estado_cuenta === "SUSPENDIDA") {
    return error(423, "CUENTA_BLOQUEADA", "La cuenta está bloqueada. Pedí el blanqueo de la contraseña al administrador del sistema.");
  }
  if (u.min_bloqueo !== null && Number(u.min_bloqueo) > 0) {
    return error(423, "BLOQUEO_TEMPORAL", `Demasiados intentos fallidos. Probá de nuevo en ${u.min_bloqueo} minuto(s).`);
  }

  if (!(await coincide(clave, u.hash_contrasena))) {
    const { rows } = await pool.query(
      "UPDATE usuario SET intentos_fallidos = intentos_fallidos + 1 WHERE usuario_id = $1 RETURNING intentos_fallidos",
      [u.usuario_id]
    );
    const intentos = Number(rows[0].intentos_fallidos);
    await auditar("LOGIN_FALLIDO", { usuarioId: u.usuario_id, ip, detalle: { intento: intentos } });
    if (intentos < INTENTOS_ANTES_DE_BLOQUEO) return GENERICO();

    await pool.query(
      "UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = now() + make_interval(mins => $2) WHERE usuario_id = $1",
      [u.usuario_id, MINUTOS_DE_BLOQUEO]
    );
    await auditar("BLOQUEO_CUENTA", { usuarioId: u.usuario_id, ip, detalle: { minutos: MINUTOS_DE_BLOQUEO } });
    const [{ n }] = (await pool.query(
      `SELECT count(*)::int AS n FROM auditoria
        WHERE usuario_id = $1 AND accion = 'BLOQUEO_CUENTA' AND fecha_hora > now() - interval '24 hours'
          -- después de un blanqueo o un cambio de clave, el conteo vuelve a empezar
          AND fecha_hora > COALESCE((SELECT max(fecha_hora) FROM auditoria
                                      WHERE usuario_id = $1 AND accion IN ('BLANQUEO_CLAVE', 'CAMBIO_CLAVE')), '-infinity')`,
      [u.usuario_id]
    )).rows;
    if (n >= BLOQUEOS_PARA_BLOQUEO_PERMANENTE) {
      await pool.query("UPDATE usuario SET estado_cuenta = 'BLOQUEADA' WHERE usuario_id = $1", [u.usuario_id]);
      await auditar("BLOQUEO_PERMANENTE", { usuarioId: u.usuario_id, ip, detalle: { bloqueosEn24h: n } });
      return error(423, "CUENTA_BLOQUEADA", "La cuenta quedó bloqueada por repetidos intentos fallidos. Pedí el blanqueo de la contraseña al administrador del sistema.");
    }
    return error(423, "BLOQUEO_TEMPORAL", `Tercer intento fallido: la cuenta quedó bloqueada durante ${MINUTOS_DE_BLOQUEO} minutos.`);
  }

  if (u.estado_cuenta === "PENDIENTE") {
    return error(403, "CORREO_SIN_VERIFICAR", "Antes de ingresar, verificá tu correo con el enlace que te enviamos.");
  }

  const rol = u.rol as Rol;
  const { rows } = await pool.query(
    `UPDATE usuario
        SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now(),
            debe_cambiar_clave = debe_cambiar_clave OR fecha_cambio_clave < now() - make_interval(days => $2)
      WHERE usuario_id = $1
      RETURNING email, rol, debe_cambiar_clave`,
    [u.usuario_id, VIGENCIA_CLAVE_DIAS[rol]]
  );
  const token = await crearSesion({ usuario_id: u.usuario_id, rol }, ip);
  const res = NextResponse.json({
    success: true,
    usuario: { email: rows[0].email, rol, debeCambiarClave: rows[0].debe_cambiar_clave },
  });
  guardarCookie(res, token);
  return res;
}
