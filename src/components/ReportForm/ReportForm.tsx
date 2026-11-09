/**
 * SIRU — components/ReportForm/ReportForm.tsx
 * Formulario modal de alta de incidentes urbanos.
 *
 * Funcionalidades implementadas (TFG §5):
 *   1. Captura GPS real via navigator.geolocation.getCurrentPosition
 *   2. Validación de archivo de imagen (tipo, tamaño, hash SHA-256)
 *   3. Geofencing de 50m: bloquea duplicado y ofrece confirmación de confianza
 *   4. Envío al API Route POST /api/incidents
 *
 * Flujo de pasos:
 *   STEP 1: Captura GPS obligatoria
 *   STEP 2: Categoría + Descripción + Severidad
 *   STEP 3: Foto obligatoria (con preview y validación)
 *   STEP 4: Confirmación y envío
 */
"use client";

import { useState, useRef, useCallback } from "react";
import type { GeoPoint, IncidentCategory, IncidentSeverity, Incident } from "@/lib/types";
import { haversineDistance, GEOFENCE_RADIUS_M, formatDistance } from "@/lib/spatial";
import { computeFileHash, validateImageFile, formatFileSize } from "@/lib/exif";
import { MOCK_INCIDENTS } from "@/lib/db";
import styles from "./ReportForm.module.css";

// ---------------------------------------------------------------------------
// Types internos del formulario
// ---------------------------------------------------------------------------

type FormStep = "gps" | "details" | "photo" | "confirm";

type GeofenceAlert = {
  type: "duplicate";
  nearbyIncident: Incident;
  distance: number;
};

interface ReportFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (incident: Incident) => void;
  initialLocation?: GeoPoint | null;
}

const CATEGORIES: IncidentCategory[] = [
  "Bache", "Iluminación", "Basura", "Vandalismo", "Inundación", "Otro",
];

