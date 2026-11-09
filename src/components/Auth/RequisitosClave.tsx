/**
 * SIRU — components/Auth/RequisitosClave.tsx
 * Muestra en vivo qué requisitos de la política de claves faltan cumplir.
 */
"use client";

import { requisitosIncumplidos } from "@/lib/politicaClave";
import styles from "@/app/auth.module.css";

const BASE = [
  "Tener al menos 8 caracteres.",
  "Incluir una letra mayúscula.",
  "Incluir una letra minúscula.",
  "Incluir un número.",
  "Incluir un carácter especial (por ejemplo # $ % & *).",
];

export default function RequisitosClave({ clave, email }: { clave: string; email: string }) {
  const faltan = requisitosIncumplidos(clave, email);
  const extra = faltan.filter((f) => !BASE.includes(f));
  return (
    <ul className={styles.checklist} aria-live="polite">
      {BASE.map((r) => {
        const ok = clave.length > 0 && !faltan.includes(r);
        return <li key={r} className={ok ? styles.cumple : styles.falta}>{ok ? "✓" : "·"} {r}</li>;
      })}
      {clave.length > 0 && extra.map((r) => <li key={r} className={styles.falta}>✗ {r}</li>)}
    </ul>
  );
}
