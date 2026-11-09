/**
 * SIRU — app/layout.tsx
 * Root Layout de Next.js App Router.
 * Define el shell HTML global, meta SEO y la importación del design system.
 */

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIRU — Sistema Interactivo de Reportes Urbanos",
  description:
    "Plataforma ciudadana de reportes urbanos con verificación espacial y puntos de confianza colectivos. Proyecto TFG — Ramos Mejía, Buenos Aires.",
  keywords: ["reportes urbanos", "participación ciudadana", "Ramos Mejía", "incidentes", "geolocalización"],
  authors: [{ name: "SIRU TFG Project" }],
  robots: "noindex, nofollow", // Prototipo académico
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
      <head>
        {/* Leaflet CSS — se carga aquí para evitar FOUC en el mapa */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
