import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist resolves its cMap and standard-font assets from disk via
  // createRequire, and pdf-to-img loads a native canvas binding. Bundling
  // either breaks those lookups, so they stay external and are required by
  // Node at runtime.
  serverExternalPackages: ["pdfjs-dist", "pdf-to-img", "@napi-rs/canvas", "canvas"],
};

export default nextConfig;
