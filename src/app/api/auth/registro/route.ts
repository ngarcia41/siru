/**
 * SIRU — POST /api/auth/registro (HU-01)
 * Alta de vecinos con correo único, política de claves, hash bcrypt y
 * enlace de verificación de un solo uso válido por 24 horas.
 * Los operadores no se registran desde aquí: los crea el administrador técnico.
 */
import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { transaccion } from "@/lib/servidor/db";
import { guardarEnHistorial, hashear } from "@/lib/servidor/clave";
import { auditar } from "@/lib/servidor/auditoria";
import { enviarVerificacion, modoConsola } from "@/lib/servidor/correo";
import { error, ipDe, leerJson } from "@/lib/servidor/http";
import { requisitosIncumplidos } from "@/lib/politicaClave";
import { HORAS_VALIDEZ_VERIFICACION } from "@/lib/reglas";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  const body = await leerJson<{ email?: string; clave?: string }>(req);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const clave = String(body?.clave ?? "");
  if (!EMAIL.test(email) || email.length > 120) return error(400, "EMAIL_INVALIDO", "Ingresá un correo electrónico válido.");

  const faltan = requisitosIncumplidos(clave, email);
  if (faltan.length) return error(400, "CLAVE_DEBIL", "La contraseña no cumple la política de claves.", { requisitos: faltan });

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const hash = await hashear(clave);

  try {
    const usuarioId = await transaccion(async (c) => {
      const existe = await c.query("SELECT 1 FROM usuario WHERE email = $1", [email]);
      if (existe.rowCount) return null;
      const { rows } = await c.query(
        `INSERT INTO usuario (email, hash_contrasena, rol, estado_cuenta, token_verificacion_hash, token_verificacion_vence)
         VALUES ($1, $2, 'VECINO', 'PENDIENTE', $3, now() + make_interval(hours => $4))
         RETURNING usuario_id`,
        [email, hash, tokenHash, HORAS_VALIDEZ_VERIFICACION]
      );
      const id = rows[0].usuario_id as number;
      await guardarEnHistorial(c, id, hash);
      await auditar("REGISTRO_USUARIO", { usuarioId: id, ip: ipDe(req), detalle: { rol: "VECINO" } }, c);
      return id;
    });
    if (usuarioId === null) return error(409, "EMAIL_NO_DISPONIBLE", "El correo no está disponible.");

    const enlace = `${req.nextUrl.origin}/api/auth/verificar?token=${token}`;
    await enviarVerificacion(email, enlace);
    return NextResponse.json({
      success: true,
      message: "Te enviamos un enlace para verificar tu correo. Vence en 24 horas.",
      // Solo en desarrollo: el enlace se devuelve para poder probar sin correo real.
      ...(modoConsola() ? { enlaceDesarrollo: enlace } : {}),
    }, { status: 201 });
  } catch (e) {
    console.error("[SIRU API] Error en el registro:", e);
    return error(500, "ERROR_INTERNO", "No se pudo completar el registro.");
  }
}
