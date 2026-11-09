/**
 * SIRU — components/ReportForm/ReportForm.tsx
 * Formulario modal de alta de incidentes urbanos.
 *
 * Funcionalidades implementadas (TFG §5):
 *   1. Captura GPS real via navigator.geolocation.getCurrentPosition
 *   2. Foto: huella SHA-256 y EXIF del original, y versión reducida que se sube (D-19)
 *   3. Geofencing de 50m: bloquea duplicado y ofrece confirmación de confianza
 *   4. Envío a POST /api/incidents como multipart/form-data
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
import { GEOFENCE_RADIUS_M, formatDistance } from "@/lib/spatial";
import { ErrorFoto, formatearTamano, prepararFoto, type FotoPreparada } from "@/lib/cliente/imagen";
import { api } from "@/lib/cliente/api";
import { CATEGORIAS, PRECISION_GPS_MAXIMA } from "@/lib/reglas";
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
}

const CATEGORIES: IncidentCategory[] = [...CATEGORIAS];
const MAX_DESCRIPCION = 200;

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
}: ReportFormProps) {
  // Estado de pasos del wizard
  const [step, setStep] = useState<FormStep>("gps");

  // Estado del formulario
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [category, setCategory] = useState<IncidentCategory>("Bache");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [posicionTomadaEn, setPosicionTomadaEn] = useState<number | null>(null);
  const [foto, setFoto] = useState<FotoPreparada | null>(null);
  const [nombreFoto, setNombreFoto] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const photoHash = foto?.hashOriginal ?? null;

  // Estado de UI
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [geofenceAlert, setGeofenceAlert] = useState<GeofenceAlert | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trustMessage, setTrustMessage] = useState<string | null>(null);

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
        const precision = Math.round(position.coords.accuracy);
        setGpsLoading(false);
        // HU-02: si la precisión supera el máximo, se pide repetir la captura
        if (precision > PRECISION_GPS_MAXIMA) {
          setLocation(null);
          setGpsAccuracy(null);
          setGpsError(
            `La precisión del GPS es de ±${precision} m y se necesitan ${PRECISION_GPS_MAXIMA} m o menos. Salí a un lugar abierto, esperá unos segundos y volvé a intentar.`
          );
          return;
        }
        const coords: GeoPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setLocation(coords);
        setGpsAccuracy(precision);
        setPosicionTomadaEn(position.timestamp);

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

  /** Libera la vista previa anterior (una URL de objeto ocupa memoria hasta que se revoca). */
  const quitarFoto = useCallback(() => {
    setPhotoPreview((anterior) => {
      if (anterior) URL.revokeObjectURL(anterior);
      return null;
    });
    setFoto(null);
    setNombreFoto(null);
  }, []);

  /**
   * D-19: sobre el original se calculan la huella y el EXIF; después se genera
   * la versión reducida, que es la que se muestra y se sube.
   */
  const handlePhotoSelect = useCallback(async (file: File) => {
    setPhotoError(null);
    quitarFoto();
    setPreparandoFoto(true);
    try {
      const preparada = await prepararFoto(file);
      setFoto(preparada);
      setNombreFoto(file.name);
      setPhotoPreview(URL.createObjectURL(preparada.reducida));
    } catch (e) {
      setPhotoError(e instanceof ErrorFoto ? e.message : "No se pudo procesar la foto. Intentá con otra imagen.");
    } finally {
      setPreparandoFoto(false);
    }
  }, [quitarFoto]);

  // -----------------------------------------------------------------------
  // STEP 4: Geofencing y envío
  // -----------------------------------------------------------------------

  /**
   * Envía el reporte. La validación de duplicados por proximidad (50 m),
   * de la huella de la foto y de la precisión GPS la hace el servidor con
   * PostGIS; si encuentra un incidente cercano responde 409 y se ofrece
   * confirmarlo en lugar de duplicarlo.
   */
  const checkGeofenceAndSubmit = useCallback(async () => {
    if (!location || !foto || gpsAccuracy === null) return;

    setSubmitting(true);
    setSubmitError(null);
    setGeofenceAlert(null);

    try {
      const datos = new FormData();
      datos.append("foto", foto.reducida, "foto.jpg");
      datos.append("hashOriginal", foto.hashOriginal);
      datos.append("lat", String(location.lat));
      datos.append("lng", String(location.lng));
      datos.append("gpsAccuracy", String(gpsAccuracy));
      datos.append("category", category);
      datos.append("severity", severity);
      datos.append("description", description);
      if (foto.exifFecha) datos.append("exifFecha", foto.exifFecha);
      if (foto.exifLat !== null && foto.exifLng !== null) {
        datos.append("exifLat", String(foto.exifLat));
        datos.append("exifLng", String(foto.exifLng));
      }
      if (posicionTomadaEn !== null) datos.append("posicionTomadaEn", new Date(posicionTomadaEn).toISOString());

      const { res, data } = await api("/api/incidents", { method: "POST", body: datos });

      if (res.status === 409 && data?.error === "GEOFENCE_DUPLICATE") {
        setGeofenceAlert({
          type: "duplicate",
          nearbyIncident: data.nearbyIncident,
          distance: data.distanceMeters,
        });
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        setSubmitError(data?.message || "Error al crear el reporte.");
        setSubmitting(false);
        return;
      }

      onSuccess(data.data);
      resetForm();
      onClose();
    } catch {
      setSubmitError("Error de conexión. Verificá tu internet e intentá nuevamente.");
      setSubmitting(false);
    }
  }, [location, foto, gpsAccuracy, posicionTomadaEn, category, description, severity]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Suma 1 punto de confianza al incidente existente detectado por proximidad.
   * El servidor valida distancia (< 50 m), autoría, doble confirmación y límite diario.
   */
  const addTrustPoint = async () => {
    if (!geofenceAlert || !location || gpsAccuracy === null) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const { res, data } = await api("/api/trust", {
        method: "POST",
        body: JSON.stringify({
          incidentId: geofenceAlert.nearbyIncident.id,
          userLocation: location,
          gpsAccuracy,
        }),
      });

      if (!res.ok) {
        setSubmitError(data?.message || "No se pudo confirmar el incidente.");
        setSubmitting(false);
        return;
      }

      onSuccess(data.data);
      setTrustMessage(data.message);
      setSubmitting(false);
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
    setPosicionTomadaEn(null);
    quitarFoto();
    setGeofenceAlert(null);
    setGpsError(null);
    setPhotoError(null);
    setSubmitError(null);
    setTrustMessage(null);
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

        {/* Alerta de duplicado por proximidad — BLOQUEA el flujo normal */}
        {geofenceAlert && (
          <GeofenceAlertPanel
            alert={geofenceAlert}
            onAddTrust={addTrustPoint}
            onCancel={() => { setGeofenceAlert(null); setSubmitting(false); setSubmitError(null); }}
            onClose={() => { resetForm(); onClose(); }}
            submitting={submitting}
            error={submitError}
            done={trustMessage}
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
                foto={foto}
                nombreFoto={nombreFoto}
                preparando={preparandoFoto}
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
                nombreFoto={nombreFoto}
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
        💡 Se aceptan posiciones con una precisión de {PRECISION_GPS_MAXIMA} m o menos. En una computadora la ubicación se estima por IP y suele ser menos precisa.
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
          Descripción * <span className={styles.charCount}>{description.length}/{MAX_DESCRIPCION}</span>
        </label>
        <textarea
          id="textarea-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value.slice(0, MAX_DESCRIPCION))}
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
  foto, nombreFoto, preparando, photoPreview, photoHash, error,
  fileInputRef, onFileSelect, onBack, onNext,
}: {
  foto: FotoPreparada | null;
  nombreFoto: string | null;
  preparando: boolean;
  photoPreview: string | null;
  photoHash: string | null;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelect: (file: File) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className={styles.step}>
      <div className={styles.stepIcon}>📷</div>
      <h3 className={styles.stepTitle}>Evidencia fotográfica</h3>
      <p className={styles.stepDesc}>
        La foto es <strong>obligatoria</strong>. Se calcula su huella SHA-256 para rechazar una imagen ya usada en otro reporte, y se reduce antes de enviarla para ahorrar datos.
      </p>

      {error && <div className={styles.errorBox}>{error}</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
          e.target.value = ""; // permite volver a elegir el mismo archivo
        }}
        id="input-photo-upload"
      />

      {preparando ? (
        <div className={styles.photoDropzone} aria-live="polite">
          <span className={styles.dropzoneIcon}>⏳</span>
          <span>Preparando la foto…</span>
        </div>
      ) : photoPreview && foto ? (
        <div className={styles.photoPreview}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoPreview} alt="Preview del incidente" className={styles.previewImg} />
          <div className={styles.photoMeta}>
            <span className={styles.metaItem}>📁 {nombreFoto}</span>
            <span className={styles.metaItem}>
              📏 {formatearTamano(foto.tamanoOriginal)} → {formatearTamano(foto.reducida.size)} ({foto.ancho} × {foto.alto} px)
            </span>
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
          <span className={styles.dropzoneHint}>Cualquier formato que abra tu navegador · Mín. 50 KB</span>
        </button>
      )}

      <div className={styles.navButtons}>
        <button className={styles.btnSecondary} onClick={onBack}>← Atrás</button>
        <button
          className={styles.btnPrimary}
          onClick={onNext}
          disabled={!photoHash || preparando}
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
  nombreFoto, photoHash, submitting, error,
  onBack, onSubmit,
}: {
  location: GeoPoint | null;
  category: string;
  description: string;
  severity: string;
  nombreFoto: string | null;
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
          <span className={styles.summaryVal}>{nombreFoto || "Adjunta"}</span>
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
        Al confirmar, el sistema verificará que no exista un incidente abierto de la misma categoría a menos de <strong>{GEOFENCE_RADIUS_M} metros</strong> de tu ubicación.
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
  alert, onAddTrust, onCancel, onClose, submitting, error, done,
}: {
  alert: GeofenceAlert;
  onAddTrust: () => void;
  onCancel: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string | null;
  done: string | null;
}) {
  const inc = alert.nearbyIncident;
  if (done) {
    return (
      <div className={styles.geofenceAlert}>
        <div className={styles.geofenceIcon}>✅</div>
        <h3 className={styles.geofenceTitle}>Confirmación registrada</h3>
        <p className={styles.geofenceDesc}>{done}</p>
        <div className={styles.geofenceActions}>
          <button className={styles.btnTrust} onClick={onClose} id="btn-geofence-done">Volver al mapa</button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.geofenceAlert}>
      <div className={styles.geofenceIcon}>🛑</div>
      <h3 className={styles.geofenceTitle}>Incidente duplicado detectado</h3>
      <p className={styles.geofenceDesc}>
        Ya existe un incidente de tipo <strong>&quot;{inc.category}&quot;</strong> a{" "}
        <strong>{formatDistance(alert.distance)}</strong> de tu ubicación (radio de validación: {GEOFENCE_RADIUS_M} m).
      </p>
      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.geofenceCard}>
        <div className={styles.geofenceCardTitle}>{inc.category}</div>
        <div className={styles.geofenceCardDesc}>
          {inc.description.length > 100 ? `${inc.description.slice(0, 100)}…` : inc.description}
        </div>
        <div className={styles.geofenceCardMeta}>
          <span>★ {inc.trustPoints} pts de confianza</span>
          <span>📍 {formatDistance(alert.distance)}</span>
        </div>
      </div>

      <p className={styles.geofenceQuestion}>
        ¿Deseas confirmar la existencia de este incidente?
        <br />
        <small>Tu confirmación suma 1 punto de confianza al reporte existente.</small>
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
          {submitting ? <><span className={styles.spinner} />...</> : "✅ Confirmar existencia"}
        </button>
      </div>
    </div>
  );
}
