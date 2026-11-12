/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react"],
  serverExternalPackages: ["node-pty"],
};

export default nextConfig;
