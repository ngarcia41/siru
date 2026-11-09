/**
 * SIRU — app/api/incidents/route.ts
 *
 *   GET  /api/incidents  → incidentes no desestimados (vecino u operador)
 *   POST /api/incidents  → alta de incidente (solo vecino), HU-02
 *
 * El alta valida en el servidor la precisión del GPS (≤ 25 m), el límite de
 * 5 reportes por día, la huella SHA-256 de la foto y la existencia de un
 * incidente abierto de la misma categoría a menos de 50 m (HTTP 409).
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { crearIncidente, listarIncidentes } from "@/lib/servidor/incidentes";
import { error, esPunto, ipDe, leerJson } from "@/lib/servidor/http";
import type { CreateIncidentDto } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await requerirSesion(req);
  if (!s.ok) return s.respuesta;
  const data = await listarIncidentes();
  return NextResponse.json({ success: true, data, total: data.length });
}

export async function POST(req: NextRequest) {
  const s = await requerirSesion(req, { roles: ["VECINO"] });
  if (!s.ok) return s.respuesta;

  const body = await leerJson<CreateIncidentDto>(req);
  if (!body || !esPunto(body.geom) || !body.category || !body.description || !body.photoHash || !body.severity) {
    return error(400, "DATOS_INCOMPLETOS", "Faltan datos obligatorios: ubicación, categoría, severidad, descripción y foto.");
  }

  try {
    const r = await crearIncidente(s.usuario.id, {
      lat: body.geom.lat,
      lng: body.geom.lng,
      precision: body.gpsAccuracy,
      categoria: body.category,
      severidad: body.severity,
      descripcion: String(body.description),
      hashFoto: String(body.photoHash).toLowerCase(),
    }, ipDe(req));
    if (!r.ok) return error(r.status, r.codigo, r.mensaje, r.extra);
    return NextResponse.json({ success: true, data: r.datos }, { status: 201 });
  } catch (e) {
    console.error("[SIRU API] Error al crear el incidente:", e);
    return error(500, "ERROR_INTERNO", "No se pudo registrar el incidente. Intentá de nuevo.");
  }
}
