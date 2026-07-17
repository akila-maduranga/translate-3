import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow the sandbox preview domain to hit /_next/* resources without
  // triggering the cross-origin dev warning. (Production is unaffected.)
  allowedDevOrigins: ["*.space-z.ai"],
  // TMDB image host — needs to be allowed in next/image for optimization.
  // We use `unoptimized` on the <Image> components themselves, but list
  // the host here too for safety.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
    ],
  },
};

export default nextConfig;
