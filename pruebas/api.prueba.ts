/**
 * SIRU — pruebas/api.prueba.ts
 * Pruebas funcionales de la API del Sprint 2 (HU-01, HU-02, HU-03, HU-07, HU-08).
 *
 * ATENCIÓN: crea usuarios, incidentes y registros de auditoría. Correrlas
 * solo contra una base de PRUEBA recién cargada con la semilla, nunca
 * contra datos reales.
 *
 * Uso (con el servidor levantado):  npx tsx pruebas/api.prueba.ts http://localhost:3000
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { Client } from "pg";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CLAVE_VECINOS = "Ramos#Mejia26";
const CLAVE_OPERADOR_TEMPORAL = "Fomento#Temp26";

type Sesion = { cookie: string | null };
const resultados: { caso: string; ok: boolean; detalle: string }[] = [];

function caso(nombre: string, ok: boolean, detalle = "") {
  resultados.push({ caso: nombre, ok, detalle });
  console.log(`${ok ? "PASA" : "FALLA"}  ${nombre}${detalle ? `  (${detalle})` : ""}`);
}

async function llamar(s: Sesion | null, metodo: string, ruta: string, cuerpo?: unknown, redirect: RequestRedirect = "follow") {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    redirect,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "190.210.0.10",
      ...(s?.cookie ? { Cookie: s.cookie } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  const c = set.find((x) => x.startsWith("siru_sesion="));
  if (s && c) s.cookie = c.split(";")[0].endsWith("=") ? null : c.split(";")[0];
  let data: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, data, location: res.headers.get("location") };
}

/** Desplaza un punto `metros` hacia el norte (aprox. 111.320 m por grado). */
const alNorte = (p: { lat: number; lng: number }, metros: number) => ({ lat: p.lat + metros / 111320, lng: p.lng });
const hashFoto = (semilla: string) => createHash("sha256").update(`prueba-${semilla}-${Date.now()}`).digest("hex");

