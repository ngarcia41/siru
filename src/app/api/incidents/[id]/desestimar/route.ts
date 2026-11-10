/**
 * SIRU — app/api/incidents/[id]/desestimar/route.ts
 *
 *   POST /api/incidents/:id/desestimar  { observacion }  → solo operador (HU-05 criterio 4, D-12)
 *
 * Desestima un reporte falso, inexistente o ajeno al alcance, desde Sin
 * verificar o Activo. Después controla la suspensión del autor (D-09): la
 * respuesta informa en `cuentaSuspendida` si la cuenta quedó suspendida.
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { error, ipDe, leerJson } from "@/lib/servidor/http";
import { desestimarIncidente } from "@/lib/servidor/resoluciones";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requerirSesion(req, { roles: ["OPERADOR"] });
  if (!s.ok) return s.respuesta;
  const id = /^\d{1,9}$/.test(params.id) ? Number(params.id) : null;
  if (!id) return error(404, "NO_ENCONTRADO", "Incidente no encontrado.");

  const body = await leerJson<{ observacion?: unknown }>(req);
  try {
    const r = await desestimarIncidente(s.usuario.id, id, body?.observacion, ipDe(req));
    if (!r.ok) return error(r.status, r.codigo, r.mensaje, r.extra);
    return NextResponse.json({ success: true, data: r.datos.incidente, cuentaSuspendida: r.datos.cuentaSuspendida });
  } catch (e) {
    console.error("[SIRU API] Error al desestimar:", e);
    return error(500, "ERROR_INTERNO", "No se pudo desestimar el incidente.");
  }
}
