/**
 * SIRU — lib/servidor/auditoria.ts
 * Registro de las acciones críticas (HU-07). La tabla solo admite inserciones:
 * un disparador de la base rechaza cualquier UPDATE, DELETE o TRUNCATE.
 */
import type { PoolClient } from "pg";
import { pool } from "./db";

export type AccionAuditada =
  | "REGISTRO_USUARIO"
  | "VERIFICA_CORREO"
  | "LOGIN_FALLIDO"
  | "BLOQUEO_CUENTA"
  | "BLOQUEO_PERMANENTE"
  | "CIERRE_SESION"
  | "CAMBIO_CLAVE"
  | "ALTA_INCIDENTE"
  | "CONFIRMA_INCIDENTE"
  | "ACTIVA_INCIDENTE"
  | "INFORMA_RESOLUCION"
  | "VALIDA_RESOLUCION"
  | "RECHAZA_RESOLUCION"
  | "DESESTIMA_INCIDENTE"
  | "SUSPENDE_CUENTA"
  | "REHABILITA_CUENTA"
  | "CAMBIO_SEVERIDAD"
  | "CAMBIO_CATEGORIA"
  | "CREA_OPERADOR"
  | "BLANQUEO_CLAVE";

export async function auditar(
  accion: AccionAuditada,
  datos: { usuarioId?: number | null; incidenteId?: number | null; detalle?: Record<string, unknown>; ip?: string | null },
  cliente?: PoolClient
): Promise<void> {
  const ejecutor = cliente ?? pool;
  await ejecutor.query(
    `INSERT INTO auditoria (usuario_id, incidente_id, accion, detalle, direccion_ip)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [datos.usuarioId ?? null, datos.incidenteId ?? null, accion, JSON.stringify(datos.detalle ?? {}), datos.ip ?? null]
  );
}
