/**
 * SIRU — components/ResolucionForm/ResolucionForm.tsx
 * Informe de la resolución de un incidente activo (HU-05 criterio 1, T12).
 *
 *   Vecino:   captura su posición (tiene que estar a menos de 50 m) y saca una
 *             foto con la cámara (D-22); la foto se prepara igual que en el alta
 *             (huella y EXIF del original, versión reducida, D-19).
 *   Operador: carga la información oficial como foto o como PDF, sin control de
 *             distancia (D-10).
 *
 * Reutiliza los estilos del formulario de alta para que se vea igual.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoPoint, Incident } from "@/lib/types";
import { api } from "@/lib/cliente/api";
import { ErrorFoto, formatearTamano, prepararFoto, type FotoPreparada } from "@/lib/cliente/imagen";
import { EVIDENCIA, PRECISION_GPS_MAXIMA, RADIO_METROS } from "@/lib/reglas";
import styles from "../ReportForm/ReportForm.module.css";

interface Props {
  incident: Incident;
  rol: "VECINO" | "OPERADOR";
  onClose: () => void;
  onListo: (incident: Incident) => void;
}

export default function ResolucionForm({ incident, rol, onClose, onListo }: Props) {
  const esVecino = rol === "VECINO";
  const [posicion, setPosicion] = useState<{ punto: GeoPoint; precision: number } | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [foto, setFoto] = useState<FotoPreparada | null>(null);
  const [documento, setDocumento] = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entradaRef = useRef<HTMLInputElement>(null);

  // La vista previa es una URL de objeto: se libera al cambiarla o al cerrar.
  useEffect(() => () => { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); }, [vistaPrevia]);

  const capturarUbicacion = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Tu navegador no permite obtener la ubicación. Usá Chrome o Firefox actualizados.");
      return;
    }
    setBuscandoGps(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBuscandoGps(false);
        const precision = Math.round(p.coords.accuracy);
        if (precision > PRECISION_GPS_MAXIMA) {
          setPosicion(null);
          setError(`La precisión del GPS es de ±${precision} m y se necesitan ${PRECISION_GPS_MAXIMA} m o menos. Salí a un lugar abierto y volvé a intentar.`);
          return;
        }
        setPosicion({ punto: { lat: p.coords.latitude, lng: p.coords.longitude }, precision });
      },
      () => {
        setBuscandoGps(false);
        setError("No se pudo obtener tu ubicación. Revisá el permiso de ubicación del navegador e intentá de nuevo.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  const elegirArchivo = useCallback(async (archivo: File) => {
    setError(null);
    setFoto(null);
    setDocumento(null);
    setVistaPrevia(null);
    if (archivo.type === "application/pdf") {
      if (esVecino) {
        setError("Para informar la resolución hace falta una foto.");
        return;
      }
      if (archivo.size > EVIDENCIA.PDF_MAXIMO_BYTES) {
        setError(`El PDF pesa ${formatearTamano(archivo.size)} y el máximo es ${formatearTamano(EVIDENCIA.PDF_MAXIMO_BYTES)}.`);
        return;
      }
      setDocumento(archivo);
      return;
    }
    setPreparando(true);
    try {
      const preparada = await prepararFoto(archivo);
      setFoto(preparada);
      setVistaPrevia(URL.createObjectURL(preparada.reducida));
    } catch (e) {
      setError(e instanceof ErrorFoto ? e.message : "No se pudo procesar la foto. Intentá con otra imagen.");
    } finally {
      setPreparando(false);
    }
  }, [esVecino]);

  const enviar = useCallback(async () => {
    if ((!foto && !documento) || (esVecino && !posicion)) return;
    setEnviando(true);
    setError(null);
    const datos = new FormData();
    if (documento) {
      datos.append("documento", documento, documento.name);
    } else if (foto) {
      datos.append("foto", foto.reducida, "foto.jpg");
      datos.append("hashOriginal", foto.hashOriginal);
      if (foto.exifFecha) datos.append("exifFecha", foto.exifFecha);
      if (foto.exifLat !== null && foto.exifLng !== null) {
        datos.append("exifLat", String(foto.exifLat));
        datos.append("exifLng", String(foto.exifLng));
      }
    }
    if (posicion) {
      datos.append("lat", String(posicion.punto.lat));
      datos.append("lng", String(posicion.punto.lng));
      datos.append("gpsAccuracy", String(posicion.precision));
    }
    try {
      const { res, data } = await api(`/api/incidents/${incident.id}/resolucion`, { method: "POST", body: datos });
      if (!res.ok) {
        setError(data?.message ?? "No se pudo registrar el informe.");
        return;
      }
      onListo(data.data);
    } catch {
      setError("Error de conexión. Verificá tu internet e intentá nuevamente.");
    } finally {
      setEnviando(false);
    }
  }, [foto, documento, esVecino, posicion, incident.id, onListo]);

  const listo = (foto || documento) && (!esVecino || posicion) && !preparando;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Informar la resolución">
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div>
              <h2 className={styles.title}>{esVecino ? "Informar que se resolvió" : "Cargar información oficial"}</h2>
              <p className={styles.subtitle}>{incident.category} · N.° {incident.id}</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.step}>
            <p className={styles.stepDesc}>
              {esVecino
                ? <>Tenés que estar a menos de <strong>{RADIO_METROS} m</strong> del incidente y sacar una foto que muestre el arreglo. Un operador la revisa antes de cerrarlo.</>
                : <>Adjuntá una foto o un PDF con la información oficial del arreglo. Después lo validás desde la bandeja &quot;En revisión&quot;.</>}
            </p>

            {error && <div className={styles.errorBox} role="alert">{error}</div>}

            {esVecino && (
              posicion ? (
                <div className={styles.successBox}>
                  <div className={styles.successIcon}>📍</div>
                  <div>
                    <div className={styles.successTitle}>Ubicación capturada</div>
                    <div className={styles.successDetail}>±{posicion.precision} m</div>
                  </div>
                </div>
              ) : (
                <button className={`${styles.btnPrimary} ${buscandoGps ? styles.loading : ""}`} onClick={capturarUbicacion} disabled={buscandoGps} id="btn-resolucion-gps">
                  {buscandoGps ? "Obteniendo GPS…" : "📍 Capturar mi ubicación"}
                </button>
              )
            )}

            <input
              ref={entradaRef}
              type="file"
              accept={esVecino ? "image/*" : "image/*,application/pdf"}
              // D-22: el vecino saca la foto con la cámara trasera en el momento.
              {...(esVecino ? { capture: "environment" as const } : {})}
              style={{ display: "none" }}
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) elegirArchivo(archivo);
                e.target.value = "";
              }}
              id="input-resolucion-evidencia"
            />

            {preparando ? (
              <div className={styles.photoDropzone} aria-live="polite">
                <span className={styles.dropzoneIcon}>⏳</span>
                <span>Preparando la foto…</span>
              </div>
            ) : foto && vistaPrevia ? (
              <div className={styles.photoPreview}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={vistaPrevia} alt="Foto del arreglo" className={styles.previewImg} />
                <div className={styles.photoMeta}>
                  <span className={styles.metaItem}>📏 {formatearTamano(foto.reducida.size)} ({foto.ancho} × {foto.alto} px)</span>
                </div>
                <button className={styles.btnSecondary} onClick={() => entradaRef.current?.click()}>Cambiar foto</button>
              </div>
            ) : documento ? (
              <div className={styles.photoPreview}>
                <div className={styles.photoMeta}>
                  <span className={styles.metaItem}>📄 {documento.name} · {formatearTamano(documento.size)}</span>
                </div>
                <button className={styles.btnSecondary} onClick={() => entradaRef.current?.click()}>Cambiar archivo</button>
              </div>
            ) : (
              <button className={styles.photoDropzone} onClick={() => entradaRef.current?.click()} id="btn-resolucion-evidencia">
                <span className={styles.dropzoneIcon}>{esVecino ? "📷" : "📎"}</span>
                <span>{esVecino ? "Sacar la foto del arreglo" : "Adjuntar foto o PDF"}</span>
                <span className={styles.dropzoneHint}>
                  {esVecino ? "En el teléfono se abre la cámara" : `PDF de hasta ${formatearTamano(EVIDENCIA.PDF_MAXIMO_BYTES)}`}
                </span>
              </button>
            )}

            <div className={styles.navButtons}>
              <button className={styles.btnSecondary} onClick={onClose} disabled={enviando}>Cancelar</button>
              <button
                className={`${styles.btnPrimary} ${enviando ? styles.loading : ""}`}
                onClick={enviar}
                disabled={!listo || enviando}
                id="btn-resolucion-enviar"
              >
                {enviando ? "Enviando…" : "Enviar informe"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
