/**
 * SIRU — components/Dashboard/StatsPanel.tsx
 * Panel analítico de resumen de zonas críticas.
 *
 * Muestra:
 *   - Contadores por estado (Sin Verificar / Activos / Resueltos)
 *   - Distribución por categoría
 *   - Lista de incidentes con filtros
 *   - Toggle de heatmap
 *
 * Objetivo TFG §7 — Módulo de Analítica para organizaciones vecinales.
 */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BandaPrioridad, Incident, IncidentStatus, SesionCliente } from "@/lib/types";
import styles from "./StatsPanel.module.css";

interface StatsPanelProps {
  incidents: Incident[];
  selectedId: string | null;
  showHeatmap: boolean;
  onSelectIncident: (incident: Incident) => void;
  onToggleHeatmap: (v: boolean) => void;
  onNewReport: () => void;
  usuario: SesionCliente | null;
  onLogout: () => void;
  /** Solo para operadores: registra el cierre de un incidente activo o en revisión. */
}

const CATEGORY_ICONS: Record<string, string> = {
  Bache: "🕳",
  Luminaria: "💡",
  Anegamiento: "💧",
  "Basura acumulada": "🗑",
  Otro: "⚠",
};

/**
 * HU-04 criterio 2: primero los activos, por índice de prioridad de mayor a
 * menor; después los demás, del más nuevo al más viejo. Es el mismo orden que
 * devuelve la API; se repite acá porque la lista también cambia en la pantalla
 * (por ejemplo, al sumar un reporte nuevo).
 */
function ordenPorPrioridad(a: Incident, b: Incident): number {
  const activoA = a.status === "active" ? 1 : 0;
  const activoB = b.status === "active" ? 1 : 0;
  if (activoA !== activoB) return activoB - activoA;
  const ipA = a.indicePrioridad ?? -1;
  const ipB = b.indicePrioridad ?? -1;
  if (ipA !== ipB) return ipB - ipA;
  return b.createdAt.localeCompare(a.createdAt);
}

/** Banda del índice (la calcula el servidor con los umbrales del documento). */
const BANDA: Record<BandaPrioridad, { etiqueta: string; color: string }> = {
  alta: { etiqueta: "Prioridad alta", color: "#ef4444" },
  media: { etiqueta: "Prioridad media", color: "#f97316" },
  baja: { etiqueta: "Prioridad baja", color: "#eab308" },
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  unverified: "Sin verificar",
  active: "Activo",
  review: "En revisión",
  resolved: "Resuelto",
  dismissed: "Desestimado",
};

