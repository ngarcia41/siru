/**
 * SIRU — GET /api/auditoria?incidente=&usuario= (HU-07), solo operador.
 * Devuelve los registros en orden cronológico (los 300 más recientes que
 * cumplan el filtro). No existe ninguna ruta para modificarlos o borrarlos,
 * y la base de datos rechaza esas operaciones con un disparador.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/servidor/db";
import { requerirSesion } from "@/lib/servidor/sesion";
import { error } from "@/lib/servidor/http";

export const dynamic = "force-dynamic";

function entero(v: string | null): number | null | undefined {
  if (v === null || v === "") return null;
  return /^\d{1,9}$/.test(v) ? Number(v) : undefined;
}

export async function GET(req: NextRequest) {
  const s = await requerirSesion(req, { roles: ["OPERADOR"] });
  if (!s.ok) return s.respuesta;

  const incidente = entero(req.nextUrl.searchParams.get("incidente"));
  const usuario = entero(req.nextUrl.searchParams.get("usuario"));
  if (incidente === undefined || usuario === undefined) return error(400, "FILTRO_INVALIDO", "Los filtros deben ser números.");

  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT a.auditoria_id, a.fecha_hora, a.accion, a.usuario_id, u.email, u.rol,
              a.incidente_id, a.detalle, a.direccion_ip
         FROM auditoria a LEFT JOIN usuario u ON u.usuario_id = a.usuario_id
        WHERE ($1::int IS NULL OR a.incidente_id = $1)
          AND ($2::int IS NULL OR a.usuario_id = $2)
        ORDER BY a.fecha_hora DESC, a.auditoria_id DESC
        LIMIT 300) t
      ORDER BY t.fecha_hora ASC, t.auditoria_id ASC`,
    [incidente, usuario]
  );
  return NextResponse.json({ success: true, data: rows });
}
