/**
 * SIRU — components/Dashboard/AccionesIncidente.tsx
 * Acciones sobre el incidente seleccionado en el panel (T12).
 *
 *   Vecino, incidente activo:      "Informar que se resolvió" (HU-05 criterio 1).
 *   Operador, en revisión:         evidencia (miniatura o PDF), quién informó, cuándo y a qué
 *                                  distancia; Validar o Rechazar con observación (criterios 2 y 3).
 *   Operador, sin verificar/activo: Reclasificar (HU-04 criterio 4, D-13), Desestimar con
 *                                  observación (criterio 4, D-09) y, si está activo, cargar la
 *                                  información oficial (D-10).
 */
"use client";

import { useEffect, useState } from "react";
import type { Incident, IncidentCategory, IncidentSeverity } from "@/lib/types";
import { api } from "@/lib/cliente/api";
import { CATEGORIAS, OBSERVACION } from "@/lib/reglas";
import styles from "./StatsPanel.module.css";

interface Props {
  incident: Incident;
  rol: "VECINO" | "OPERADOR";
  onInformar: (incident: Incident) => void;
  onActualizado: (incident: Incident) => void;
  onDesestimado: (incident: Incident) => void;
}

interface ResolucionPendiente {
  perfil: "VECINO" | "OPERADOR";
  informadaPor: string;
  fechaInforme: string;
  distanciaMetros: number | null;
  tipoEvidencia: "foto" | "pdf";
  miniaturaUrl: string | null;
  fotoUrl: string | null;
  documentoUrl: string | null;
}

type Modo = null | "rechazar" | "desestimar" | "reclasificar";

const SEVERIDADES: { valor: IncidentSeverity; etiqueta: string }[] = [
  { valor: "low", etiqueta: "Baja" },
  { valor: "medium", etiqueta: "Media" },
  { valor: "high", etiqueta: "Alta" },
];

