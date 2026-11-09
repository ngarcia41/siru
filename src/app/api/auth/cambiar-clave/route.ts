/**
 * SIRU — POST /api/auth/cambiar-clave (HU-08)
 * Exige la clave actual, aplica la política de claves y rechaza cualquiera
 * de las últimas 3 contraseñas usadas.
 */
import { NextRequest, NextResponse } from "next/server";
import { transaccion } from "@/lib/servidor/db";
import { coincide, guardarEnHistorial, hashear, usadaRecientemente } from "@/lib/servidor/clave";
import { auditar } from "@/lib/servidor/auditoria";
import { requerirSesion } from "@/lib/servidor/sesion";
import { error, ipDe, leerJson } from "@/lib/servidor/http";
import { requisitosIncumplidos } from "@/lib/politicaClave";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await requerirSesion(req, { permitirCambioPendiente: true });
  if (!s.ok) return s.respuesta;

  const body = await leerJson<{ actual?: string; nueva?: string }>(req);
  const actual = String(body?.actual ?? "");
  const nueva = String(body?.nueva ?? "");

  const faltan = requisitosIncumplidos(nueva, s.usuario.email);
  if (faltan.length) return error(400, "CLAVE_DEBIL", "La nueva contraseña no cumple la política de claves.", { requisitos: faltan });

  const r = await transaccion(async (c) => {
    const { rows } = await c.query("SELECT hash_contrasena FROM usuario WHERE usuario_id = $1 FOR UPDATE", [s.usuario.id]);
    if (!(await coincide(actual, rows[0].hash_contrasena))) return "ACTUAL_INCORRECTA" as const;
    if (await usadaRecientemente(c, s.usuario.id, nueva)) return "REPETIDA" as const;
    const hash = await hashear(nueva);
    await c.query(
      "UPDATE usuario SET hash_contrasena = $2, fecha_cambio_clave = now(), debe_cambiar_clave = FALSE WHERE usuario_id = $1",
      [s.usuario.id, hash]
    );
    await guardarEnHistorial(c, s.usuario.id, hash);
    await auditar("CAMBIO_CLAVE", { usuarioId: s.usuario.id, ip: ipDe(req) }, c);
    return "OK" as const;
  });

  if (r === "ACTUAL_INCORRECTA") return error(400, "CLAVE_ACTUAL_INCORRECTA", "La contraseña actual no es correcta.");
  if (r === "REPETIDA") return error(400, "CLAVE_REPETIDA", "No podés reutilizar ninguna de tus últimas 3 contraseñas.");
  return NextResponse.json({ success: true, message: "Contraseña actualizada." });
}
