/**
 * SIRU — GET /api/auth/sesion
 * Devuelve el usuario de la sesión y renueva su última actividad.
 * La interfaz lo usa al cargar y cuando el vecino elige "Seguir conectado".
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await requerirSesion(req, { permitirCambioPendiente: true });
  if (!s.ok) return s.respuesta;
  return NextResponse.json({ success: true, usuario: { ...s.usuario, inactividadMinutos: s.inactividadMinutos } });
}
