/**
 * SIRU — scripts/admin-comun.ts
 * Utilidades de los scripts del administrador técnico.
 */
import { randomInt } from "node:crypto";
import { requisitosIncumplidos } from "../src/lib/politicaClave";

const MAYUS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUS = "abcdefghijkmnpqrstuvwxyz";
const NUM = "23456789";
const ESP = "#$%&*+?!";

/** Genera una contraseña temporal aleatoria que cumple la política de claves. */
export function claveTemporal(email: string): string {
  const todos = MAYUS + MINUS + NUM + ESP;
  for (;;) {
    const partes = [MAYUS, MINUS, NUM, ESP].map((g) => g[randomInt(g.length)]);
    while (partes.length < 12) partes.push(todos[randomInt(todos.length)]);
    for (let i = partes.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [partes[i], partes[j]] = [partes[j], partes[i]];
    }
    const clave = partes.join("");
    if (requisitosIncumplidos(clave, email).length === 0) return clave;
  }
}

export function emailDeArgumentos(): string {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Indicá el correo como argumento. Ejemplo: npm run admin:crear-operador -- referente@fomento.org");
    process.exit(1);
  }
  return email;
}
