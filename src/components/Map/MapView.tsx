/**
 * SIRU — components/Map/MapView.tsx
 * Componente principal del mapa interactivo basado en Leaflet.
 *
 * Renderiza:
 *   - Mapa base (OpenStreetMap) centrado en Ramos Mejía
 *   - Marcadores diferenciados por estado y puntos de confianza
 *   - Capa de heatmap para incidentes activos
 *   - Marcador de posición actual del usuario (GPS)
 *
 * Se usa "use client" porque Leaflet requiere acceso a window/document.
 * Se carga con dynamic import desde el dashboard para evitar SSR.
 */
"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Map as LeafletMap, Marker, Layer } from "leaflet";
import type { Incident, GeoPoint } from "@/lib/types";
import styles from "./MapView.module.css";

// ---------------------------------------------------------------------------
// Constantes de configuración del mapa
// ---------------------------------------------------------------------------

/** Centro del mapa: Ramos Mejía, Buenos Aires (WGS-84) */
const RAMOS_MEJIA_CENTER: [number, number] = [-34.6482, -58.5625];
const DEFAULT_ZOOM = 15;
const MAX_ZOOM = 18;
const MIN_ZOOM = 13;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MapViewProps {
  incidents: Incident[];
  userLocation: GeoPoint | null;
  selectedIncidentId: string | null;
  onIncidentSelect: (incident: Incident) => void;
  onMapClick?: (point: GeoPoint) => void;
  showHeatmap?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers para generar íconos SVG custom por estado/severidad
// ---------------------------------------------------------------------------

/**
 * Genera el color del marcador según el estado y severidad del incidente.
 * Refleja el ciclo de vida definido en TFG §6.2.
 */
function getMarkerColor(incident: Incident): { fill: string; opacity: number; border: string } {
  if (incident.status === "resolved") {
    return { fill: "#6b7280", opacity: 0.7, border: "#9ca3af" };
  }
  if (incident.status === "review") {
    // Resolución informada, pendiente de que el operador la valide (HU-05)
    return { fill: "#3b82f6", opacity: 0.9, border: "#93c5fd" };
  }
  if (incident.status === "unverified") {
    // Marcador translúcido para incidentes sin verificar (TFG §6.2)
    return { fill: "#94a3b8", opacity: 0.45, border: "#cbd5e1" };
  }
  // Estado "active" — color por severidad
  switch (incident.severity) {
    case "high":   return { fill: "#ef4444", opacity: 0.95, border: "#fca5a5" };
    case "medium": return { fill: "#f97316", opacity: 0.95, border: "#fdba74" };
    case "low":    return { fill: "#eab308", opacity: 0.95, border: "#fde047" };
    default:       return { fill: "#3b82f6", opacity: 0.95, border: "#93c5fd" };
  }
}

/** Escapa texto para insertarlo en el HTML del popup (los datos los cargan los vecinos). */
function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const ETIQUETA_ESTADO: Record<string, string> = {
  unverified: "Sin verificar",
  active: "Activo",
  review: "En revisión",
  resolved: "Resuelto",
  dismissed: "Desestimado",
};

/**
 * HTML del popup de un incidente. Leaflet inserta este HTML recién cuando se
 * abre el popup, así que la miniatura se descarga solo al abrir el incidente:
 * el mapa en sí no carga fotos (imagenes.md).
 */
function popupHtml(incident: Incident): string {
  const trustColor =
    incident.status === "active" ? "#22c55e" : incident.status === "resolved" ? "#6b7280" : "#94a3b8";
  const desc = incident.description.length > 80 ? `${incident.description.slice(0, 80)}…` : incident.description;
  const miniatura = incident.miniaturaUrl
    ? `<img src="${escapar(incident.miniaturaUrl)}" alt="Foto del incidente" loading="lazy" width="240" height="180"
         style="display:block; width:100%; max-width:240px; height:auto; aspect-ratio:4/3; object-fit:cover;
                border-radius:8px; margin-bottom:8px; background:#21262d;" />`
    : "";
  return `
    <div style="padding:12px; min-width:200px; font-family:'Inter',sans-serif;">
      ${miniatura}
      <div style="font-weight:700; font-size:14px; margin-bottom:4px; color:#f0f6fc;">${escapar(incident.category)} · N.° ${escapar(incident.id)}</div>
      <div style="font-size:12px; color:#8b949e; margin-bottom:8px;">${escapar(incident.address || "Ramos Mejía")}</div>
      <div style="font-size:12px; color:#c9d1d9; margin-bottom:10px; line-height:1.5;">${escapar(desc)}</div>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="background:${trustColor}22; color:${trustColor}; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600;">
          ${ETIQUETA_ESTADO[incident.status] ?? ""}
        </span>
        <span style="background:#3b82f622; color:#93c5fd; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600;">
          ★ ${incident.trustPoints} pts
        </span>
      </div>
    </div>`;
}

/** Genera el SVG del ícono del marcador */
function createMarkerSvg(incident: Incident, isSelected: boolean): string {
  const { fill, opacity, border } = getMarkerColor(incident);
  const size = isSelected ? 36 : 28;
  const pulseRing = incident.status === "active" && incident.severity === "high";

  // Ícono de categoría embebido en el SVG
  const categoryIcons: Record<string, string> = {
    Bache: "🕳",
    Luminaria: "💡",
    Anegamiento: "💧",
    "Basura acumulada": "🗑",
    Otro: "⚠",
  };
  const emoji = categoryIcons[incident.category] || "⚠";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size + 8}" height="${size + 12}" viewBox="0 0 ${size + 8} ${size + 12}">
      ${pulseRing ? `<circle cx="${(size + 8) / 2}" cy="${(size + 8) / 2}" r="${size / 2 + 4}" fill="${fill}" opacity="0.2">
        <animate attributeName="r" from="${size / 2}" to="${size / 2 + 8}" dur="1.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" from="0.3" to="0" dur="1.5s" repeatCount="indefinite"/>
      </circle>` : ""}
      <circle cx="${(size + 8) / 2}" cy="${(size + 8) / 2}" r="${size / 2}" fill="${fill}" opacity="${opacity}" stroke="${border}" stroke-width="2"/>
      <text x="${(size + 8) / 2}" y="${(size + 8) / 2 + 5}" text-anchor="middle" font-size="${size * 0.4}px">${emoji}</text>
      <polygon points="${(size + 8) / 2},${size + 12} ${(size + 8) / 2 - 5},${size + 4} ${(size + 8) / 2 + 5},${size + 4}" fill="${fill}" opacity="${opacity}"/>
    </svg>
  `.trim();
}

// ---------------------------------------------------------------------------
// Componente MapView
// ---------------------------------------------------------------------------

export default function MapView({
  incidents,
  userLocation,
  selectedIncidentId,
  onIncidentSelect,
  onMapClick,
  showHeatmap = false,
}: MapViewProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const userMarkerRef = useRef<Marker | null>(null);
  const heatLayerRef = useRef<Layer | null>(null);

  // -----------------------------------------------------------------------
  // Inicialización del mapa
  // -----------------------------------------------------------------------
  useEffect(() => {
    // Guard: evitar doble inicialización en React StrictMode
    if (mapRef.current || !containerRef.current) return;

    // Importar Leaflet de forma dinámica (solo cliente)
    import("leaflet").then((L) => {
      if (!containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: RAMOS_MEJIA_CENTER,
        zoom: DEFAULT_ZOOM,
        maxZoom: MAX_ZOOM,
        minZoom: MIN_ZOOM,
        zoomControl: true,
        attributionControl: true,
      });

      // Capa de mosaicos OpenStreetMap
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: MAX_ZOOM,
      }).addTo(map);

      // Click en el mapa para obtener coordenadas
      if (onMapClick) {
        map.on("click", (e) => {
          onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
      }

      mapRef.current = map;
    });

    // Cleanup al desmontar
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Renderizado de marcadores de incidentes
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current) return;

    import("leaflet").then((L) => {
      if (!mapRef.current) return;

      // Eliminar marcadores que ya no existen
      markersRef.current.forEach((marker, id) => {
        if (!incidents.find((i) => i.id === id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });

      // Agregar/actualizar marcadores
      incidents.forEach((incident) => {
        const isSelected = incident.id === selectedIncidentId;
        const svgString = createMarkerSvg(incident, isSelected);
        const svgBlob = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;

        const iconSize = isSelected ? 44 : 36;
        const icon = L.icon({
          iconUrl: svgBlob,
          iconSize: [iconSize, iconSize],
          iconAnchor: [iconSize / 2, iconSize],
          popupAnchor: [0, -iconSize],
        });

        if (markersRef.current.has(incident.id)) {
          // Actualizar ícono y contenido del marcador existente (estado, puntos)
          const existente = markersRef.current.get(incident.id)!;
          existente.setIcon(icon);
          existente.setPopupContent(popupHtml(incident));
        } else {
          // Crear nuevo marcador
          const marker = L.marker([incident.geom.lat, incident.geom.lng], { icon });

          marker.bindPopup(popupHtml(incident));

          marker.on("click", () => {
            onIncidentSelect(incident);
          });

          marker.addTo(mapRef.current!);
          markersRef.current.set(incident.id, marker);
        }
      });
    });
  }, [incidents, selectedIncidentId, onIncidentSelect]);

  // -----------------------------------------------------------------------
  // Marcador de posición del usuario
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    import("leaflet").then((L) => {
      if (!mapRef.current) return;

      // Remover marcador anterior
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }

      // Crear ícono pulsante para el usuario
      const userIcon = L.divIcon({
        html: `
          <div style="position:relative; width:20px; height:20px;">
            <div style="position:absolute; inset:0; background:#3b82f6; border-radius:50%; border:3px solid white; box-shadow:0 0 0 4px rgba(59,130,246,0.3); z-index:2;"></div>
            <div style="position:absolute; inset:-6px; background:rgba(59,130,246,0.2); border-radius:50%; animation:pulse 2s infinite;"></div>
          </div>
          <style>
            @keyframes pulse {
              0% { transform: scale(1); opacity: 0.8; }
              100% { transform: scale(2.5); opacity: 0; }
            }
          </style>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        className: "",
      });

      const marker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon });
      marker.bindPopup('<div style="padding:8px; font-family:\'Inter\',sans-serif; color:#f0f6fc; font-size:13px;"><strong>Tu posición actual</strong></div>');
      marker.addTo(mapRef.current!);
      userMarkerRef.current = marker;

      // Centrar mapa en la ubicación del usuario
      mapRef.current.setView([userLocation.lat, userLocation.lng], DEFAULT_ZOOM, {
        animate: true,
      });
    });
  }, [userLocation]);

  // -----------------------------------------------------------------------
  // Heatmap (incidentes activos)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current) return;

    // Remover capa de heatmap anterior
    if (heatLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(heatLayerRef.current as L.Layer);
      heatLayerRef.current = null;
    }

    if (!showHeatmap) return;

    // Puntos del mapa de calor: solo incidentes activos, ponderados por su índice
    const heatPoints = incidents
      .filter((i) => i.status === "active")
      .filter((i) => i.indicePrioridad !== null)
      // HU-04 criterio 3: cada incidente activo pesa según su índice de prioridad (0 a 1).
      .map((i) => [i.geom.lat, i.geom.lng, (i.indicePrioridad as number) / 100] as [number, number, number]);

    if (heatPoints.length === 0) return;

    // Si la capa se apaga o cambian los incidentes antes de que termine la carga, no se dibuja.
    let cancelado = false;

    // leaflet.heat se carga dinámicamente. Es un script clásico, no un módulo: no
    // exporta nada y se registra escribiendo L.heatLayer sobre una variable global
    // L. Dentro del bundle de Next esa variable no existe, así que antes de cargarlo
    // se publica en window.L el mismo objeto de Leaflet que usa el mapa.
    import("leaflet").then(async (modulo) => {
      if (!mapRef.current) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const L = ((modulo as any).default ?? modulo) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).L = L;
        await import("leaflet.heat");
        if (cancelado || !mapRef.current) return;
        if (typeof L.heatLayer !== "function") throw new Error("leaflet.heat no registró heatLayer");

        const heatLayer = L.heatLayer(heatPoints, {
          radius: 40,
          blur: 25,
          maxZoom: 16,
          gradient: {
            0.2: "#eab308",
            0.5: "#f97316",
            0.8: "#ef4444",
            1.0: "#7f1d1d",
          },
        });

        heatLayer.addTo(mapRef.current);
        heatLayerRef.current = heatLayer;
      } catch (e) {
        // El mapa sigue funcionando sin la capa de calor, pero el error queda a la vista.
        console.error("[SIRU] No se pudo dibujar el mapa de calor:", e);
      }
    });
    return () => {
      cancelado = true;
    };
  }, [showHeatmap, incidents]);

  // -----------------------------------------------------------------------
  // Centrar en incidente seleccionado
  // -----------------------------------------------------------------------
  const centerOnIncident = useCallback((incident: Incident) => {
    if (!mapRef.current) return;
    mapRef.current.setView(
      [incident.geom.lat, incident.geom.lng],
      16,
      { animate: true }
    );
    markersRef.current.get(incident.id)?.openPopup();
  }, []);

  useEffect(() => {
    if (!selectedIncidentId) return;
    const incident = incidents.find((i) => i.id === selectedIncidentId);
    if (incident) centerOnIncident(incident);
  }, [selectedIncidentId, incidents, centerOnIncident]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={containerRef} className={styles.mapContainer} />
    </div>
  );
}
