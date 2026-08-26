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
        // woff2 muss hier ausdruecklich mit rein: die Voreinstellung von
        // workbox ist {js,css,html,ico,png,svg} -- OHNE Schriften. Ohne
        // diese Zeile faellt Inter offline aus, die App zeigt dann still
        // die Systemschrift. Nachpruefbar an der Zeile "precache N entries"
        // in der Bauausgabe: die woff2 muss mitgezaehlt werden.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      manifest: {
        name: "Zimmerakte",
        short_name: "Zimmerakte",
        description: "Verwaltung für Betreutes Wohnen",
        lang: "de",
        // Standard-Markenfarbe (Palette "DRK Rot", siehe PASTELL_PALETTEN in
        // packages/shared). Diese beiden Werte sind zwangslaeufig
        // BAUZEITLICH und damit NICHT mandantenindividuell: das Manifest
        // wird einmal gebaut und von allen Traegern geteilt. Der
        // Startbildschirm und der Splash zeigen deshalb fuer alle dieselbe
        // Farbe -- eingefaerbt ist erst die laufende Anwendung. Als bewusste
        // Grenze in der README vermerkt.
        theme_color: "#e3000f",
        background_color: "#fbfbfc",
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
