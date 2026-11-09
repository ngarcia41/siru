/**
 * SIRU — lib/servidor/sesion.ts
 * Gestión de la sesión (HU-08).
 *
 * - El token es un JWT firmado (HS256) que viaja en una cookie HttpOnly,
 *   SameSite=Strict y, en producción, Secure: el código del navegador no
 *   puede leerlo.
 * - Cada token apunta a una fila de la tabla SESION. Así el servidor puede
 *   invalidarlo al cerrar sesión y controlar la inactividad: 30 minutos para
 *   el vecino y 15 para el operador, con una duración máxima de 8 horas.
 */
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "./db";
import { error } from "./http";
import { INACTIVIDAD_MINUTOS, SESION_MAXIMA_HORAS, type Rol } from "../reglas";

export const COOKIE_SESION = "siru_sesion";

export function secretoSesion(): Uint8Array {
  const s = process.env.SESION_SECRETO ?? "";
  if (s.length < 32) throw new Error("SESION_SECRETO debe tener al menos 32 caracteres (ver .env.example)");
  return new TextEncoder().encode(s);
}

export interface UsuarioSesion {
  id: number;
  email: string;
  rol: Rol;
  debeCambiarClave: boolean;
}

export async function crearSesion(usuario: { usuario_id: number; rol: Rol }, ip: string | null): Promise<string> {
  const sesionId = randomUUID();
  await pool.query(
    "INSERT INTO sesion (sesion_id, usuario_id, direccion_ip) VALUES ($1, $2, $3)",
    [sesionId, usuario.usuario_id, ip]
  );
  return new SignJWT({ sid: sesionId, rol: usuario.rol })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(usuario.usuario_id))
    .setIssuedAt()
    .setExpirationTime(`${SESION_MAXIMA_HORAS}h`)
    .sign(secretoSesion());
}

export function guardarCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_SESION, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESION_MAXIMA_HORAS * 3600,
  });
}

export function borrarCookie(res: NextResponse) {
  res.cookies.set(COOKIE_SESION, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
}

export async function revocarSesion(sesionId: string) {
  await pool.query("UPDATE sesion SET revocada_en = now() WHERE sesion_id = $1 AND revocada_en IS NULL", [sesionId]);
}

function noAutorizado(codigo: string, mensaje: string) {
  const r = error(401, codigo, mensaje);
  borrarCookie(r);
  return r;
}

export type ResultadoSesion =
  | { ok: true; usuario: UsuarioSesion; sesionId: string; inactividadMinutos: number }
  | { ok: false; respuesta: NextResponse };

/**
 * Valida la sesión de la solicitud y renueva su última actividad.
 * Con `roles` restringe el acceso por perfil; con `permitirCambioPendiente`
 * deja pasar a un usuario que todavía debe cambiar su contraseña.
 */
export async function requerirSesion(
  req: NextRequest,
  opciones: { roles?: Rol[]; permitirCambioPendiente?: boolean } = {}
): Promise<ResultadoSesion> {
  const token = req.cookies.get(COOKIE_SESION)?.value;
  if (!token) return { ok: false, respuesta: noAutorizado("NO_AUTENTICADO", "Iniciá sesión para continuar.") };

  let sid: string, sub: string;
  try {
    const { payload } = await jwtVerify(token, secretoSesion(), { algorithms: ["HS256"] });
    sid = String(payload.sid);
    sub = String(payload.sub);
  } catch {
    return { ok: false, respuesta: noAutorizado("SESION_EXPIRADA", "Tu sesión venció. Volvé a ingresar.") };
  }

  const { rows } = await pool.query(
    `SELECT s.sesion_id, s.usuario_id, s.revocada_en,
            EXTRACT(EPOCH FROM (now() - s.ultima_actividad)) AS seg_inactivo,
            EXTRACT(EPOCH FROM (now() - s.creada)) AS seg_desde_inicio,
            u.email, u.rol, u.estado_cuenta, u.debe_cambiar_clave
       FROM sesion s JOIN usuario u ON u.usuario_id = s.usuario_id
      WHERE s.sesion_id = $1`,
    [sid]
  );
  const fila = rows[0];
  if (!fila || fila.revocada_en || String(fila.usuario_id) !== sub || fila.estado_cuenta !== "ACTIVA") {
    return { ok: false, respuesta: noAutorizado("SESION_EXPIRADA", "Tu sesión venció. Volvé a ingresar.") };
  }

  const rol = fila.rol as Rol;
  const limiteInactividad = INACTIVIDAD_MINUTOS[rol] * 60;
  if (Number(fila.seg_inactivo) > limiteInactividad) {
    await revocarSesion(sid);
    return { ok: false, respuesta: noAutorizado("SESION_EXPIRADA", "Tu sesión venció por inactividad. Volvé a ingresar.") };
  }
  if (Number(fila.seg_desde_inicio) > SESION_MAXIMA_HORAS * 3600) {
    await revocarSesion(sid);
    return { ok: false, respuesta: noAutorizado("SESION_EXPIRADA", "Alcanzaste la duración máxima de la sesión. Volvé a ingresar.") };
  }

  const usuario: UsuarioSesion = {
    id: fila.usuario_id,
    email: fila.email,
    rol,
    debeCambiarClave: fila.debe_cambiar_clave,
  };

  if (opciones.roles && !opciones.roles.includes(rol)) {
    return { ok: false, respuesta: error(403, "SIN_PERMISO", "Tu perfil no tiene permiso para esta acción.") };
  }
  if (usuario.debeCambiarClave && !opciones.permitirCambioPendiente) {
    return { ok: false, respuesta: error(403, "CAMBIO_CLAVE_REQUERIDO", "Tenés que cambiar tu contraseña antes de continuar.") };
  }

  await pool.query("UPDATE sesion SET ultima_actividad = now() WHERE sesion_id = $1", [sid]);
  return { ok: true, usuario, sesionId: sid, inactividadMinutos: INACTIVIDAD_MINUTOS[rol] };
}
