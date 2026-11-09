/**
 * SIRU — lib/cliente/imagen.ts
 * Preparación de la foto en el teléfono antes de subirla (D-19, imagenes.md).
 *
 * Sobre el ORIGINAL:
 *   1. controla el tamaño mínimo (D-04);
 *   2. calcula la huella SHA-256, que detecta una foto ya usada;
 *   3. lee la fecha y las coordenadas EXIF con exifr (las valida el servidor).
 * Después genera la VERSIÓN REDUCIDA que se sube: lado mayor de 1600 px como
 * máximo, JPEG con calidad 0,8, orientación corregida y sin metadatos (un
 * canvas no copia el EXIF del original).
 *
 * Reemplaza la simulación de lib/exif.ts del Sprint 2.
 */
import { IMAGEN } from "../reglas";

export interface FotoPreparada {
  /** Versión reducida que se sube al servidor. */
  reducida: Blob;
  ancho: number;
  alto: number;
  /** SHA-256 del archivo original, en hexadecimal. */
  hashOriginal: string;
  tamanoOriginal: number;
  /** Fecha de captura EXIF en ISO 8601 con su desfase horario, si la foto la tiene. */
  exifFecha: string | null;
  exifLat: number | null;
  exifLng: number | null;
}

/** Error con un mensaje listo para mostrar al vecino. */
export class ErrorFoto extends Error {}

/** SHA-256 de un archivo con la Web Crypto API del navegador. */
export async function huellaSha256(archivo: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await archivo.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Convierte la fecha EXIF ("2026:11:09 10:30:00") a ISO 8601. Si la foto no
 * informa su desfase horario, se toma la hora de Argentina, UTC−3 (D-16).
 */
export function fechaExifAIso(fecha: unknown, desfase: unknown): string | null {
  if (typeof fecha !== "string") return null;
  const m = fecha.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const zona = typeof desfase === "string" && /^[+-]\d{2}:\d{2}$/.test(desfase.trim())
    ? desfase.trim()
    : IMAGEN.DESFASE_EXIF_PREDETERMINADO;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zona}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Lee la fecha y las coordenadas EXIF del original. Si falta algo, devuelve null en ese dato. */
async function leerExif(archivo: File): Promise<Pick<FotoPreparada, "exifFecha" | "exifLat" | "exifLng">> {
  const sinDatos = { exifFecha: null, exifLat: null, exifLng: null };
  try {
    // Se carga solo cuando hace falta, para no sumar peso a la primera carga del mapa.
    const { default: exifr } = await import("exifr");
    // reviveValues: false devuelve la fecha como texto, sin convertirla a la zona del navegador (D-16).
    const datos = await exifr.parse(archivo, {
      pick: ["DateTimeOriginal", "OffsetTimeOriginal"],
      reviveValues: false,
    });
    const gps = await exifr.gps(archivo).catch(() => undefined);
    const lat = gps && Number.isFinite(gps.latitude) ? gps.latitude : null;
    const lng = gps && Number.isFinite(gps.longitude) ? gps.longitude : null;
    return {
      exifFecha: fechaExifAIso(datos?.DateTimeOriginal, datos?.OffsetTimeOriginal),
      exifLat: lat,
      exifLng: lng,
    };
  } catch {
    // El documento reconoce que el EXIF puede faltar: no impide el reporte.
    return sinDatos;
  }
}

/** Abre la imagen con el navegador. Las imágenes ya vienen con la orientación EXIF aplicada. */
function abrirImagen(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ErrorFoto("No se pudo abrir la imagen. Probá sacar la foto de nuevo con la cámara."));
    };
    img.src = url;
  });
}

/** Medidas de la versión reducida: el lado mayor queda en 1600 px como máximo, sin agrandar. */
function medidasReducidas(ancho: number, alto: number) {
  const escala = Math.min(1, IMAGEN.LADO_MAYOR_MAXIMO_PX / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

/**
 * Dibuja la imagen a tamaño reducido. Si el navegador lo permite, la decodifica
 * directamente a ese tamaño con createImageBitmap, para no ocupar la memoria de
 * la foto completa en un teléfono de gama baja; si no, usa la imagen ya abierta.
 */
async function dibujarReducida(archivo: File, img: HTMLImageElement, ancho: number, alto: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ErrorFoto("Tu navegador no permite procesar la imagen.");

  let fuente: CanvasImageSource = img;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(archivo, {
        resizeWidth: ancho,
        resizeHeight: alto,
        resizeQuality: "high",
        imageOrientation: "from-image",
      });
      // Solo se usa si respetó la orientación; si no, se queda con la imagen abierta.
      if (bitmap.width === ancho && bitmap.height === alto) fuente = bitmap;
    } catch {
      /* el navegador no admite estas opciones: se usa la imagen abierta */
    }
  }
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  if (fuente !== img) (fuente as ImageBitmap).close();
  return canvas;
}

function aJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ErrorFoto("No se pudo preparar la foto. Intentá de nuevo."))),
      "image/jpeg",
      IMAGEN.CALIDAD_JPEG_TELEFONO
    );
  });
}

/**
 * Prepara la foto para el alta. Lanza ErrorFoto con un mensaje claro si no se
 * puede usar; en ese caso no se sube nada.
 */
export async function prepararFoto(archivo: File): Promise<FotoPreparada> {
  if (archivo.size < IMAGEN.ORIGINAL_MINIMO_BYTES) {
    throw new ErrorFoto(
      `La foto pesa ${formatearTamano(archivo.size)}, y el mínimo es ${formatearTamano(IMAGEN.ORIGINAL_MINIMO_BYTES)}. Sacá una foto nueva con la cámara.`
    );
  }

  const [hashOriginal, exif, img] = await Promise.all([huellaSha256(archivo), leerExif(archivo), abrirImagen(archivo)]);

  if (Math.max(img.naturalWidth, img.naturalHeight) < IMAGEN.LADO_MAYOR_MINIMO_PX) {
    throw new ErrorFoto(
      `La foto es muy chica (${img.naturalWidth} × ${img.naturalHeight} px). Hace falta que el lado mayor tenga al menos ${IMAGEN.LADO_MAYOR_MINIMO_PX} px.`
    );
  }

  const { ancho, alto } = medidasReducidas(img.naturalWidth, img.naturalHeight);
  const reducida = await aJpeg(await dibujarReducida(archivo, img, ancho, alto));
  if (reducida.size > IMAGEN.SOLICITUD_MAXIMA_BYTES) {
    throw new ErrorFoto("La foto quedó demasiado pesada después de reducirla. Probá sacarla de nuevo.");
  }

  return { reducida, ancho, alto, hashOriginal, tamanoOriginal: archivo.size, ...exif };
}
