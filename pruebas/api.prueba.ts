/**
 * SIRU — pruebas/api.prueba.ts
 * Pruebas funcionales de la API: Sprint 2 (HU-01, HU-02, HU-03, HU-07, HU-08)
 * y, desde el Sprint 3, el alta con la foto reducida en el teléfono (D-19).
 *
 * ATENCIÓN: crea usuarios, incidentes y registros de auditoría. Correrlas
 * solo contra una base de PRUEBA recién cargada con la semilla, nunca
 * contra datos reales.
 *
 * Se corren con `npm run prueba`, que recrea la base siru_prueba y levanta el
 * servidor. A mano: npx tsx pruebas/api.prueba.ts http://localhost:3001
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "pg";
import sharp from "sharp";
import { recalcularIndices } from "../src/lib/servidor/prioridad";

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
      // Con FormData, fetch arma el Content-Type multipart con su separador.
      ...(cuerpo instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-Forwarded-For": "190.210.0.10",
      ...(s?.cookie ? { Cookie: s.cookie } : {}),
    },
    body: cuerpo === undefined ? undefined : cuerpo instanceof FormData ? cuerpo : JSON.stringify(cuerpo),
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

/**
 * Imagen generada para cada prueba: un color liso distinto en cada llamada, así
 * ningún archivo se repite. Por defecto, un JPEG de 1600 × 1200 px como el que
 * arma el teléfono (D-19).
 */
let imagenesGeneradas = 0;
async function imagenDePrueba(ancho = 1600, alto = 1200, formato: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  imagenesGeneradas++;
  const n = imagenesGeneradas * 7919 + (Date.now() % 100000);
  const color = { r: n % 256, g: Math.floor(n / 256) % 256, b: Math.floor(n / 65536) % 256 };
  const img = sharp({ create: { width: ancho, height: alto, channels: 3, background: color } });
  return formato === "png" ? img.png().toBuffer() : img.jpeg({ quality: 80 }).toBuffer();
}

/** JPEG de 1600 px que trae metadatos EXIF, para comprobar que el servidor los descarta (B-03). */
async function imagenConExif(): Promise<Buffer> {
  const base = await imagenDePrueba();
  return sharp(base).withExif({ IFD0: { Copyright: "SIRU prueba", Make: "Prueba" } }).jpeg({ quality: 80 }).toBuffer();
}

/** GET de una imagen: devuelve el estado, los encabezados y los bytes. */
async function pedirImagen(s: Sesion | null, ruta: string) {
  const res = await fetch(BASE + ruta, { headers: s?.cookie ? { Cookie: s.cookie } : {} });
  return { status: res.status, headers: res.headers, datos: Buffer.from(await res.arrayBuffer()) };
}

type DatosAlta = {
  geom: { lat: number; lng: number }; gpsAccuracy: number; category: string; severity: string;
  description: string; photoHash: string;
  /** Datos EXIF del original que informa el teléfono (opcionales). */
  exifFecha?: string; exifLat?: number; exifLng?: number;
};

