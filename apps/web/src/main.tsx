import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { KatzenEasterEgg } from "./components/Katze";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./styles/schrift.css";
import "./styles/tokens.css";
import "./styles/app.css";

// Nach einem Server-Update holt sich der Service Worker (registerType:
// "autoUpdate") die neuen Dateien und uebernimmt sofort -- die bereits
// geoeffnete Seite laeuft aber weiter mit dem alten JavaScript, bis jemand
// von Hand neu laedt. Das sah aus, als haette das Update nicht gegriffen.
// Nur neu laden, wenn schon ein Worker die Seite steuerte; beim allerersten
// Besuch (kein Vorgaenger) waere das ein sinnloser Reload.
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  let neuGeladen = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (neuGeladen) return;
    neuGeladen = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      <KatzenEasterEgg />
    </ThemeProvider>
  </React.StrictMode>
);
