/**
 * SIRU — app/api/incidents/[id]/route.ts
 *
 *   GET   /api/incidents/:id  → un incidente
 *   PATCH /api/incidents/:id  → { action: "resolve", observacion? } solo operador
 *
 * El cierre queda registrado en RESOLUCION (quién lo validó y cuándo) y en la
 * auditoría. El informe del vecino con evidencia fotográfica se agrega en el
 * Sprint 3 (HU-05).
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { obtenerIncidente, resolverIncidente } from "@/lib/servidor/incidentes";
import { error, ipDe, leerJson } from "@/lib/servidor/http";

export const dynamic = "force-dynamic";

function idValido(v: string): number | null {
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requerirSesion(req);
  if (!s.ok) return s.respuesta;
  const id = idValido(params.id);
  const inc = id ? await obtenerIncidente(id) : null;
  if (!inc || inc.status === "dismissed") return error(404, "NO_ENCONTRADO", "Incidente no encontrado.");
  return NextResponse.json({ success: true, data: inc });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requerirSesion(req, { roles: ["OPERADOR"] });
  if (!s.ok) return s.respuesta;
  const id = idValido(params.id);
  if (!id) return error(404, "NO_ENCONTRADO", "Incidente no encontrado.");

  const body = await leerJson<{ action?: string; observacion?: string }>(req);
  if (body?.action !== "resolve") return error(400, "ACCION_INVALIDA", "Acción no reconocida.");

  try {
    const r = await resolverIncidente(s.usuario.id, id, body.observacion ?? null, ipDe(req));
    if (!r.ok) return error(r.status, r.codigo, r.mensaje);
    return NextResponse.json({ success: true, data: r.datos });
  } catch (e) {
    console.error("[SIRU API] Error al resolver:", e);
    return error(500, "ERROR_INTERNO", "No se pudo registrar el cierre.");
  }
}
