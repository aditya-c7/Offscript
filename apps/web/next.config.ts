import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  webpack(config) {
    // Workspace packages use explicit .js specifiers for NodeNext consumers.
    // Map them back to the TypeScript sources when bundling for the browser.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
