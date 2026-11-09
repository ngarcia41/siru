/**
 * SIRU — app/page.tsx
 * Página de inicio — Landing y acceso al dashboard.
 *
 * Presenta el sistema y lleva al ingreso. El mapa requiere iniciar sesión
 * (vecino u operador) desde el Sprint 2.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./page.module.css";

export default function LandingPage() {
  const router = useRouter();
  const [entering, setEntering] = useState(false);

  const handleEnter = () => {
    setEntering(true);
    setTimeout(() => router.push("/ingresar"), 300);
  };

  return (
    <div className={styles.landing}>
      {/* Fondo animado */}
      <div className={styles.bgOrb1} />
      <div className={styles.bgOrb2} />
      <div className={styles.bgGrid} />

      <div className={styles.content}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoIcon}>🗺</span>
          <div>
            <h1 className={styles.logoText}>SIRU</h1>
            <span className={styles.logoSub}>Sistema Interactivo de Reportes Urbanos</span>
          </div>
        </div>

        {/* Tagline */}
        <h2 className={styles.tagline}>
          Tu barrio, tu voz,<br />
          <span className={styles.taglineAccent}>tu ciudad mejor</span>
        </h2>

        <p className={styles.description}>
          Plataforma ciudadana de participación urbana con verificación
          espacial y sistema colectivo de puntos de confianza.
          <br />
          <strong>Ramos Mejía, Buenos Aires.</strong>
        </p>

        {/* Features */}
        <div className={styles.features}>
          <FeatureChip icon="📍" label="Geolocalización GPS" />
          <FeatureChip icon="🛡" label="Validación a 50 m" />
          <FeatureChip icon="★" label="Puntos de Confianza" />
          <FeatureChip icon="🔥" label="Mapa de calor" />
        </div>

        {/* CTA */}
        <button
          className={`${styles.cta} ${entering ? styles.ctaEntering : ""}`}
          onClick={handleEnter}
          disabled={entering}
          id="btn-enter-app"
        >
          {entering ? (
            <><span className={styles.spinner} />Abriendo…</>
          ) : (
            <>Ingresar →</>
          )}
        </button>

        {/* Badge TFG */}
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Trabajo Final de Grado · 2026
        </div>
      </div>

      {/* Preview del mapa (decorativo) */}
      <div className={styles.mapPreview}>
        <div className={styles.mapPreviewDot} style={{ top: "30%", left: "45%" }} data-color="red" />
        <div className={styles.mapPreviewDot} style={{ top: "50%", left: "60%" }} data-color="orange" />
        <div className={styles.mapPreviewDot} style={{ top: "65%", left: "38%" }} data-color="yellow" />
        <div className={styles.mapPreviewDot} style={{ top: "40%", left: "70%" }} data-color="gray" />
        <div className={styles.mapPreviewDot} style={{ top: "55%", left: "52%" }} data-color="red" />
        <div className={styles.mapPreviewLines} />
      </div>
    </div>
  );
}

function FeatureChip({ icon, label }: { icon: string; label: string }) {
  return (
    <div className={styles.featureChip}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}
