/**
 * SIRU — lib/db.ts
 * Módulo de persistencia mock — simula PostgreSQL + PostGIS en memoria.
 *
 * En el prototipo académico esta capa reemplaza la base de datos real.
 * Los datos se mantienen en un objeto en memoria del proceso Next.js y se
 * sincronizan con localStorage en el cliente para persistencia entre recargas.
 *
 * La estructura de datos replica el esquema DDL de la BD de producción
 * descrito en la memoria del TFG (cap. 4 — Arquitectura de Datos).
 *
 * IMPORTANTE: En producción esta capa sería reemplazada por:
 *   - Prisma ORM + PostgreSQL con extensión PostGIS
 *   - Consultas ST_DWithin para geofencing nativo en BD
 *   - Índices GIST en columnas geom para búsquedas espaciales eficientes
 */

import type { Incident, User } from "./types";

// ---------------------------------------------------------------------------
// Dataset inicial simulado (Ramos Mejía, Buenos Aires)
// ---------------------------------------------------------------------------

/**
 * Incidentes mock precargados centrados en Ramos Mejía (-34.6482, -58.5625).
 * Representan distintos estados del ciclo de vida para demostración del prototipo.
 */
export const MOCK_INCIDENTS: Incident[] = [
  {
    id: "inc-001",
    geom: { lat: -34.6479, lng: -58.5618 }, // ~80m al noreste del centro
    category: "Bache",
    description:
      "Gran bache en la intersección de Av. De Mayo y San Martín. Peligroso para ciclistas y motociclistas.",
    photoHash: "a3f5c9d2e1b4...", // SHA-256 simulado
    exifData: { make: "Samsung", model: "Galaxy S21", dateTaken: "2026-09-20T10:30:00Z" },
    trustPoints: 5,
    status: "active",
    severity: "high",
    createdBy: "user-001",
    confirmedBy: ["user-002", "user-003", "user-004", "user-005"],
    createdAt: "2026-09-20T10:35:00Z",
    address: "Av. De Mayo y San Martín",
  },
  {
    id: "inc-002",
    geom: { lat: -34.6491, lng: -58.5635 }, // ~150m al suroeste
    category: "Iluminación",
    description: "Luminaria apagada hace más de 2 semanas. La cuadra queda completamente oscura.",
    photoHash: "b7e2a1f8c3d6...",
    exifData: { make: "Apple", model: "iPhone 14", dateTaken: "2026-09-22T21:00:00Z" },
    trustPoints: 3,
    status: "active",
    severity: "medium",
    createdBy: "user-002",
    confirmedBy: ["user-001", "user-006"],
    createdAt: "2026-09-22T21:05:00Z",
    address: "Calle Arenales al 300",
  },
  {
    id: "inc-003",
    geom: { lat: -34.6474, lng: -58.5610 }, // ~120m al norte
    category: "Basura",
    description: "Voluminosos abandonados en la vereda hace 4 días. No fueron retirados por el servicio.",
    photoHash: "c4d8b2e7a5f1...",
    exifData: null,
    trustPoints: 1,
    status: "unverified",
    severity: "low",
    createdBy: "user-003",
    confirmedBy: [],
    createdAt: "2026-09-25T14:20:00Z",
    address: "Rivadavia al 500",
  },
  {
    id: "inc-004",
    geom: { lat: -34.6500, lng: -58.5645 }, // ~250m al sur
    category: "Vandalismo",
    description: "Graffitis en la pared de la escuela. Cubren casi toda la fachada frontal.",
    photoHash: "d1f6c3a9e2b8...",
    exifData: { make: "Motorola", model: "Edge 30", dateTaken: "2026-09-24T08:15:00Z" },
    trustPoints: 2,
    status: "unverified",
    severity: "medium",
    createdBy: "user-004",
    confirmedBy: ["user-007"],
    createdAt: "2026-09-24T08:20:00Z",
    address: "Calle Belgrano 120",
  },
  {
    id: "inc-005",
    geom: { lat: -34.6468, lng: -58.5600 }, // ~200m al norte
    category: "Bache",
    description: "Bache profundo en la calzada, afecta el carril izquierdo. Riesgo de daños vehiculares.",
    photoHash: "e9a3d7f2c6b4...",
    exifData: { make: "Xiaomi", model: "Redmi 12", dateTaken: "2026-09-19T16:40:00Z" },
    trustPoints: 4,
    status: "active",
    severity: "medium",
    createdBy: "user-005",
    confirmedBy: ["user-001", "user-002", "user-003"],
    createdAt: "2026-09-19T16:45:00Z",
    address: "Av. Rivadavia al 1200",
  },
  {
    id: "inc-006",
    geom: { lat: -34.6488, lng: -58.5612 }, // ~50m del centro — útil para probar geofencing
    category: "Inundación",
    description: "Acumulación de agua en la esquina por tapón en la boca de tormenta.",
    photoHash: "f2b8e5c1a7d3...",
    exifData: { make: "Samsung", model: "Galaxy A54", dateTaken: "2026-09-26T09:00:00Z" },
    trustPoints: 3,
    status: "active",
    severity: "high",
    createdBy: "user-006",
    confirmedBy: ["user-002", "user-004"],
    createdAt: "2026-09-26T09:05:00Z",
    address: "Av. De Mayo al 800",
  },
  {
    id: "inc-007",
    geom: { lat: -34.6505, lng: -58.5625 }, // ~270m al sur
    category: "Basura",
    description: "Contenedor de basura rebalsado. Residuos dispersos en la vereda y calzada.",
    photoHash: "g7c2f4a9d1e6...",
    exifData: { make: "Oppo", model: "Reno 8", dateTaken: "2026-09-23T12:30:00Z" },
    trustPoints: 0,
    status: "unverified",
    severity: "low",
    createdBy: "user-007",
    confirmedBy: [],
    createdAt: "2026-09-23T12:35:00Z",
    address: "Calle Corrientes al 200",
  },
  {
    id: "inc-008",
    geom: { lat: -34.6476, lng: -58.5638 }, // ~160m al noroeste
    category: "Iluminación",
    description: "Semáforo peatonal roto. Solo parpadea en rojo, no indica paso habilitado.",
    photoHash: "h4e9b6c3f1a8...",
    exifData: { make: "Apple", model: "iPhone 13", dateTaken: "2026-09-21T19:55:00Z" },
    trustPoints: 3,
    status: "active",
    severity: "high",
    createdBy: "user-002",
    confirmedBy: ["user-001", "user-005"],
    createdAt: "2026-09-21T20:00:00Z",
    address: "Av. Rivadavia e Hipólito Yrigoyen",
  },
];