/** POST /api/incidents como multipart/form-data, igual que el formulario del teléfono. */
async function alta(s: Sesion | null, d: DatosAlta, imagen?: Buffer | null, tipo = "image/jpeg") {
  const f = new FormData();
  if (imagen !== null) {
    const bytes = imagen ?? (await imagenDePrueba());
    f.append("foto", new Blob([new Uint8Array(bytes)], { type: tipo }), "foto.jpg");
  }
  f.append("hashOriginal", d.photoHash);
  f.append("lat", String(d.geom.lat));
  f.append("lng", String(d.geom.lng));
  f.append("gpsAccuracy", String(d.gpsAccuracy));
  f.append("category", d.category);
  f.append("severity", d.severity);
  f.append("description", d.description);
  if (d.exifFecha !== undefined) f.append("exifFecha", d.exifFecha);
  if (d.exifLat !== undefined) f.append("exifLat", String(d.exifLat));
  if (d.exifLng !== undefined) f.append("exifLng", String(d.exifLng));
  return llamar(s, "POST", "/api/incidents", f);
}

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
  const datos = { geom: base, category: "Bache", severity: "high", description: "Bache profundo que obliga a esquivarlo sobre la mano derecha.", photoHash: foto };
  r = await alta(nuevo, { ...datos, gpsAccuracy: 40 });
  caso("Precisión GPS mayor a 25 m: pide repetir la captura", r.status === 422 && r.data?.error === "PRECISION_INSUFICIENTE", r.data?.message);
  // --- D-19: el servidor valida la foto reducida que sube el teléfono ---
  const pesada = Buffer.concat([await imagenDePrueba(), Buffer.alloc(1_600_000, 1)]);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12 }, pesada);
  caso("Una solicitud de más de 1,5 MB se rechaza (413)", r.status === 413 && r.data?.error === "IMAGEN_DEMASIADO_GRANDE", `HTTP ${r.status}`);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12 }, await imagenDePrueba(3000, 2000));
  caso("Un JPEG de 3000 px de lado se rechaza (400)", r.status === 400 && r.data?.error === "IMAGEN_INVALIDA", r.data?.message);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12 }, await imagenDePrueba(700, 500));
  caso("Un JPEG de menos de 800 px de lado se rechaza (400)", r.status === 400 && r.data?.error === "IMAGEN_INVALIDA", r.data?.message);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12 }, await imagenDePrueba(1600, 1200, "png"), "image/jpeg");
  caso("Un PNG se rechaza aunque se declare como JPEG (400)", r.status === 400 && r.data?.error === "IMAGEN_INVALIDA", r.data?.message);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12 }, null);
  caso("Un alta sin foto se rechaza (400)", r.status === 400 && r.data?.error === "DATOS_INCOMPLETOS", r.data?.message);
  const completa = await imagenDePrueba();
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12 }, completa.subarray(0, Math.floor(completa.length / 2)));
  caso("Un JPEG dañado que sharp no puede decodificar se rechaza (400)", r.status === 400 && r.data?.error === "IMAGEN_INVALIDA", r.data?.message);

  // --- B-01: reglas EXIF del documento (T03) ---
  const haceHoras = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12, exifFecha: haceHoras(25) });
  caso("Una foto con fecha EXIF de más de 24 h se rechaza (422)", r.status === 422 && r.data?.error === "FOTO_ANTIGUA", r.data?.message);
  const lejos = alNorte(base, 80);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12, exifFecha: haceHoras(1), exifLat: lejos.lat, exifLng: lejos.lng });
  caso("Una foto con coordenadas EXIF a 80 m del dispositivo se rechaza (422, PostGIS)", r.status === 422 && r.data?.error === "FOTO_LEJANA", r.data?.message);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12, exifLat: lejos.lat });
  caso("Coordenadas EXIF incompletas se rechazan (400)", r.status === 400 && r.data?.error === "EXIF_INVALIDO", r.data?.message);
  r = await alta(nuevo, { ...datos, gpsAccuracy: 12, exifFecha: haceHoras(-1) });
  caso("Una foto con fecha EXIF una hora en el futuro se rechaza (422, D-23)", r.status === 422 && r.data?.error === "FOTO_FECHA_FUTURA", r.data?.message);
  const sinAltas = (await db.query("SELECT count(*)::int AS n FROM incidente WHERE hash_foto = $1", [foto])).rows[0].n;
  caso("Ninguna foto rechazada llega a crear el incidente", sinAltas === 0, `${sinAltas} incidentes`);

  r = await alta(nuevo, { ...datos, gpsAccuracy: 12 });
  const incId = r.data?.data?.id;
  caso("Alta válida: Sin verificar con 1 punto de confianza", r.status === 201 && r.data?.data?.trustPoints === 1 && r.data?.data?.status === "unverified", `incidente ${incId}`);
  const sinExif = (await db.query("SELECT fecha_captura_foto FROM incidente WHERE incidente_id = $1", [incId])).rows[0];
  caso("Una foto sin EXIF se acepta y deja fecha_captura_foto en NULL", sinExif?.fecha_captura_foto === null, String(sinExif?.fecha_captura_foto));

  // D-16: una fecha EXIF sin desfase horario se toma en la hora de Argentina (UTC−3).
  const capturaReal = new Date(Math.floor((Date.now() - 3_600_000) / 1000) * 1000);
  const horaLocalArgentina = new Date(capturaReal.getTime() - 3 * 3_600_000).toISOString().slice(0, 19);
  const cerca = alNorte(alNorte(base, 1000), 20);
  const conMetadatos = await imagenConExif();
  const hashConExif = hashFoto("exif");
  r = await alta(nuevo, {
    ...datos, geom: alNorte(base, 1000), photoHash: hashConExif, gpsAccuracy: 12,
    exifFecha: horaLocalArgentina, exifLat: cerca.lat, exifLng: cerca.lng,
  }, conMetadatos);
  const incConFoto = r.data?.data?.id;
  const conExif = r.status === 201
    ? (await db.query("SELECT fecha_captura_foto FROM incidente WHERE incidente_id = $1", [r.data?.data?.id])).rows[0]
    : null;
  const guardada = conExif?.fecha_captura_foto ? new Date(conExif.fecha_captura_foto).getTime() : NaN;
  caso("Una foto con EXIF reciente y a 20 m se acepta y guarda fecha_captura_foto (sin desfase: UTC−3)",
    r.status === 201 && guardada === capturaReal.getTime(),
    r.status === 201 ? `${horaLocalArgentina} → ${new Date(guardada).toISOString()}` : `HTTP ${r.status} ${r.data?.message ?? ""}`);
  r = await alta(nuevo, { ...datos, geom: alNorte(base, 1500), photoHash: hashFoto("tolerancia"), gpsAccuracy: 12, exifFecha: haceHoras(-5 / 60) });
  caso("Una fecha EXIF 5 minutos adelantada se acepta (tolerancia de 10 min, D-23)", r.status === 201, `HTTP ${r.status} ${r.data?.message ?? ""}`);
  r = await alta(nuevo, { ...datos, geom: alNorte(base, 500), category: "Luminaria", gpsAccuracy: 10 });
  caso("Una foto ya usada se rechaza por su huella SHA-256", r.status === 409 && r.data?.error === "FOTO_DUPLICADA", r.data?.message);
  r = await alta(nuevo, { ...datos, geom: alNorte({ lat: -34.6479, lng: -58.5618 }, 30), photoHash: hashFoto("b"), gpsAccuracy: 10 });
  caso("Mismo tipo a menos de 50 m: propone confirmar el existente (ST_DWithin)", r.status === 409 && r.data?.error === "GEOFENCE_DUPLICATE" && r.data?.nearbyIncident?.id === "1",
    `a ${Math.round(r.data?.distanceMeters ?? -1)} m del incidente ${r.data?.nearbyIncident?.id}`);
  r = await alta(nuevo, { ...datos, geom: alNorte({ lat: -34.6479, lng: -58.5618 }, 30), category: "Luminaria", photoHash: hashFoto("c"), gpsAccuracy: 10 });
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

  // --- HU-04: índice de prioridad al activar y con cada confirmación (T05) ---
  const indiceDe = async (id: unknown) =>
    (await db.query("SELECT indice_prioridad FROM incidente WHERE incidente_id = $1", [id])).rows[0]?.indice_prioridad as string | null;
  caso("Al activarse, el incidente recibe su índice (alta, 3 puntos, 0 días: 65,00)", (await indiceDe(incId)) === "65.00", String(await indiceDe(incId)));
  // Otro incidente (bache alto, Sin verificar): dos confirmaciones lo activan y una tercera lo recalcula.
  const v3 = await ingresar("vecino3@siru.local", CLAVE_VECINOS);
  const lugar = alNorte(alNorte(base, 1000), 10);
  const indicePrevio = await indiceDe(incConFoto);
  for (const v of [v1, v2]) await llamar(v, "POST", "/api/trust", { incidentId: incConFoto, userLocation: lugar, gpsAccuracy: 8 });
  const alActivar = await indiceDe(incConFoto);
  r = await llamar(v3, "POST", "/api/trust", { incidentId: incConFoto, userLocation: lugar, gpsAccuracy: 8 });
  const conCuatro = await indiceDe(incConFoto);
  caso("Sin verificar no tiene índice; al llegar a 3 puntos se calcula y una confirmación más lo recalcula (65,00 → 70,00)",
    indicePrevio === null && alActivar === "65.00" && conCuatro === "70.00" && r.status === 200,
    `${indicePrevio} → ${alActivar} → ${conCuatro}`);

  // --- HU-04: tarea diaria de las 00:30 (T06, D-07) ---
  await db.query("UPDATE incidente SET fecha_activacion = fecha_activacion - interval '1 day' WHERE incidente_id = $1", [incConFoto]);
  const tareaDiaria = () => spawnSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), "scripts/tareas-diarias.ts"],
    { env: process.env, encoding: "utf8" });
  const corrida1 = tareaDiaria();
  const trasUnDia = await indiceDe(incConFoto);
  const corrida2 = tareaDiaria();
  const trasRepetir = await indiceDe(incConFoto);
  caso("La tarea diaria recalcula después de mover fecha_activacion un día atrás (70,00 → 70,67)",
    corrida1.status === 0 && trasUnDia === "70.67", `${conCuatro} → ${trasUnDia}`);
  caso("La tarea diaria es idempotente: repetirla no cambia el índice", corrida2.status === 0 && trasRepetir === trasUnDia, `${trasUnDia} → ${trasRepetir}`);

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

  // --- B-03: foto privada, miniatura sin metadatos y ruta autenticada (T04) ---
  const filaFoto = (await db.query("SELECT foto_ruta FROM incidente WHERE incidente_id = $1", [incConFoto])).rows[0];
  caso("foto_ruta guarda la clave de la foto privada", filaFoto?.foto_ruta === `fotos/${hashConExif}.jpg`, filaFoto?.foto_ruta);
  const original = await sharp(conMetadatos).metadata();
  r = await llamar(v1, "GET", "/api/incidents");
  const dto = (r.data?.data ?? []).find((x: { id: string }) => x.id === String(incConFoto));
  caso("La API informa la miniatura y la foto por la ruta autenticada",
    dto?.miniaturaUrl === `/api/imagenes/miniaturas/${hashConExif}.jpg` && dto?.fotoUrl === `/api/imagenes/fotos/${hashConExif}.jpg`, dto?.miniaturaUrl);
  let img = await pedirImagen(null, `/api/imagenes/miniaturas/${hashConExif}.jpg`);
  caso("Sin sesión no se puede leer una imagen (401)", img.status === 401, `HTTP ${img.status}`);
  img = await pedirImagen(v1, `/api/imagenes/fotos/${hashConExif}.jpg`);
  caso("Un vecino no puede ver la foto privada (403)", img.status === 403, `HTTP ${img.status}`);
  img = await pedirImagen(v1, `/api/imagenes/miniaturas/${hashConExif}.jpg`);
  const metaMini = img.status === 200 ? await sharp(img.datos).metadata() : null;
  caso("Un vecino ve la miniatura, con caché privada, larga e inmutable",
    img.status === 200 && img.headers.get("content-type") === "image/jpeg"
      && img.headers.get("cache-control") === "private, max-age=604800, immutable",
    `HTTP ${img.status} · ${img.headers.get("cache-control")}`);
  caso("La miniatura mide 480 px como máximo y no conserva EXIF",
    !!metaMini && Math.max(metaMini.width ?? 0, metaMini.height ?? 0) <= 480 && !metaMini.exif,
    `${metaMini?.width} × ${metaMini?.height} · EXIF del original: ${original.exif ? "sí" : "no"}, de la miniatura: ${metaMini?.exif ? "sí" : "no"}`);
  img = await pedirImagen(op, `/api/imagenes/fotos/${hashConExif}.jpg`);
  const metaFoto = img.status === 200 ? await sharp(img.datos).metadata() : null;
  caso("El operador ve la foto privada: 1600 px como máximo y sin EXIF",
    !!original.exif && !!metaFoto && Math.max(metaFoto.width ?? 0, metaFoto.height ?? 0) <= 1600 && !metaFoto.exif,
    `HTTP ${img.status} · ${metaFoto?.width} × ${metaFoto?.height}`);
  const malas = await Promise.all([
    pedirImagen(op, "/api/imagenes/fotos/..%2F..%2F.env"),
    pedirImagen(op, `/api/imagenes/otra/${hashConExif}.jpg`),
    pedirImagen(op, `/api/imagenes/fotos/${hashConExif.slice(0, 63)}.jpg`),
  ]);
  caso("Una clave con otro formato se rechaza sin tocar el disco (400)", malas.every((m) => m.status === 400), malas.map((m) => m.status).join(", "));
  img = await pedirImagen(op, `/api/imagenes/fotos/${"0".repeat(64)}.jpg`);
  caso("Una imagen inexistente responde 404", img.status === 404, `HTTP ${img.status}`);

  // --- D-24 (T15): verificación de duplicados al elegir la categoría, sin crear nada ---
  // Incidente 1 de la semilla: bache activo, reportado por vecino1 y confirmado por vecino2, 3 y 4.
  const junto1 = alNorte({ lat: -34.6479, lng: -58.5618 }, 30);
  const conteo = async () => (await db.query(
    "SELECT (SELECT count(*) FROM incidente)::int AS i, (SELECT count(*) FROM auditoria)::int AS a, (SELECT count(*) FROM confirmacion)::int AS c"
  )).rows[0];
  const antesVerif = await conteo();
  const verificar = (s: Sesion | null, cuerpo: unknown) => llamar(s, "POST", "/api/incidents/cercania", cuerpo);
  r = await verificar(null, { ...junto1, category: "Bache" });
  caso("Verificar la cercanía exige sesión (401)", r.status === 401, `HTTP ${r.status}`);
  r = await verificar(op, { ...junto1, category: "Bache" });
  caso("Un operador no usa la verificación del alta (403)", r.status === 403, `HTTP ${r.status}`);
  r = await verificar(nuevo, { ...junto1, category: "Bache" });
  const dup = r.data?.data?.duplicado;
  caso("Misma categoría a 30 m: propone confirmar el existente, con la distancia de PostGIS",
    r.status === 200 && dup?.nearbyIncident?.id === "1" && Math.round(dup?.distanceMeters) === 30 && dup?.motivoNoConfirmable === null,
    `incidente ${dup?.nearbyIncident?.id} a ${Math.round(dup?.distanceMeters ?? -1)} m, motivo ${dup?.motivoNoConfirmable}`);
  r = await verificar(nuevo, { ...junto1, category: "Anegamiento" });
  caso("Otra categoría en el mismo lugar: no hay duplicado", r.status === 200 && r.data?.data?.duplicado === null, JSON.stringify(r.data?.data));
  r = await verificar(nuevo, { ...alNorte({ lat: -34.6479, lng: -58.5618 }, 80), category: "Bache" });
  caso("Misma categoría a 80 m: no hay duplicado", r.status === 200 && r.data?.data?.duplicado === null, JSON.stringify(r.data?.data));
  r = await verificar(v1, { ...junto1, category: "Bache" });
  caso("Si el incidente es del mismo vecino, avisa que necesita la confirmación de otros",
    r.data?.data?.duplicado?.motivoNoConfirmable === "PROPIO_REPORTE", r.data?.data?.duplicado?.motivoNoConfirmable);
  r = await verificar(v2, { ...junto1, category: "Bache" });
  caso("Si el vecino ya lo confirmó, lo informa", r.data?.data?.duplicado?.motivoNoConfirmable === "YA_CONFIRMADO", r.data?.data?.duplicado?.motivoNoConfirmable);
  r = await verificar(nuevo, { ...junto1, category: "Pozo" });
  const r2 = await verificar(nuevo, { lat: 200, lng: -58.5, category: "Bache" });
  caso("Categoría o ubicación inválidas se rechazan (400)", r.status === 400 && r2.status === 400, `${r.status}, ${r2.status}`);
  const despuesVerif = await conteo();
  caso("La verificación no crea incidentes, confirmaciones ni registros de auditoría",
    JSON.stringify(antesVerif) === JSON.stringify(despuesVerif), `${JSON.stringify(antesVerif)} → ${JSON.stringify(despuesVerif)}`);
  r = await alta(nuevo, { ...datos, geom: junto1, photoHash: hashFoto("t15"), gpsAccuracy: 10 });
  caso("El alta mantiene su propio control de duplicados (409, con el mismo aviso)",
    r.status === 409 && r.data?.error === "GEOFENCE_DUPLICATE" && r.data?.nearbyIncident?.id === "1" && r.data?.motivoNoConfirmable === null,
    `HTTP ${r.status} · ${r.data?.error}`);

  // --- HU-04 criterio 4: reclasificación por el operador (T07, D-13) ---
  const reclasificar = (s: Sesion, id: unknown, cambios: Record<string, unknown>) =>
    llamar(s, "PATCH", `/api/incidents/${id}`, { action: "reclasificar", ...cambios });
  const ultimaAuditoria = async (id: unknown, accion: string) => (await db.query(
    "SELECT usuario_id, detalle FROM auditoria WHERE incidente_id = $1 AND accion = $2 ORDER BY auditoria_id DESC LIMIT 1", [id, accion]
  )).rows[0];
  r = await reclasificar(v1, incConFoto, { severidad: "low" });
  caso("Un vecino no puede reclasificar (403)", r.status === 403, `HTTP ${r.status}`);
  const ipAntes = await indiceDe(incConFoto);
  r = await reclasificar(op, incConFoto, { severidad: "low" });
  const ipDespues = await indiceDe(incConFoto);
  const audSev = await ultimaAuditoria(incConFoto, "CAMBIO_SEVERIDAD");
  caso("El operador baja la severidad de un activo: el índice se recalcula (70,67 → 37,17)",
    r.status === 200 && r.data?.data?.severity === "low" && ipAntes === "70.67" && ipDespues === "37.17", `${ipAntes} → ${ipDespues}`);
  caso("El cambio de severidad se audita con los valores e índices anterior y nuevo",
    audSev?.detalle?.severidadAnterior === "alta" && audSev?.detalle?.severidadNueva === "baja"
      && audSev?.detalle?.indiceAnterior === 70.67 && audSev?.detalle?.indiceNuevo === 37.17 && !!audSev?.usuario_id,
    JSON.stringify(audSev?.detalle));
  r = await reclasificar(op, incConFoto, { categoria: "Otro" });
  const audCat = await ultimaAuditoria(incConFoto, "CAMBIO_CATEGORIA");
  caso("El cambio de categoría no recalcula el índice y se audita",
    r.status === 200 && r.data?.data?.category === "Otro" && (await indiceDe(incConFoto)) === "37.17"
      && audCat?.detalle?.categoriaAnterior === "Bache" && audCat?.detalle?.categoriaNueva === "Otro",
    JSON.stringify(audCat?.detalle));
  r = await reclasificar(op, 1, { categoria: "Luminaria" });
  caso("Reclasificar la categoría no puede dejar un duplicado a menos de 50 m (409 con el existente)",
    r.status === 409 && r.data?.error === "GEOFENCE_DUPLICATE" && !!r.data?.nearbyIncident?.id, `${r.data?.error} · incidente ${r.data?.nearbyIncident?.id}`);
  const sinCambio = await reclasificar(op, incConFoto, { severidad: "low" });
  const invalida = await reclasificar(op, incConFoto, { severidad: "urgente" });
  caso("Sin cambios o con valores inválidos se rechaza (400)",
    sinCambio.status === 400 && sinCambio.data?.error === "SIN_CAMBIOS" && invalida.status === 400, `${sinCambio.data?.error}, ${invalida.data?.error}`);
  r = await alta(op, { ...datos, geom: alNorte(base, 2000), photoHash: hashFoto("d"), gpsAccuracy: 10 });
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
  r = await reclasificar(op, incId, { severidad: "medium" });
  caso("Un incidente cerrado no se reclasifica (409)", r.status === 409 && r.data?.error === "INCIDENTE_CERRADO", r.data?.message);
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
    const rr = await alta(v4, {
      ...datos, category: "Otro", geom: alNorte({ lat: -34.66, lng: -58.58 }, i * 300), photoHash: hashFoto(`lim${i}`), gpsAccuracy: 10,
    });
    estados.push(rr.status);
  }
  caso("El sexto reporte del día se rechaza", JSON.stringify(estados) === "[201,201,201,201,201,429]", estados.join(", "));

  // --- HU-04: ejemplos del documento, con la misma función que usa el sistema (T05) ---
  const vecinoId = (await db.query("SELECT usuario_id FROM usuario WHERE email = 'vecino1@siru.local'")).rows[0].usuario_id;
  const ejemplo = async (categoria: string, severidad: string, puntos: number, dias: number, n: number) => {
    const { rows } = await db.query(
      `INSERT INTO incidente (usuario_id, categoria_id, severidad_id, descripcion, ubicacion, precision_gps, hash_foto,
                              puntaje_confianza, estado, fecha_activacion)
       VALUES ($1, (SELECT categoria_id FROM categoria WHERE nombre = $2), (SELECT severidad_id FROM severidad WHERE nombre = $3),
               'Ejemplo del documento para el índice de prioridad.', ST_SetSRID(ST_MakePoint(-58.60, $4), 4326), 10, $5,
               $6, 'ACTIVO', now() - make_interval(days => $7, hours => 1))
       RETURNING incidente_id`,
      [vecinoId, categoria, severidad, -34.70 - n * 0.01, hashFoto(`ejemplo${n}`), puntos, dias]
    );
    const [calc] = await recalcularIndices(db, { incidenteId: rows[0].incidente_id });
    return calc?.indice;
  };
  const bache = await ejemplo("Bache", "alta", 5, 12, 1);
  caso("Ejemplo del documento: bache alto, 5 puntos, 12 días activo → IP = 83,00", bache === 83, String(bache));
  const luminaria = await ejemplo("Luminaria", "media", 3, 2, 2);
  caso("Ejemplo del documento: luminaria media, 3 puntos, 2 días activa → IP = 49,83", luminaria === 49.83, String(luminaria));
  const tope = await ejemplo("Anegamiento", "baja", 9, 45, 3);
  caso("Los componentes C y T no superan 1: baja, 9 puntos, 45 días → IP = 66,50", tope === 66.5, String(tope));
  await recalcularIndices(db);
  const { fuera, activosSin } = (await db.query(
    `SELECT count(*) FILTER (WHERE estado <> 'ACTIVO' AND indice_prioridad IS NOT NULL)::int AS fuera,
            count(*) FILTER (WHERE estado = 'ACTIVO' AND indice_prioridad IS NULL)::int AS "activosSin"
       FROM incidente`
  )).rows[0];
  caso("Solo los ACTIVO tienen índice; los demás quedan en NULL", fuera === 0 && activosSin === 0, `fuera de ACTIVO con índice: ${fuera}, activos sin índice: ${activosSin}`);

  await db.end();
  const fallas = resultados.filter((x) => !x.ok).length;
  console.log(`\n${resultados.length - fallas} de ${resultados.length} casos pasaron.`);
  process.exitCode = fallas ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
