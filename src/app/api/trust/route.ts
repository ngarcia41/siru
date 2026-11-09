/**
 * SIRU — app/api/trust/route.ts
 * API Route — Sistema de Puntos de Confianza.
 *
 * POST /api/trust — Sumar +1 punto de confianza a un incidente.
 *
 * Reglas de negocio (TFG §6.1):
 *   1. El usuario debe estar autenticado
 *   2. El usuario no puede confirmar su propio reporte
 *   3. El usuario no puede confirmar el mismo reporte más de una vez
 *   4. El usuario debe estar a <50m del incidente (validado en frontend; aquí se re-valida)
 *   5. Al llegar a 3 puntos, el estado cambia a "active" automáticamente
 */

import { NextRequest, NextResponse } from "next/server";
import { incidentStore, updateIncidentTrust } from "@/lib/db";
import { haversineDistance, GEOFENCE_RADIUS_M } from "@/lib/spatial";
import type { AddTrustDto } from "@/lib/types";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: AddTrustDto = await request.json();
    const { incidentId, userId, userLocation } = body;

    if (!incidentId || !userId || !userLocation) {
      return NextResponse.json(
        { success: false, error: "Campos obligatorios: incidentId, userId, userLocation" },
        { status: 400 }
      );
    }

    const incident = incidentStore.find((i) => i.id === incidentId);
    if (!incident) {
      return NextResponse.json(
        { success: false, error: "Incidente no encontrado" },
        { status: 404 }
      );
    }

    // Regla: No puede confirmar su propio reporte
    if (incident.createdBy === userId) {
      return NextResponse.json(
        { success: false, error: "No puede confirmar su propio reporte" },
        { status: 403 }
      );
    }

    // Regla: No puede confirmar dos veces
    if (incident.confirmedBy.includes(userId)) {
      return NextResponse.json(
        { success: false, error: "Ya confirmó la existencia de este incidente" },
        { status: 409 }
      );
    }

    // Regla: Validación de proximidad espacial (50m)
    const distance = haversineDistance(userLocation, incident.geom);
    if (distance >= GEOFENCE_RADIUS_M) {
      return NextResponse.json(
        {
          success: false,
          error: `Debe estar a menos de ${GEOFENCE_RADIUS_M}m del incidente para confirmar (distancia actual: ${Math.round(distance)}m)`,
        },
        { status: 403 }
      );
    }

    // Actualizar puntos de confianza (y transición de estado si corresponde)
    const updated = updateIncidentTrust(incidentId, userId);

    return NextResponse.json({
      success: true,
      data: updated,
      message:
        updated?.status === "active" && updated.trustPoints === 3
          ? "¡Incidente validado! Ha alcanzado 3 puntos de confianza y ahora es Activo."
          : `+1 Punto de Confianza sumado. Total: ${updated?.trustPoints} puntos.`,
    });
  } catch (error) {
    console.error("[SIRU API] Error adding trust:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
