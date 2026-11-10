/**
 * SIRU — lib/reglas.ts
 * Parámetros de las reglas de negocio y de seguridad definidas en el documento
 * del proyecto (Reglas de validación, Seguridad). Se concentran en un solo
 * lugar para poder auditarlos y ajustarlos sin tocar la lógica.
 */

/** Radio único para duplicados y para confirmar en el lugar (metros). */
export const RADIO_METROS = 50;

/**
 * Precisión GPS máxima aceptada (metros). El documento fija 25 m.
 * Se puede subir temporalmente en .env para probar desde una computadora,
 * cuya ubicación por IP suele tener una precisión de cientos de metros.
 */
export const PRECISION_GPS_DOCUMENTO = 25;
export const PRECISION_GPS_MAXIMA = Number(process.env.NEXT_PUBLIC_PRECISION_GPS_MAXIMA ?? PRECISION_GPS_DOCUMENTO);

/** Puntos de confianza necesarios para que un incidente pase a Activo. */
export const UMBRAL_ACTIVACION = 3;

/** Límites de uso por usuario cada 24 horas. */
export const LIMITE_REPORTES_24H = 5;
export const LIMITE_CONFIRMACIONES_24H = 20;

/** Sesión: expiración por inactividad según el perfil y duración máxima. */
export const INACTIVIDAD_MINUTOS = { VECINO: 30, OPERADOR: 15 } as const;
export const SESION_MAXIMA_HORAS = 8;
export const AVISO_EXPIRACION_MINUTOS = 2;

/** Bloqueo de cuentas por intentos fallidos. */
export const INTENTOS_ANTES_DE_BLOQUEO = 3;
export const MINUTOS_DE_BLOQUEO = 15;
export const BLOQUEOS_PARA_BLOQUEO_PERMANENTE = 3; // dentro de 24 horas

/** Contraseñas. */
export const VIGENCIA_CLAVE_DIAS = { VECINO: 180, OPERADOR: 90 } as const;
export const CLAVES_ANTERIORES_PROHIBIDAS = 3;
export const COSTO_BCRYPT = 12;

/** Verificación de correo. */
export const HORAS_VALIDEZ_VERIFICACION = 24;

/**
 * Imagen del reporte (D-04 y D-19). El teléfono controla el original y lo
 * reduce antes de subirlo; el servidor solo acepta la versión reducida.
 */
export const IMAGEN = {
  /** Tamaño mínimo del original, controlado en el teléfono (D-04). */
  ORIGINAL_MINIMO_BYTES: 50 * 1024,
  /** Lado mayor de la versión reducida: el teléfono la deja en 1600 px como máximo. */
  LADO_MAYOR_MAXIMO_PX: 1600,
  /** El servidor rechaza una imagen cuyo lado mayor sea menor (foto de muy baja resolución). */
  LADO_MAYOR_MINIMO_PX: 800,
  /** Calidad JPEG de la versión reducida en el teléfono (0 a 1). */
  CALIDAD_JPEG_TELEFONO: 0.8,
  /** Tamaño máximo de la solicitud de alta, con la foto incluida (1,5 MB). */
  SOLICITUD_MAXIMA_BYTES: 1.5 * 1024 * 1024,
  /** La fecha de captura EXIF no puede tener más de 24 horas (Reglas › imagen). */
  ANTIGUEDAD_EXIF_MAXIMA_HORAS: 24,
  /** Desfase que se asume si la fecha EXIF no informa su zona horaria: hora de Argentina (D-16). */
  DESFASE_EXIF_PREDETERMINADO: "-03:00",
  /** Tolerancia para una fecha EXIF posterior a la hora del servidor (reloj del teléfono adelantado, D-23). */
  TOLERANCIA_FECHA_FUTURA_MINUTOS: 10,
  /** Versiones que guarda el servidor, siempre sin metadatos (D-14). */
  CALIDAD_FOTO_SERVIDOR: 80,
  MINIATURA_LADO_MAYOR_PX: 480,
  CALIDAD_MINIATURA: 70,
  /** Caché de las imágenes servidas: la clave es la huella, así que el contenido nunca cambia (7 días). */
  CACHE_SEGUNDOS: 604800,
} as const;

/** Resolución y desestimación (HU-05). */
export const EVIDENCIA = {
  /** PDF de información oficial que carga el operador (imagenes.md): máximo 2 MB, sin miniatura. */
  PDF_MAXIMO_BYTES: 2 * 1024 * 1024,
} as const;
/** Observación del operador al rechazar una resolución o desestimar (VARCHAR(300) en RESOLUCION). */
export const OBSERVACION = { MINIMO: 10, MAXIMO: 300 } as const;
/** D-09: 3 reportes desestimados en 30 días suspenden la cuenta (plan de R02). */
export const DESESTIMADOS_PARA_SUSPENSION = 3;
export const DIAS_VENTANA_SUSPENSION = 30;

/**
 * Índice de prioridad (HU-04): IP = 100 × (0,5·S + 0,3·C + 0,2·T), solo para incidentes activos.
 *   S = peso de la severidad (tabla SEVERIDAD)
 *   C = min(puntos / 6, 1)
 *   T = min(días enteros desde la activación / 30, 1)   (D-06)
 */
export const PESOS_PRIORIDAD = { S: 0.5, C: 0.3, T: 0.2 } as const;
export const PUNTOS_RESPALDO_MAXIMO = 6;
export const DIAS_ANTIGUEDAD_MAXIMA = 30;
/** Bandas: alta si IP ≥ 70; media si 40 ≤ IP < 70; baja si IP < 40. */
export const BANDAS_PRIORIDAD = { alta: 70, media: 40 } as const;
/** Hora del recálculo diario, en la zona horaria de Argentina (D-07). */
export const HORA_RECALCULO = "00:30";

export const CATEGORIAS = ["Bache", "Luminaria", "Anegamiento", "Basura acumulada", "Otro"] as const;

export type Rol = keyof typeof INACTIVIDAD_MINUTOS;
