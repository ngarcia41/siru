/**
 * SIRU — app/dashboard/page.tsx
 * Página principal del dashboard — vista integrada de mapa + panel analítico.
 *
 * Arquitectura de la SPA:
 *   - Layout dividido: panel lateral (30%) + mapa (70%) en desktop
 *   - En móvil: panel debajo del mapa con scroll, o como sheet togglable
 *   - Carga dinámica del mapa para evitar SSR (Leaflet usa window)
 *   - Estado de incidentes gestionado en este componente (mock de store)
 *
 * Objetivo TFG §4 — Interfaz de Usuario y Experiencia ciudadana.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Incident, GeoPoint } from "@/lib/types";
import { MOCK_INCIDENTS } from "@/lib/db";
import StatsPanel from "@/components/Dashboard/StatsPanel";
import ReportForm from "@/components/ReportForm/ReportForm";
import styles from "./dashboard.module.css";

// Carga dinámica del mapa — evita SSR de Leaflet (requiere window)
const MapView = dynamic(() => import("@/components/Map/MapView"), {
  ssr: false,
  loading: () => (
    <div className={styles.mapLoading}>
      <div className={styles.mapLoadingSpinner} />
      <span>Cargando mapa...</span>
    </div>
  ),
});

export default function DashboardPage() {
  // Estado de datos
  const [incidents, setIncidents] = useState<Incident[]>(MOCK_INCIDENTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Estado de UI
  const [showReportForm, setShowReportForm] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "panel">("map");
  const [showLocationBanner, setShowLocationBanner] = useState(true);

  // Detectar si es mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Intentar obtener ubicación al cargar (no bloqueante)
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setShowLocationBanner(false);
      },
      () => {
        // Sin permiso — continúa sin ubicación del usuario
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  const handleIncidentSelect = useCallback((incident: Incident) => {
    setSelectedId(incident.id);
    if (isMobile) setMobileView("map");
  }, [isMobile]);

  const handleNewReport = useCallback(() => {
    setShowReportForm(true);
  }, []);

  const handleReportSuccess = useCallback((newIncident: Incident) => {
    // Agregar el nuevo incidente al estado local (actualización optimista)
    setIncidents((prev) => [newIncident, ...prev]);
    setSelectedId(newIncident.id);
  }, []);

  return (
    <div className={styles.layout}>

      {/* ── Banner de ubicación ── */}
      {showLocationBanner && !userLocation && (
        <div className={styles.locationBanner}>
          <span>📍</span>
          <span>Activa la ubicación para funciones de geofencing en tiempo real</span>
          <button
            className={styles.bannerClose}
            onClick={() => setShowLocationBanner(false)}
            aria-label="Cerrar banner"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Layout principal ── */}
      <div className={styles.main}>

        {/* ── Panel analítico ── */}
        <aside
          className={`${styles.sidebar} ${
            isMobile && mobileView !== "panel" ? styles.sidebarHidden : ""
          }`}
        >
          <StatsPanel
            incidents={incidents}
            selectedId={selectedId}
            showHeatmap={showHeatmap}
            onSelectIncident={handleIncidentSelect}
            onToggleHeatmap={setShowHeatmap}
            onNewReport={handleNewReport}
          />
        </aside>

        {/* ── Mapa ── */}
        <main
          className={`${styles.mapArea} ${
            isMobile && mobileView !== "map" ? styles.mapHidden : ""
          }`}
        >
          <MapView
            incidents={incidents}
            userLocation={userLocation}
            selectedIncidentId={selectedId}
            onIncidentSelect={handleIncidentSelect}
            showHeatmap={showHeatmap}
          />

          {/* FAB — Botón flotante de reporte */}
          <button
            className={styles.fab}
            onClick={handleNewReport}
            aria-label="Reportar nuevo incidente"
            id="fab-report"
          >
            <span className={styles.fabIcon}>+</span>
            <span className={styles.fabLabel}>Reportar</span>
          </button>

          {/* Leyenda del mapa */}
          <div className={styles.legend}>
            <div className={styles.legendTitle}>Estado de marcadores</div>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: "#ef4444" }} />
              Activo — Alta severidad
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: "#f97316" }} />
              Activo — Media severidad
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: "#eab308" }} />
              Activo — Baja severidad
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: "#94a3b8", opacity: 0.5 }} />
              Sin Verificar (&lt;3 pts)
            </div>
          </div>
        </main>
      </div>

      {/* ── Barra de navegación móvil ── */}
      {isMobile && (
        <nav className={styles.mobileNav}>
          <button
            className={`${styles.mobileNavBtn} ${mobileView === "map" ? styles.mobileNavActive : ""}`}
            onClick={() => setMobileView("map")}
            id="mobile-nav-map"
          >
            <span>🗺</span>
            <span>Mapa</span>
          </button>
          <button
            className={styles.mobileNavFab}
            onClick={handleNewReport}
            id="mobile-nav-report"
            aria-label="Nuevo reporte"
          >
            🚨
          </button>
          <button
            className={`${styles.mobileNavBtn} ${mobileView === "panel" ? styles.mobileNavActive : ""}`}
            onClick={() => setMobileView("panel")}
            id="mobile-nav-panel"
          >
            <span>📊</span>
            <span>Panel</span>
          </button>
        </nav>
      )}

      {/* ── Modal de Reporte ── */}
      <ReportForm
        isOpen={showReportForm}
        onClose={() => setShowReportForm(false)}
        onSuccess={handleReportSuccess}
        initialLocation={userLocation}
      />
    </div>
  );
}
