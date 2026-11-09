/**
 * SIRU — scripts/semilla.ts
 * Carga datos de DEMOSTRACIÓN: un operador, cuatro vecinos y ocho incidentes
 * en Ramos Mejía con sus confirmaciones. Solo corre sobre una base vacía.
 *
 * Las credenciales de prueba están en el README (sección "Usuarios de prueba").
 * No usar estas cuentas fuera del entorno local.
 *
 * Uso: npm run db:semilla
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { pool } from "../src/lib/servidor/db";
import { hashear } from "../src/lib/servidor/clave";
import { requisitosIncumplidos } from "../src/lib/politicaClave";
import { recalcularIndices } from "../src/lib/servidor/prioridad";

const CLAVE_VECINOS = "Ramos#Mejia26";
const CLAVE_OPERADOR_TEMPORAL = "Fomento#Temp26";

const VECINOS = ["vecino1@siru.local", "vecino2@siru.local", "vecino3@siru.local", "vecino4@siru.local"];
const OPERADOR = "operador@siru.local";

// [categoría, severidad, lat, lng, descripción, autor (índice de VECINOS), confirmadores, fecha]
const INCIDENTES: [string, string, number, number, string, number, number[], string][] = [
  ["Bache", "alta", -34.6479, -58.5618, "Bache profundo en la intersección de Av. de Mayo y San Martín. Peligroso para ciclistas y motociclistas.", 0, [1, 2, 3], "2026-09-20T10:35:00-03:00"],
  ["Luminaria", "media", -34.6491, -58.5635, "Luminaria apagada hace más de dos semanas. La cuadra queda completamente oscura.", 1, [0, 3], "2026-09-22T21:05:00-03:00"],
  ["Basura acumulada", "baja", -34.6474, -58.5610, "Residuos voluminosos abandonados en la vereda hace cuatro días; no fueron retirados.", 2, [], "2026-09-25T14:20:00-03:00"],
  ["Otro", "media", -34.6500, -58.5645, "Falta la tapa de una cámara de inspección en la vereda, frente a la escuela.", 3, [0], "2026-09-24T08:20:00-03:00"],
  ["Bache", "media", -34.6468, -58.5600, "Bache en la calzada que afecta el carril izquierdo. Riesgo de daños a los vehículos.", 1, [0, 2, 3], "2026-09-19T16:45:00-03:00"],
  ["Anegamiento", "alta", -34.6488, -58.5612, "Acumulación de agua en la esquina por una boca de tormenta tapada.", 2, [1, 3], "2026-09-26T09:05:00-03:00"],
  ["Basura acumulada", "baja", -34.6505, -58.5625, "Contenedor desbordado; residuos dispersos en la vereda y la calzada.", 3, [], "2026-09-23T12:35:00-03:00"],
  ["Luminaria", "alta", -34.6476, -58.5638, "Columna de alumbrado con la luminaria rota; la esquina queda a oscuras.", 0, [1, 2], "2026-09-21T20:00:00-03:00"],
];

async function main() {
  for (const c of [CLAVE_VECINOS, CLAVE_OPERADOR_TEMPORAL]) {
    const f = requisitosIncumplidos(c);
    if (f.length) throw new Error(`La clave de prueba no cumple la política: ${f.join(" ")}`);
  }

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM usuario");
  if (rows[0].n > 0) {
    console.log("La base ya tiene usuarios: no se cargaron datos de demostración.");
    return;
  }

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const hashVecino = await hashear(CLAVE_VECINOS);
    const hashOperador = await hashear(CLAVE_OPERADOR_TEMPORAL);

    const ids: number[] = [];
    for (const email of VECINOS) {
      const r = await c.query(
        `INSERT INTO usuario (email, hash_contrasena, rol, estado_cuenta) VALUES ($1, $2, 'VECINO', 'ACTIVA') RETURNING usuario_id`,
        [email, hashVecino]
      );
      ids.push(r.rows[0].usuario_id);
      await c.query("INSERT INTO historial_contrasena (usuario_id, hash_contrasena) VALUES ($1, $2)", [r.rows[0].usuario_id, hashVecino]);
    }
    const op = await c.query(
      `INSERT INTO usuario (email, hash_contrasena, rol, estado_cuenta, debe_cambiar_clave)
       VALUES ($1, $2, 'OPERADOR', 'ACTIVA', TRUE) RETURNING usuario_id`,
      [OPERADOR, hashOperador]
    );
    await c.query("INSERT INTO historial_contrasena (usuario_id, hash_contrasena) VALUES ($1, $2)", [op.rows[0].usuario_id, hashOperador]);
    await c.query(
      "INSERT INTO auditoria (usuario_id, accion, detalle) VALUES ($1, 'CREA_OPERADOR', $2::jsonb)",
      [op.rows[0].usuario_id, JSON.stringify({ origen: "datos de demostración" })]
    );

    for (const [k, [cat, sev, lat, lng, desc, autor, confirmadores, fecha]] of INCIDENTES.entries()) {
      const puntaje = 1 + confirmadores.length;
      const estado = puntaje >= 3 ? "ACTIVO" : "SIN_VERIFICAR";
      const hash = createHash("sha256").update(`siru-demostracion-${k}`).digest("hex");
      const r = await c.query(
        `INSERT INTO incidente (usuario_id, categoria_id, severidad_id, descripcion, ubicacion, precision_gps,
                                hash_foto, puntaje_confianza, estado, fecha_creacion, fecha_activacion)
         VALUES ($1, (SELECT categoria_id FROM categoria WHERE nombre = $2), (SELECT severidad_id FROM severidad WHERE nombre = $3),
                 $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, $10::varchar, $11::timestamptz,
                 CASE WHEN $10::varchar = 'ACTIVO' THEN $11::timestamptz + interval '1 day' END)
         RETURNING incidente_id`,
        [ids[autor], cat, sev, desc, lng, lat, 8 + (k % 5) * 3, hash, puntaje, estado, fecha]
      );
      const incId = r.rows[0].incidente_id;
      await c.query(
        "INSERT INTO auditoria (usuario_id, incidente_id, accion, detalle, fecha_hora) VALUES ($1, $2, 'ALTA_INCIDENTE', $3::jsonb, $4::timestamptz)",
        [ids[autor], incId, JSON.stringify({ origen: "datos de demostración", categoria: cat, severidad: sev }), fecha]
      );
      for (const [j, v] of confirmadores.entries()) {
        await c.query(
          `INSERT INTO confirmacion (incidente_id, usuario_id, distancia_metros, precision_gps, fecha_confirmacion)
           VALUES ($1, $2, $3, $4, $5::timestamptz + make_interval(hours => $6))`,
          [incId, ids[v], 6 + j * 9, 10, fecha, 2 + j * 5]
        );
      }
    }
    // HU-04: los incidentes activos de la demostración llegan con su índice de prioridad calculado.
    const indices = await recalcularIndices(c);
    await c.query("COMMIT");
    console.log(`Índice de prioridad calculado para ${indices.length} incidentes activos.`);
    console.log(`Datos de demostración cargados: 1 operador, ${VECINOS.length} vecinos y ${INCIDENTES.length} incidentes.`);
    console.log("Las credenciales de prueba están en el README.");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
