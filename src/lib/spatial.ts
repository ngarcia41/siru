/**
 * SIRU — lib/spatial.ts
 * Utilidades espaciales para la interfaz.
 *
 * Desde el Sprint 2 las validaciones de proximidad (duplicados y
 * confirmaciones) las resuelve PostGIS en el servidor con ST_DWithin y
 * ST_Distance (ver lib/servidor/incidentes.ts). Aquí queda solo el cálculo
 * de Haversine para mostrar distancias aproximadas en pantalla.
 *
 * Referencia: Sinnott, R. W. (1984). Virtues of the Haversine. Sky and Telescope, 68(2), 159.
 */
import type { GeoPoint } from "./types";
import { RADIO_METROS } from "./reglas";

/** Radio de validación espacial (metros), definido en las reglas del documento. */
export const GEOFENCE_RADIUS_M = RADIO_METROS;

/** Distancia en metros entre dos puntos WGS-84 (fórmula de Haversine). */
export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Formatea una distancia para la interfaz (ej. "23 m" o "1.2 km"). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
