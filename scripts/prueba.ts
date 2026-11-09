/**
 * SIRU — scripts/prueba.ts
 * Corre las pruebas funcionales sobre una base aislada (D-17):
 *   1. recrea la base siru_prueba (DROP y CREATE), la migra y carga la semilla;
 *   2. compila la aplicación y levanta el servidor en el puerto 3001 contra esa base;
 *   3. corre cada archivo pruebas/*.prueba.ts;
 *   4. apaga el servidor y termina con código 1 si alguna prueba falló.
 *
 * La URL de la base sale de DATABASE_URL_PRUEBA (.env). Si el nombre de la base
 * no es exactamente "siru_prueba", el script aborta sin tocar nada: las pruebas
 * crean y modifican datos, y nunca deben correr contra la base siru.
 *
 * Antes de correrlo, detené `npm run dev`: la compilación reescribe la carpeta .next.
 *
 * Uso: npm run prueba
 */
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { PRECISION_GPS_DOCUMENTO } from "../src/lib/reglas";

const BASE_PERMITIDA = "siru_prueba";
const PUERTO = 3001;
const URL_SERVIDOR = `http://localhost:${PUERTO}`;
const ESPERA_SERVIDOR_MS = 60_000;
/** Carpeta de imágenes de las pruebas: se vacía en cada corrida, como la base. */
const CARPETA_IMAGENES = "almacenamiento-prueba";

const TSX = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const NEXT = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

/** Valida la URL de prueba y devuelve el entorno con el que corren todos los pasos. */
function entornoDePrueba(): NodeJS.ProcessEnv {
  const url = process.env.DATABASE_URL_PRUEBA;
  if (!url) throw new Error("Falta DATABASE_URL_PRUEBA en el archivo .env (ver .env.example).");

  let nombreBase: string;
  try {
    nombreBase = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL_PRUEBA no es una URL válida.");
  }
  if (nombreBase !== BASE_PERMITIDA) {
    throw new Error(
      `La base de prueba debe llamarse "${BASE_PERMITIDA}" y DATABASE_URL_PRUEBA apunta a "${nombreBase}". ` +
        "Se aborta para no modificar otra base."
    );
  }
  // Todos los procesos hijos (migración, semilla, servidor y pruebas) leen DATABASE_URL.
  // dotenv y Next.js no pisan una variable que ya existe en el entorno.
  // Las imágenes de las pruebas van a su propia carpeta, separada de la de desarrollo.
  // La precisión GPS se fija en el valor del documento aunque .env la tenga subida para
  // probar desde la computadora (D-05): las pruebas verifican la regla de 25 m.
  return {
    ...process.env,
    DATABASE_URL: url,
    ALMACENAMIENTO_LOCAL: CARPETA_IMAGENES,
    NEXT_PUBLIC_PRECISION_GPS_MAXIMA: String(PRECISION_GPS_DOCUMENTO),
  };
}

/** Borra y vuelve a crear la base de prueba, conectándose a la base "postgres" del servidor. */
async function recrearBase(url: string) {
  const servidor = new URL(url);
  servidor.pathname = "/postgres";
  const admin = new Client({ connectionString: servidor.toString() });
  await admin.connect();
  try {
    // El nombre está validado contra una constante; no proviene de la entrada.
    await admin.query(`DROP DATABASE IF EXISTS ${BASE_PERMITIDA} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${BASE_PERMITIDA}`);
  } finally {
    await admin.end();
  }
}

/** Ejecuta un paso con Node y corta todo si falla. */
function paso(titulo: string, args: string[], env: NodeJS.ProcessEnv) {
  console.log(`\n== ${titulo}`);
  const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Falló el paso "${titulo}".`);
}

async function puertoLibre(): Promise<boolean> {
  try {
    await fetch(URL_SERVIDOR, { signal: AbortSignal.timeout(1000) });
    return false; // algo respondió en el puerto
  } catch {
    return true;
  }
}

async function esperarServidor(servidor: ChildProcess) {
  const limite = Date.now() + ESPERA_SERVIDOR_MS;
  while (Date.now() < limite) {
    if (servidor.exitCode !== null) throw new Error("El servidor de prueba se detuvo al arrancar.");
    try {
      await fetch(`${URL_SERVIDOR}/api/auth/sesion`, { signal: AbortSignal.timeout(2000) });
      return; // cualquier respuesta HTTP indica que está listo
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`El servidor de prueba no respondió en ${ESPERA_SERVIDOR_MS / 1000} s.`);
}

function detener(servidor: ChildProcess | null) {
  if (!servidor || servidor.exitCode !== null || !servidor.pid) return;
  if (process.platform === "win32") {
    // En Windows hay que cerrar el árbol de procesos completo.
    spawnSync("taskkill", ["/pid", String(servidor.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    servidor.kill("SIGTERM");
  }
}

async function main() {
  const env = entornoDePrueba();
  if (!(await puertoLibre())) {
    throw new Error(`El puerto ${PUERTO} está ocupado. Cerrá el proceso que lo usa y volvé a intentar.`);
  }

  console.log(`== Recreando la base ${BASE_PERMITIDA} y vaciando ${CARPETA_IMAGENES}/`);
  await recrearBase(env.DATABASE_URL!);
  rmSync(CARPETA_IMAGENES, { recursive: true, force: true });
  paso("Migración", [TSX, "scripts/migrar.ts"], env);
  paso("Semilla", [TSX, "scripts/semilla.ts"], env);
  paso("Compilación", [NEXT, "build"], env);

  console.log(`\n== Servidor de prueba en ${URL_SERVIDOR}`);
  const servidor = spawn(process.execPath, [NEXT, "start", "-p", String(PUERTO)], { env, stdio: "ignore" });
  const alSalir = () => detener(servidor);
  process.on("exit", alSalir);
  process.on("SIGINT", () => process.exit(130));

  let fallaron = 0;
  try {
    await esperarServidor(servidor);
    const archivos = readdirSync("pruebas").filter((f) => f.endsWith(".prueba.ts")).sort();
    for (const archivo of archivos) {
      console.log(`\n== ${archivo}`);
      const r = spawnSync(process.execPath, [TSX, join("pruebas", archivo), URL_SERVIDOR], { env, stdio: "inherit" });
      if (r.status !== 0) fallaron++;
    }
    console.log(`\n== ${archivos.length - fallaron} de ${archivos.length} archivos de prueba sin fallas.`);
  } finally {
    detener(servidor);
    // Comprobación final: el servidor de prueba no puede quedar escuchando.
    let libre = false;
    for (let i = 0; i < 10 && !libre; i++) {
      libre = await puertoLibre();
      if (!libre) await new Promise((r) => setTimeout(r, 500));
    }
    if (!libre) console.error(`\nATENCIÓN: el puerto ${PUERTO} sigue ocupado después de apagar el servidor de prueba.`);
  }
  process.exitCode = fallaron ? 1 : 0;
}

main().catch((e) => {
  console.error(`\n${(e as Error).message ?? e}`);
  process.exitCode = 1;
});
