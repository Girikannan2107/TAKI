import type { NextConfig } from "next";

/**
 * TAKI Travel — Next.js config.
 * cacheComponents is intentionally disabled: the demo is client-state driven
 * (zustand + localStorage) and does not benefit from PPR/cache components.
 * Re-evaluate when a real backend (Firebase) is integrated.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
