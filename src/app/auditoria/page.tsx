/**
 * SIRU — /auditoria
 * Consulta del registro de auditoría para el operador (HU-07), con filtros
 * por incidente y por usuario, en orden cronológico. Solo lectura.
 */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/cliente/api";
import type { SesionCliente } from "@/lib/types";
import styles from "../auth.module.css";

interface Registro {
  auditoria_id: string;
  fecha_hora: string;
  accion: string;
  usuario_id: number | null;
  email: string | null;
  rol: string | null;
  incidente_id: number | null;
  detalle: Record<string, unknown>;
  direccion_ip: string | null;
}

const fecha = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium" });

export default function AuditoriaPage() {
  const [usuario, setUsuario] = useState<SesionCliente | null>(null);
  const [registros, setRegistros] = useState<Registro[] | null>(null);
  const [incidente, setIncidente] = useState("");
  const [usuarioFiltro, setUsuarioFiltro] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (inc: string, usr: string) => {
    setError(null);
    const q = new URLSearchParams();
    if (inc) q.set("incidente", inc);
    if (usr) q.set("usuario", usr);
    const { res, data } = await api(`/api/auditoria?${q.toString()}`);
    if (!res.ok) {
      setError(data?.message ?? "No se pudo cargar la auditoría.");
      setRegistros([]);
      return;
    }
    setRegistros(data.data);
  }, []);

  useEffect(() => {
    api("/api/auth/sesion").then(({ res, data }) => {
      if (!res.ok) return;
      setUsuario(data.usuario);
      if (data.usuario.rol === "OPERADOR") cargar("", "");
    });
  }, [cargar]);

  function filtrar(e: FormEvent) {
    e.preventDefault();
    cargar(incidente.trim(), usuarioFiltro.trim());
  }

  return (
    <main className={styles.page}>
      <div className={`${styles.card} ${styles.wide}`}>
        <div className={styles.header}>
          <h1 className={styles.title}>Registro de auditoría</h1>
          <Link href="/dashboard" className={styles.buttonGhost}>Volver al mapa</Link>
        </div>
        {usuario && usuario.rol !== "OPERADOR" ? (
          <div className={styles.error}>Solo los operadores pueden consultar la auditoría.</div>
        ) : (
          <>
            <p className={styles.lead}>
              Cada acción crítica queda registrada con el usuario, el incidente, el detalle, la dirección IP y la fecha y hora.
              Los registros no pueden modificarse ni eliminarse.
            </p>
            <form className={styles.filters} onSubmit={filtrar}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="f-incidente">N.° de incidente</label>
                <input id="f-incidente" className={styles.input} inputMode="numeric" value={incidente}
                  onChange={(e) => setIncidente(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="f-usuario">N.° de usuario</label>
                <input id="f-usuario" className={styles.input} inputMode="numeric" value={usuarioFiltro}
                  onChange={(e) => setUsuarioFiltro(e.target.value)} />
              </div>
              <button className={styles.button} type="submit">Filtrar</button>
            </form>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fecha y hora</th><th>Acción</th><th>Usuario</th><th>Incidente</th><th>Detalle</th><th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {registros === null && <tr><td colSpan={6}>Cargando…</td></tr>}
                  {registros?.length === 0 && <tr><td colSpan={6}>No hay registros para ese filtro.</td></tr>}
                  {registros?.map((r) => (
                    <tr key={r.auditoria_id}>
                      <td className={styles.num}>{fecha.format(new Date(r.fecha_hora))}</td>
                      <td>{r.accion}</td>
                      <td>{r.email ? `${r.email} (${r.usuario_id})` : "—"}</td>
                      <td className={styles.num}>{r.incidente_id ?? "—"}</td>
                      <td className={`${styles.mono} ${styles.detalle}`}>
                        {Object.keys(r.detalle ?? {}).length
                          ? Object.entries(r.detalle).map(([k, v]) => (
                              <div key={k}>{k}: {typeof v === "string" ? v : JSON.stringify(v)}</div>
                            ))
                          : "—"}
                      </td>
                      <td className={`${styles.mono} ${styles.num}`}>{r.direccion_ip ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
