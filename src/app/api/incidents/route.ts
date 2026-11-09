/**
 * SIRU — app/api/incidents/route.ts
 * API Route de Next.js — Gestión de incidentes urbanos.
 *
 * Endpoints:
 *   GET  /api/incidents          → Lista todos los incidentes
 *   POST /api/incidents          → Crea un nuevo incidente con geofencing
 *
 * Objetivo TFG §5.2 — El endpoint POST implementa el control de duplicados
 * espaciales: si existe un incidente activo de la misma categoría a <50m,
 * retorna HTTP 409 (Conflict) con la referencia al incidente existente.
 */

import { NextRequest, NextResponse } from "next/server";
import { incidentStore, insertIncident, getActiveIncidents } from "@/lib/db";
import { checkGeofence } from "@/lib/spatial";
import type { CreateIncidentDto, Incident } from "@/lib/types";
import { v4 as uuidv4 } from "crypto"; // Usamos crypto para UUID en edge

// ---------------------------------------------------------------------------
// GET /api/incidents
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    success: true,
    data: incidentStore,
    total: incidentStore.length,
  });
}

// ---------------------------------------------------------------------------
// POST /api/incidents
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: CreateIncidentDto = await request.json();

    // Validación básica de campos obligatorios
    if (!body.geom || !body.category || !body.description || !body.photoHash) {
      return NextResponse.json(
        { success: false, error: "Campos obligatorios faltantes: geom, category, description, photoHash" },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // GEOFENCING: Control de duplicados espaciales (TFG §5.2)
    // -----------------------------------------------------------------------
    const activeIncidents = getActiveIncidents();
    const geofenceResult = checkGeofence(body.geom, body.category, activeIncidents);

    if (geofenceResult.hasDuplicate && geofenceResult.nearbyIncident) {
      // Devolver HTTP 409 con referencia al incidente existente
      return NextResponse.json(
        {
          success: false,
          error: "GEOFENCE_DUPLICATE",
          message: `Ya existe un incidente de tipo "${body.category}" a ${Math.round(geofenceResult.distanceMeters!)} metros. ¿Desea confirmar su existencia?`,
          nearbyIncident: geofenceResult.nearbyIncident,
          distanceMeters: geofenceResult.distanceMeters,
        },
        { status: 409 }
      );
    }

    // -----------------------------------------------------------------------
    // Creación del nuevo incidente
    // -----------------------------------------------------------------------
    const newIncident: Incident = {
      id: `inc-${Date.now()}`,
      geom: body.geom,
      category: body.category,
      description: body.description,
      photoHash: body.photoHash,
      exifData: body.exifData,
      trustPoints: 0,
      status: "unverified",
      severity: body.severity || "low",
      createdBy: body.userId,
      confirmedBy: [],
      createdAt: new Date().toISOString(),
    };

    const created = insertIncident(newIncident);

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    console.error("[SIRU API] Error creating incident:", error);
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
