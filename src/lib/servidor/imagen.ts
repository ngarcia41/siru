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
 * Guardar la foto privada y la miniatura corresponde a la tarea T04.
 */
import sharp from "sharp";
import { IMAGEN } from "../reglas";
import type { Resultado } from "./incidentes";

export interface ImagenValida {
  datos: Buffer;
  ancho: number;
  alto: number;
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
  return { ok: true, datos: { datos, ancho, alto } };
}
