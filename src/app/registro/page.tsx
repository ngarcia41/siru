/**
 * SIRU — /registro
 * Alta de vecinos con verificación de correo (HU-01).
 */
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/cliente/api";
import { requisitosIncumplidos } from "@/lib/politicaClave";
import RequisitosClave from "@/components/Auth/RequisitosClave";
import styles from "../auth.module.css";

export default function RegistroPage() {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ mensaje: string; enlace?: string } | null>(null);

  const claveValida = requisitosIncumplidos(clave, email).length === 0;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave !== repetir) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    const { res, data } = await api("/api/auth/registro", { method: "POST", body: JSON.stringify({ email, clave }) });
    setEnviando(false);
    if (!res.ok) {
      setError(data?.requisitos ? `${data.message} ${data.requisitos.join(" ")}` : data?.message ?? "No se pudo registrar.");
      return;
    }
    setListo({ mensaje: data.message, enlace: data.enlaceDesarrollo });
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Crear cuenta de vecino</h1>
        <p className={styles.lead}>Con tu cuenta podés reportar incidentes y confirmar los que reportan otros vecinos.</p>

        {listo ? (
          <>
            <div className={styles.ok}>{listo.mensaje}</div>
            {listo.enlace && (
              <div className={styles.info}>
                Modo desarrollo: no se envían correos reales. <a href={listo.enlace}>Abrí este enlace para verificar la cuenta</a>.
              </div>
            )}
            <div className={styles.links}><Link href="/ingresar">Ir a ingresar</Link></div>
          </>
        ) : (
          <>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <form className={styles.form} onSubmit={enviar}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">Correo electrónico</label>
                <input id="email" className={styles.input} type="email" autoComplete="email" required maxLength={120}
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="clave">Contraseña</label>
                <input id="clave" className={styles.input} type="password" autoComplete="new-password" required
                  value={clave} onChange={(e) => setClave(e.target.value)} />
                <RequisitosClave clave={clave} email={email} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="repetir">Repetí la contraseña</label>
                <input id="repetir" className={styles.input} type="password" autoComplete="new-password" required
                  value={repetir} onChange={(e) => setRepetir(e.target.value)} />
              </div>
              <button className={styles.button} type="submit" disabled={enviando || !claveValida}>
                {enviando ? "Registrando…" : "Crear cuenta"}
              </button>
            </form>
            <div className={styles.links}><Link href="/ingresar">Ya tengo cuenta</Link></div>
          </>
        )}
      </div>
    </main>
  );
}
