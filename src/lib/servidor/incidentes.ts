/**
 * SIRU — lib/servidor/incidentes.ts
 * Acceso a incidentes y confirmaciones en PostgreSQL con PostGIS.
 *
 * Las validaciones espaciales se resuelven en la base de datos:
 *   - ST_DWithin(..., 50) sobre geography detecta duplicados en metros
 *     usando el índice GiST (reemplaza el cálculo de Haversine en memoria).
 *   - ST_Distance(...) mide la distancia del vecino al confirmar.
 */
import type { PoolClient } from "pg";
import { consulta, transaccion } from "./db";
import { auditar } from "./auditoria";
import { validarExif, type ExifDeclarado } from "./imagen";
import { almacenamiento, claveFoto, claveMiniatura, miniaturaDe } from "./almacenamiento";
import { recalcularIndices } from "./prioridad";
import type { Incident, IncidentCategory, IncidentSeverity, IncidentStatus, MotivoNoConfirmable } from "../types";
import {
  CATEGORIAS, LIMITE_CONFIRMACIONES_24H, LIMITE_REPORTES_24H, PRECISION_GPS_MAXIMA, RADIO_METROS, UMBRAL_ACTIVACION,
} from "../reglas";

const ESTADO_A_UI: Record<string, IncidentStatus> = {
  SIN_VERIFICAR: "unverified", ACTIVO: "active", EN_REVISION: "review", RESUELTO: "resolved", DESESTIMADO: "dismissed",
};
const SEVERIDAD_A_UI: Record<string, IncidentSeverity> = { baja: "low", media: "medium", alta: "high" };
const SEVERIDAD_A_ID: Record<IncidentSeverity, number> = { low: 1, medium: 2, high: 3 };
/** Estados que todavía cuentan para detectar duplicados. */
const ESTADOS_ABIERTOS = ["SIN_VERIFICAR", "ACTIVO", "EN_REVISION"];

/** Punto PostGIS a partir de dos parámetros posicionales ($n = longitud, $m = latitud). */
function punto(lngParam: number, latParam: number) {
  return `ST_SetSRID(ST_MakePoint($${lngParam}, $${latParam}), 4326)`;
}

