/**
 * SIRU — lib/servidor/almacenamiento.ts
 * Almacenamiento de imágenes (D-14). El resto del sistema usa solo esta
 * interfaz, así que pasar del disco local a Spaces (compatible con S3) en el
 * Sprint 4 no cambia la lógica del alta ni de la resolución.
 *
 * Claves (la huella SHA-256 del original identifica el archivo):
 *   fotos/<hash>.jpg       versión privada, hasta 1600 px (foto_ruta o evidencia_ruta)
 *   miniaturas/<hash>.jpg  miniatura de 480 px; se deriva de la anterior, sin columna propia
 *   documentos/<hash>.pdf  información oficial que carga el operador como evidencia (evidencia_ruta)
 *
 * Como la clave sale de la huella, el contenido de una clave nunca cambia: por
 * eso se puede servir con una caché larga e inmutable.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type TipoArchivo = "fotos" | "miniaturas" | "documentos";

/** Formato estricto de una clave: carpeta conocida, 64 caracteres hexadecimales y extensión. */
const CLAVE_VALIDA = /^((fotos|miniaturas)\/[0-9a-f]{64}\.jpg|documentos\/[0-9a-f]{64}\.pdf)$/;

export function esClaveValida(clave: string): boolean {
  return CLAVE_VALIDA.test(clave);
}

export const claveFoto = (hash: string) => `fotos/${hash}.jpg`;
export const claveMiniatura = (hash: string) => `miniaturas/${hash}.jpg`;
/** PDF de información oficial del operador (HU-05): privado y sin miniatura. */
export const claveDocumento = (hash: string) => `documentos/${hash}.pdf`;

/** Miniatura que corresponde a una foto: misma huella, otra carpeta. */
export function miniaturaDe(claveDeFoto: string): string {
  return claveDeFoto.replace(/^fotos\//, "miniaturas/");
}

export interface Almacenamiento {
  guardar(clave: string, datos: Buffer): Promise<void>;
  /** Devuelve null si la clave no existe. */
  leer(clave: string): Promise<Buffer | null>;
}

/**
 * Implementación local para desarrollo: guarda en una carpeta fuera de public/
 * y fuera de git. ALMACENAMIENTO_LOCAL permite usar otra carpeta (las pruebas
 * usan almacenamiento-prueba/ para no mezclarse con los datos de desarrollo).
 */
class AlmacenamientoLocal implements Almacenamiento {
  private readonly raiz = resolve(process.env.ALMACENAMIENTO_LOCAL || "almacenamiento");

  private ruta(clave: string): string {
    // Defensa contra el recorrido de rutas: solo claves con el formato exacto.
    if (!esClaveValida(clave)) throw new Error(`Clave de almacenamiento inválida: ${clave}`);
    return join(this.raiz, clave);
  }

  async guardar(clave: string, datos: Buffer): Promise<void> {
    const destino = this.ruta(clave);
    await mkdir(dirname(destino), { recursive: true });
    // Se escribe en un temporal y se renombra: nunca queda un archivo a medio escribir.
    const temporal = `${destino}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporal, datos);
    await rename(temporal, destino);
  }

  async leer(clave: string): Promise<Buffer | null> {
    try {
      return await readFile(this.ruta(clave));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}

/** Implementación en uso. En el Sprint 4 se elige Spaces según el entorno. */
export const almacenamiento: Almacenamiento = new AlmacenamientoLocal();
