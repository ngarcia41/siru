/**
 * SIRU — app/api/incidents/[id]/resolucion/route.ts
 *
 *   POST /api/incidents/:id/resolucion   (multipart/form-data)  → vecino u operador (HU-05, D-10)
 *
 * Vecino: foto (JPEG reducido en el teléfono), hashOriginal, lat, lng,
 *   gpsAccuracy y, si existen, exifFecha, exifLat y exifLng. Tiene que estar a
 *   menos de 50 m del incidente activo.
 * Operador: la información oficial, como foto (mismos campos de la foto) o como
 *   documento (PDF de hasta 2 MB). No hay control de distancia.
 *
 * La foto pasa por los mismos controles que la del alta (T02 a T04).
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { error, ipDe, leerFormulario, numeroDe, textoDe } from "@/lib/servidor/http";
import { validarImagenSubida } from "@/lib/servidor/imagen";
import { esFirmaPdf, informarResolucion, type Evidencia } from "@/lib/servidor/resoluciones";
import { EVIDENCIA, IMAGEN } from "@/lib/reglas";

export const dynamic = "force-dynamic";

/** Margen para los campos de texto y los separadores del multipart, además del PDF. */
const MARGEN_FORMULARIO_BYTES = 64 * 1024;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requerirSesion(req, { roles: ["VECINO", "OPERADOR"] });
  if (!s.ok) return s.respuesta;
  const id = /^\d{1,9}$/.test(params.id) ? Number(params.id) : null;
  if (!id) return error(404, "NO_ENCONTRADO", "Incidente no encontrado.");
  const esOperador = s.usuario.rol === "OPERADOR";

  const limite = esOperador ? EVIDENCIA.PDF_MAXIMO_BYTES + MARGEN_FORMULARIO_BYTES : IMAGEN.SOLICITUD_MAXIMA_BYTES;
  const f = await leerFormulario(req, limite);
  if (f === "DEMASIADO_GRANDE") {
    return error(413, "EVIDENCIA_DEMASIADO_GRANDE", "La evidencia es demasiado pesada.");
  }
  if (!f) return error(400, "DATOS_INCOMPLETOS", "Faltan los datos del informe.");

  const foto = f.get("foto");
  const documento = f.get("documento");
  const hayFoto = foto instanceof File;
  const hayDocumento = documento instanceof File;
  if (hayFoto === hayDocumento) {
    return error(400, "EVIDENCIA_OBLIGATORIA", esOperador
      ? "Adjuntá una foto o un PDF con la información oficial."
      : "Para informar la resolución hace falta una foto.");
  }

  try {
    let evidencia: Evidencia;
    if (hayDocumento) {
      if (!esOperador) return error(400, "FOTO_OBLIGATORIA", "Para informar la resolución hace falta una foto.");
      const datos = Buffer.from(await (documento as File).arrayBuffer());
      if (datos.length > EVIDENCIA.PDF_MAXIMO_BYTES) {
        return error(413, "EVIDENCIA_DEMASIADO_GRANDE", "El PDF supera los 2 MB.");
      }
      if (!esFirmaPdf(datos)) return error(400, "DOCUMENTO_INVALIDO", "El archivo no es un PDF válido.");
      evidencia = { tipo: "pdf", datos };
    } else {
      const imagen = await validarImagenSubida(foto as File);
      if (!imagen.ok) return error(imagen.status, imagen.codigo, imagen.mensaje);
      evidencia = {
        tipo: "foto",
        hashOriginal: textoDe(f.get("hashOriginal")).toLowerCase(),
        foto: imagen.datos.foto,
        miniatura: imagen.datos.miniatura,
        exif: { fecha: textoDe(f.get("exifFecha")) || null, lat: numeroDe(f.get("exifLat")), lng: numeroDe(f.get("exifLng")) },
      };
    }

    const r = await informarResolucion(
      { id: s.usuario.id, rol: s.usuario.rol },
      id,
      { lat: numeroDe(f.get("lat")), lng: numeroDe(f.get("lng")), precision: numeroDe(f.get("gpsAccuracy")), evidencia },
      ipDe(req)
    );
    if (!r.ok) return error(r.status, r.codigo, r.mensaje, r.extra);
    return NextResponse.json({ success: true, data: r.datos }, { status: 201 });
  } catch (e) {
    console.error("[SIRU API] Error al informar la resolución:", e);
    return error(500, "ERROR_INTERNO", "No se pudo registrar el informe. Intentá de nuevo.");
  }
}
