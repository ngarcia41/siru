/**
 * SIRU — POST /api/auth/salir
 * Cierra la sesión: la invalida en el servidor y borra la cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { borrarCookie, requerirSesion, revocarSesion } from "@/lib/servidor/sesion";
import { auditar } from "@/lib/servidor/auditoria";
import { ipDe } from "@/lib/servidor/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await requerirSesion(req, { permitirCambioPendiente: true });
  if (s.ok) {
    await revocarSesion(s.sesionId);
    await auditar("CIERRE_SESION", { usuarioId: s.usuario.id, ip: ipDe(req) });
  }
  const res = NextResponse.json({ success: true });
  borrarCookie(res);
  return res;
}
