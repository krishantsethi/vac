/** @type {import('next').NextConfig} */

// Where the browser's /api/v1 requests go.
//
// Three cases, and getting them wrong is what previously produced a production
// URL of http://localhost:8000:
//
//   1. NEXT_PUBLIC_API_URL set  -> proxy to that origin (local development, or a
//                                  backend hosted separately from the frontend).
//   2. On Vercel with nothing set -> NO rewrite. The Python function answers
//                                  /api/v1/* on this same origin, so proxying
//                                  would only add a hop and break cookies.
//   3. Local with nothing set   -> proxy to http://localhost:8000.
//
// Same-origin matters for authentication as much as for latency: a cross-origin
// API makes the session cookie third-party, which browsers are increasingly
// unwilling to store.
const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || "").trim();
const sameOriginApi = process.env.API_SAME_ORIGIN === "1" || (!apiOrigin && process.env.VERCEL === "1");

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "via.placeholder.com" },
    ],
  },
  async rewrites() {
    if (sameOriginApi) return [];
    return [
      { source: "/api/v1/:path*", destination: `${apiOrigin || "http://localhost:8000"}/api/v1/:path*` },
    ];
  },
};
export default nextConfig;