/**
 * SIRU — /ingresar
 * Inicio de sesión de vecinos y operadores (HU-01, HU-08).
 */
"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/cliente/api";
import styles from "../auth.module.css";

function Avisos() {
  const p = useSearchParams();
  if (p.get("verificado") === "1") return <div className={styles.ok}>Tu correo quedó verificado. Ya podés ingresar.</div>;
  if (p.get("verificado") === "0") return <div className={styles.error}>El enlace de verificación no es válido o venció. Registrate de nuevo.</div>;
  if (p.get("expirada") === "1") return <div className={styles.info}>Tu sesión venció. Volvé a ingresar.</div>;
  return null;
}

export default function IngresarPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMensaje(null);
    const { res, data } = await api("/api/auth/ingresar", { method: "POST", body: JSON.stringify({ email, clave }) });
    setEnviando(false);
    if (!res.ok) {
      setMensaje(data?.message ?? "No se pudo ingresar.");
      return;
    }
    router.replace(data.usuario.debeCambiarClave ? "/cambiar-clave" : "/dashboard");
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>S</div>
          <div>
            <div className={styles.brandName}>SIRU</div>
            <div className={styles.brandSub}>Sistema Interactivo de Reportes Urbanos</div>
          </div>
        </div>
        <h1 className={styles.title}>Ingresar</h1>
        <Suspense fallback={null}><Avisos /></Suspense>
        {mensaje && <div className={styles.error} role="alert">{mensaje}</div>}
        <form className={styles.form} onSubmit={enviar}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Correo electrónico</label>
            <input id="email" className={styles.input} type="email" autoComplete="username" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="clave">Contraseña</label>
            <input id="clave" className={styles.input} type="password" autoComplete="current-password" required
              value={clave} onChange={(e) => setClave(e.target.value)} />
          </div>
          <button className={styles.button} type="submit" disabled={enviando}>
            {enviando ? "Verificando…" : "Ingresar"}
          </button>
        </form>
        <div className={styles.links}>
          <Link href="/registro">Crear una cuenta de vecino</Link>
          <Link href="/">Volver al inicio</Link>
        </div>
      </div>
    </main>
  );
}
