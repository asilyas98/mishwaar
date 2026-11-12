import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'seed/*.json'],
      manifest: {
        name: 'مشوار',
        short_name: 'مشوار',
        description: 'مواقف الحافلات ومحلات الدراجات النارية وطلب التاكسي في اليمن',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#f6f3ec',
        theme_color: '#1f2a5c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Custom service worker (src/sw.js) so it can also receive push notifications.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,json}'] },
      devOptions: { enabled: false },
    }),
  ],
})
