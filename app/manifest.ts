import type { MetadataRoute } from 'next';

/**
 * v8 — PWA manifest (served at /manifest.webmanifest by Next). Together
 * with the registered service worker this makes Callitnow installable on
 * phones — betting traffic is an evening-on-the-couch audience.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Callitnow — Make the call. Make the market.',
    short_name: 'Callitnow',
    description:
      'Trade real-world events — or launch your own prediction market in seconds.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0E1C28',
    theme_color: '#0E1C28',
    icons: [
      {
        src: '/brand/callitnow-icon-256.png',
        sizes: '256x256',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/callitnow-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // The squircle icon has its own safe margin — it doubles as maskable.
        src: '/brand/callitnow-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
