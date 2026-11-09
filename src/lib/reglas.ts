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
export const PRECISION_GPS_MAXIMA = Number(process.env.NEXT_PUBLIC_PRECISION_GPS_MAXIMA ?? 25);

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
} as const;

export const CATEGORIAS =["Bache", "Luminaria", "Anegamiento", "Basura acumulada", "Otro"] as const;

export type Rol = keyof typeof INACTIVIDAD_MINUTOS;
