/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  productionBrowserSourceMaps: false,
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{kebabCase member}}",
      preventFullImport: true,
    },
    "date-fns": {
      transform: "date-fns/{{member}}",
      preventFullImport: true,
    },
  },
  experimental: {
    optimizePackageImports: [
      "recharts",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-popover",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
      "cmdk",
    ],
  },
  images: {
    domains: ["avatars.githubusercontent.com", "lh3.googleusercontent.com"],
    formats: ["image/avif", "image/webp"],
  },
  // Allow WASM for xlsx
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false, stream: false };
    return config;
  },
};

export default nextConfig;
