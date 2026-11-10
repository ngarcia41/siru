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
import { pool, transaccion } from "./db";
import { auditar } from "./auditoria";
import { almacenamiento, claveDocumento, claveFoto, claveMiniatura, miniaturaDe } from "./almacenamiento";
import { validarExif, type ExifDeclarado } from "./imagen";
import { obtenerIncidente, punto, rechazo, validarPrecision, type Resultado } from "./incidentes";
import { DESESTIMADOS_PARA_SUSPENSION, DIAS_VENTANA_SUSPENSION, OBSERVACION, RADIO_METROS } from "../reglas";
import { recalcularIndices } from "./prioridad";
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

/** Valida y recorta la observación del operador (obligatoria al rechazar y al desestimar). */
export function leerObservacion(valor: unknown, obligatoria: boolean): Resultado<string | null> {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto) {
    return obligatoria
      ? rechazo(400, "OBSERVACION_OBLIGATORIA", `Escribí una observación de al menos ${OBSERVACION.MINIMO} caracteres.`)
      : { ok: true, datos: null };
  }
  if (texto.length < OBSERVACION.MINIMO) {
    return rechazo(400, "OBSERVACION_OBLIGATORIA", `La observación tiene que tener al menos ${OBSERVACION.MINIMO} caracteres.`);
  }
  if (texto.length > OBSERVACION.MAXIMO) {
    return rechazo(400, "OBSERVACION_DEMASIADO_LARGA", `La observación puede tener hasta ${OBSERVACION.MAXIMO} caracteres.`);
  }
  return { ok: true, datos: texto };
}

/**
 * HU-05 criterios 2 y 3: el operador valida o rechaza la resolución informada.
 *   CONFIRMADA → el incidente pasa a RESUELTO con su fecha de cierre y el operador responsable.
 *   RECHAZADA  → la observación es obligatoria; el incidente vuelve a ACTIVO, se recalcula su
 *                índice y la evidencia rechazada queda registrada con su observación.
 * D-10: puede validar el mismo operador que informó; la auditoría deja constancia de ambos pasos.
 */
export async function validarResolucion(
  operadorId: number,
  incidenteId: number,
  d: { resultado: unknown; observacion: unknown },
  ip: string | null
): Promise<Resultado<Incident>> {
  if (d.resultado !== "CONFIRMADA" && d.resultado !== "RECHAZADA") {
    return rechazo(400, "RESULTADO_INVALIDO", "El resultado tiene que ser CONFIRMADA o RECHAZADA.");
  }
  const confirma = d.resultado === "CONFIRMADA";
  const obs = leerObservacion(d.observacion, !confirma);
  if (!obs.ok) return obs;

  return transaccion(async (c) => {
    const inc = (await c.query("SELECT estado FROM incidente WHERE incidente_id = $1 FOR UPDATE", [incidenteId])).rows[0];
    if (!inc) return rechazo(404, "NO_ENCONTRADO", "Incidente no encontrado.");
    const res = (await c.query(
      `SELECT resolucion_id, informada_por FROM resolucion
        WHERE incidente_id = $1 AND resultado = 'PENDIENTE' ORDER BY fecha_informe DESC LIMIT 1 FOR UPDATE`,
      [incidenteId]
    )).rows[0];
    if (inc.estado !== "EN_REVISION" || !res) {
      return rechazo(409, "SIN_RESOLUCION_PENDIENTE", "El incidente no tiene una resolución pendiente de validar.");
    }

    await c.query(
      `UPDATE resolucion SET resultado = $2, validada_por = $3, fecha_validacion = now(), observacion = $4
        WHERE resolucion_id = $1`,
      [res.resolucion_id, d.resultado, operadorId, obs.datos]
    );

    if (confirma) {
      await c.query(
        "UPDATE incidente SET estado = 'RESUELTO', fecha_cierre = now(), indice_prioridad = NULL WHERE incidente_id = $1",
        [incidenteId]
      );
      await auditar("VALIDA_RESOLUCION", {
        usuarioId: operadorId, incidenteId, ip,
        detalle: { resolucionId: res.resolucion_id, informadaPor: res.informada_por, estadoAnterior: "EN_REVISION", estadoNuevo: "RESUELTO", observacion: obs.datos },
      }, c);
    } else {
      await c.query("UPDATE incidente SET estado = 'ACTIVO' WHERE incidente_id = $1", [incidenteId]);
      const [calculado] = await recalcularIndices(c, { incidenteId });
      await auditar("RECHAZA_RESOLUCION", {
        usuarioId: operadorId, incidenteId, ip,
        detalle: {
          resolucionId: res.resolucion_id, informadaPor: res.informada_por, estadoAnterior: "EN_REVISION", estadoNuevo: "ACTIVO",
          observacion: obs.datos, indicePrioridad: calculado?.indice ?? null,
        },
      }, c);
    }
    return { ok: true, datos: (await obtenerIncidente(incidenteId, c))! };
  });
}

// ---------------------------------------------------------------------------
// Desestimación y suspensión (HU-05 criterio 4, D-09, D-12)
// ---------------------------------------------------------------------------

/**
 * D-09 (plan de R02): con 3 reportes desestimados en 30 días la cuenta del
 * autor pasa a SUSPENDIDA y se cierran sus sesiones. Se cuentan solo los
 * desestimados posteriores a la última rehabilitación, para que una cuenta
 * recién rehabilitada no vuelva a suspenderse por los mismos reportes.
 * Devuelve true si suspendió la cuenta.
 */
