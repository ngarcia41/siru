/**
 * SIRU — app/api/trust/route.ts
 * POST /api/trust — Confirmación participativa (HU-03), solo vecino.
 *
 * Reglas validadas en el servidor:
 *   1. Sesión activa con perfil de vecino.
 *   2. Precisión del GPS de 25 m o menos.
 *   3. No puede confirmar su propio reporte ni confirmar dos veces.
 *   4. Debe estar a menos de 50 m (ST_Distance de PostGIS).
 *   5. Máximo 20 confirmaciones cada 24 horas.
 *   6. Al llegar a 3 puntos, el incidente pasa a Activo.
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { confirmarIncidente } from "@/lib/servidor/incidentes";
import { error, esPunto, ipDe, leerJson } from "@/lib/servidor/http";
import type { AddTrustDto } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await requerirSesion(req, { roles: ["VECINO"] });
  if (!s.ok) return s.respuesta;

  const body = await leerJson<AddTrustDto>(req);
  if (!body || !/^\d{1,9}$/.test(String(body.incidentId)) || !esPunto(body.userLocation)) {
    return error(400, "DATOS_INCOMPLETOS", "Faltan datos obligatorios: incidente y ubicación.");
  }

  try {
    const r = await confirmarIncidente(s.usuario.id, Number(body.incidentId), {
      lat: body.userLocation.lat,
      lng: body.userLocation.lng,
      precision: body.gpsAccuracy,
    }, ipDe(req));
    if (!r.ok) return error(r.status, r.codigo, r.mensaje);
    return NextResponse.json({ success: true, data: r.datos, message: r.mensaje });
  } catch (e) {
    console.error("[SIRU API] Error al confirmar:", e);
    return error(500, "ERROR_INTERNO", "No se pudo registrar la confirmación.");
  }
}
