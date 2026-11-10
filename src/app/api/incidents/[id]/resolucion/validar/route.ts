/**
 * SIRU — app/api/incidents/[id]/resolucion/validar/route.ts
 *
 *   POST /api/incidents/:id/resolucion/validar  { resultado: "CONFIRMADA" | "RECHAZADA", observacion }
 *   → solo operador (HU-05, criterios 2 y 3). La observación es obligatoria al rechazar.
 *
 * Reemplaza el cierre directo del Sprint 2 (D-18): un incidente solo se cierra
 * validando una resolución informada con evidencia.
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { error, ipDe, leerJson } from "@/lib/servidor/http";
import { validarResolucion } from "@/lib/servidor/resoluciones";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requerirSesion(req, { roles: ["OPERADOR"] });
  if (!s.ok) return s.respuesta;
  const id = /^\d{1,9}$/.test(params.id) ? Number(params.id) : null;
  if (!id) return error(404, "NO_ENCONTRADO", "Incidente no encontrado.");

  const body = await leerJson<{ resultado?: unknown; observacion?: unknown }>(req);
  if (!body) return error(400, "DATOS_INCOMPLETOS", "Falta el resultado de la validación.");
  try {
    const r = await validarResolucion(s.usuario.id, id, { resultado: body.resultado, observacion: body.observacion }, ipDe(req));
    if (!r.ok) return error(r.status, r.codigo, r.mensaje, r.extra);
    return NextResponse.json({ success: true, data: r.datos });
  } catch (e) {
    console.error("[SIRU API] Error al validar la resolución:", e);
    return error(500, "ERROR_INTERNO", "No se pudo registrar la validación.");
  }
}