export default function AccionesIncidente({ incident, rol, onInformar, onActualizado, onDesestimado }: Props) {
  const [modo, setModo] = useState<Modo>(null);
  const [observacion, setObservacion] = useState("");
  const [severidad, setSeveridad] = useState<IncidentSeverity>(incident.severity);
  const [categoria, setCategoria] = useState<IncidentCategory>(incident.category);
  const [resolucion, setResolucion] = useState<ResolucionPendiente | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Al cambiar de incidente se limpia el estado de la acción anterior.
  useEffect(() => {
    setModo(null);
    setObservacion("");
    setSeveridad(incident.severity);
    setCategoria(incident.category);
    setError(null);
    setAviso(null);
  }, [incident.id, incident.severity, incident.category]);

  // Bandeja "En revisión": se carga la evidencia y los datos del informe.
  useEffect(() => {
    setResolucion(null);
    if (rol !== "OPERADOR" || incident.status !== "review") return;
    let vigente = true;
    api(`/api/incidents/${incident.id}/resolucion`).then(({ res, data }) => {
      if (vigente && res.ok) setResolucion(data.data);
    });
    return () => { vigente = false; };
  }, [rol, incident.id, incident.status]);

  const enviar = async (url: string, cuerpo: unknown, metodo = "POST") => {
    setEnviando(true);
    setError(null);
    try {
      const { res, data } = await api(url, { method: metodo, body: JSON.stringify(cuerpo) });
      if (!res.ok) {
        setError(data?.message ?? "No se pudo completar la acción.");
        return null;
      }
      return data;
    } catch {
      setError("Error de conexión. Intentá de nuevo.");
      return null;
    } finally {
      setEnviando(false);
    }
  };

  const observacionValida = observacion.trim().length >= OBSERVACION.MINIMO;

  // --- Vecino ---
  if (rol === "VECINO") {
    if (incident.status !== "active") return null;
    return (
      <div className={styles.acciones}>
        <button type="button" className={styles.resolveBtn} onClick={() => onInformar(incident)} id="btn-informar-resolucion">
          ✓ Informar que se resolvió
        </button>
      </div>
    );
  }

  // --- Operador ---
  const validar = async () => {
    const data = await enviar(`/api/incidents/${incident.id}/resolucion/validar`, { resultado: "CONFIRMADA" });
    if (data) onActualizado(data.data);
  };
  const rechazar = async () => {
    const data = await enviar(`/api/incidents/${incident.id}/resolucion/validar`, { resultado: "RECHAZADA", observacion });
    if (data) onActualizado(data.data);
  };
  const desestimar = async () => {
    const data = await enviar(`/api/incidents/${incident.id}/desestimar`, { observacion });
    if (data) {
      if (data.cuentaSuspendida) window.alert("Con este son tres reportes desestimados en 30 días: la cuenta del autor quedó suspendida.");
      onDesestimado(data.data);
    }
  };
  const reclasificar = async () => {
    const cambios: Record<string, string> = {};
    if (severidad !== incident.severity) cambios.severidad = severidad;
    if (categoria !== incident.category) cambios.categoria = categoria;
    const data = await enviar(`/api/incidents/${incident.id}`, { action: "reclasificar", ...cambios }, "PATCH");
    if (data) {
      setModo(null);
      setAviso("Reclasificación guardada.");
      onActualizado(data.data);
    }
  };

  const cerrable = incident.status === "unverified" || incident.status === "active";
  if (incident.status !== "review" && !cerrable) return null;

  return (
    <div className={styles.acciones}>
      {error && <div className={styles.accionError} role="alert">{error}</div>}
      {aviso && !error && <div className={styles.accionAviso}>{aviso}</div>}

      {incident.status === "review" && (
        <div className={styles.evidencia}>
          <div className={styles.evidenciaTitulo}>Resolución informada</div>
          {!resolucion ? (
            <div className={styles.evidenciaDato}>Cargando la evidencia…</div>
          ) : (
            <>
              {resolucion.miniaturaUrl && resolucion.fotoUrl && (
                <a href={resolucion.fotoUrl} target="_blank" rel="noopener noreferrer" title="Ver la foto completa">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={resolucion.miniaturaUrl} alt="Evidencia de la resolución" className={styles.evidenciaImg} loading="lazy" />
                </a>
              )}
              {resolucion.documentoUrl && (
                <a href={resolucion.documentoUrl} target="_blank" rel="noopener noreferrer" className={styles.evidenciaPdf}>📄 Ver el PDF de la información oficial</a>
              )}
              <div className={styles.evidenciaDato}>
                Informó: {resolucion.informadaPor} ({resolucion.perfil === "VECINO" ? "vecino" : "operador"})
              </div>
              <div className={styles.evidenciaDato}>
                {new Date(resolucion.fechaInforme).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                {resolucion.distanciaMetros !== null && <> · a {Math.round(resolucion.distanciaMetros)} m del incidente</>}
              </div>
            </>
          )}
          {modo !== "rechazar" ? (
            <div className={styles.accionFila}>
              <button type="button" className={styles.resolveBtn} onClick={validar} disabled={enviando || !resolucion} id="btn-validar">✓ Validar</button>
              <button type="button" className={styles.accionPeligro} onClick={() => setModo("rechazar")} disabled={enviando} id="btn-rechazar">✕ Rechazar</button>
            </div>
          ) : (
            <FormObservacion
              titulo="Motivo del rechazo (el incidente vuelve a Activo)"
              valor={observacion}
              onCambio={setObservacion}
              valida={observacionValida}
              enviando={enviando}
              confirmar="Rechazar la resolución"
              onConfirmar={rechazar}
              onCancelar={() => setModo(null)}
            />
          )}
        </div>
      )}

      {cerrable && modo === null && (
        <div className={styles.accionFila}>
          {incident.status === "active" && (
            <button type="button" className={styles.accionNeutra} onClick={() => onInformar(incident)} id="btn-informacion-oficial">📎 Información oficial</button>
          )}
          <button type="button" className={styles.accionNeutra} onClick={() => setModo("reclasificar")} id="btn-reclasificar">✎ Reclasificar</button>
          <button type="button" className={styles.accionPeligro} onClick={() => setModo("desestimar")} id="btn-desestimar">⊘ Desestimar</button>
        </div>
      )}

      {cerrable && modo === "reclasificar" && (
        <div className={styles.accionForm}>
          <label className={styles.accionEtiqueta}>
            Severidad
            <select value={severidad} onChange={(e) => setSeveridad(e.target.value as IncidentSeverity)}>
              {SEVERIDADES.map((s) => <option key={s.valor} value={s.valor}>{s.etiqueta}</option>)}
            </select>
          </label>
          <label className={styles.accionEtiqueta}>
            Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value as IncidentCategory)}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className={styles.accionFila}>
            <button type="button" className={styles.accionNeutra} onClick={() => setModo(null)} disabled={enviando}>Cancelar</button>
            <button
              type="button"
              className={styles.resolveBtn}
              onClick={reclasificar}
              disabled={enviando || (severidad === incident.severity && categoria === incident.category)}
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      {cerrable && modo === "desestimar" && (
        <FormObservacion
          titulo="Motivo: reporte falso, inexistente o ajeno al alcance"
          valor={observacion}
          onCambio={setObservacion}
          valida={observacionValida}
          enviando={enviando}
          confirmar="Desestimar el reporte"
          onConfirmar={desestimar}
          onCancelar={() => setModo(null)}
        />
      )}
    </div>
  );
}

function FormObservacion({
  titulo, valor, onCambio, valida, enviando, confirmar, onConfirmar, onCancelar,
}: {
  titulo: string;
  valor: string;
  onCambio: (v: string) => void;
  valida: boolean;
  enviando: boolean;
  confirmar: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className={styles.accionForm}>
      <label className={styles.accionEtiqueta}>
        {titulo}
        <textarea
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          maxLength={OBSERVACION.MAXIMO}
          rows={3}
          placeholder={`Al menos ${OBSERVACION.MINIMO} caracteres`}
        />
      </label>
      <div className={styles.accionFila}>
        <button type="button" className={styles.accionNeutra} onClick={onCancelar} disabled={enviando}>Cancelar</button>
        <button type="button" className={styles.accionPeligro} onClick={onConfirmar} disabled={!valida || enviando}>{confirmar}</button>
      </div>
    </div>
  );
}
