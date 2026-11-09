/**
 * SIRU — lib/types.ts
 * Tipos compartidos entre la interfaz y la API.
 *
 * La base de datos (PostgreSQL + PostGIS) usa los nombres del DER del
 * documento (INCIDENTE, CONFIRMACION, ...); la API los traduce a estos
 * objetos para la interfaz. Ver lib/servidor/incidentes.ts.
 */

/** Punto geográfico en WGS-84 (EPSG:4326). En la base: GEOMETRY(Point, 4326). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Categorías definidas en el documento (tabla CATEGORIA). */
export type IncidentCategory = "Bache" | "Luminaria" | "Anegamiento" | "Basura acumulada" | "Otro";

/**
 * Ciclo de vida del incidente (columna INCIDENTE.Estado):
 *   unverified = SIN_VERIFICAR (menos de 3 puntos)
 *   active     = ACTIVO        (3 puntos o más; entra al mapa de calor)
 *   review     = EN_REVISION   (resolución informada, pendiente de validar)
 *   resolved   = RESUELTO      (cierre validado por un operador)
 *   dismissed  = DESESTIMADO   (reporte falso o fuera de alcance)
 */
export type IncidentStatus = "unverified" | "active" | "review" | "resolved" | "dismissed";

/** Severidad (tabla SEVERIDAD): baja, media o alta. */
export type IncidentSeverity = "low" | "medium" | "high";

export interface Incident {
  id: string;
  geom: GeoPoint;
  category: IncidentCategory;
  description: string;
  photoHash: string;
  /** Miniatura de 480 px, para cualquier usuario autenticado (null si el incidente no tiene foto guardada). */
  miniaturaUrl: string | null;
  /** Foto completa privada: la ruta solo la entrega al operador. */
  fotoUrl: string | null;
  exifData: ExifMetadata | null;
  gpsAccuracy: number | null;
  trustPoints: number;
  status: IncidentStatus;
  severity: IncidentSeverity;
  createdBy: string;
  confirmedBy: string[];
  createdAt: string;
  resolvedAt?: string;
  address?: string;
}

/** Usuario de la sesión actual, tal como lo informa GET /api/auth/sesion. */
export interface SesionCliente {
  id: number;
  email: string;
  rol: "VECINO" | "OPERADOR";
  debeCambiarClave: boolean;
  inactividadMinutos: number;
}

/** Subconjunto de metadatos EXIF relevantes para la validación de la imagen. */
export interface ExifMetadata {
  make?: string;
  model?: string;
  dateTaken?: string;
  gpsLat?: number;
  gpsLng?: number;
  width?: number;
  height?: number;
}

/** POST /api/incidents se envía como multipart/form-data (ver app/api/incidents/route.ts). */

/** POST /api/trust. */
export interface AddTrustDto {
  incidentId: string;
  userLocation: GeoPoint;
  gpsAccuracy: number;
}
