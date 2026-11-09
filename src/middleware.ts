/**
 * SIRU — middleware.ts
 * Primera barrera para las páginas privadas: sin un token de sesión con firma
 * válida, redirige a /ingresar. La validación completa (inactividad,
 * revocación, perfil) la hace cada API Route contra la tabla SESION.
 */
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_SESION = "siru_sesion";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE_SESION)?.value;
  const secreto = process.env.SESION_SECRETO ?? "";
  if (token && secreto.length >= 32) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secreto), { algorithms: ["HS256"] });
      return NextResponse.next();
    } catch {
      // token inválido o vencido: sigue a la redirección
    }
  }
  const destino = new URL("/ingresar", req.url);
  destino.searchParams.set("expirada", token ? "1" : "0");
  return NextResponse.redirect(destino);
}

export const config = {
  matcher: ["/dashboard/:path*", "/cambiar-clave", "/auditoria"],
};
