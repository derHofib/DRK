import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Reine App-Shell-Strategie: nur das gebaute Frontend wird gecacht,
      // damit die App startet (und Zimmer/Klienten/etc. als leere Seite
      // statt als Netzwerkfehler laedt), nie API-Antworten -- ein
      // gecachter Kassenbuch-Stand waere sonst irrefuehrend, sobald sich
      // die echten Daten geaendert haben. Siehe README, "Was hier bewusst
      // fehlt" fuer die Grenzen dieser Offline-Unterstuetzung.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "Zimmerakte",
        short_name: "Zimmerakte",
        description: "Verwaltung für Betreutes Wohnen",
        lang: "de",
        // Platzhalter-Markenfarbe, siehe src/styles/tokens.css -- beide
        // zusammen austauschen, sobald echte Werte vorliegen.
        theme_color: "#2c5f5a",
        background_color: "#f5f5f5",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
