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

export function esPunto(v: unknown): v is { lat: number; lng: number } {
  const p = v as { lat?: unknown; lng?: unknown };
  return !!p && typeof p.lat === "number" && typeof p.lng === "number"
    && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
