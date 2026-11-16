import type { RueckmeldungKontext } from "@zimmerakte/shared";

// Von vite.config.ts eingesetzt (define).
declare const __APP_VERSION__: string;

/** Hoechstens grob: Name und Hauptversion, keine Build-Nummern (kein Fingerprinting). */
function browserName(ua: string): string {
  const treffer =
    /(Edg|OPR|Firefox|Chrome|CriOS|FxiOS|Version)\/(\d+)/.exec(ua) ?? /(Safari)\/(\d+)/.exec(ua);
  if (!treffer) return "unbekannt";
  const name = { Edg: "Edge", OPR: "Opera", CriOS: "Chrome iOS", FxiOS: "Firefox iOS", Version: "Safari" }[treffer[1]] ?? treffer[1];
  return `${name} ${treffer[2]}`;
}

function betriebssystem(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "unbekannt";
}

/**
 * Rahmenbedingungen, die mit der Rueckmeldung gehen. Bewusst eine Whitelist
 * fester Felder (der Server verwirft alles andere): keine Konsole, keine
 * Requests, kein Klickpfad -- deren Inhalte enthalten Klientendaten.
 * `seite` ist der Name der Ansicht ("klienten"), nie ein Pfad mit Ids.
 */
export function sammleKontext(args: { seite: string; rolle?: string }): RueckmeldungKontext {
  const ua = navigator.userAgent;
  return {
    seite: args.seite,
    appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    browser: browserName(ua),
    betriebssystem: betriebssystem(ua),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    theme: document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dunkel" : "hell"),
    rolle: args.rolle,
    zeitpunkt: new Date().toISOString(),
  };
}
