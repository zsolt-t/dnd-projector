import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative asset URLs so the build works on a subpath (GitHub Pages) and
  // when opened directly from disk (file://).
  base: './',
  plugins: [
    VitePWA({
      // 'prompt': the app shows an update button instead of the SW silently
      // reloading the page (which would wipe the in-memory session state).
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      manifest: {
        name: 'DnD Projector',
        short_name: 'DnD Projector',
        description:
          'Projection mapping for tabletop gaming — warp battle maps onto physical surfaces.',
        display: 'standalone',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
