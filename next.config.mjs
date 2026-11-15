/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Packaged Apps use relative assets; the dev server uses Next's default URLs.
  assetPrefix: process.env.NODE_ENV === "production" ? "." : undefined,
  // Debian/glibc target: omit the alternative musl image libraries.
  outputFileTracingExcludes: {
    "**": ["**/node_modules/@img/*linuxmusl*/**"],
  },
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react"],
};

export default nextConfig;
