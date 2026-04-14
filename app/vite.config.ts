import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',

      // Inject the SW registration script automatically
      injectRegister: 'auto',

      workbox: {
        // Precache the entire compiled app shell
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,ttf,otf}'],

        // Network-first for navigation (single-page app fallback)
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          // Google Fonts CSS — cache-first (stylesheet changes rarely)
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'galawgaw-google-fonts-css',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          // Google Fonts binary files — cache-first, immutable
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'galawgaw-google-fonts-woff2',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          // Worker / Notion API — network-first with stale fallback so the
          // last-known program / session data is visible when offline.
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'galawgaw-worker-api',
              networkTimeoutSeconds: 8,
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24, // 24 h stale fallback
              },
            },
          },
        ],
      },

      // Inline manifest — keeps it in sync with public/manifest.json
      // vite-plugin-pwa merges this with the file; listing key fields here
      // so the generated sw.js knows the start_url.
      manifest: {
        name: 'Galawgaw Workout Timer',
        short_name: 'Galawgaw',
        description: 'Pro-grade workout timer with Notion-powered data ownership',
        start_url: '/',
        id: '/',
        display: 'standalone',
        background_color: '#120b18',
        theme_color: '#2D1E2F',
        orientation: 'portrait-primary',
        lang: 'en',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
