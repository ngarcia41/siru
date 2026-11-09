/**
 * SIRU — lib/politicaClave.ts
 * Política de claves del documento (sección Seguridad → Claves).
 * Se usa en el servidor y también en el formulario, para mostrar los
 * requisitos incumplidos antes de enviar.
 */

const PATRONES_TECLADO = ["qwer", "wert", "erty", "rtyu", "tyui", "yuio", "uiop", "asdf", "sdfg", "dfgh",
  "fghj", "ghjk", "hjkl", "zxcv", "xcvb", "cvbn", "vbnm", "1qaz", "qazw", "zaq1"];

function tieneSecuencia(clave: string, largo = 4): boolean {
  const s = clave.toLowerCase();
  for (let i = 0; i + largo <= s.length; i++) {
    let asc = true, desc = true;
    for (let j = 1; j < largo; j++) {
      const d = s.charCodeAt(i + j) - s.charCodeAt(i + j - 1);
      if (d !== 1) asc = false;
      if (d !== -1) desc = false;
    }
    const tramo = s.slice(i, i + largo);
    if ((asc || desc) && /^[a-z]+$|^[0-9]+$/.test(tramo)) return true;
  }
  return false;
}

/** Devuelve la lista de requisitos incumplidos (vacía si la clave es válida). */
export function requisitosIncumplidos(clave: string, email = ""): string[] {
  const faltan: string[] = [];
  if (clave.length < 8) faltan.push("Tener al menos 8 caracteres.");
  if (!/[A-ZÁÉÍÓÚÑ]/.test(clave)) faltan.push("Incluir una letra mayúscula.");
  if (!/[a-záéíóúñ]/.test(clave)) faltan.push("Incluir una letra minúscula.");
  if (!/[0-9]/.test(clave)) faltan.push("Incluir un número.");
  if (!/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ\s]/.test(clave)) faltan.push("Incluir un carácter especial (por ejemplo # $ % & *).");
  if (/\s/.test(clave)) faltan.push("No contener espacios.");
  if (tieneSecuencia(clave)) faltan.push("No contener secuencias como 1234 o abcd.");
  if (/(.)\1{3,}/.test(clave)) faltan.push("No repetir el mismo carácter 4 veces seguidas.");
  const minus = clave.toLowerCase();
  if (PATRONES_TECLADO.some((p) => minus.includes(p))) faltan.push("No contener patrones de teclado como qwerty o asdf.");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && minus.includes(local)) faltan.push("No contener tu correo electrónico.");
  return faltan;
}
