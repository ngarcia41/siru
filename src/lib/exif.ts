/**
 * SIRU — lib/exif.ts
 * Módulo de validación de metadatos EXIF e integridad de imágenes.
 *
 * Objetivo TFG §5.3 — Capas iniciales de mitigación de spam:
 *   1. Hash SHA-256 del archivo: detecta fotos duplicadas exactas
 *   2. Validación de tipo MIME y tamaño de archivo
 *   3. Extracción básica de metadatos de imagen (dimensiones, tipo)
 *
 * Nota académica: Para extracción EXIF completa en producción se utilizaría
 * la librería `exifr` (https://github.com/MikeKovarik/exifr) que soporta
 * lectura de GPS, fabricante y fecha desde JPEG/HEIC/RAW. En este prototipo
 * se simula con los datos disponibles via File API del navegador.
 */

import type { ExifMetadata } from "./types";

// ---------------------------------------------------------------------------
// Constantes de validación
// ---------------------------------------------------------------------------

/** Tipos MIME de imagen aceptados */
const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"];

/** Tamaño máximo de archivo: 10 MB */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Tamaño mínimo de archivo: 50 KB (evita imágenes genéricas/vacías) */
const MIN_FILE_SIZE_BYTES = 50 * 1024;

// ---------------------------------------------------------------------------
// Hash SHA-256 (Web Crypto API)
// ---------------------------------------------------------------------------

/**
 * Calcula el hash SHA-256 de un archivo usando la Web Crypto API nativa.
 * Este hash se almacena en la BD para detectar cargas duplicadas (mismo archivo,
 * mismo incidente). Control anti-spam de primera capa (TFG §5.3.1).
 *
 * @param file - Archivo de imagen a hashear
 * @returns Promise con el hash SHA-256 en formato hexadecimal (64 chars)
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

// ---------------------------------------------------------------------------
// Validación de archivo
// ---------------------------------------------------------------------------

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Valida un archivo de imagen antes de la carga.
 * Aplica reglas de negocio de integridad definidas en TFG §5.3.
 *
 * @param file - Archivo seleccionado por el usuario
 * @returns Resultado de validación con errores y advertencias
 */
export function validateImageFile(file: File): FileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validar tipo MIME
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    errors.push(`Tipo de archivo no permitido: ${file.type}. Use JPEG, PNG o WebP.`);
  }

  // Validar tamaño máximo
  if (file.size > MAX_FILE_SIZE_BYTES) {
    errors.push(`El archivo supera el límite de 10 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`);
  }

  // Validar tamaño mínimo
  if (file.size < MIN_FILE_SIZE_BYTES) {
    warnings.push("El archivo parece muy pequeño. Asegúrese de que la imagen sea clara y representativa.");
  }

  // Advertencia si el archivo no tiene extensión de imagen esperada
  const fileName = file.name.toLowerCase();
  if (!fileName.match(/\.(jpg|jpeg|png|webp|heic)$/)) {
    warnings.push("La extensión del archivo no corresponde a una imagen reconocida.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Extracción de metadatos básicos (simulado)
// ---------------------------------------------------------------------------

/**
 * Extrae metadatos básicos de una imagen usando solo APIs web nativas.
 * En producción, esta función usaría la librería `exifr` para leer EXIF
 * completo incluyendo coordenadas GPS, fabricante del dispositivo y fecha.
 *
 * Por limitaciones del prototipo académico, se obtienen dimensiones de imagen
 * y se simula el resto de metadatos basándose en el user-agent del navegador.
 *
 * @param file - Archivo de imagen
 * @returns Promise con los metadatos extraídos
 */
export async function extractExifMetadata(file: File): Promise<ExifMetadata> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      // Liberar la URL de objeto para evitar memory leaks
      URL.revokeObjectURL(url);

      // En producción: await exifr.parse(file) obtendría GPS, make, model, dateTaken
      const metadata: ExifMetadata = {
        width: img.naturalWidth,
        height: img.naturalHeight,
        // Los siguientes campos requerirían librería EXIF completa en producción
        dateTaken: new Date().toISOString(), // Fallback: fecha actual
      };

      resolve(metadata);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({}); // Retorna metadatos vacíos si no puede cargar la imagen
    };

    img.src = url;
  });
}

/**
 * Formatea el tamaño de un archivo para mostrar en la UI.
 * @param bytes - Tamaño en bytes
 * @returns String formateado (ej: "2.4 MB", "512 KB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
