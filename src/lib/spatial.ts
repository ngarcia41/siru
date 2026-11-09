/**
 * SIRU — lib/spatial.ts
 * Módulo de cálculos espaciales.
 *
 * Implementa el algoritmo de Haversine para calcular la distancia ortodrómica
 * (línea recta sobre la esfera terrestre) entre dos puntos GPS en metros.
 *
 * Referencia académica:
 *   Haversine formula — Sinnott, R.W. (1984). "Virtues of the Haversine".
 *   Sky and Telescope. 68(2): 159.
 *
 * Objetivo TFG §5.2 — Geofencing espacial de 50 metros:
 *   Si la distancia entre el nuevo reporte y un incidente activo preexistente
 *   de la misma categoría es < GEOFENCE_RADIUS_M (50 m), se bloquea la
 *   creación del duplicado y se ofrece sumar una confirmación de confianza.
 */

import type { GeoPoint, Incident, GeofenceCheckResult, IncidentCategory } from "./types";

// ---------------------------------------------------------------------------
// Constante de radio de geofencing
// ---------------------------------------------------------------------------

/** Radio de geofencing en metros. Valor definido en la especificación del TFG. */
export const GEOFENCE_RADIUS_M = 50;

// ---------------------------------------------------------------------------
// Algoritmo de Haversine
// ---------------------------------------------------------------------------

/**
 * Calcula la distancia en metros entre dos puntos geográficos (WGS-84)
 * usando la fórmula de Haversine.
 *
 * @param a - Punto de origen {lat, lng} en grados decimales
 * @param b - Punto de destino {lat, lng} en grados decimales
 * @returns Distancia en metros (número positivo)
 *
 * @example
 * const d = haversineDistance(
 *   { lat: -34.6482, lng: -58.5625 },   // Ramos Mejía centro
 *   { lat: -34.6487, lng: -58.5620 }    // ~60 metros al norte
 * );
 * // d ≈ 62.3 metros
 */
export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000; // Radio medio de la Tierra en metros (IUGG 2015)

  // Convertir grados a radianes
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);

  // Término a de Haversine
  const hav =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  // Ángulo central en radianes
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));

  return R * c; // Distancia en metros
}

// ---------------------------------------------------------------------------
// Verificación de geofencing
// ---------------------------------------------------------------------------

/**
 * Verifica si existe un incidente activo de la misma categoría dentro del
 * radio de geofencing de 50 metros respecto al punto indicado.
 *
 * Implementa la regla de negocio central del TFG:
 *   "Si el backend detecta un incidente activo de la misma categoría en un
 *    radio menor a 50 metros, debe interrumpir la creación de un nuevo
 *    registro y ofrecer sumar una confirmación de confianza al existente."
 *
 * @param location - Coordenadas del nuevo reporte
 * @param category - Categoría del nuevo reporte
 * @param existingIncidents - Lista de incidentes no resueltos en el sistema
 * @returns GeofenceCheckResult con flag de duplicado y referencia al existente
 */
export function checkGeofence(
  location: GeoPoint,
  category: IncidentCategory,
  existingIncidents: Incident[]
): GeofenceCheckResult {
  let nearestIncident: Incident | null = null;
  let nearestDistance: number | null = null;

  for (const incident of existingIncidents) {
    // Solo evaluar incidentes no resueltos de la misma categoría
    if (incident.status === "resolved" || incident.category !== category) {
      continue;
    }

    const distance = haversineDistance(location, incident.geom);

    // Registrar el más cercano para informar al usuario
    if (nearestDistance === null || distance < nearestDistance) {
      nearestDistance = distance;
      nearestIncident = incident;
    }
  }

  const hasDuplicate =
    nearestDistance !== null && nearestDistance < GEOFENCE_RADIUS_M;

  return {
    hasDuplicate,
    nearbyIncident: hasDuplicate ? nearestIncident : null,
    distanceMeters: nearestDistance,
  };
}

// ---------------------------------------------------------------------------
// Verificación de proximidad de usuario para confirmación de confianza
// ---------------------------------------------------------------------------

/**
 * Verifica si el usuario se encuentra dentro del radio de 50 metros de un
 * incidente para poder confirmar su existencia (sumar +1 punto de confianza).
 *
 * Regla TFG §6.1:
 *   "Solo los usuarios autenticados que se encuentren a menos de 50 metros
 *    pueden presionar 'Confirmar existencia'."
 *
 * @param userLocation - Coordenadas GPS actuales del usuario
 * @param incidentLocation - Coordenadas del incidente a confirmar
 * @returns true si el usuario está dentro del radio habilitado
 */
export function isWithinConfirmationRadius(
  userLocation: GeoPoint,
  incidentLocation: GeoPoint
): boolean {
  const distance = haversineDistance(userLocation, incidentLocation);
  return distance < GEOFENCE_RADIUS_M;
}

/**
 * Formatea una distancia en metros a texto legible para la UI.
 * @param meters - Distancia en metros
 * @returns String formateado (ej. "23 m" o "1.2 km")
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