async function ingresar(email: string, clave: string): Promise<Sesion> {
  const s: Sesion = { cookie: null };
  await llamar(s, "POST", "/api/auth/ingresar", { email, clave });
  return s;
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // --- Acceso sin sesión ---
  let r = await llamar(null, "GET", "/api/incidents");
  caso("Sin sesión, la API rechaza la consulta", r.status === 401, `HTTP ${r.status}`);
  r = await llamar(null, "GET", "/dashboard", undefined, "manual");
  caso("Sin sesión, el mapa redirige al ingreso", r.status === 307 && !!r.location?.includes("/ingresar"), `HTTP ${r.status}`);

  // --- HU-01: registro y verificación ---
  const email = `nuevo.vecino.${Date.now()}@correo.test`;
  r = await llamar(null, "POST", "/api/auth/registro", { email, clave: "abc12345" });
  caso("Registro con clave débil informa los requisitos incumplidos", r.status === 400 && Array.isArray(r.data?.requisitos), r.data?.requisitos?.join(" | "));
  r = await llamar(null, "POST", "/api/auth/registro", { email, clave: "Barrio#Oeste26" });
  const enlace: string = r.data?.enlaceDesarrollo ?? "";
  caso("Registro válido crea la cuenta pendiente y genera el enlace", r.status === 201 && enlace.includes("/api/auth/verificar?token="), `HTTP ${r.status}`);
  const fila = (await db.query("SELECT hash_contrasena, estado_cuenta FROM usuario WHERE email = $1", [email])).rows[0];
  caso("La contraseña se guarda con bcrypt de costo 12", fila?.hash_contrasena?.startsWith("$2a$12$") && fila.estado_cuenta === "PENDIENTE", fila?.hash_contrasena?.slice(0, 7));
  r = await llamar(null, "POST", "/api/auth/registro", { email, clave: "Barrio#Oeste26" });
  caso("Un correo ya registrado no está disponible", r.status === 409, r.data?.message);
  r = await llamar(null, "POST", "/api/auth/ingresar", { email, clave: "Barrio#Oeste26" });
  caso("No se puede ingresar sin verificar el correo", r.status === 403 && r.data?.error === "CORREO_SIN_VERIFICAR", `HTTP ${r.status}`);
  const ruta = enlace.replace(/^https?:\/\/[^/]+/, "");
  r = await llamar(null, "GET", ruta, undefined, "manual");
  caso("El enlace de verificación activa la cuenta", r.status === 307 && !!r.location?.includes("verificado=1"), r.location ?? "");
  r = await llamar(null, "GET", ruta, undefined, "manual");
  caso("El enlace es de un solo uso", !!r.location?.includes("verificado=0"), r.location ?? "");

  const nuevo = await ingresar(email, "Barrio#Oeste26");
  r = await llamar(nuevo, "GET", "/api/auth/sesion");
  caso("Ingreso con perfil de vecino y 30 minutos de inactividad", r.status === 200 && r.data?.usuario?.rol === "VECINO" && r.data?.usuario?.inactividadMinutos === 30, JSON.stringify(r.data?.usuario));

  // --- HU-02: alta de incidente ---
  r = await llamar(nuevo, "GET", "/api/incidents");
  caso("Los incidentes se leen desde PostgreSQL", r.status === 200 && r.data?.total >= 8, `${r.data?.total} incidentes`);
  const base = { lat: -34.6530, lng: -58.5700 };
  const foto = hashFoto("a");
  const datos = { geom: base, category: "Bache", severity: "high", description: "Bache profundo que obliga a esquivarlo sobre la mano derecha.", photoHash: foto, exifData: null };
  r = await llamar(nuevo, "POST", "/api/incidents", { ...datos, gpsAccuracy: 40 });
  caso("Precisión GPS mayor a 25 m: pide repetir la captura", r.status === 422 && r.data?.error === "PRECISION_INSUFICIENTE", r.data?.message);
  r = await llamar(nuevo, "POST", "/api/incidents", { ...datos, gpsAccuracy: 12 });
  const incId = r.data?.data?.id;
  caso("Alta válida: Sin verificar con 1 punto de confianza", r.status === 201 && r.data?.data?.trustPoints === 1 && r.data?.data?.status === "unverified", `incidente ${incId}`);
  r = await llamar(nuevo, "POST", "/api/incidents", { ...datos, geom: alNorte(base, 500), category: "Luminaria", gpsAccuracy: 10 });
  caso("Una foto ya usada se rechaza por su huella SHA-256", r.status === 409 && r.data?.error === "FOTO_DUPLICADA", r.data?.message);
  r = await llamar(nuevo, "POST", "/api/incidents", { ...datos, geom: alNorte({ lat: -34.6479, lng: -58.5618 }, 30), photoHash: hashFoto("b"), gpsAccuracy: 10 });
  caso("Mismo tipo a menos de 50 m: propone confirmar el existente (ST_DWithin)", r.status === 409 && r.data?.error === "GEOFENCE_DUPLICATE" && r.data?.nearbyIncident?.id === "1",
    `a ${Math.round(r.data?.distanceMeters ?? -1)} m del incidente ${r.data?.nearbyIncident?.id}`);
  r = await llamar(nuevo, "POST", "/api/incidents", { ...datos, geom: alNorte({ lat: -34.6479, lng: -58.5618 }, 30), category: "Luminaria", photoHash: hashFoto("c"), gpsAccuracy: 10 });
  caso("Otra categoría en el mismo lugar sí se registra", r.status === 201, `HTTP ${r.status}`);

  // --- HU-03: confirmación ---
  r = await llamar(nuevo, "POST", "/api/trust", { incidentId: incId, userLocation: base, gpsAccuracy: 8 });
  caso("No se puede confirmar el propio reporte", r.status === 403 && r.data?.error === "PROPIO_REPORTE", r.data?.message);
  const v1 = await ingresar("vecino1@siru.local", CLAVE_VECINOS);
  const v2 = await ingresar("vecino2@siru.local", CLAVE_VECINOS);
  r = await llamar(v1, "POST", "/api/trust", { incidentId: incId, userLocation: alNorte(base, 30), gpsAccuracy: 8 });
  caso("Confirmación a 30 m suma 1 punto", r.status === 200 && r.data?.data?.trustPoints === 2, r.data?.message);
  r = await llamar(v1, "POST", "/api/trust", { incidentId: incId, userLocation: alNorte(base, 30), gpsAccuracy: 8 });
  caso("No se puede confirmar dos veces", r.status === 409 && r.data?.error === "YA_CONFIRMADO", r.data?.message);
  r = await llamar(v2, "POST", "/api/trust", { incidentId: incId, userLocation: alNorte(base, 80), gpsAccuracy: 8 });
  caso("Confirmación a 80 m se rechaza (fuera del radio)", r.status === 403 && r.data?.error === "FUERA_DE_RADIO", r.data?.message);
  r = await llamar(v2, "POST", "/api/trust", { incidentId: incId, userLocation: alNorte(base, 10), gpsAccuracy: 8 });
  caso("Al llegar a 3 puntos el incidente pasa a Activo", r.status === 200 && r.data?.data?.status === "active" && r.data?.data?.trustPoints === 3, r.data?.message);
  const dist = (await db.query("SELECT distancia_metros FROM confirmacion WHERE incidente_id = $1 ORDER BY 1", [incId])).rows.map((x) => Number(x.distancia_metros));
  caso("Se guarda la distancia medida por PostGIS en cada confirmación", dist.length === 2 && dist.every((d) => d < 50), dist.join(" m, ") + " m");

  // --- Permisos por perfil ---
  r = await llamar(v1, "PATCH", `/api/incidents/${incId}`, { action: "resolve" });
  caso("Un vecino no puede registrar el cierre", r.status === 403 && r.data?.error === "SIN_PERMISO", `HTTP ${r.status}`);
  r = await llamar(v1, "GET", "/api/auditoria");
  caso("Un vecino no puede consultar la auditoría", r.status === 403, `HTTP ${r.status}`);

  // --- HU-08: operador con clave temporal ---
  const op = await ingresar("operador@siru.local", CLAVE_OPERADOR_TEMPORAL);
  r = await llamar(op, "GET", "/api/auth/sesion");
  caso("Operador en su primer ingreso: cambio de clave obligatorio, 15 min de inactividad",
    r.data?.usuario?.debeCambiarClave === true && r.data?.usuario?.inactividadMinutos === 15, JSON.stringify(r.data?.usuario));
  r = await llamar(op, "GET", "/api/incidents");
  caso("Hasta cambiar la clave no puede operar", r.status === 403 && r.data?.error === "CAMBIO_CLAVE_REQUERIDO", `HTTP ${r.status}`);
  r = await llamar(op, "POST", "/api/auth/cambiar-clave", { actual: CLAVE_OPERADOR_TEMPORAL, nueva: CLAVE_OPERADOR_TEMPORAL });
  caso("No acepta repetir una de las últimas 3 claves", r.status === 400 && r.data?.error === "CLAVE_REPETIDA", r.data?.message);
  r = await llamar(op, "POST", "/api/auth/cambiar-clave", { actual: CLAVE_OPERADOR_TEMPORAL, nueva: "Gestion#Barrio27" });
  caso("Cambio de clave válido", r.status === 200, r.data?.message);
  r = await llamar(op, "POST", "/api/incidents", { ...datos, geom: alNorte(base, 2000), photoHash: hashFoto("d"), gpsAccuracy: 10 });
  caso("Un operador no registra incidentes", r.status === 403 && r.data?.error === "SIN_PERMISO", `HTTP ${r.status}`);
  r = await llamar(op, "PATCH", `/api/incidents/${incId}`, { action: "resolve", observacion: "Bacheo verificado en el lugar." });
  caso("El operador registra el cierre: pasa a Resuelto", r.status === 200 && r.data?.data?.status === "resolved", `HTTP ${r.status}`);
  const res = (await db.query("SELECT informada_por, validada_por, resultado, fecha_validacion FROM resolucion WHERE incidente_id = $1", [incId])).rows[0];
  caso("El cierre registra quién lo validó y cuándo", res?.resultado === "CONFIRMADA" && !!res?.validada_por && !!res?.fecha_validacion, JSON.stringify({ validadaPor: res?.validada_por, resultado: res?.resultado }));

  // --- HU-07: auditoría ---
  r = await llamar(op, "GET", `/api/auditoria?incidente=${incId}`);
  const acciones = (r.data?.data ?? []).map((a: { accion: string }) => a.accion);
  caso("La auditoría del incidente está completa y en orden cronológico",
    JSON.stringify(acciones) === JSON.stringify(["ALTA_INCIDENTE", "CONFIRMA_INCIDENTE", "CONFIRMA_INCIDENTE", "ACTIVA_INCIDENTE", "VALIDA_RESOLUCION"]),
    acciones.join(" → "));
  const ip = r.data?.data?.[0]?.direccion_ip;
  caso("Cada registro guarda la dirección IP", ip === "190.210.0.10", ip);
  let bloqueada = false;
  try { await db.query("UPDATE auditoria SET accion = 'X' WHERE auditoria_id = (SELECT min(auditoria_id) FROM auditoria)"); } catch { bloqueada = true; }
  caso("La base rechaza modificar la auditoría", bloqueada);
  bloqueada = false;
  try { await db.query("DELETE FROM auditoria WHERE auditoria_id = (SELECT min(auditoria_id) FROM auditoria)"); } catch { bloqueada = true; }
  caso("La base rechaza borrar la auditoría", bloqueada);

  // --- HU-08: bloqueo e inactividad ---
  const intentos = [];
  for (let i = 0; i < 3; i++) intentos.push((await llamar(null, "POST", "/api/auth/ingresar", { email: "vecino3@siru.local", clave: "Equivocada#1" })).status);
  caso("Tres intentos fallidos bloquean la cuenta", JSON.stringify(intentos) === "[401,401,423]", intentos.join(", "));
  r = await llamar(null, "POST", "/api/auth/ingresar", { email: "vecino3@siru.local", clave: CLAVE_VECINOS });
  caso("Durante el bloqueo ni la clave correcta permite ingresar", r.status === 423 && r.data?.error === "BLOQUEO_TEMPORAL", r.data?.message);
  r = await llamar(null, "POST", "/api/auth/ingresar", { email: "no.existe@correo.test", clave: "Cualquiera#9" });
  caso("Un correo inexistente recibe el mismo mensaje genérico", r.status === 401 && r.data?.message === "Correo o contraseña incorrectos.", r.data?.message);

  await db.query("UPDATE sesion SET ultima_actividad = now() - interval '31 minutes' WHERE usuario_id = (SELECT usuario_id FROM usuario WHERE email = 'vecino1@siru.local')");
  r = await llamar(v1, "GET", "/api/auth/sesion");
  caso("Tras 31 minutos sin actividad la sesión del vecino vence", r.status === 401 && r.data?.error === "SESION_EXPIRADA", r.data?.message);
  await db.query("UPDATE sesion SET ultima_actividad = now() - interval '16 minutes' WHERE usuario_id = (SELECT usuario_id FROM usuario WHERE email = 'operador@siru.local') AND revocada_en IS NULL");
  r = await llamar(op, "GET", "/api/auth/sesion");
  caso("Tras 16 minutos sin actividad la sesión del operador vence", r.status === 401, r.data?.message);

  const cookieAnterior = { cookie: nuevo.cookie };
  r = await llamar(nuevo, "POST", "/api/auth/salir");
  r = await llamar(cookieAnterior, "GET", "/api/auth/sesion");
  caso("Al cerrar sesión el token queda invalidado en el servidor", r.status === 401, `HTTP ${r.status}`);

  // --- Límite de 5 reportes por día ---
  const v4 = await ingresar("vecino4@siru.local", CLAVE_VECINOS);
  const estados: number[] = [];
  for (let i = 0; i < 6; i++) {
    const rr = await llamar(v4, "POST", "/api/incidents", {
      ...datos, category: "Otro", geom: alNorte({ lat: -34.66, lng: -58.58 }, i * 300), photoHash: hashFoto(`lim${i}`), gpsAccuracy: 10,
    });
    estados.push(rr.status);
  }
  caso("El sexto reporte del día se rechaza", JSON.stringify(estados) === "[201,201,201,201,201,429]", estados.join(", "));

  await db.end();
  const fallas = resultados.filter((x) => !x.ok).length;
  console.log(`\n${resultados.length - fallas} de ${resultados.length} casos pasaron.`);
  process.exitCode = fallas ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
