/** @type {import('next').NextConfig} */
const nextConfig = {
  // Módulos de servidor que no se empaquetan (controlador de PostgreSQL y bcrypt)
  experimental: {
    serverComponentsExternalPackages: ["pg", "bcryptjs"],
  },
  // Necesario para Leaflet: evitar SSR de módulos que usen window/navigator
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

module.exports = nextConfig;
