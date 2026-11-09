/**
 * SIRU — lib/servidor/correo.ts
 * Envío del enlace de verificación de correo.
 *
 * En el entorno de desarrollo (MODO_CORREO=consola) el enlace no se envía:
 * se muestra en la consola del servidor y en la pantalla de registro, para
 * poder probar el flujo sin un servidor de correo. En producción se
 * reemplaza esta función por un envío SMTP.
 */
export function modoConsola(): boolean {
  return (process.env.MODO_CORREO ?? "consola") === "consola";
}

export async function enviarVerificacion(email: string, enlace: string): Promise<void> {
  if (modoConsola()) {
    console.log(`\n[SIRU · correo simulado] Para: ${email}\nVerificá tu cuenta (válido 24 h): ${enlace}\n`);
    return;
  }
  throw new Error("Envío por SMTP no configurado: definí MODO_CORREO=consola o implementá el envío.");
}
