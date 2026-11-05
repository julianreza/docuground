import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  cacheComponents: true,
  partialPrefetching: true,

};

export default nextConfig;
