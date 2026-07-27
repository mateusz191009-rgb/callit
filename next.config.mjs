/** @type {import('next').NextConfig} */
const nextConfig = {
  // StrictMode's double-invoked effects break framer-motion 12.4x
  // AnimatePresence exit unmounts (elements stick at opacity 0 and block
  // clicks). Keep off until the upstream incompatibility is resolved.
  reactStrictMode: false,
  experimental: {
    // Rewrites barrel imports to deep paths so a named import pulls in the
    // one module it names instead of the package index. lucide-react is the
    // case that matters here — it is imported by name in ~50 files.
    optimizePackageImports: ['lucide-react', 'recharts', 'framer-motion'],
  },
};

export default nextConfig;
