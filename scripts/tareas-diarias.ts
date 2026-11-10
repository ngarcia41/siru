/**
 * SIRU — scripts/tareas-diarias.ts
 * Tareas programadas que corren todos los días a las 00:30, hora de Argentina
 * (America/Argentina/Buenos_Aires), según D-07:
 *   1. recalcular el índice de prioridad de todos los incidentes activos, porque
 *      el componente T (días desde la activación) cambia aunque nadie confirme (HU-04).
 * En el Sprint 4 se suma la purga de las coordenadas de quienes confirman a los
 * 90 días (D-08).
 *
 * Es idempotente: correrla dos veces el mismo día deja los mismos valores. Por
 * eso no importa si cron la repite o si se corre a mano.
 *
 * Programación (ver README):
 *   - servidor (cron):  30 0 * * *  con CRON_TZ=America/Argentina/Buenos_Aires
 *   - desarrollo:       a mano o con el Programador de tareas de Windows
 *
 * Uso: npm run tareas:diarias
 */
import "dotenv/config";
import { pool, transaccion } from "../src/lib/servidor/db";
import { recalcularIndices } from "../src/lib/servidor/prioridad";
import { HORA_RECALCULO } from "../src/lib/reglas";

/** Cada tarea corre en su propia transacción: si una falla, las demás igual se aplican. */
const TAREAS: { nombre: string; correr: () => Promise<string> }[] = [
  {
    nombre: "Recálculo del índice de prioridad",
    correr: () => transaccion(async (c) => `${(await recalcularIndices(c)).length} incidentes activos recalculados`),
  },
  // Sprint 4 (D-08): purga de las coordenadas de confirmación con más de 90 días.
];

async function main() {
  const ahora = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  console.log(`Tareas diarias de SIRU (programadas a las ${HORA_RECALCULO}) · ${ahora}`);
  let fallas = 0;
  for (const tarea of TAREAS) {
    try {
      console.log(`  ✔ ${tarea.nombre}: ${await tarea.correr()}`);
    } catch (e) {
      fallas++;
      console.error(`  ✘ ${tarea.nombre}: ${(e as Error).message}`);
    }
  }
  process.exitCode = fallas ? 1 : 0;
}

main().finally(() => pool.end());
