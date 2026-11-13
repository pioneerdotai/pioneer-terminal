/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Debian/glibc target: omit the alternative musl image libraries.
  outputFileTracingExcludes: {
    "**": ["**/node_modules/@img/*linuxmusl*/**"],
  },
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react"],
};

export default nextConfig;