const SEVERITY_OPTIONS: { value: IncidentSeverity; label: string; color: string }[] = [
  { value: "low",    label: "Bajo — Molestia menor",     color: "#eab308" },
  { value: "medium", label: "Medio — Riesgo moderado",   color: "#f97316" },
  { value: "high",   label: "Alto — Peligro inmediato",  color: "#ef4444" },
];

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function ReportForm({
  isOpen,
  onClose,
  onSuccess,
  initialLocation,
}: ReportFormProps) {
  // Estado de pasos del wizard
  const [step, setStep] = useState<FormStep>("gps");

  // Estado del formulario
  const [location, setLocation] = useState<GeoPoint | null>(initialLocation || null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [category, setCategory] = useState<IncidentCategory>("Bache");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoHash, setPhotoHash] = useState<string | null>(null);

  // Estado de UI
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [geofenceAlert, setGeofenceAlert] = useState<GeofenceAlert | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // -----------------------------------------------------------------------
  // STEP 1: Captura GPS
  // -----------------------------------------------------------------------

  /**
   * Solicita la posición GPS real del dispositivo usando la Geolocation API.
   * Implementa TFG §5.1 — Geolocalización obligatoria del dispositivo.
   */
  const captureGPS = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Tu navegador no soporta geolocalización. Por favor, usa Chrome o Firefox actualizado.");
      return;
    }

    setGpsLoading(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: GeoPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setLocation(coords);
        setGpsAccuracy(Math.round(position.coords.accuracy));
        setGpsLoading(false);

        // Auto-avanzar al siguiente paso
        setTimeout(() => setStep("details"), 800);
      },
      (error) => {
        setGpsLoading(false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setGpsError("Permiso de ubicación denegado. Habilítalo en la configuración del navegador para reportar incidentes.");
            break;
          case error.POSITION_UNAVAILABLE:
            setGpsError("Ubicación no disponible. Asegúrate de tener GPS activo.");
            break;
          case error.TIMEOUT:
            setGpsError("Tiempo de espera agotado. Intenta nuevamente en un lugar con mejor señal.");
            break;
        }
      },
      {
        enableHighAccuracy: true, // GPS de alta precisión (TFG §5.1)
        timeout: 15000,
        maximumAge: 0, // No usar caché — siempre coordenadas frescas
      }
    );
  }, []);

  // -----------------------------------------------------------------------
  // STEP 3: Procesamiento de foto
  // -----------------------------------------------------------------------

  const handlePhotoSelect = useCallback(async (file: File) => {
    setPhotoError(null);

    // Validar archivo
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setPhotoError(validation.errors.join(" "));
      return;
    }

    try {
      // Calcular hash SHA-256 (TFG §5.3 — anti-duplicados)
      const hash = await computeFileHash(file);

      // Preview
      const reader = new FileReader();
      reader.onload = (e) => setPhotoPreview(e.target?.result as string);
      reader.readAsDataURL(file);

      setPhotoFile(file);
      setPhotoHash(hash);
    } catch {
      setPhotoError("Error procesando el archivo. Intenta con otra imagen.");
    }
  }, []);

  // -----------------------------------------------------------------------
  // STEP 4: Geofencing y envío
  // -----------------------------------------------------------------------

  /**
   * Verifica geofencing ANTES de enviar al servidor.
   * Primera línea de defensa en cliente (TFG §5.2).
   * El servidor re-valida esta lógica (defense in depth).
   */
  const checkGeofenceAndSubmit = useCallback(async () => {
    if (!location || !photoHash) return;

    setSubmitting(true);
    setSubmitError(null);
    setGeofenceAlert(null);

    // Geofencing en cliente usando el mock de incidentes
    // (en producción esto vendría del servidor via /api/incidents/check)
    const activeIncidents = MOCK_INCIDENTS.filter(
      (i) => i.status !== "resolved" && i.category === category
    );

    for (const incident of activeIncidents) {
      const distance = haversineDistance(location, incident.geom);
      if (distance < GEOFENCE_RADIUS_M) {
        // BLOQUEO: incidente duplicado detectado
        setGeofenceAlert({ type: "duplicate", nearbyIncident: incident, distance });
        setSubmitting(false);
        return;
      }
    }

    // Sin duplicados — enviar al servidor
    await submitReport();
  }, [location, photoHash, category]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitReport = async () => {
    if (!location || !photoHash) return;

    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geom: location,
          category,
          description,
          photoHash,
          exifData: null,
          severity,
          userId: "user-demo", // Mock userId
        }),
      });

      const data = await response.json();

      if (response.status === 409) {
        // Geofencing detectado en servidor
        setGeofenceAlert({
          type: "duplicate",
          nearbyIncident: data.nearbyIncident,
          distance: data.distanceMeters,
        });
        setSubmitting(false);
        return;
      }

      if (!response.ok) {
        setSubmitError(data.error || "Error al crear el reporte.");
        setSubmitting(false);
        return;
      }

      // Éxito
      onSuccess(data.data);
      resetForm();
      onClose();
    } catch {
      setSubmitError("Error de conexión. Verifica tu internet e intenta nuevamente.");
      setSubmitting(false);
    }
  };

  /**
   * Suma +1 punto de confianza al incidente existente detectado por geofencing.
   * Implementa TFG §6.1.
   */
  const addTrustPoint = async () => {
    if (!geofenceAlert || !location) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId: geofenceAlert.nearbyIncident.id,
          userId: "user-demo",
          userLocation: location,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setSubmitError(data.error || "No se pudo confirmar el incidente.");
        setSubmitting(false);
        return;
      }

      alert(`✅ ${data.message}`);
      onSuccess(data.data);
      resetForm();
      onClose();
    } catch {
      setSubmitError("Error de conexión al confirmar.");
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep("gps");
    setLocation(null);
    setGpsAccuracy(null);
    setCategory("Bache");
    setDescription("");
    setSeverity("medium");
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoHash(null);
    setGeofenceAlert(null);
    setGpsError(null);
    setPhotoError(null);
    setSubmitError(null);
    setSubmitting(false);
  };

  if (!isOpen) return null;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Reportar Incidente">

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerIcon}>🚨</span>
            <div>
              <h2 className={styles.title}>Reportar Incidente</h2>
              <p className={styles.subtitle}>Ramos Mejía, Buenos Aires</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Stepper */}
        <StepIndicator current={step} />

        {/* Alerta de Geofencing — BLOQUEA el flujo normal */}
        {geofenceAlert && (
          <GeofenceAlertPanel
            alert={geofenceAlert}
            onAddTrust={addTrustPoint}
            onCancel={() => { setGeofenceAlert(null); setSubmitting(false); }}
            submitting={submitting}
          />
        )}

        {/* Contenido por paso */}
        {!geofenceAlert && (
          <div className={styles.body}>

            {/* STEP 1: GPS */}
            {step === "gps" && (
              <StepGPS
                location={location}
                accuracy={gpsAccuracy}
                loading={gpsLoading}
                error={gpsError}
                onCapture={captureGPS}
                onNext={() => setStep("details")}
              />
            )}

            {/* STEP 2: Detalles */}
            {step === "details" && (
              <StepDetails
                category={category}
                description={description}
                severity={severity}
                onCategoryChange={setCategory}
                onDescriptionChange={setDescription}
                onSeverityChange={setSeverity}
                onBack={() => setStep("gps")}
                onNext={() => setStep("photo")}
              />
            )}

            {/* STEP 3: Foto */}
            {step === "photo" && (
              <StepPhoto
                photoFile={photoFile}
                photoPreview={photoPreview}
                photoHash={photoHash}
                error={photoError}
                fileInputRef={fileInputRef}
                onFileSelect={handlePhotoSelect}
                onBack={() => setStep("details")}
                onNext={() => setStep("confirm")}
              />
            )}

            {/* STEP 4: Confirmar y enviar */}
            {step === "confirm" && (
              <StepConfirm
                location={location}
                category={category}
                description={description}
                severity={severity}
                photoFile={photoFile}
                photoHash={photoHash}
                submitting={submitting}
                error={submitError}
                onBack={() => setStep("photo")}
                onSubmit={checkGeofenceAndSubmit}
              />
            )}

          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Sub-componentes de pasos
// ============================================================

// --- Stepper visual ---
function StepIndicator({ current }: { current: FormStep }) {
  const steps: { id: FormStep; label: string }[] = [
    { id: "gps",     label: "GPS" },
    { id: "details", label: "Detalles" },
    { id: "photo",   label: "Foto" },
    { id: "confirm", label: "Confirmar" },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className={styles.stepper}>
      {steps.map((s, i) => (
        <div key={s.id} className={styles.stepperItem}>
          <div
            className={`${styles.stepperDot} ${
              i < currentIdx ? styles.done : i === currentIdx ? styles.active : ""
            }`}
          >
            {i < currentIdx ? "✓" : i + 1}
          </div>
          <span className={`${styles.stepperLabel} ${i === currentIdx ? styles.activeLabel : ""}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div className={`${styles.stepperLine} ${i < currentIdx ? styles.doneLine : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// --- Step 1: GPS ---
function StepGPS({
  location, accuracy, loading, error, onCapture, onNext,
}: {
  location: GeoPoint | null;
  accuracy: number | null;
  loading: boolean;
  error: string | null;
  onCapture: () => void;
  onNext: () => void;
}) {
  return (
    <div className={styles.step}>
      <div className={styles.stepIcon}>📍</div>
      <h3 className={styles.stepTitle}>Capturar ubicación GPS</h3>
      <p className={styles.stepDesc}>
        La geolocalización precisa es <strong>obligatoria</strong> para reportar un incidente y validar su posición en el mapa.
      </p>

      {error && <div className={styles.errorBox}>{error}</div>}

      {location ? (
        <div className={styles.successBox}>
          <div className={styles.successIcon}>✅</div>
          <div>
            <div className={styles.successTitle}>Ubicación capturada</div>
            <div className={styles.successDetail}>
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
              {accuracy && <span> · Precisión: ±{accuracy}m</span>}
            </div>
          </div>
        </div>
      ) : (
        <button
          className={`${styles.btnPrimary} ${loading ? styles.loading : ""}`}
          onClick={onCapture}
          disabled={loading}
          id="btn-capture-gps"
        >
          {loading ? (
            <><span className={styles.spinner} />Obteniendo GPS...</>
          ) : (
            <><span>📡</span> Capturar mi ubicación</>
          )}
        </button>
      )}

      {location && (
        <button className={styles.btnPrimary} onClick={onNext} id="btn-gps-next">
          Continuar →
        </button>
      )}

      <p className={styles.hint}>
        💡 Si estás en escritorio, el navegador usará tu IP para geolocalización aproximada. En móvil se usa el GPS del dispositivo.
      </p>
    </div>
  );
}

// --- Step 2: Detalles ---
function StepDetails({
  category, description, severity,
  onCategoryChange, onDescriptionChange, onSeverityChange,
  onBack, onNext,
}: {
  category: IncidentCategory;
  description: string;
  severity: IncidentSeverity;
  onCategoryChange: (v: IncidentCategory) => void;
  onDescriptionChange: (v: string) => void;
  onSeverityChange: (v: IncidentSeverity) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canContinue = category && description.trim().length >= 20;

  return (
    <div className={styles.step}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="select-category">Categoría *</label>
        <select
          id="select-category"
          value={category}
          onChange={(e) => onCategoryChange(e.target.value as IncidentCategory)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="textarea-description">
          Descripción * <span className={styles.charCount}>{description.length}/500</span>
        </label>
        <textarea
          id="textarea-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value.slice(0, 500))}
          placeholder="Describe el incidente con detalle: ¿qué ocurre? ¿desde cuándo? ¿qué riesgos genera?"
          rows={4}
          className={styles.textarea}
        />
        {description.length < 20 && description.length > 0 && (
          <span className={styles.fieldError}>Mínimo 20 caracteres ({20 - description.length} restantes)</span>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Severidad *</label>
        <div className={styles.severityGrid}>
          {SEVERITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`${styles.severityBtn} ${severity === opt.value ? styles.severitySelected : ""}`}
              style={severity === opt.value ? { borderColor: opt.color, background: `${opt.color}18` } : {}}
              onClick={() => onSeverityChange(opt.value)}
              id={`btn-severity-${opt.value}`}
            >
              <span style={{ color: opt.color }}>●</span> {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.navButtons}>
        <button className={styles.btnSecondary} onClick={onBack}>← Atrás</button>
        <button
          className={styles.btnPrimary}
          onClick={onNext}
          disabled={!canContinue}
          id="btn-details-next"
        >
          Continuar →
        </button>
      </div>
    </div>
  );
}

// --- Step 3: Foto ---
function StepPhoto({
  photoFile, photoPreview, photoHash, error,
  fileInputRef, onFileSelect, onBack, onNext,
}: {
  photoFile: File | null;
  photoPreview: string | null;
  photoHash: string | null;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (file: File) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className={styles.step}>
      <div className={styles.stepIcon}>📷</div>
      <h3 className={styles.stepTitle}>Evidencia fotográfica</h3>
      <p className={styles.stepDesc}>
        La foto es <strong>obligatoria</strong>. Se calculará un hash SHA-256 para detectar duplicados (TFG §5.3).
      </p>

      {error && <div className={styles.errorBox}>{error}</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
        }}
        id="input-photo-upload"
      />

      {photoPreview ? (
        <div className={styles.photoPreview}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoPreview} alt="Preview del incidente" className={styles.previewImg} />
          <div className={styles.photoMeta}>
            <span className={styles.metaItem}>📁 {photoFile?.name}</span>
            <span className={styles.metaItem}>📏 {formatFileSize(photoFile?.size || 0)}</span>
            <span className={styles.metaItem} title={photoHash || ""}>
              🔐 SHA-256: {photoHash?.slice(0, 16)}...
            </span>
          </div>
          <button
            className={styles.btnSecondary}
            onClick={() => fileInputRef.current?.click()}
            id="btn-change-photo"
          >
            Cambiar foto
          </button>
        </div>
      ) : (
        <button
          className={styles.photoDropzone}
          onClick={() => fileInputRef.current?.click()}
          id="btn-select-photo"
        >
          <span className={styles.dropzoneIcon}>🖼️</span>
          <span>Seleccionar foto del incidente</span>
          <span className={styles.dropzoneHint}>JPEG, PNG o WebP · Máx. 10 MB</span>
        </button>
      )}

      <div className={styles.navButtons}>
        <button className={styles.btnSecondary} onClick={onBack}>← Atrás</button>
        <button
          className={styles.btnPrimary}
          onClick={onNext}
          disabled={!photoHash}
          id="btn-photo-next"
        >
          Continuar →
        </button>
      </div>
    </div>
  );
}

// --- Step 4: Confirmar ---
function StepConfirm({
  location, category, description, severity,
  photoFile, photoHash, submitting, error,
  onBack, onSubmit,
}: {
  location: GeoPoint | null;
  category: string;
  description: string;
  severity: string;
  photoFile: File | null;
  photoHash: string | null;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const sevColor = severity === "high" ? "#ef4444" : severity === "medium" ? "#f97316" : "#eab308";
  const sevLabel = severity === "high" ? "Alto" : severity === "medium" ? "Medio" : "Bajo";

  return (
    <div className={styles.step}>
      <div className={styles.stepIcon}>✅</div>
      <h3 className={styles.stepTitle}>Confirmar reporte</h3>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <span className={styles.summaryKey}>📍 Ubicación</span>
          <span className={styles.summaryVal}>
            {location?.lat.toFixed(5)}, {location?.lng.toFixed(5)}
          </span>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryKey}>🏷 Categoría</span>
          <span className={styles.summaryVal}>{category}</span>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryKey}>⚠ Severidad</span>
          <span className={styles.summaryVal} style={{ color: sevColor }}>● {sevLabel}</span>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryKey}>📷 Foto</span>
          <span className={styles.summaryVal}>{photoFile?.name || "Adjunta"}</span>
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryKey}>🔐 Hash</span>
          <span className={styles.summaryVal} style={{ fontFamily: "monospace", fontSize: "11px" }}>
            {photoHash?.slice(0, 24)}...
          </span>
        </div>
        <div className={styles.summaryDesc}>
          <span className={styles.summaryKey}>📝 Descripción</span>
          <p className={styles.summaryDescText}>{description}</p>
        </div>
      </div>

      <p className={styles.hint}>
        Al confirmar, el sistema verificará que no exista un incidente activo de la misma categoría a menos de <strong>50 metros</strong> de tu ubicación.
      </p>

      <div className={styles.navButtons}>
        <button className={styles.btnSecondary} onClick={onBack} disabled={submitting}>← Atrás</button>
        <button
          className={`${styles.btnPrimary} ${styles.btnSubmit} ${submitting ? styles.loading : ""}`}
          onClick={onSubmit}
          disabled={submitting}
          id="btn-submit-report"
        >
          {submitting ? <><span className={styles.spinner} />Verificando...</> : "🚨 Enviar Reporte"}
        </button>
      </div>
    </div>
  );
}

// --- Panel de alerta de geofencing ---
function GeofenceAlertPanel({
  alert, onAddTrust, onCancel, submitting,
}: {
  alert: GeofenceAlert;
  onAddTrust: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const inc = alert.nearbyIncident;
  return (
    <div className={styles.geofenceAlert}>
      <div className={styles.geofenceIcon}>🛑</div>
      <h3 className={styles.geofenceTitle}>Incidente duplicado detectado</h3>
      <p className={styles.geofenceDesc}>
        Ya existe un incidente activo de tipo <strong>&quot;{inc.category}&quot;</strong> a{" "}
        <strong>{formatDistance(alert.distance)}</strong> de tu ubicación (radio de geofencing: {GEOFENCE_RADIUS_M}m).
      </p>

      <div className={styles.geofenceCard}>
        <div className={styles.geofenceCardTitle}>{inc.category}</div>
        <div className={styles.geofenceCardDesc}>{inc.description.slice(0, 100)}...</div>
        <div className={styles.geofenceCardMeta}>
          <span>★ {inc.trustPoints} pts de confianza</span>
          <span>📍 {formatDistance(alert.distance)}</span>
        </div>
      </div>

      <p className={styles.geofenceQuestion}>
        ¿Deseas confirmar la existencia de este incidente?
        <br />
        <small>Sumar tu confirmación suma +1 Punto de Confianza al reporte existente.</small>
      </p>

      <div className={styles.geofenceActions}>
        <button
          className={styles.btnSecondary}
          onClick={onCancel}
          disabled={submitting}
          id="btn-geofence-cancel"
        >
          Cancelar
        </button>
        <button
          className={`${styles.btnTrust} ${submitting ? styles.loading : ""}`}
          onClick={onAddTrust}
          disabled={submitting}
          id="btn-geofence-confirm"
        >
          {submitting ? <><span className={styles.spinner} />...</> : "✅ Sumar +1 Confianza"}
        </button>
      </div>
    </div>
  );
}
