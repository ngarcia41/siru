/**
 * SIRU — app/api/imagenes/[tipo]/[clave]/route.ts
 *
 *   GET /api/imagenes/miniaturas/<hash>.jpg  → miniatura, para cualquier usuario autenticado
 *   GET /api/imagenes/fotos/<hash>.jpg       → foto privada, solo para el operador
 *
 * Coincide con el documento: "se publica una miniatura" y la imagen completa
 * queda privada (la ve el operador para validar). Las imágenes no están en
 * public/: solo se llega a ellas por esta ruta, que exige sesión (D-14, B-03).
 */
import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/servidor/sesion";
import { almacenamiento, esClaveValida } from "@/lib/servidor/almacenamiento";
import { error } from "@/lib/servidor/http";
import { IMAGEN } from "@/lib/reglas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { tipo: string; clave: string } }) {
  const s = await requerirSesion(req);
  if (!s.ok) return s.respuesta;

  // La clave se valida con una expresión estricta antes de tocar el disco (evita el recorrido de rutas).
  const clave = `${params.tipo}/${params.clave}`;
  if (!esClaveValida(clave)) return error(400, "CLAVE_INVALIDA", "La imagen pedida no es válida.");

  if (params.tipo === "fotos" && s.usuario.rol !== "OPERADOR") {
    return error(403, "SIN_PERMISO", "La foto completa solo la puede ver un operador.");
  }

  const datos = await almacenamiento.leer(clave);
  if (!datos) return error(404, "IMAGEN_INEXISTENTE", "La imagen no existe.");

  return new NextResponse(new Uint8Array(datos), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(datos.length),
      // La clave es la huella: el contenido nunca cambia. "private": solo la caché del navegador, no la de un proxy.
      "Cache-Control": `private, max-age=${IMAGEN.CACHE_SEGUNDOS}, immutable`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
