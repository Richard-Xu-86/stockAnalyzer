import type { NextConfig } from "next";

/** React needs eval() only in development (for debugging call stacks); production never allows it. */
/** Security headers for every response. Personal pages add `Cache-Control: private, no-store` themselves. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" }, // keeps OAuth codes out of Referer headers
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Content-Security-Policy",
    value: ["default-src 'self'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`, "font-src 'self' data:", "frame-ancestors 'none'", "form-action 'self' https://dashboard.snaptrade.com"].join("; "),
  },
];

const config: NextConfig = {
  // PGlite is test-only; keep native/wasm DB drivers out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Personal pages: never stored by a CDN or a shared browser cache.
      ...["/dashboard", "/auth/:path*", "/api/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: "private, no-store" }] })),
    ];
  },
};

export default config;
