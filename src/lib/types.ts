/**
 * SIRU — lib/types.ts
 * Interfaces TypeScript que modelan los esquemas de datos del sistema.
 * Inspiran directamente en el esquema DDL de PostgreSQL + PostGIS definido
 * en la sección de arquitectura de datos de la memoria del TFG.
 *
 * Equivalencias PostGIS:
 *   GeoPoint       → GEOMETRY(Point, 4326)
 *   Incident.geom  → columna geom con SRID 4326 (WGS-84)
 */

// ---------------------------------------------------------------------------
// Tipos espaciales
// ---------------------------------------------------------------------------

/** Representa un punto geográfico en el sistema de referencia WGS-84 (EPSG:4326) */
export interface GeoPoint {
  lat: number; // Latitud decimal
  lng: number; // Longitud decimal
}

// ---------------------------------------------------------------------------
// Enumeraciones de dominio
// ---------------------------------------------------------------------------

/**
 * Categorías de incidentes disponibles en el sistema.
 * Objetivo TFG §3.2 – Taxonomía de Eventos Urbanos.
 */
export type IncidentCategory =
  | "Bache"
  | "Iluminación"
  | "Basura"
  | "Vandalismo"
  | "Inundación"
  | "Otro";

/**
 * Ciclo de vida del incidente según puntos de confianza acumulados.
 *
 * Sin Verificar  (0–2 pts): recién creado, opacidad reducida en el mapa.
 * Activo         (≥3 pts):  validado por la comunidad, ingresa al heatmap.
 * Resuelto       (cierre participativo): marcador gris, pasa a historial.
 */
export type IncidentStatus = "unverified" | "active" | "resolved";

/** Nivel de severidad visual del marcador cuando el reporte es "Activo" */
export type IncidentSeverity = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Entidad principal: Incidente
// ---------------------------------------------------------------------------

/**
 * Equivalente a la tabla `incidents` en PostgreSQL + PostGIS.
 *
 * CREATE TABLE incidents (
 *   id           UUID PRIMARY KEY,
 *   geom         GEOMETRY(Point, 4326) NOT NULL,  -- índice GIST
 *   category     TEXT NOT NULL,
 *   description  TEXT NOT NULL,
 *   photo_hash   TEXT NOT NULL,                   -- SHA-256 anti-duplicados
 *   trust_points INT  DEFAULT 0,
 *   status       TEXT DEFAULT 'unverified',
 *   severity     TEXT DEFAULT 'low',
 *   created_by   UUID REFERENCES users(id),
 *   confirmed_by UUID[],
 *   created_at   TIMESTAMPTZ DEFAULT now(),
 *   resolved_at  TIMESTAMPTZ
 * );
 * CREATE INDEX incidents_geom_idx ON incidents USING GIST(geom);
 */
export interface Incident {
  id: string;
  geom: GeoPoint; // Equivale a GEOMETRY(Point, 4326)
  category: IncidentCategory;
  description: string;
  photoHash: string; // SHA-256 del archivo — control anti-spam/duplicados
  exifData: ExifMetadata | null; // Metadatos EXIF extraídos de la foto
  trustPoints: number; // 0 = sin verificar; ≥3 = activo
  status: IncidentStatus;
  severity: IncidentSeverity;
  createdBy: string; // userId del reportador (no anónimo)
  confirmedBy: string[]; // userIds que sumaron confianza
  createdAt: string; // ISO 8601
  resolvedAt?: string; // Solo si status === 'resolved'
  address?: string; // Dirección aproximada (geocoding inverso)
}

// ---------------------------------------------------------------------------
// Entidad: Usuario
// ---------------------------------------------------------------------------

/**
 * Equivalente a la tabla `users` en PostgreSQL.
 * La autenticación obligatoria previene el anonimato malicioso (TFG §4.1).
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string; // bcrypt en producción; SHA-256 en mock
  createdAt: string;
  reportCount: number;
  trustScore: number; // Reputación acumulada del usuario
}

// ---------------------------------------------------------------------------
// Metadatos EXIF
// ---------------------------------------------------------------------------

/**
 * Subconjunto de metadatos EXIF relevantes para la validación de integridad.
 * Objetivo TFG §5.3 – Mitigación de spam y fotos genéricas.
 */
export interface ExifMetadata {
  make?: string; // Fabricante del dispositivo
  model?: string; // Modelo del dispositivo
  dateTaken?: string; // Fecha de captura (ISO 8601)
  gpsLat?: number; // Latitud embebida en EXIF (si existe)
  gpsLng?: number; // Longitud embebida en EXIF (si existe)
  width?: number; // Ancho en píxeles
  height?: number; // Alto en píxeles
}

// ---------------------------------------------------------------------------
// DTOs (Data Transfer Objects) para API Routes
// ---------------------------------------------------------------------------

/** Payload para crear un nuevo incidente (POST /api/incidents) */
export interface CreateIncidentDto {
  geom: GeoPoint;
  category: IncidentCategory;
  description: string;
  photoHash: string;
  exifData: ExifMetadata | null;
  severity: IncidentSeverity;
  userId: string;
}

/** Respuesta de la capa de geofencing */
export interface GeofenceCheckResult {
  hasDuplicate: boolean;
  nearbyIncident: Incident | null;
  distanceMeters: number | null;
}

/** Payload para sumar punto de confianza (POST /api/trust) */
export interface AddTrustDto {
  incidentId: string;
  userId: string;
  userLocation: GeoPoint;
}
