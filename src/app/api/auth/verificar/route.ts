/**
 * SIRU — GET /api/auth/verificar?token=... (HU-01)
 * Activa la cuenta si el enlace es válido, no venció y no se usó antes.
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/servidor/db";
import { auditar } from "@/lib/servidor/auditoria";
import { ipDe } from "@/lib/servidor/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const destino = new URL("/ingresar", req.nextUrl.origin);
  if (!/^[0-9a-f]{64}$/.test(token)) {
    destino.searchParams.set("verificado", "0");
    return NextResponse.redirect(destino);
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await pool.query(
    `UPDATE usuario
        SET estado_cuenta = 'ACTIVA', token_verificacion_hash = NULL, token_verificacion_vence = NULL
      WHERE token_verificacion_hash = $1 AND token_verificacion_vence > now() AND estado_cuenta = 'PENDIENTE'
      RETURNING usuario_id`,
    [tokenHash]
  );
  if (rows[0]) {
    await auditar("VERIFICA_CORREO", { usuarioId: rows[0].usuario_id, ip: ipDe(req) });
    destino.searchParams.set("verificado", "1");
  } else {
    destino.searchParams.set("verificado", "0");
  }
  return NextResponse.redirect(destino);
}
