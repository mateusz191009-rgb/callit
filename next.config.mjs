/** @type {import('next').NextConfig} */
const nextConfig = {
  // StrictMode's double-invoked effects break framer-motion 12.4x
  // AnimatePresence exit unmounts (elements stick at opacity 0 and block
  // clicks). Keep off until the upstream incompatibility is resolved.
  reactStrictMode: false,
};

export default nextConfig;
