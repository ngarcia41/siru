/**
 * SIRU — app/api/incidents/[id]/route.ts
 *
 *   GET   /api/incidents/:id  → un incidente
 *   PATCH /api/incidents/:id  → solo operador:
 *     { action: "reclasificar", severidad?, categoria? }  (HU-04, D-13; severidad: low | medium | high)
 *   El cierre directo del Sprint 2 (action "resolve") se eliminó: un incidente se cierra validando una
 *   resolución con evidencia (POST /api/incidents/:id/resolucion/validar, D-18).
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { obtenerIncidente, reclasificarIncidente } from "@/lib/servidor/incidentes";
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

  const body = await leerJson<{ action?: string; severidad?: unknown; categoria?: unknown }>(req);

  if (body?.action === "reclasificar") {
    try {
      const r = await reclasificarIncidente(s.usuario.id, id, { severidad: body.severidad, categoria: body.categoria }, ipDe(req));
      if (!r.ok) return error(r.status, r.codigo, r.mensaje, r.extra);
      return NextResponse.json({ success: true, data: r.datos });
    } catch (e) {
      console.error("[SIRU API] Error al reclasificar:", e);
      return error(500, "ERROR_INTERNO", "No se pudo reclasificar el incidente.");
    }
  }

  return error(400, "ACCION_INVALIDA", "Acción no reconocida.");
}
