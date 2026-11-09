/**
 * SIRU — app/api/incidents/[id]/route.ts
 * API Route — Operaciones sobre un incidente específico.
 *
 * Endpoints:
 *   GET   /api/incidents/:id  → Obtiene un incidente por ID
 *   PATCH /api/incidents/:id  → Cierre participativo (resolve)
 */

import { NextRequest, NextResponse } from "next/server";
import { incidentStore, resolveIncident } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const incident = incidentStore.find((i) => i.id === params.id);

  if (!incident) {
    return NextResponse.json(
      { success: false, error: "Incidente no encontrado" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: incident });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { action, userId } = await request.json();

    if (action === "resolve") {
      const updated = resolveIncident(params.id, userId);
      if (!updated) {
        return NextResponse.json(
          { success: false, error: "Incidente no encontrado o ya resuelto" },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, data: updated });
    }

    return NextResponse.json(
      { success: false, error: "Acción no reconocida" },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: "Error interno" },
      { status: 500 }
    );
  }
}
