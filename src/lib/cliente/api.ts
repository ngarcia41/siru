/**
 * SIRU — lib/cliente/api.ts
 * Llamadas a la API desde el navegador. Si la sesión venció, lleva al
 * ingreso; si falta cambiar la contraseña, lleva a esa pantalla. Cada
 * respuesta correcta avisa a la interfaz que hubo actividad, para reiniciar
 * el aviso de expiración por inactividad.
 */
export const EVENTO_ACTIVIDAD = "siru:actividad";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api(url: string, init?: RequestInit): Promise<{ res: Response; data: any }> {
  // Con FormData (alta con foto) el navegador arma el Content-Type multipart con su separador.
  const esFormulario = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { ...(esFormulario ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (typeof window !== "undefined") {
    if (res.status === 401 && !url.startsWith("/api/auth/ingresar")) {
      window.location.href = "/ingresar?expirada=1";
    } else if (res.status === 403 && data?.error === "CAMBIO_CLAVE_REQUERIDO") {
      window.location.href = "/cambiar-clave";
    } else if (res.ok) {
      window.dispatchEvent(new Event(EVENTO_ACTIVIDAD));
    }
  }
  return { res, data };
}
