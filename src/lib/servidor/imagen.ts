/**
 * SIRU — lib/servidor/imagen.ts
 * Validación en el servidor de la foto que sube el teléfono (D-19, imagenes.md).
 *
 * El teléfono sube una versión reducida en JPEG. El servidor "valida su tipo y
 * tamaño", como pide el documento:
 *   - tipo: la firma del archivo tiene que ser la de un JPEG, y sharp tiene que
 *     poder leerlo como tal (no alcanza con el tipo que declara el navegador);
 *   - tamaño: el lado mayor tiene que estar entre 800 y 1600 px. El límite de
 *     1,5 MB de la solicitud se controla antes, en la ruta.
 *
 * Después la recodifica (T04, B-03): con sharp genera la foto privada (hasta
 * 1600 px) y la miniatura (480 px), ambas en JPEG y SIN METADATOS. sharp no
 * copia el EXIF salvo que se lo pida con withMetadata(), que acá no se usa;
 * rotate() sin argumentos aplica antes la orientación EXIF, si la hubiera.
 *
 * Además aplica las reglas EXIF del documento (T03, B-01) sobre los datos del
 * original que informa el teléfono, porque la versión reducida ya no los trae (D-19).
 */
import sharp from "sharp";
import type { PoolClient } from "pg";
import { IMAGEN, RADIO_METROS } from "../reglas";
import type { Resultado } from "./incidentes";

export interface ImagenValida {
  /** Versión privada, recodificada y sin metadatos (fotos/<hash>.jpg). */
  foto: Buffer;
  /** Miniatura pública para usuarios autenticados (miniaturas/<hash>.jpg). */
  miniatura: Buffer;
  ancho: number;
  alto: number;
}

/** Recodifica la imagen con un lado mayor máximo, en JPEG y sin metadatos. */
function recodificar(datos: Buffer, ladoMayor: number, calidad: number): Promise<Buffer> {
  return sharp(datos)
    .rotate()
    .resize({ width: ladoMayor, height: ladoMayor, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: calidad, mozjpeg: true })
    .toBuffer();
}

const INVALIDA = "La foto no es válida. Sacala de nuevo desde el formulario de SIRU.";

/** Firma de los archivos JPEG: los tres primeros bytes son FF D8 FF. */
function esFirmaJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

export async function validarImagenSubida(archivo: File): Promise<Resultado<ImagenValida>> {
  const datos = Buffer.from(await archivo.arrayBuffer());
  if (!esFirmaJpeg(datos)) {
    return { ok: false, status: 400, codigo: "IMAGEN_INVALIDA", mensaje: INVALIDA };
  }

  let ancho = 0;
  let alto = 0;
  try {
    // autoOrient refleja la orientación EXIF, si la hubiera (la versión del teléfono no la trae).
    const meta = await sharp(datos).metadata();
    if (meta.format !== "jpeg") throw new Error("formato");
    ancho = meta.autoOrient?.width ?? meta.width ?? 0;
    alto = meta.autoOrient?.height ?? meta.height ?? 0;
  } catch {
    return { ok: false, status: 400, codigo: "IMAGEN_INVALIDA", mensaje: INVALIDA };
  }

  const ladoMayor = Math.max(ancho, alto);
  if (ladoMayor < IMAGEN.LADO_MAYOR_MINIMO_PX || ladoMayor > IMAGEN.LADO_MAYOR_MAXIMO_PX) {
    return {
      ok: false, status: 400, codigo: "IMAGEN_INVALIDA",
      mensaje: `La foto debe tener entre ${IMAGEN.LADO_MAYOR_MINIMO_PX} y ${IMAGEN.LADO_MAYOR_MAXIMO_PX} px en su lado mayor (tiene ${ladoMayor} px).`,
    };
  }

  try {
    // Decodificar y volver a codificar descarta cualquier contenido que no sea la imagen.
    const [foto, miniatura] = await Promise.all([
      recodificar(datos, IMAGEN.LADO_MAYOR_MAXIMO_PX, IMAGEN.CALIDAD_FOTO_SERVIDOR),
      recodificar(datos, IMAGEN.MINIATURA_LADO_MAYOR_PX, IMAGEN.CALIDAD_MINIATURA),
    ]);
    return { ok: true, datos: { foto, miniatura, ancho, alto } };
  } catch {
    // sharp leyó el encabezado pero no pudo decodificar la imagen (archivo dañado o truncado).
    return { ok: false, status: 400, codigo: "IMAGEN_INVALIDA", mensaje: INVALIDA };
  }
}

