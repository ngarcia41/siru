/** @type {import('next').NextConfig} */
const nextConfig = {
  // Necesario para Leaflet: evitar SSR de módulos que usen window/navigator
  webpack: (config) => {
    config.resolve.fallback = { fs: false };
    return config;
  },
};

module.exports = nextConfig;
