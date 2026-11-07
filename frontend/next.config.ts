import type { NextConfig } from "next";

const development = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: process.cwd() },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_URL || "http://127.0.0.1:4000"}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` },
    ] }];
  },
};

export default nextConfig;
