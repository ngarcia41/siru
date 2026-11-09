/**
 * SIRU — lib/servidor/http.ts
 * Utilidades comunes de las API Routes.
 */
import { NextRequest, NextResponse } from "next/server";

/** Dirección IP del cliente (detrás de un proxy, la primera de X-Forwarded-For). */
export function ipDe(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 45);
  return req.headers.get("x-real-ip")?.slice(0, 45) ?? null;
}

export function error(status: number, codigo: string, mensaje: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error: codigo, message: mensaje, ...extra }, { status });
}

export async function leerJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Lee un cuerpo multipart/form-data sin aceptar más de `maximoBytes`.
 * Si Content-Length ya supera el máximo, rechaza sin leer el cuerpo; si no lo
 * informa (envío por partes), lee hasta el máximo y corta. Devuelve null si el
 * cuerpo no es un formulario válido.
 */
export async function leerFormulario(req: NextRequest, maximoBytes: number): Promise<FormData | null | "DEMASIADO_GRANDE"> {
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maximoBytes) return "DEMASIADO_GRANDE";
  if (!req.body) return null;

  const partes: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  const lector = req.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximoBytes) {
      await lector.cancel();
      return "DEMASIADO_GRANDE";
    }
    partes.push(value);
  }
  try {
    const cuerpo = new Blob(partes);
    return await new Response(cuerpo, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  }
}

/** Número de un campo de formulario, o null si falta o no es un número finito. */
export function numeroDe(v: FormDataEntryValue | null | undefined): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Texto de un campo de formulario ("" si falta o es un archivo). */
export function textoDe(v: FormDataEntryValue | null | undefined): string {
  return typeof v === "string" ? v : "";
}

export function esPunto(v: unknown): v is { lat: number; lng: number } {
  const p = v as { lat?: unknown; lng?: unknown };
  return !!p && typeof p.lat === "number" && typeof p.lng === "number"
    && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
