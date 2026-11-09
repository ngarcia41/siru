/**
 * SIRU — app/layout.tsx
 * Root Layout de Next.js App Router.
 * Define el shell HTML global, meta SEO y la importación del design system.
 */

import type { Metadata, Viewport } from "next";
// Estilos de Leaflet desde el paquete instalado (no depende de un CDN externo)
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIRU — Sistema Interactivo de Reportes Urbanos",
  description:
    "Plataforma ciudadana de reportes urbanos con verificación espacial y puntos de confianza colectivos. Proyecto TFG — Ramos Mejía, Buenos Aires.",
  keywords: ["reportes urbanos", "participación ciudadana", "Ramos Mejía", "incidentes", "geolocalización"],
  authors: [{ name: "SIRU TFG Project" }],
  robots: "noindex, nofollow", // Proyecto académico, no indexar
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Deshabilitar zoom en móvil para mejor UX de mapa
  themeColor: "#0d1117",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