async function controlarSuspension(c: PoolClient, autorId: number, incidenteId: number, operadorId: number, ip: string | null) {
  const { estado } = (await c.query(
    "SELECT estado_cuenta AS estado FROM usuario WHERE usuario_id = $1 FOR UPDATE", [autorId]
  )).rows[0];
  const { n } = (await c.query(
    `SELECT count(*)::int AS n FROM incidente
      WHERE usuario_id = $1 AND estado = 'DESESTIMADO'
        AND fecha_cierre > now() - make_interval(days => $2)
        AND fecha_cierre > COALESCE((SELECT max(fecha_hora) FROM auditoria
                                      WHERE usuario_id = $1 AND accion = 'REHABILITA_CUENTA'), '-infinity')`,
    [autorId, DIAS_VENTANA_SUSPENSION]
  )).rows[0];
  if (n < DESESTIMADOS_PARA_SUSPENSION || estado === "SUSPENDIDA") return false;

  await c.query("UPDATE usuario SET estado_cuenta = 'SUSPENDIDA' WHERE usuario_id = $1", [autorId]);
  await c.query("UPDATE sesion SET revocada_en = now() WHERE usuario_id = $1 AND revocada_en IS NULL", [autorId]);
  // La acción la provoca el operador; el registro queda a nombre de la cuenta suspendida, con el operador en el detalle.
  await auditar("SUSPENDE_CUENTA", {
    usuarioId: autorId, incidenteId, ip,
    detalle: { estadoAnterior: estado, desestimadosEn30Dias: n, operadorId },
  }, c);
  return true;
}

/**
 * HU-05 criterio 4: el operador desestima un reporte falso, inexistente o
 * ajeno al alcance, con observación obligatoria. Solo desde SIN_VERIFICAR o
 * ACTIVO (D-12): uno EN_REVISION primero se valida o se rechaza.
 */
export async function desestimarIncidente(
  operadorId: number,
  incidenteId: number,
  observacion: unknown,
  ip: string | null
): Promise<Resultado<{ incidente: Incident; cuentaSuspendida: boolean }>> {
  const obs = leerObservacion(observacion, true);
  if (!obs.ok) return obs;

  return transaccion(async (c) => {
    const inc = (await c.query("SELECT estado, usuario_id FROM incidente WHERE incidente_id = $1 FOR UPDATE", [incidenteId])).rows[0];
    if (!inc) return rechazo(404, "NO_ENCONTRADO", "Incidente no encontrado.");
    if (!["SIN_VERIFICAR", "ACTIVO"].includes(inc.estado)) {
      return rechazo(409, "ESTADO_NO_DESESTIMABLE",
        inc.estado === "EN_REVISION"
          ? "El incidente está en revisión: primero validá o rechazá la resolución informada."
          : "Solo se pueden desestimar incidentes sin verificar o activos.");
    }

    await c.query(
      "UPDATE incidente SET estado = 'DESESTIMADO', fecha_cierre = now(), indice_prioridad = NULL WHERE incidente_id = $1",
      [incidenteId]
    );
    await auditar("DESESTIMA_INCIDENTE", {
      usuarioId: operadorId, incidenteId, ip,
      detalle: { estadoAnterior: inc.estado, estadoNuevo: "DESESTIMADO", observacion: obs.datos, autorId: inc.usuario_id },
    }, c);
    const cuentaSuspendida = await controlarSuspension(c, inc.usuario_id, incidenteId, operadorId, ip);
    return { ok: true, datos: { incidente: (await obtenerIncidente(incidenteId, c))!, cuentaSuspendida } };
  });
}

// ---------------------------------------------------------------------------
// Bandeja del operador (T12)
// ---------------------------------------------------------------------------

export interface ResolucionPendiente {
  resolucionId: number;
  perfil: PerfilInformante;
  informadaPor: string;
  fechaInforme: string;
  /** Distancia del vecino al incidente al informar (la del operador no se controla: null). */
  distanciaMetros: number | null;
  tipoEvidencia: "foto" | "pdf";
  miniaturaUrl: string | null;
  fotoUrl: string | null;
  documentoUrl: string | null;
}

/**
 * Lo que el operador necesita para validar: quién informó, cuándo, a qué
 * distancia y la evidencia. La distancia no tiene columna propia en RESOLUCION:
 * se toma del detalle de la auditoría INFORMA_RESOLUCION de esa resolución.
 */
export async function obtenerResolucionPendiente(incidenteId: number): Promise<ResolucionPendiente | null> {
  const { rows } = await pool.query(
    `SELECT r.resolucion_id, r.fecha_informe, r.evidencia_ruta, u.email, u.rol,
            (SELECT (a.detalle->>'distanciaMetros')::numeric FROM auditoria a
              WHERE a.accion = 'INFORMA_RESOLUCION' AND a.incidente_id = r.incidente_id
                AND (a.detalle->>'resolucionId')::int = r.resolucion_id
              ORDER BY a.auditoria_id DESC LIMIT 1) AS distancia
       FROM resolucion r JOIN usuario u ON u.usuario_id = r.informada_por
      WHERE r.incidente_id = $1 AND r.resultado = 'PENDIENTE'
      ORDER BY r.fecha_informe DESC LIMIT 1`,
    [incidenteId]
  );
  const f = rows[0];
  if (!f) return null;
  const esPdf = String(f.evidencia_ruta).startsWith("documentos/");
  return {
    resolucionId: f.resolucion_id,
    perfil: f.rol,
    informadaPor: f.email,
    fechaInforme: new Date(f.fecha_informe).toISOString(),
    distanciaMetros: f.distancia === null ? null : Number(f.distancia),
    tipoEvidencia: esPdf ? "pdf" : "foto",
    miniaturaUrl: esPdf ? null : `/api/imagenes/${miniaturaDe(f.evidencia_ruta)}`,
    fotoUrl: esPdf ? null : `/api/imagenes/${f.evidencia_ruta}`,
    documentoUrl: esPdf ? `/api/imagenes/${f.evidencia_ruta}` : null,
  };
}