// ---------------------------------------------------------------------------
// Reglas EXIF (T03, B-01)
// ---------------------------------------------------------------------------

/** Datos EXIF del original, tal como los informa el teléfono (todos opcionales). */
export interface ExifDeclarado {
  fecha: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Convierte la fecha declarada a Date. Acepta ISO 8601 con o sin desfase; si no
 * lo trae, la toma en la hora de Argentina (D-16), para no depender de la zona
 * horaria del servidor. Devuelve null si el texto no es una fecha válida.
 */
export function fechaExifDeServidor(texto: string): Date | null {
  const m = texto.trim().match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return null;
  const fecha = new Date(`${m[1]}${m[2] ?? ""}${m[3] ?? IMAGEN.DESFASE_EXIF_PREDETERMINADO}`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Aplica las reglas EXIF del documento: si la foto tiene fecha de captura, no
 * puede superar las 24 h; si tiene coordenadas, deben estar a menos de 50 m de
 * la posición del dispositivo (medido con PostGIS). Si el EXIF falta, no se
 * rechaza: el documento reconoce que puede faltar o estar modificado.
 * Devuelve la fecha de captura para guardarla en fecha_captura_foto.
 */
export async function validarExif(
  c: PoolClient,
  exif: ExifDeclarado,
  dispositivo: { lat: number; lng: number }
): Promise<Resultado<{ fechaCaptura: Date | null }>> {
  let fechaCaptura: Date | null = null;
  if (exif.fecha) {
    fechaCaptura = fechaExifDeServidor(exif.fecha);
    if (!fechaCaptura) {
      return { ok: false, status: 400, codigo: "EXIF_INVALIDO", mensaje: "La fecha de la foto no tiene un formato válido." };
    }
    const horas = (Date.now() - fechaCaptura.getTime()) / 3_600_000;
    // D-23: una fecha posterior a la hora del servidor (con 10 minutos de tolerancia) no es creíble.
    if (-horas * 60 > IMAGEN.TOLERANCIA_FECHA_FUTURA_MINUTOS) {
      return {
        ok: false, status: 422, codigo: "FOTO_FECHA_FUTURA",
        mensaje: "La fecha de la foto es posterior a la hora actual. Revisá la fecha y hora del teléfono y sacá la foto de nuevo.",
      };
    }
    if (horas > IMAGEN.ANTIGUEDAD_EXIF_MAXIMA_HORAS) {
      return {
        ok: false, status: 422, codigo: "FOTO_ANTIGUA",
        mensaje: `La foto se sacó hace más de ${IMAGEN.ANTIGUEDAD_EXIF_MAXIMA_HORAS} horas. Sacá una foto nueva del incidente.`,
      };
    }
  }

  const hayLat = exif.lat !== null;
  const hayLng = exif.lng !== null;
  if (hayLat !== hayLng) {
    return { ok: false, status: 400, codigo: "EXIF_INVALIDO", mensaje: "Las coordenadas de la foto están incompletas." };
  }
  if (hayLat && hayLng) {
    const { lat, lng } = exif as { lat: number; lng: number };
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { ok: false, status: 400, codigo: "EXIF_INVALIDO", mensaje: "Las coordenadas de la foto no son válidas." };
    }
    const { distancia } = (await c.query(
      `SELECT ST_Distance(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                          ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography) AS distancia`,
      [lng, lat, dispositivo.lng, dispositivo.lat]
    )).rows[0];
    if (Number(distancia) >= RADIO_METROS) {
      return {
        ok: false, status: 422, codigo: "FOTO_LEJANA",
        mensaje: `La foto se sacó a ${Math.round(Number(distancia))} m de donde estás, y tiene que ser a menos de ${RADIO_METROS} m. Sacá la foto en el lugar del incidente.`,
        extra: { distanciaMetros: Number(distancia) },
      };
    }
  }
  return { ok: true, datos: { fechaCaptura } };
}
