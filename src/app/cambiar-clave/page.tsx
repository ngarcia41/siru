/**
 * SIRU — /cambiar-clave
 * Cambio de contraseña (HU-08). Obligatorio en el primer ingreso de un
 * operador, tras un blanqueo o cuando la clave venció.
 */
"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/cliente/api";
import { requisitosIncumplidos } from "@/lib/politicaClave";
import RequisitosClave from "@/components/Auth/RequisitosClave";
import type { SesionCliente } from "@/lib/types";
import styles from "../auth.module.css";

export default function CambiarClavePage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<SesionCliente | null>(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/auth/sesion").then(({ res, data }) => { if (res.ok) setUsuario(data.usuario); });
  }, []);

  const email = usuario?.email ?? "";
  const valida = requisitosIncumplidos(nueva, email).length === 0;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva !== repetir) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    setEnviando(true);
    const { res, data } = await api("/api/auth/cambiar-clave", { method: "POST", body: JSON.stringify({ actual, nueva }) });
    setEnviando(false);
    if (!res.ok) {
      setError(data?.requisitos ? `${data.message} ${data.requisitos.join(" ")}` : data?.message ?? "No se pudo cambiar la contraseña.");
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Cambiar contraseña</h1>
        {usuario?.debeCambiarClave && (
          <div className={styles.info}>Tenés que cambiar tu contraseña antes de continuar.</div>
        )}
        {error && <div className={styles.error} role="alert">{error}</div>}
        <form className={styles.form} onSubmit={enviar}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="actual">Contraseña actual</label>
            <input id="actual" className={styles.input} type="password" autoComplete="current-password" required
              value={actual} onChange={(e) => setActual(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="nueva">Contraseña nueva</label>
            <input id="nueva" className={styles.input} type="password" autoComplete="new-password" required
              value={nueva} onChange={(e) => setNueva(e.target.value)} />
            <RequisitosClave clave={nueva} email={email} />
            <span className={styles.lead}>No puede coincidir con ninguna de tus últimas 3 contraseñas.</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="repetir">Repetí la contraseña nueva</label>
            <input id="repetir" className={styles.input} type="password" autoComplete="new-password" required
              value={repetir} onChange={(e) => setRepetir(e.target.value)} />
          </div>
          <button className={styles.button} type="submit" disabled={enviando || !valida}>
            {enviando ? "Guardando…" : "Guardar contraseña"}
          </button>
        </form>
        {!usuario?.debeCambiarClave && <div className={styles.links}><Link href="/dashboard">Volver al mapa</Link></div>}
      </div>
    </main>
  );
}
