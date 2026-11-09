/**
 * SIRU — lib/servidor/prioridad.ts
 * Índice de prioridad (HU-04, RF06). Es la única implementación del cálculo:
 * la usan la confirmación, la reclasificación, el rechazo de una resolución y
 * la tarea diaria.
 *
 *   IP = 100 × (0,5 × S + 0,3 × C + 0,2 × T)
 *     S = severidad.peso (baja 0,33; media 0,67; alta 1,00)
 *     C = min(puntos / 6, 1)
 *     T = min(floor(días desde la activación) / 30, 1)   ← días enteros (D-06)
 *
 * Se redondea a 2 decimales (NUMERIC(5,2)) y solo existe para incidentes en
 * estado ACTIVO; en cualquier otro estado queda en NULL (D-06). Con días
 * enteros salen exactos los ejemplos del documento: un bache alto con 5 puntos
 * y 12 días da 83,00, y una luminaria media con 3 puntos y 2 días da 49,83.
 *
 * El cálculo se hace en la base, con un único UPDATE parametrizado: así un
 * incidente y "todos los activos" usan exactamente la misma fórmula.
 */
import type { ClientBase } from "pg";
import { BANDAS_PRIORIDAD, DIAS_ANTIGUEDAD_MAXIMA, PESOS_PRIORIDAD, PUNTOS_RESPALDO_MAXIMO } from "../reglas";

/** Cualquier conexión de node-postgres (un cliente de la transacción o un Client suelto). */
type Conexion = Pick<ClientBase, "query">;

export interface IndiceCalculado {
  incidenteId: number;
  indice: number;
}

/**
 * Recalcula el índice de un incidente activo (`incidenteId`) o de todos los
 * activos. Al recalcular todos, también deja en NULL el índice de cualquier
 * incidente que no esté activo, para que nunca quede un valor viejo.
 * Devuelve los índices calculados.
 */
export async function recalcularIndices(c: Conexion, opciones: { incidenteId?: number } = {}): Promise<IndiceCalculado[]> {
  const id = opciones.incidenteId ?? null;
  const { rows } = await c.query(
    `UPDATE incidente i
        SET indice_prioridad = round(100 * (
              $1::numeric * s.peso
            + $2::numeric * LEAST(i.puntaje_confianza::numeric / $3::numeric, 1)
            + $4::numeric * LEAST(
                floor(extract(epoch FROM (now() - COALESCE(i.fecha_activacion, now()))) / 86400) / $5::numeric, 1)
            ), 2)
       FROM severidad s
      WHERE s.severidad_id = i.severidad_id
        AND i.estado = 'ACTIVO'
        AND ($6::int IS NULL OR i.incidente_id = $6::int)
      RETURNING i.incidente_id, i.indice_prioridad`,
    [PESOS_PRIORIDAD.S, PESOS_PRIORIDAD.C, PUNTOS_RESPALDO_MAXIMO, PESOS_PRIORIDAD.T, DIAS_ANTIGUEDAD_MAXIMA, id]
  );
  if (id === null) {
    await c.query("UPDATE incidente SET indice_prioridad = NULL WHERE estado <> 'ACTIVO' AND indice_prioridad IS NOT NULL");
  }
  return rows.map((f) => ({ incidenteId: Number(f.incidente_id), indice: Number(f.indice_prioridad) }));
}

export type BandaPrioridad = "alta" | "media" | "baja";

/** Banda del índice: alta si IP ≥ 70; media si 40 ≤ IP < 70; baja si IP < 40. */
export function bandaDe(indice: number | null): BandaPrioridad | null {
  if (indice === null) return null;
  if (indice >= BANDAS_PRIORIDAD.alta) return "alta";
  if (indice >= BANDAS_PRIORIDAD.media) return "media";
  return "baja";
}
