/**
 * SIRU — app/dashboard/page.tsx
 * Vista principal: mapa + panel analítico.
 *
 * Desde el Sprint 2:
 *   - Exige sesión (middleware + validación de la API).
 *   - Los incidentes se leen de PostgreSQL con PostGIS (GET /api/incidents).
 *   - El vecino reporta y confirma; el operador registra el cierre.
 *   - Aviso 2 minutos antes de que la sesión venza por inactividad.
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Incident, GeoPoint, SesionCliente } from "@/lib/types";
import { api, EVENTO_ACTIVIDAD } from "@/lib/cliente/api";
import { AVISO_EXPIRACION_MINUTOS } from "@/lib/reglas";
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
  const router = useRouter();

  // Sesión y datos
  const [usuario, setUsuario] = useState<SesionCliente | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [cargaError, setCargaError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Estado de UI
  const [showReportForm, setShowReportForm] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "panel">("map");
  const [showLocationBanner, setShowLocationBanner] = useState(true);
  const [avisoSesion, setAvisoSesion] = useState(false);
  const ultimaActividad = useRef(Date.now());

  const puedeReportar = usuario?.rol === "VECINO";

  // Detectar si es mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Sesión e incidentes
  useEffect(() => {
    (async () => {
      const s = await api("/api/auth/sesion");
      if (!s.res.ok) return; // api() ya redirige al ingreso si la sesión venció
      if (s.data.usuario.debeCambiarClave) {
        router.replace("/cambiar-clave");
        return;
      }
      setUsuario(s.data.usuario);
      const r = await api("/api/incidents");
      if (r.res.ok) setIncidents(r.data.data);
      else setCargaError(r.data?.message ?? "No se pudieron cargar los incidentes.");
    })();
  }, [router]);

  // Aviso de expiración por inactividad (30 min vecino, 15 min operador)
  useEffect(() => {
    if (!usuario) return;
    ultimaActividad.current = Date.now();
    const marcar = () => {
      ultimaActividad.current = Date.now();
      setAvisoSesion(false);
    };
    window.addEventListener(EVENTO_ACTIVIDAD, marcar);
    const t = setInterval(() => {
      const minutos = (Date.now() - ultimaActividad.current) / 60000;
      if (minutos >= usuario.inactividadMinutos) window.location.href = "/ingresar?expirada=1";
      else if (minutos >= usuario.inactividadMinutos - AVISO_EXPIRACION_MINUTOS) setAvisoSesion(true);
    }, 15000);
    return () => {
      window.removeEventListener(EVENTO_ACTIVIDAD, marcar);
      clearInterval(t);
    };
  }, [usuario]);

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
    if (puedeReportar) setShowReportForm(true);
  }, [puedeReportar]);

  /** Agrega un incidente nuevo o actualiza uno existente (por ejemplo, al confirmarlo). */
  const upsertIncident = useCallback((incident: Incident) => {
    setIncidents((prev) => {
      const i = prev.findIndex((x) => x.id === incident.id);
      if (i === -1) return [incident, ...prev];
      const copia = [...prev];
      copia[i] = incident;
      return copia;
    });
    setSelectedId(incident.id);
  }, []);

  /** El operador registra el cierre de un incidente activo. */
  const handleResolve = useCallback(async (incident: Incident) => {
    if (!window.confirm(`¿Registrar como resuelto el incidente "${incident.category}" N.° ${incident.id}?`)) return;
    const { res, data } = await api(`/api/incidents/${incident.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "resolve", observacion: "Cierre validado por el operador." }),
    });
    if (res.ok) upsertIncident(data.data);
    else window.alert(data?.message ?? "No se pudo registrar el cierre.");
  }, [upsertIncident]);

  const seguirConectado = useCallback(() => {
    api("/api/auth/sesion");
  }, []);

  const salir = useCallback(async () => {
    await api("/api/auth/salir", { method: "POST" });
    window.location.href = "/ingresar";
  }, []);

  return (
    <div className={styles.layout}>

      {/* ── Aviso de expiración de sesión ── */}
      {avisoSesion && (
        <div className={styles.locationBanner} role="alert">
          <span>⏳</span>
          <span>Tu sesión vence en {AVISO_EXPIRACION_MINUTOS} minutos por inactividad.</span>
          <button className={styles.bannerAction} onClick={seguirConectado}>Seguir conectado</button>
        </div>
      )}

      {/* ── Error de carga ── */}
      {cargaError && (
        <div className={styles.locationBanner} role="alert">
          <span>⚠</span>
          <span>{cargaError}</span>
        </div>
      )}

      {/* ── Banner de ubicación ── */}
      {!avisoSesion && !cargaError && showLocationBanner && !userLocation && (
        <div className={styles.locationBanner}>
          <span>📍</span>
          <span>Activá la ubicación para reportar y confirmar incidentes cercanos</span>
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
            usuario={usuario}
            onLogout={salir}
            onResolve={usuario?.rol === "OPERADOR" ? handleResolve : undefined}
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

          {/* FAB — Botón flotante de reporte (solo vecinos) */}
          {puedeReportar && (
            <button
              className={styles.fab}
              onClick={handleNewReport}
              aria-label="Reportar nuevo incidente"
              id="fab-report"
            >
              <span className={styles.fabIcon}>+</span>
              <span className={styles.fabLabel}>Reportar</span>
            </button>
          )}

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
              Sin verificar (&lt;3 pts)
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: "#6b7280" }} />
              Resuelto
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
          {puedeReportar && (
            <button
              className={styles.mobileNavFab}
              onClick={handleNewReport}
              id="mobile-nav-report"
              aria-label="Nuevo reporte"
            >
              🚨
            </button>
          )}
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
      {puedeReportar && (
        <ReportForm
          isOpen={showReportForm}
          onClose={() => setShowReportForm(false)}
          onSuccess={upsertIncident}
        />
      )}
    </div>
  );
}
