/**
 * SIRU — app/api/incidents/cercania/route.ts
 *
 *   POST /api/incidents/cercania  { lat, lng, category }  → solo vecino (D-24)
 *
 * Verificación anticipada de duplicados del paso 2 del alta: informa si ya hay
 * un incidente abierto de la misma categoría a menos de 50 m, con la misma
 * consulta PostGIS que el alta. No crea ni modifica nada, y el alta vuelve a
 * controlarlo al enviar.
 *
 * Se usa POST para que la posición del vecino viaje en el cuerpo y no en la
 * URL, donde quedaría en los registros de acceso del servidor y del proxy.
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { verificarCercania } from "@/lib/servidor/incidentes";
import { error, esPunto, leerJson } from "@/lib/servidor/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await requerirSesion(req, { roles: ["VECINO"] });
  if (!s.ok) return s.respuesta;

  const body = await leerJson<{ lat?: unknown; lng?: unknown; category?: unknown }>(req);
  const punto = { lat: body?.lat, lng: body?.lng };
  if (!body || !esPunto(punto) || typeof body.category !== "string") {
    return error(400, "DATOS_INCOMPLETOS", "Faltan datos obligatorios: ubicación y categoría.");
  }

  try {
    const r = await verificarCercania(s.usuario.id, { lat: punto.lat, lng: punto.lng, categoria: body.category });
    if (!r.ok) return error(r.status, r.codigo, r.mensaje, r.extra);
    return NextResponse.json({ success: true, data: r.datos });
  } catch (e) {
    console.error("[SIRU API] Error al verificar la cercanía:", e);
    return error(500, "ERROR_INTERNO", "No se pudo verificar la cercanía. Intentá de nuevo.");
  }
}