const SELECT_INCIDENTE = `
  SELECT i.incidente_id, i.usuario_id, c.nombre AS categoria, s.nombre AS severidad, i.descripcion,
         ST_Y(i.ubicacion) AS lat, ST_X(i.ubicacion) AS lng, i.precision_gps, i.hash_foto, i.foto_ruta,
         i.puntaje_confianza, i.estado, i.fecha_creacion, i.fecha_cierre,
         COALESCE((SELECT array_agg(cf.usuario_id ORDER BY cf.fecha_confirmacion)
                     FROM confirmacion cf WHERE cf.incidente_id = i.incidente_id), '{}') AS confirmadores
    FROM incidente i
    JOIN categoria c ON c.categoria_id = i.categoria_id
    JOIN severidad s ON s.severidad_id = i.severidad_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aDto(f: any): Incident {
  return {
    id: String(f.incidente_id),
    geom: { lat: Number(f.lat), lng: Number(f.lng) },
    category: f.categoria as IncidentCategory,
    description: f.descripcion,
    photoHash: f.hash_foto,
    // Las imágenes se piden a la ruta autenticada; la foto privada solo la entrega al operador.
    miniaturaUrl: f.foto_ruta ? `/api/imagenes/${miniaturaDe(f.foto_ruta)}` : null,
    fotoUrl: f.foto_ruta ? `/api/imagenes/${f.foto_ruta}` : null,
    exifData: null,
    gpsAccuracy: f.precision_gps === null ? null : Number(f.precision_gps),
    trustPoints: Number(f.puntaje_confianza),
    status: ESTADO_A_UI[f.estado],
    severity: SEVERIDAD_A_UI[f.severidad],
    createdBy: String(f.usuario_id),
    confirmedBy: (f.confirmadores as number[]).map(String),
    createdAt: new Date(f.fecha_creacion).toISOString(),
    resolvedAt: f.fecha_cierre ? new Date(f.fecha_cierre).toISOString() : undefined,
  };
}

export async function listarIncidentes(): Promise<Incident[]> {
  const filas = await consulta(`${SELECT_INCIDENTE} WHERE i.estado <> 'DESESTIMADO' ORDER BY i.fecha_creacion DESC`);
  return filas.map(aDto);
}

export async function obtenerIncidente(id: number, c?: PoolClient): Promise<Incident | null> {
  const filas = c
    ? (await c.query(`${SELECT_INCIDENTE} WHERE i.incidente_id = $1`, [id])).rows
    : await consulta(`${SELECT_INCIDENTE} WHERE i.incidente_id = $1`, [id]);
  return filas[0] ? aDto(filas[0]) : null;
}

/** Resultado de una operación: éxito con datos o rechazo con su código HTTP. */
export type Resultado<T> =
  | { ok: true; datos: T; mensaje?: string }
  | { ok: false; status: number; codigo: string; mensaje: string; extra?: Record<string, unknown> };

function rechazo(status: number, codigo: string, mensaje: string, extra?: Record<string, unknown>): Resultado<never> {
  return { ok: false, status, codigo, mensaje, extra };
}

function validarPrecision(precision: unknown): Resultado<never> | null {
  if (typeof precision !== "number" || !Number.isFinite(precision) || precision <= 0) {
    return rechazo(400, "PRECISION_FALTANTE", "Falta la precisión informada por el GPS.");
  }
  if (precision > PRECISION_GPS_MAXIMA) {
    return rechazo(422, "PRECISION_INSUFICIENTE",
      `La precisión del GPS es de ±${Math.round(precision)} m y se necesitan ${PRECISION_GPS_MAXIMA} m o menos. Volvé a capturar la ubicación en un lugar abierto.`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Duplicado por cercanía (HU-02, RF04)
// ---------------------------------------------------------------------------

export interface DuplicadoCercano {
  nearbyIncident: Incident;
  distanceMeters: number;
  motivoNoConfirmable: MotivoNoConfirmable;
}

/**
 * Busca un incidente abierto (Sin verificar, Activo o En revisión) de la misma
 * categoría a menos de 50 m, con ST_DWithin sobre geography (usa el índice GiST).
 * Es la única consulta de duplicados: la usan la verificación del paso 2 (D-24)
 * y el alta. No modifica nada.
 */
async function buscarDuplicado(
  c: PoolClient,
  usuarioId: number,
  d: { lat: number; lng: number; categoria: string }
): Promise<DuplicadoCercano | null> {
  const cercano = (await c.query(
    `SELECT i.incidente_id, i.usuario_id, i.estado,
            ST_Distance(i.ubicacion::geography, ${punto(1, 2)}::geography) AS distancia,
            EXISTS (SELECT 1 FROM confirmacion cf WHERE cf.incidente_id = i.incidente_id AND cf.usuario_id = $6) AS ya_confirmo
       FROM incidente i JOIN categoria c ON c.categoria_id = i.categoria_id
      WHERE c.nombre = $3 AND i.estado = ANY($4)
        AND ST_DWithin(i.ubicacion::geography, ${punto(1, 2)}::geography, $5)
      ORDER BY distancia LIMIT 1`,
    [d.lng, d.lat, d.categoria, ESTADOS_ABIERTOS, RADIO_METROS, usuarioId]
  )).rows[0];
  if (!cercano) return null;

  const motivoNoConfirmable: MotivoNoConfirmable =
    cercano.usuario_id === usuarioId ? "PROPIO_REPORTE"
      : cercano.ya_confirmo ? "YA_CONFIRMADO"
        : cercano.estado === "EN_REVISION" ? "EN_REVISION"
          : null;
  return {
    nearbyIncident: (await obtenerIncidente(cercano.incidente_id, c))!,
    distanceMeters: Number(cercano.distancia),
    motivoNoConfirmable,
  };
}

/**
 * D-24: verificación anticipada del paso 2 del alta. Con la ubicación y la
 * categoría, informa si ya hay un incidente abierto de esa categoría a menos de
 * 50 m, para proponer confirmarlo antes de que el vecino escriba la descripción
 * y saque la foto. No crea ni modifica nada, y no reemplaza el control del alta.
 */
export async function verificarCercania(
  usuarioId: number,
  d: { lat: number; lng: number; categoria: string }
): Promise<Resultado<{ duplicado: DuplicadoCercano | null }>> {
  if (!(CATEGORIAS as readonly string[]).includes(d.categoria)) return rechazo(400, "CATEGORIA_INVALIDA", "La categoría no es válida.");
  return transaccion(async (c) => ({ ok: true, datos: { duplicado: await buscarDuplicado(c, usuarioId, d) } }));
}

// ---------------------------------------------------------------------------
// Alta de incidente (HU-02)
// ---------------------------------------------------------------------------
export async function crearIncidente(
  usuarioId: number,
  d: {
    lat: number; lng: number; precision: unknown; categoria: string; severidad: string; descripcion: string;
    hashFoto: string; exif: ExifDeclarado;
    /** Versiones recodificadas por el servidor (T04), sin metadatos. */
    imagen: { foto: Buffer; miniatura: Buffer };
  },
  ip: string | null
): Promise<Resultado<Incident>> {
  const errPrecision = validarPrecision(d.precision);
  if (errPrecision) return errPrecision;
  if (!(CATEGORIAS as readonly string[]).includes(d.categoria)) return rechazo(400, "CATEGORIA_INVALIDA", "La categoría no es válida.");
  const severidadId = SEVERIDAD_A_ID[d.severidad as IncidentSeverity];
  if (!severidadId) return rechazo(400, "SEVERIDAD_INVALIDA", "La severidad no es válida.");
  const descripcion = d.descripcion.trim();
  if (descripcion.length < 20 || descripcion.length > 200) {
    return rechazo(400, "DESCRIPCION_INVALIDA", "La descripción debe tener entre 20 y 200 caracteres.");
  }
  if (!/^[0-9a-f]{64}$/.test(d.hashFoto)) return rechazo(400, "HASH_INVALIDO", "Falta la huella SHA-256 de la fotografía.");

  return transaccion(async (c) => {
    const [{ n }] = (await c.query(
      "SELECT count(*)::int AS n FROM incidente WHERE usuario_id = $1 AND fecha_creacion > now() - interval '24 hours'",
      [usuarioId]
    )).rows;
    if (n >= LIMITE_REPORTES_24H) {
      return rechazo(429, "LIMITE_REPORTES", `Alcanzaste el máximo de ${LIMITE_REPORTES_24H} reportes en 24 horas.`);
    }

    // B-01: fecha de captura de 24 h como máximo y coordenadas EXIF a menos de 50 m del dispositivo.
    const exif = await validarExif(c, d.exif, { lat: d.lat, lng: d.lng });
    if (!exif.ok) return exif;

    const foto = await c.query("SELECT incidente_id FROM incidente WHERE hash_foto = $1", [d.hashFoto]);
    if (foto.rowCount) {
      return rechazo(409, "FOTO_DUPLICADA", "Esa fotografía ya se usó en otro reporte. Tomá una foto nueva del incidente.");
    }

    // El mismo control que la verificación del paso 2 (D-24): se repite al enviar por si
    // alguien reportó el mismo incidente mientras tanto.
    const cercano = await buscarDuplicado(c, usuarioId, d);
    if (cercano) {
      return rechazo(409, "GEOFENCE_DUPLICATE",
        `Ya existe un incidente de tipo "${d.categoria}" a ${Math.round(cercano.distanceMeters)} metros. ¿Querés confirmar su existencia?`,
        { ...cercano });
    }

    // B-02 y B-03: se guardan la foto privada y la miniatura después de todas las validaciones
    // y antes del INSERT. Si falla la escritura, la transacción se cancela y no queda un
    // incidente sin foto; un archivo que quede de un intento cancelado no molesta, porque su
    // clave es la huella y se reescribe igual si se vuelve a subir.
    const fotoRuta = claveFoto(d.hashFoto);
    await almacenamiento.guardar(fotoRuta, d.imagen.foto);
    await almacenamiento.guardar(claveMiniatura(d.hashFoto), d.imagen.miniatura);

    const { rows } = await c.query(
      `INSERT INTO incidente (usuario_id, categoria_id, severidad_id, descripcion, ubicacion, precision_gps, hash_foto,
                             foto_ruta, fecha_captura_foto, puntaje_confianza)
       VALUES ($3, (SELECT categoria_id FROM categoria WHERE nombre = $4), $5, $6, ${punto(1, 2)}, $7, $8, $9, $10, 1)
       RETURNING incidente_id`,
      [d.lng, d.lat, usuarioId, d.categoria, severidadId, descripcion, d.precision, d.hashFoto, fotoRuta,
        exif.datos.fechaCaptura]
    );
    const id = rows[0].incidente_id as number;
    await auditar("ALTA_INCIDENTE", {
      usuarioId, incidenteId: id, ip,
      detalle: { categoria: d.categoria, severidad: d.severidad, lat: d.lat, lng: d.lng, precisionGps: d.precision },
    }, c);
    return { ok: true, datos: (await obtenerIncidente(id, c))! };
  });
}

// ---------------------------------------------------------------------------
// Confirmación participativa (HU-03)
// ---------------------------------------------------------------------------
export async function confirmarIncidente(
  usuarioId: number,
  incidenteId: number,
  d: { lat: number; lng: number; precision: unknown },
  ip: string | null
): Promise<Resultado<Incident>> {
  const errPrecision = validarPrecision(d.precision);
  if (errPrecision) return errPrecision;

  return transaccion(async (c) => {
    const inc = (await c.query(
      `SELECT incidente_id, usuario_id, estado, puntaje_confianza,
              ST_Distance(ubicacion::geography, ${punto(2, 3)}::geography) AS distancia
         FROM incidente WHERE incidente_id = $1 FOR UPDATE`,
      [incidenteId, d.lng, d.lat]
    )).rows[0];
    if (!inc) return rechazo(404, "NO_ENCONTRADO", "Incidente no encontrado.");
    if (!["SIN_VERIFICAR", "ACTIVO"].includes(inc.estado)) {
      return rechazo(409, "ESTADO_NO_CONFIRMABLE", "Solo se pueden confirmar incidentes sin verificar o activos.");
    }
    if (inc.usuario_id === usuarioId) return rechazo(403, "PROPIO_REPORTE", "No podés confirmar tu propio reporte.");

    const ya = await c.query("SELECT 1 FROM confirmacion WHERE incidente_id = $1 AND usuario_id = $2", [incidenteId, usuarioId]);
    if (ya.rowCount) return rechazo(409, "YA_CONFIRMADO", "Ya confirmaste la existencia de este incidente.");

    const distancia = Number(inc.distancia);
    if (distancia >= RADIO_METROS) {
      return rechazo(403, "FUERA_DE_RADIO",
        `Tenés que estar a menos de ${RADIO_METROS} m del incidente para confirmarlo (distancia actual: ${Math.round(distancia)} m).`);
    }

    const [{ n }] = (await c.query(
      "SELECT count(*)::int AS n FROM confirmacion WHERE usuario_id = $1 AND fecha_confirmacion > now() - interval '24 hours'",
      [usuarioId]
    )).rows;
    if (n >= LIMITE_CONFIRMACIONES_24H) {
      return rechazo(429, "LIMITE_CONFIRMACIONES", `Alcanzaste el máximo de ${LIMITE_CONFIRMACIONES_24H} confirmaciones en 24 horas.`);
    }

    await c.query(
      "INSERT INTO confirmacion (incidente_id, usuario_id, distancia_metros, precision_gps) VALUES ($1, $2, $3, $4)",
      [incidenteId, usuarioId, Math.round(distancia * 10) / 10, d.precision]
    );
    const nuevo = (await c.query(
      `UPDATE incidente SET puntaje_confianza = puntaje_confianza + 1,
              estado = CASE WHEN estado = 'SIN_VERIFICAR' AND puntaje_confianza + 1 >= $2 THEN 'ACTIVO' ELSE estado END,
              fecha_activacion = CASE WHEN estado = 'SIN_VERIFICAR' AND puntaje_confianza + 1 >= $2 THEN now() ELSE fecha_activacion END
        WHERE incidente_id = $1 RETURNING estado, puntaje_confianza`,
      [incidenteId, UMBRAL_ACTIVACION]
    )).rows[0];

    // HU-04: al activarse y con cada confirmación sobre un incidente activo se recalcula el índice,
    // en la misma transacción que la confirmación.
    const [calculado] = nuevo.estado === "ACTIVO" ? await recalcularIndices(c, { incidenteId }) : [];

    await auditar("CONFIRMA_INCIDENTE", {
      usuarioId, incidenteId, ip,
      detalle: {
        distanciaMetros: Math.round(distancia * 10) / 10, puntajeAnterior: inc.puntaje_confianza, puntajeNuevo: nuevo.puntaje_confianza,
        ...(calculado ? { indicePrioridad: calculado.indice } : {}),
      },
    }, c);
    const activado = inc.estado === "SIN_VERIFICAR" && nuevo.estado === "ACTIVO";
    if (activado) {
      await auditar("ACTIVA_INCIDENTE", {
        usuarioId, incidenteId, ip,
        detalle: { estadoAnterior: "SIN_VERIFICAR", estadoNuevo: "ACTIVO", puntaje: nuevo.puntaje_confianza, indicePrioridad: calculado?.indice },
      }, c);
    }
    return {
      ok: true,
      datos: (await obtenerIncidente(incidenteId, c))!,
      mensaje: activado
        ? `¡Incidente activado! Alcanzó ${UMBRAL_ACTIVACION} puntos de confianza y ahora está Activo.`
        : `Sumaste 1 punto de confianza. Total: ${nuevo.puntaje_confianza} puntos.`,
    };
  });
}

// ---------------------------------------------------------------------------
// Cierre validado por el operador (el flujo con evidencia del vecino es HU-05, Sprint 3)
// ---------------------------------------------------------------------------
export async function resolverIncidente(
  operadorId: number,
  incidenteId: number,
  observacion: string | null,
  ip: string | null
): Promise<Resultado<Incident>> {
  return transaccion(async (c) => {
    const inc = (await c.query("SELECT estado FROM incidente WHERE incidente_id = $1 FOR UPDATE", [incidenteId])).rows[0];
    if (!inc) return rechazo(404, "NO_ENCONTRADO", "Incidente no encontrado.");
    if (!["ACTIVO", "EN_REVISION"].includes(inc.estado)) {
      return rechazo(409, "ESTADO_NO_RESOLUBLE", "Solo se pueden cerrar incidentes activos o en revisión.");
    }
    const obs = observacion?.trim().slice(0, 300) || null;
    await c.query(
      `INSERT INTO resolucion (incidente_id, informada_por, observacion, validada_por, fecha_validacion, resultado)
       VALUES ($1, $2, $3, $2, now(), 'CONFIRMADA')`,
      [incidenteId, operadorId, obs]
    );
    // Fuera de ACTIVO el índice de prioridad queda en NULL (D-06). Esta acción se reemplaza en la T10 (D-18).
    await c.query(
      "UPDATE incidente SET estado = 'RESUELTO', fecha_cierre = now(), indice_prioridad = NULL WHERE incidente_id = $1",
      [incidenteId]
    );
    await auditar("VALIDA_RESOLUCION", {
      usuarioId: operadorId, incidenteId, ip,
      detalle: { estadoAnterior: inc.estado, estadoNuevo: "RESUELTO", observacion: obs },
    }, c);
    return { ok: true, datos: (await obtenerIncidente(incidenteId, c))! };
  });
}