/** Usuarios mock del sistema */
export const MOCK_USERS: User[] = [
  {
    id: "user-001",
    email: "vecino@ramosmejia.ar",
    displayName: "Carlos Rodríguez",
    passwordHash: "mock_hash_123",
    createdAt: "2026-01-15T00:00:00Z",
    reportCount: 12,
    trustScore: 48,
  },
  {
    id: "user-002",
    email: "ana@ramosmejia.ar",
    displayName: "Ana Gómez",
    passwordHash: "mock_hash_456",
    createdAt: "2026-02-20T00:00:00Z",
    reportCount: 7,
    trustScore: 31,
  },
];

// ---------------------------------------------------------------------------
// Store reactivo (in-memory) — simula el estado de la BD en el servidor
// ---------------------------------------------------------------------------

/**
 * Almacén global de incidentes accesible desde las API Routes de Next.js.
 * En producción esto sería la conexión a la BD PostgreSQL via pool de conexiones.
 */
export const incidentStore: Incident[] = [...MOCK_INCIDENTS];

/** Añade un incidente al store y retorna el registro creado */
export function insertIncident(incident: Incident): Incident {
  incidentStore.push(incident);
  return incident;
}

/** Actualiza los puntos de confianza y el estado de un incidente */
export function updateIncidentTrust(
  incidentId: string,
  userId: string
): Incident | null {
  const incident = incidentStore.find((i) => i.id === incidentId);
  if (!incident) return null;

  // Evitar confirmación duplicada del mismo usuario
  if (incident.confirmedBy.includes(userId)) return incident;

  incident.confirmedBy.push(userId);
  incident.trustPoints += 1;

  // Transición de estado según umbral de puntos de confianza (TFG §6.2)
  if (incident.trustPoints >= 3 && incident.status === "unverified") {
    incident.status = "active";
  }

  return incident;
}

/** Cierre participativo: marca el incidente como resuelto */
export function resolveIncident(
  incidentId: string,
  _resolvedBy: string
): Incident | null {
  const incident = incidentStore.find((i) => i.id === incidentId);
  if (!incident || incident.status === "resolved") return null;

  incident.status = "resolved";
  incident.resolvedAt = new Date().toISOString();
  return incident;
}

/** Retorna todos los incidentes no resueltos (para geofencing) */
export function getActiveIncidents(): Incident[] {
  return incidentStore.filter((i) => i.status !== "resolved");
}
