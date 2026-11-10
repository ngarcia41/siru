/**
 * SIRU — lib/servidor/resoluciones.ts
 * Resolución de incidentes con evidencia (HU-05, RF07).
 *
 *   ACTIVO ──informar (vecino a < 50 m con foto, u operador con foto o PDF)──▶ EN_REVISION
 *   EN_REVISION ──validar (operador)──▶ RESUELTO
 *   EN_REVISION ──rechazar con observación (operador)──▶ ACTIVO (la evidencia se conserva)
 *
 * Cada paso se hace en una transacción con la fila del incidente bloqueada
 * (SELECT … FOR UPDATE) y se audita en la misma transacción.
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { transaccion } from "./db";
import { auditar } from "./auditoria";
import { almacenamiento, claveDocumento, claveFoto, claveMiniatura } from "./almacenamiento";
import { validarExif, type ExifDeclarado } from "./imagen";
import { obtenerIncidente, punto, rechazo, validarPrecision, type Resultado } from "./incidentes";
import { RADIO_METROS } from "../reglas";
import type { Incident } from "../types";

export type PerfilInformante = "VECINO" | "OPERADOR";

/** Evidencia ya validada en la ruta: una foto recodificada o un PDF (solo el operador). */
export type Evidencia =
  | { tipo: "foto"; hashOriginal: string; foto: Buffer; miniatura: Buffer; exif: ExifDeclarado }
  | { tipo: "pdf"; datos: Buffer };

/** Firma de los archivos PDF: empiezan con "%PDF-". */
export function esFirmaPdf(b: Buffer): boolean {
  return b.length > 5 && b.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Huella de la evidencia: la del original para una foto (D-19), la del archivo para un PDF. */
function huellaDe(e: Evidencia): string {
  return e.tipo === "foto" ? e.hashOriginal : createHash("sha256").update(e.datos).digest("hex");
}

/** D-11: la evidencia no puede repetir la huella de ninguna imagen ya registrada. */
async function huellaYaRegistrada(c: PoolClient, hash: string): Promise<boolean> {
  const { rowCount } = await c.query(
    "SELECT 1 FROM incidente WHERE hash_foto = $1 UNION ALL SELECT 1 FROM resolucion WHERE hash_evidencia = $1 LIMIT 1",
    [hash]
  );
  return !!rowCount;
}

/**
 * HU-05 criterio 1 (D-10): un vecino ubicado a menos de 50 m, con precisión de
 * 25 m o menos y una foto, informa que el incidente activo se resolvió; o el
 * operador carga la información oficial (foto o PDF), sin control de distancia.
 * El incidente pasa a EN_REVISION y se registran quién informó y cuándo.
 */
export async function informarResolucion(
  informante: { id: number; rol: PerfilInformante },
  incidenteId: number,
  d: { lat: number | null; lng: number | null; precision: unknown; evidencia: Evidencia },
  ip: string | null
): Promise<Resultado<Incident>> {
  const esVecino = informante.rol === "VECINO";
  if (esVecino) {
    if (d.evidencia.tipo !== "foto") return rechazo(400, "FOTO_OBLIGATORIA", "Para informar la resolución hace falta una foto.");
    const errPrecision = validarPrecision(d.precision);
    if (errPrecision) return errPrecision;
    if (d.lat === null || d.lng === null) return rechazo(400, "DATOS_INCOMPLETOS", "Falta tu ubicación.");
  }
  const hash = huellaDe(d.evidencia);
  if (!/^[0-9a-f]{64}$/.test(hash)) return rechazo(400, "HASH_INVALIDO", "Falta la huella SHA-256 de la evidencia.");

  return transaccion(async (c) => {
    const inc = (await c.query(
      `SELECT estado, ${esVecino ? `ST_Distance(ubicacion::geography, ${punto(2, 3)}::geography)` : "NULL"} AS distancia
         FROM incidente WHERE incidente_id = $1 FOR UPDATE`,
      esVecino ? [incidenteId, d.lng, d.lat] : [incidenteId]
    )).rows[0];
    if (!inc) return rechazo(404, "NO_ENCONTRADO", "Incidente no encontrado.");
    if (inc.estado !== "ACTIVO") {
      return rechazo(409, "ESTADO_NO_RESOLUBLE", "Solo se puede informar la resolución de un incidente activo.");
    }

    let distancia: number | null = null;
    if (esVecino) {
      distancia = Number(inc.distancia);
      if (distancia >= RADIO_METROS) {
        return rechazo(403, "FUERA_DE_RADIO",
          `Tenés que estar a menos de ${RADIO_METROS} m del incidente para informar que se resolvió (distancia actual: ${Math.round(distancia)} m).`);
      }
      // La foto del vecino pasa por las mismas reglas EXIF que la del alta (T03).
      const ev = d.evidencia as Extract<Evidencia, { tipo: "foto" }>;
      const exif = await validarExif(c, ev.exif, { lat: d.lat!, lng: d.lng! });
      if (!exif.ok) return exif;
    }

    if (await huellaYaRegistrada(c, hash)) {
      return rechazo(409, "EVIDENCIA_DUPLICADA",
        "Esa evidencia ya se usó en un reporte o en otra resolución. Sacá una foto nueva que muestre el arreglo.");
    }

    // Se guarda antes del INSERT: si falla el disco, la transacción se cancela (igual que en el alta).
    let evidenciaRuta: string;
    if (d.evidencia.tipo === "foto") {
      evidenciaRuta = claveFoto(hash);
      await almacenamiento.guardar(evidenciaRuta, d.evidencia.foto);
      await almacenamiento.guardar(claveMiniatura(hash), d.evidencia.miniatura);
    } else {
      evidenciaRuta = claveDocumento(hash);
      await almacenamiento.guardar(evidenciaRuta, d.evidencia.datos);
    }

    const { rows } = await c.query(
      `INSERT INTO resolucion (incidente_id, informada_por, evidencia_ruta, hash_evidencia)
       VALUES ($1, $2, $3, $4) RETURNING resolucion_id`,
      [incidenteId, informante.id, evidenciaRuta, hash]
    );
    // Fuera de ACTIVO el índice de prioridad queda en NULL (D-06).
    await c.query("UPDATE incidente SET estado = 'EN_REVISION', indice_prioridad = NULL WHERE incidente_id = $1", [incidenteId]);
    await auditar("INFORMA_RESOLUCION", {
      usuarioId: informante.id, incidenteId, ip,
      detalle: {
        resolucionId: rows[0].resolucion_id,
        perfil: informante.rol,
        tipoEvidencia: d.evidencia.tipo,
        hashEvidencia: hash,
        ...(distancia !== null ? { distanciaMetros: Math.round(distancia * 10) / 10 } : {}),
      },
    }, c);
    return { ok: true, datos: (await obtenerIncidente(incidenteId, c))! };
  });
}