export default function StatsPanel({
  incidents,
  selectedId,
  showHeatmap,
  onSelectIncident,
  onToggleHeatmap,
  onNewReport,
  usuario,
  onLogout,
}: StatsPanelProps) {
  const [filter, setFilter] = useState<IncidentStatus | "all">("all");
  const [activeTab, setActiveTab] = useState<"list" | "analytics">("list");

  // Estadísticas calculadas
  const stats = useMemo(() => {
    const total = incidents.length;
    const active = incidents.filter((i) => i.status === "active").length;
    const unverified = incidents.filter((i) => i.status === "unverified").length;
    const resolved = incidents.filter((i) => i.status === "resolved").length;

    // Por categoría
    const byCategory = incidents.reduce<Record<string, number>>((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {});

    // Por severidad (solo activos)
    const activeIncidents = incidents.filter((i) => i.status === "active");
    const highSeverity = activeIncidents.filter((i) => i.severity === "high").length;
    const medSeverity = activeIncidents.filter((i) => i.severity === "medium").length;
    const lowSeverity = activeIncidents.filter((i) => i.severity === "low").length;

    return { total, active, unverified, resolved, byCategory, highSeverity, medSeverity, lowSeverity };
  }, [incidents]);

  // Lista filtrada
  const filtered = useMemo(
    () => (filter === "all" ? [...incidents] : incidents.filter((i) => i.status === filter)).sort(ordenPorPrioridad),
    [incidents, filter]
  );

  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>🗺</span>
          <div>
            <h1 className={styles.brandTitle}>SIRU</h1>
            <span className={styles.brandSub}>Ramos Mejía</span>
          </div>
        </div>
        {usuario?.rol === "VECINO" && (
          <button className={styles.reportBtn} onClick={onNewReport} id="btn-new-report-panel">
            <span>+</span> Reportar
          </button>
        )}
      </div>

      {/* ── Usuario de la sesión ── */}
      {usuario && (
        <div className={styles.userBar}>
          <span className={styles.userEmail} title={usuario.email}>{usuario.email}</span>
          <span className={styles.userRole}>{usuario.rol === "OPERADOR" ? "Operador" : "Vecino"}</span>
          <div className={styles.userLinks}>
            {usuario.rol === "OPERADOR" && <Link href="/auditoria">Auditoría</Link>}
            <Link href="/cambiar-clave">Cambiar clave</Link>
            <button type="button" onClick={onLogout}>Salir</button>
          </div>
        </div>
      )}

      {/* ── Stats Cards ── */}
      <div className={styles.statsGrid}>
        <StatCard
          value={stats.active}
          label="Activos"
          color="#22c55e"
          icon="🟢"
          onClick={() => setFilter("active")}
          active={filter === "active"}
        />
        <StatCard
          value={stats.unverified}
          label="Sin verificar"
          color="#94a3b8"
          icon="⚪"
          onClick={() => setFilter("unverified")}
          active={filter === "unverified"}
        />
        <StatCard
          value={stats.resolved}
          label="Resueltos"
          color="#6b7280"
          icon="✅"
          onClick={() => setFilter("resolved")}
          active={filter === "resolved"}
        />
      </div>

      {/* ── Alerta de severidad alta ── */}
      {stats.highSeverity > 0 && (
        <div className={styles.alertBanner}>
          <span>🚨</span>
          <span>
            <strong>{stats.highSeverity} incidente{stats.highSeverity > 1 ? "s" : ""}</strong> de severidad alta activos
          </span>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "list" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("list")}
          id="tab-list"
        >
          📋 Lista
        </button>
        <button
          className={`${styles.tab} ${activeTab === "analytics" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("analytics")}
          id="tab-analytics"
        >
          📊 Analítica
        </button>
      </div>

      {/* ── Tab: Lista de incidentes ── */}
      {activeTab === "list" && (
        <>
          <div className={styles.filterRow}>
            <button
              className={`${styles.filterChip} ${filter === "all" ? styles.filterActive : ""}`}
              onClick={() => setFilter("all")}
            >
              Todos ({stats.total})
            </button>
            <button
              className={`${styles.filterChip} ${filter === "active" ? styles.filterActive : ""}`}
              onClick={() => setFilter("active")}
            >
              Activos
            </button>
            <button
              className={`${styles.filterChip} ${filter === "unverified" ? styles.filterActive : ""}`}
              onClick={() => setFilter("unverified")}
            >
              Sin verificar
            </button>
          </div>

          <div className={styles.list}>
            {filtered.length === 0 ? (
              <div className={styles.empty}>No hay incidentes en esta categoría.</div>
            ) : (
              filtered.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  isSelected={incident.id === selectedId}
                  onClick={() => onSelectIncident(incident)}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* ── Tab: Analítica ── */}
      {activeTab === "analytics" && (
        <div className={styles.analytics}>
          {/* Toggle Heatmap */}
          <div className={styles.heatmapToggle}>
            <div>
              <div className={styles.toggleLabel}>🔥 Mapa de Calor</div>
              <div className={styles.toggleDesc}>Visualiza zonas críticas de mayor concentración</div>
            </div>
            <button
              className={`${styles.toggle} ${showHeatmap ? styles.toggleOn : ""}`}
              onClick={() => onToggleHeatmap(!showHeatmap)}
              id="btn-toggle-heatmap"
              aria-pressed={showHeatmap}
            >
              <span className={styles.toggleThumb} />
            </button>
          </div>

          {/* Distribución por categoría */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Incidentes por Categoría</h3>
            {Object.entries(stats.byCategory)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => (
                <CategoryBar
                  key={cat}
                  category={cat}
                  count={count}
                  total={stats.total}
                  icon={CATEGORY_ICONS[cat] || "⚠"}
                />
              ))}
          </div>

          {/* Distribución por severidad */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Distribución por Severidad</h3>
            <div className={styles.severityBars}>
              <SeverityBar label="Alta" count={stats.highSeverity} color="#ef4444" total={stats.active} />
              <SeverityBar label="Media" count={stats.medSeverity} color="#f97316" total={stats.active} />
              <SeverityBar label="Baja" count={stats.lowSeverity} color="#eab308" total={stats.active} />
            </div>
          </div>

          {/* Puntos de confianza totales */}
          <div className={styles.trustSummary}>
            <div className={styles.trustNumber}>
              {incidents.reduce((acc, i) => acc + i.trustPoints, 0)}
            </div>
            <div className={styles.trustLabel}>Puntos de Confianza Totales</div>
            <div className={styles.trustDesc}>
              Generados por {new Set(incidents.flatMap((i) => i.confirmedBy)).size} ciudadanos activos
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponentes ──

function StatCard({
  value, label, color, icon, onClick, active,
}: {
  value: number;
  label: string;
  color: string;
  icon: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      className={`${styles.statCard} ${active ? styles.statCardActive : ""}`}
      style={active ? { borderColor: color, background: `${color}12` } : {}}
      onClick={onClick}
    >
      <span className={styles.statIcon}>{icon}</span>
      <span className={styles.statValue} style={{ color: active ? color : undefined }}>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </button>
  );
}

function IncidentCard({
  incident, isSelected, onClick,
}: {
  incident: Incident;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor =
    incident.status === "active"
      ? "#22c55e"
      : incident.status === "resolved"
      ? "#6b7280"
      : "#94a3b8";

  const severityColor =
    incident.severity === "high"
      ? "#ef4444"
      : incident.severity === "medium"
      ? "#f97316"
      : "#eab308";

  const trustPct = Math.min((incident.trustPoints / 5) * 100, 100);

  return (
    <div className={styles.incidentWrap}>
    <button
      className={`${styles.incidentCard} ${isSelected ? styles.incidentSelected : ""}`}
      onClick={onClick}
      id={`incident-card-${incident.id}`}
    >
      <div className={styles.incidentHeader}>
        <span className={styles.incidentCat}>
          {CATEGORY_ICONS[incident.category]} {incident.category}
        </span>
        <span
          className={styles.incidentStatus}
          style={{ color: statusColor, background: `${statusColor}18` }}
        >
          {STATUS_LABEL[incident.status]}
        </span>
      </div>

      <p className={styles.incidentDesc}>
        {incident.description.length > 70 ? `${incident.description.slice(0, 70)}…` : incident.description}
      </p>

      <div className={styles.incidentMeta}>
        <span className={styles.incidentSeverity} style={{ color: severityColor }}>
          ● {incident.severity === "high" ? "Alto" : incident.severity === "medium" ? "Medio" : "Bajo"}
        </span>
        {incident.bandaPrioridad && incident.indicePrioridad !== null && (
          <span
            className={styles.incidentPrioridad}
            style={{ color: BANDA[incident.bandaPrioridad].color, background: `${BANDA[incident.bandaPrioridad].color}18` }}
            title="Índice de prioridad (0 a 100)"
          >
            {BANDA[incident.bandaPrioridad].etiqueta} · {Math.round(incident.indicePrioridad)}
          </span>
        )}
        <span className={styles.incidentTrust}>★ {incident.trustPoints} pts</span>
      </div>

      {/* Barra de progreso de confianza */}
      <div className={styles.trustBar}>
        <div
          className={styles.trustBarFill}
          style={{
            width: `${trustPct}%`,
            background: incident.status === "active" ? "#22c55e" : statusColor,
          }}
        />
      </div>
    </button>
    </div>
  );
}

function CategoryBar({
  category, count, total, icon,
}: {
  category: string;
  count: number;
  total: number;
  icon: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className={styles.catBar}>
      <div className={styles.catBarHeader}>
        <span>{icon} {category}</span>
        <span className={styles.catBarCount}>{count}</span>
      </div>
      <div className={styles.catBarBg}>
        <div className={styles.catBarFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SeverityBar({
  label, count, color, total,
}: {
  label: string;
  count: number;
  color: string;
  total: number;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className={styles.sevBar}>
      <div style={{ color }} className={styles.sevLabel}>● {label}</div>
      <div className={styles.catBarBg} style={{ flex: 1 }}>
        <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: "999px", transition: "width 0.5s ease" }} />
      </div>
      <span className={styles.sevCount}>{count}</span>
    </div>
  );
}
