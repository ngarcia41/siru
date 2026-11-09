/**
 * SIRU — app/api/incidents/route.ts
 *
 *   GET  /api/incidents  → incidentes no desestimados (vecino u operador)
 *   POST /api/incidents  → alta de incidente (solo vecino), HU-02
 *
 * El alta llega como multipart/form-data con la foto ya reducida en el teléfono
 * (D-19). El servidor valida el tamaño de la solicitud (1,5 MB), el tipo y las
 * medidas de la foto, la precisión del GPS (≤ 25 m), el límite de 5 reportes
 * por día, la huella SHA-256 del original y la existencia de un incidente
 * abierto de la misma categoría a menos de 50 m (HTTP 409).
 *
 * Campos: foto (archivo JPEG), hashOriginal, lat, lng, gpsAccuracy, category,
 * severity, description y, si existen, exifFecha, exifLat, exifLng y
 * posicionTomadaEn. Con los datos EXIF se aplican las reglas del documento
 * (fecha de 24 h como máximo, coordenadas a menos de 50 m: 422 FOTO_ANTIGUA o
 * FOTO_LEJANA); la hora de la posición se usará en el Sprint 4 (B-04).
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { crearIncidente, listarIncidentes } from "@/lib/servidor/incidentes";
import { error, esPunto, ipDe, leerFormulario, numeroDe, textoDe } from "@/lib/servidor/http";
import { validarImagenSubida } from "@/lib/servidor/imagen";
import { IMAGEN } from "@/lib/reglas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await requerirSesion(req);
  if (!s.ok) return s.respuesta;
  const data = await listarIncidentes();
  return NextResponse.json({ success: true, data, total: data.length });
}

export async function POST(req: NextRequest) {
  const s = await requerirSesion(req, { roles: ["VECINO"] });
  if (!s.ok) return s.respuesta;

  // D-19: el alta llega como multipart/form-data con la foto reducida en el teléfono.
  const f = await leerFormulario(req, IMAGEN.SOLICITUD_MAXIMA_BYTES);
  if (f === "DEMASIADO_GRANDE") {
    return error(413, "IMAGEN_DEMASIADO_GRANDE", "La foto es demasiado pesada. Sacala de nuevo desde el formulario de SIRU.");
  }
  const foto = f?.get("foto");
  const lat = numeroDe(f?.get("lat"));
  const lng = numeroDe(f?.get("lng"));
  const categoria = textoDe(f?.get("category"));
  const severidad = textoDe(f?.get("severity"));
  const descripcion = textoDe(f?.get("description"));
  const hashOriginal = textoDe(f?.get("hashOriginal")).toLowerCase();
  if (!f || !(foto instanceof File) || !esPunto({ lat, lng }) || !categoria || !severidad || !descripcion || !hashOriginal) {
    return error(400, "DATOS_INCOMPLETOS", "Faltan datos obligatorios: ubicación, categoría, severidad, descripción y foto.");
  }

  try {
    const imagen = await validarImagenSubida(foto);
    if (!imagen.ok) return error(imagen.status, imagen.codigo, imagen.mensaje);

    const r = await crearIncidente(s.usuario.id, {
      lat: lat as number,
      lng: lng as number,
      precision: numeroDe(f.get("gpsAccuracy")),
      categoria,
      severidad,
      descripcion,
      hashFoto: hashOriginal,
      exif: {
        fecha: textoDe(f.get("exifFecha")) || null,
        lat: numeroDe(f.get("exifLat")),
        lng: numeroDe(f.get("exifLng")),
      },
    }, ipDe(req));
    if (!r.ok) return error(r.status, r.codigo, r.mensaje, r.extra);
    return NextResponse.json({ success: true, data: r.datos }, { status: 201 });
  } catch (e) {
    console.error("[SIRU API] Error al crear el incidente:", e);
    return error(500, "ERROR_INTERNO", "No se pudo registrar el incidente. Intentá de nuevo.");
  }
}
