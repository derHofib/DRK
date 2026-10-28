/**
 * Objektive Pruefung des Designsystems im echten Browser.
 *
 * Der Kern ist die KONTRASTMATRIX: fuer jede kuratierte Palette und vier
 * bewusste Extremfaelle, in hell UND dunkel, werden die tatsaechlich
 * BERECHNETEN Farben echter Elemente gemessen (getComputedStyle) -- nie die
 * geschriebenen Tokenwerte. Nur so geht das Gamut-Mapping des Browsers mit
 * ein: oklch() kann ausserhalb von sRGB liegen, der Browser bildet dann
 * farbtonerhaltend zurueck, und erst das Ergebnis davon sieht der Nutzer.
 *
 * Aufruf (aus apps/web):
 *   node scripts/design-pruefung.mjs
 * Erwartet einen laufenden Vorschauserver auf $BASIS_URL (Standard 4173).
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";

/*
 * Playwright liegt in dieser Umgebung global (/opt/node22/lib/node_modules)
 * und ist bewusst KEINE Abhaengigkeit von @zimmerakte/web -- es gehoert
 * nicht ins Anwendungsbundle. ESM beachtet NODE_PATH nicht, deshalb ueber
 * createRequire mit ausdruecklichen Suchpfaden. PLAYWRIGHT_PFAD erlaubt es,
 * in der CI einen anderen Ort anzugeben.
 */
const require = createRequire(import.meta.url);
function ladePlaywright() {
  const kandidaten = [
    process.env.PLAYWRIGHT_PFAD,
    "playwright",
    "/opt/node22/lib/node_modules/playwright",
  ].filter(Boolean);
  for (const pfad of kandidaten) {
    try {
      return require(pfad);
    } catch {
      /* naechster Kandidat */
    }
  }
  throw new Error(
    "Playwright nicht gefunden. Entweder global installieren oder PLAYWRIGHT_PFAD setzen."
  );
}
const { chromium } = ladePlaywright();

/**
 * Sucht die Chromium-Ordner unter /opt/pw-browsers von Hand statt ueber
 * fs.globSync: das gibt es im "node:fs"-Modul erst seit Node 22, die CI
 * (siehe ci.yml) laeuft aber bewusst auf Node 20 (CLAUDE.md: "Node >= 20").
 * Ein statischer Import einer fehlenden Named-Export bricht den ganzen
 * Skriptstart mit einem SyntaxError ab, noch bevor starteBrowser() ueberhaupt
 * laeuft -- deshalb faellt das nicht erst beim Aufruf auf, sondern sofort.
 */
function chromiumOrdnerKandidaten(basisPfad) {
  try {
    return readdirSync(basisPfad)
      .filter((name) => name.startsWith("chromium-"))
      .flatMap((name) => [`${basisPfad}/${name}/chrome-linux64/chrome`, `${basisPfad}/${name}/chrome-linux/chrome`]);
  } catch {
    return [];
  }
}

/**
 * Startet Chromium und kommt dabei mit beiden Faellen zurecht:
 *  - CI: `playwright install chromium` hat den passenden Build geladen,
 *    der Normalweg funktioniert.
 *  - Diese Entwicklungsumgebung: unter /opt/pw-browsers liegt ein
 *    vorinstallierter Chromium, dessen Build-Nummer nicht zu der von
 *    playwright erwarteten passt. Statt einen zweiten Browser
 *    herunterzuladen, wird er ueber executablePath direkt benannt.
 */
async function starteBrowser() {
  try {
    return await chromium.launch();
  } catch (fehler) {
    const kandidaten = [
      process.env.CHROMIUM_PFAD,
      ...chromiumOrdnerKandidaten("/opt/pw-browsers"),
      "/opt/pw-browsers/chromium/chrome-linux/chrome",
    ].filter(Boolean);
    for (const executablePath of kandidaten) {
      if (!existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ executablePath });
      } catch {
        /* naechster Kandidat */
      }
    }
    throw fehler;
  }
}

const BASIS_URL = process.env.BASIS_URL ?? "http://localhost:4173";
const SCHREIBE_SCREENSHOTS = process.env.SCREENSHOTS !== "0";
const AUSGABE = "design-sources/screenshots";

/** Untergrenze der zu messenden Paare -- siehe Schranke in main(). */
const ERWARTETE_PAARE = 41 + 3 * 7 + 8 + 1 + 4 + 3;

/** Muss zu PASTELL_PALETTEN in packages/shared spiegeln. */
const PALETTEN = [
  ["Tannengruen", "#2d6a4f"],
  ["DRK Rot", "#e3000f"],
  ["Salbei", "#79c7a8"],
  ["Petrol", "#5ec4c0"],
  ["Himmel", "#7fbef0"],
  ["Lavendel", "#a8a4f0"],
  ["Flieder", "#d89ce0"],
  ["Rosé", "#f2a0b5"],
  ["Apricot", "#f5b183"],
  ["Honig", "#efce72"],
  ["Graphit", "#8e96a3"],
  // Extremfaelle: nicht kuratiert, aber ueber den freien Waehler moeglich.
  // Wenn das System hier haelt, haelt es ueberall.
  ["XTREM Knallgelb", "#ffe600"],
  ["XTREM Fast-Weiss", "#fefefe"],
  ["XTREM Fast-Schwarz", "#0a0a0a"],
  ["XTREM Sattblau", "#0000ff"],
];

/* --- Farbmathematik im Node-Prozess (Spiegel von theme/farbe.ts) --- */
const srgbZuLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
function hexZuOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbZuLinear(((n >> 16) & 255) / 255);
  const g = srgbZuLinear(((n >> 8) & 255) / 255);
  const b = srgbZuLinear((n & 255) / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { c: Math.hypot(a, bb), h };
}
function akzentAbleiten(hex) {
  const { c, h } = hexZuOklch(hex);
  if (c < 0.03) return { h: 0, c: 0 };
  return { h: Math.round(h * 10) / 10, c: Math.min(0.125, Math.max(0.05, c)) };
}

/* --- Im Browser ausgefuehrt --- */
const BROWSER_HELFER = `
/*
 * Farben ueber eine 1x1-Leinwand aufloesen statt sie zu parsen.
 *
 * Der Grund ist gemessen, nicht theoretisch: getComputedStyle liefert in
 * Chromium fuer oklch()-Werte die ROHE oklch()-Zeichenkette zurueck, nicht
 * ein aufgeloestes rgb(). Ein Parser fuer rgb()/rgba() bekommt davon nichts
 * und liefert still null -- die erste Fassung dieses Skripts hat dadurch
 * NULL Paare gemessen und trotzdem "alles in Ordnung" gemeldet.
 *
 * Die Leinwand loest zusaetzlich das eigentliche Problem: sie liefert
 * genau die sRGB-Bytes, die der Browser auch auf den Bildschirm bringt --
 * inklusive des Gamut-Mappings fuer oklch()-Werte ausserhalb von sRGB.
 * Genau die will man messen, nicht den geschriebenen Wunschwert.
 */
const __c = document.createElement("canvas");
__c.width = __c.height = 1;
const __g = __c.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });

const UNGUELTIG_MARKE = "#010203";

function parseFarbe(s) {
  if (!s || s === "transparent" || s === "none") return null;

  // Ungueltige Zuweisungen laesst die Leinwand still fallen -- der alte
  // Wert bleibt stehen. Mit einer unverwechselbaren Marke davor faellt das
  // auf, statt als Schwarz durchzugehen.
  __g.fillStyle = UNGUELTIG_MARKE;
  __g.fillStyle = s;
  if (__g.fillStyle === UNGUELTIG_MARKE && s.toLowerCase() !== UNGUELTIG_MARKE) return null;

  __g.clearRect(0, 0, 1, 1);
  __g.fillRect(0, 0, 1, 1);
  // getImageData liefert NICHT vormultipliziert: d[0..2] ist die Farbe,
  // d[3] die Deckkraft.
  const d = __g.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return null;
  return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
}
function lum({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// Halbtransparente Vordergruende ueber dem Hintergrund zusammenrechnen,
// sonst misst man einen Kontrast, den niemand so sieht.
function ueber(v, h) {
  if (v.a >= 1) return v;
  return { r: v.r * v.a + h.r * (1 - v.a), g: v.g * v.a + h.g * (1 - v.a), b: v.b * v.a + h.b * (1 - v.a), a: 1 };
}
function kontrast(vs, hs) {
  const v0 = parseFarbe(vs), h = parseFarbe(hs);
  if (!v0 || !h) return null;
  const v = ueber(v0, h);
  const a = lum(v), b = lum(h);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
// Effektiver Hintergrund: den Baum hinauf, bis eine deckende Farbe kommt.
function hintergrundVon(el) {
  let k = el;
  while (k) {
    const f = parseFarbe(getComputedStyle(k).backgroundColor);
    if (f && f.a > 0.99) return getComputedStyle(k).backgroundColor;
    k = k.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor;
}
`;

async function messePaare(page) {
  return page.evaluate(
    // eslint-disable-next-line no-new-func
    new Function(
      BROWSER_HELFER +
        `
      const ergebnisse = [];
      function pruefe(label, el, schwelle, farbeAttr) {
        if (!el) return;
        const st = getComputedStyle(el);
        const vg = farbeAttr === "border" ? st.borderTopColor : st.color;
        const hg = hintergrundVon(el.parentElement || el);
        const eigen = parseFarbe(st.backgroundColor);
        const wirkHg = eigen && eigen.a > 0.99 ? st.backgroundColor : hg;
        const k = kontrast(vg, wirkHg);
        if (k !== null) ergebnisse.push({ label, wert: k, schwelle });
      }
      const q = (s) => document.querySelector(s);

      pruefe("Knopftext auf Knopf", q(".zv-pruef-btn"), 4.5);
      pruefe("Knopf sekundaer", q(".zv-pruef-btn-sek"), 4.5);
      pruefe("Linktext", q(".zv-pruef-link"), 4.5);
      pruefe("Pill Standard", q(".zv-pruef-pill"), 4.5);
      pruefe("Pill vergeben", q(".zv-pruef-pill-vergeben"), 4.5);
      pruefe("Pill ok", q(".zv-pruef-pill-ok"), 4.5);
      pruefe("Pill offen", q(".zv-pruef-pill-offen"), 4.5);
      pruefe("Pill danger", q(".zv-pruef-pill-danger"), 4.5);
      pruefe("Pill info", q(".zv-pruef-pill-info"), 4.5);
      pruefe("Text auf Surface", q(".zv-pruef-text"), 4.5);
      pruefe("Text muted auf Surface", q(".zv-pruef-muted"), 4.5);
      pruefe("Text faint auf Surface", q(".zv-pruef-faint"), 4.5);
      pruefe("Text faint auf Surface-2", q(".zv-pruef-faint-s2"), 4.5);
      pruefe("Tabellenkopf", q(".zv-pruef-th"), 4.5);
      pruefe("Aktiver Reiter", q(".zv-pruef-tab"), 4.5);
      pruefe("Betrag negativ", q(".zv-pruef-neg"), 4.5);
      pruefe("Hinweis Fehler", q(".zv-pruef-hinweis-fehler"), 4.5);
      pruefe("Hinweis Erfolg", q(".zv-pruef-hinweis-erfolg"), 4.5);
      pruefe("Eingabefeldrand", q(".zv-pruef-input"), 3, "border");
      pruefe("Menue-Zaehler (Badge)", q(".zv-pruef-badge"), 4.5);
      pruefe("Chat: eigener Text", q(".zv-pruef-blase-text"), 4.5);
      pruefe("Chat: Uhrzeit in eigener Blase", q(".zv-pruef-blase-zeit"), 4.5);
      pruefe("Chat: Absendername", q(".zv-pruef-blase-absender"), 4.5);
      pruefe("Chat: Vorschau ungelesen", q(".zv-pruef-vorschau"), 4.5);
      pruefe("Chat: Hinweis Löschfrist im Verlauf", q(".zv-pruef-chat-frist"), 4.5);
      pruefe("Anfragen: Titel auf Surface-2", q(".zv-pruef-anfragen-kopf"), 4.5);
      pruefe("Anfrage: Ziel (muted) auf Karte", q(".zv-pruef-anfrage-ziel"), 4.5);
      pruefe("Anfrage: Auswahl Ziel aktiv", q(".zv-pruef-ziel-aktiv"), 4.5);
      pruefe("Klient: aktiver Bereich", q(".zv-pruef-klient-nav"), 4.5);
      pruefe("Uebergabe: Betrag auf Seitenhintergrund", q(".zv-pruef-ue-betrag"), 4.5);
      pruefe("Uebergabe: Kicker (muted) auf Seitenhintergrund", q(".zv-pruef-ue-kicker"), 4.5);
      pruefe("Uebergabe: Warnhinweis auf Seitenhintergrund", q(".zv-pruef-ue-hinweis"), 4.5);
      pruefe("Uebergabe: Knopf Unterschreiben", q(".zv-pruef-ue-knopf"), 4.5);
      pruefe("Palette: Text auf Surface", q(".zv-pruef-pal-titel"), 4.5);
      pruefe("Palette: Untertitel (muted)", q(".zv-pruef-pal-unter"), 4.5);
      pruefe("Palette: Gruppenkopf (muted)", q(".zv-pruef-pal-gruppe"), 4.5);
      pruefe("Palette: aktive Zeile (Text auf accent-soft)", q(".zv-pruef-pal-aktiv"), 4.5);
      pruefe("Palette: Hervorhebung <mark>", q(".zv-pruef-pal-mark"), 4.5);
      pruefe("Palette: Fusszeile (muted)", q(".zv-pruef-pal-fuss"), 4.5);
      pruefe("Palette: Statuszeile (muted)", q(".zv-pruef-pal-status"), 4.5);
      pruefe("Belegnummer im Kassenbuch (muted)", q(".zv-pruef-beleg-nr"), 4.5);

      // Redesign "ruhige Fachanwendung": neue Neutraltoene, Tags, Koralle.
      // Jeder Text-Token wird auf JEDER Flaeche gemessen, auf der er
      // vorkommt -- gedaempfter Text steht als Kontextzeile direkt auf dem
      // Seitenhintergrund, als Gruppenlabel auf Flaeche gedaempft.
      for (const flaeche of ["bg", "surface", "s2"]) {
        pruefe("Text auf " + flaeche, q(".zv-pruef-n-" + flaeche + " .t"), 4.5);
        pruefe("Text sekundaer auf " + flaeche, q(".zv-pruef-n-" + flaeche + " .ts"), 4.5);
        pruefe("Text gedaempft auf " + flaeche, q(".zv-pruef-n-" + flaeche + " .tg"), 4.5);
        pruefe("Achtung-Text auf " + flaeche, q(".zv-pruef-n-" + flaeche + " .ta"), 4.5);
        pruefe("Link auf " + flaeche, q(".zv-pruef-n-" + flaeche + " .zv-link-btn"), 4.5);
        // Koralle als Marker (Heute-Linie, Auszugskante): Grafik mit
        // Bedeutung, WCAG 1.4.11 -> 3:1.
        pruefe("Achtung-Marker auf " + flaeche, q(".zv-pruef-n-" + flaeche + " .ma"), 3, "border");
        // Akzent als Grafik (Fortschritts-/Laufzeitbalken).
        pruefe("Akzent-Balken auf " + flaeche, q(".zv-pruef-n-" + flaeche + " .mb"), 3, "border");
      }
      pruefe("Kontextzeile (gedaempft, Mono) auf Hintergrund", q(".zv-pruef-kontext"), 4.5);
      pruefe("Tag neutral", q(".zv-pruef-tag-neutral"), 4.5);
      pruefe("Tag erledigt", q(".zv-pruef-tag-erledigt"), 4.5);
      pruefe("Tag Frist", q(".zv-pruef-tag-frist"), 4.5);
      pruefe("Tag achtung", q(".zv-pruef-tag-achtung"), 4.5);
      // Heute: die echten Klassen, nicht Nachbauten -- eine umbenannte
      // Klasse in app.css faellt hier sofort auf (Messung bricht ab).
      pruefe("Heute: ueberfaellige Frist auf Flaeche", q(".zv-pruef-heute-frist"), 4.5);
      pruefe("Heute: Lage-Folgezeile achtung auf Flaeche", q(".zv-pruef-heute-folge"), 4.5);
      pruefe("Heute: naechster Termin (Uhrzeit)", q(".zv-pruef-heute-uhr"), 4.5);
      pruefe("Heute: vergangener Termin (durchgestrichen)", q(".zv-pruef-heute-vorbei"), 4.5);
      pruefe("Zeitleiste: Balkentext auf Balken", q(".zv-pruef-zl-balken"), 4.5);
      pruefe("Journal: stornierter Betrag auf Flaeche", q(".zv-pruef-journal-storno"), 4.5);
      pruefe("Journal: Tabellenkopf auf Flaeche", q(".zv-pruef-journal-kopf"), 4.5);
      pruefe("Eingabefeldrand auf Hintergrund", q(".zv-pruef-input-bg"), 3, "border");
      pruefe("Aktiver Menuepunkt (accent-strong auf accent-soft)", q(".zv-pruef-nav-aktiv"), 4.5);
      pruefe("Gedaempft auf ausgewaehlter Zeile", q(".zv-pruef-auswahl-tg"), 4.5);
      pruefe("Text auf Hover-Zeile", q(".zv-pruef-hover-tg"), 4.5);
      return ergebnisse;
    `
    )
  );
}

/** Eine Seite mit je einem Exemplar aller zu messenden Elemente. */
const PRUEFSEITE = `
<div class="zv-content" style="padding:24px">
  <button class="zv-btn zv-pruef-btn">Aktion</button>
  <button class="zv-btn zv-btn-sekundaer zv-pruef-btn-sek">Zweitrangig</button>
  <button class="zv-link-btn zv-pruef-link">Verweis</button>
  <div style="background:var(--zv-surface);padding:16px">
    <span class="zv-pill zv-pruef-pill">Standard</span>
    <span class="zv-pill zv-pill-vergeben zv-pruef-pill-vergeben">Vergeben</span>
    <span class="zv-pill zv-pill-ok zv-pruef-pill-ok">Bezahlt</span>
    <span class="zv-pill zv-pill-offen zv-pruef-pill-offen">Offen</span>
    <span class="zv-pill zv-pill-danger zv-pruef-pill-danger">Abgelehnt</span>
    <span class="zv-pill zv-pill-info zv-pruef-pill-info">Genehmigt</span>
    <p class="zv-pruef-text" style="color:var(--zv-text)">Fliesstext</p>
    <p class="zv-pruef-muted" style="color:var(--zv-text-muted)">Sekundaer</p>
    <p class="zv-pruef-faint" style="color:var(--zv-text-faint)">Leise</p>
    <p class="zv-pruef-neg" style="color:var(--zv-status-danger)">-12,00 &euro;</p>
    <div class="zv-hinweis zv-hinweis-fehler zv-pruef-hinweis-fehler">Fehler</div>
    <div class="zv-hinweis zv-hinweis-erfolg zv-pruef-hinweis-erfolg">Erfolg</div>
    <div class="zv-field"><input class="zv-pruef-input" value="Eingabe"></div>
  </div>
  <div style="background:var(--zv-surface-2);padding:16px">
    <p class="zv-pruef-faint-s2" style="color:var(--zv-text-faint);margin:0">Leise auf Surface-2</p>
  </div>
  <span class="zv-nav-badge zv-pruef-badge" style="margin:0">3</span>
  <div class="zv-blase zv-blase-eigene" style="max-width:none">
    <div class="zv-blase-text zv-pruef-blase-text">Eigene Nachricht</div>
    <div class="zv-blase-fuss zv-pruef-blase-zeit"><span>12:00</span></div>
  </div>
  <div class="zv-blase" style="max-width:none">
    <div class="zv-blase-absender zv-pruef-blase-absender">Anna Leitung</div>
  </div>
  <div class="zv-chat-eintrag"><span class="zv-chat-vorschau ungelesen zv-pruef-vorschau">Vorschau</span></div>
  <div class="zv-chat-nachrichten" style="overflow:visible"><p class="zv-chat-frist zv-pruef-chat-frist">Nachrichten werden nach 90 Tagen gelöscht.</p></div>
  <section class="zv-anfragen">
    <h3 class="zv-anfragen-kopf zv-pruef-anfragen-kopf">Anfragen</h3>
    <ul class="zv-anfragen-liste"><li class="zv-anfrage">
      <span class="zv-anfrage-ziel zv-pruef-anfrage-ziel">An: Team Haus Eins</span>
    </li></ul>
  </section>
  <ul class="zv-kontaktliste"><li><button class="zv-kontakt-zeile zv-ziel aktiv zv-pruef-ziel-aktiv">Team Haus Eins</button></li></ul>
  <nav class="zv-klient-nav"><button class="active zv-pruef-klient-nav">Nachrichten</button></nav>
  <table class="zv-table"><thead><tr><th class="zv-pruef-th">Spalte</th></tr></thead>
    <tbody><tr><td>Wert</td></tr></tbody></table>
  <div class="zv-tabbar"><button class="active zv-pruef-tab">Aktiv</button></div>
</div>
<div class="zv-uebergabe" style="min-height:0">
  <div class="zv-uebergabe-block">
    <p class="zv-uebergabe-kicker zv-pruef-ue-kicker">Vorbereitung durch Mitarbeitende</p>
    <p class="zv-uebergabe-betrag zv-mono zv-pruef-ue-betrag">20,00 &euro;</p>
    <p class="zv-uebergabe-hinweis zv-pruef-ue-hinweis">Der Betrag &uuml;bersteigt den Barbetrag.</p>
    <button class="zv-btn zv-uebergabe-knopf zv-pruef-ue-knopf">Unterschreiben</button>
  </div>
</div>
<div class="zv-palette" style="max-height:none">
  <p class="zv-palette-status zv-pruef-pal-status">3 Treffer</p>
  <div class="zv-palette-gruppe zv-pruef-pal-gruppe">Klient:innen</div>
  <div class="zv-palette-zeile"><span class="zv-palette-text"><span class="zv-palette-titel zv-pruef-pal-titel">Anna <mark class="zv-pruef-pal-mark">Maria</mark></span><span class="zv-palette-untertitel zv-pruef-pal-unter">Haus Eins</span></span></div>
  <div class="zv-palette-zeile aktiv"><span class="zv-palette-text"><span class="zv-palette-titel zv-pruef-pal-aktiv">Aktive Zeile</span></span></div>
  <div class="zv-palette-fuss zv-pruef-pal-fuss">Esc schlie&szlig;en</div>
</div>
<span class="zv-beleg-nr zv-mono zv-pruef-beleg-nr">KB-00042</span>
<div style="background:var(--zv-bg)">
<p class="zv-kontextzeile zv-pruef-kontext">Mo 26.10.2026 &middot; KW 44 &middot; Fruehdienst</p>
${["bg", "surface", "s2"].map((f) => `
  <div class="zv-pruef-n-${f}" style="padding:8px;background:${{ bg: "var(--zv-bg)", surface: "var(--zv-surface)", s2: "var(--zv-surface-2)" }[f]}">
    <span class="t" style="color:var(--zv-text)">Text</span>
    <span class="ts" style="color:var(--zv-text-sekundaer)">Sekundaer</span>
    <span class="tg" style="color:var(--zv-text-gedaempft)">Gedaempft</span>
    <span class="ta" style="color:var(--zv-achtung-text)">ueberfaellig</span>
    <button class="zv-link-btn">Verweis</button>
    <div class="ma" style="border-top:2px solid var(--zv-achtung)"></div>
    <div class="mb" style="border-top:2px solid var(--zv-accent)"></div>
  </div>`).join("")}
  <span class="zv-pill zv-pruef-tag-neutral">neutral</span>
  <span class="zv-pill zv-pill-erledigt zv-pruef-tag-erledigt">erledigt</span>
  <span class="zv-pill zv-pill-frist zv-pruef-tag-frist">endet in 37 T.</span>
  <span class="zv-pill zv-pill-achtung zv-pruef-tag-achtung">frei</span>
  <div style="background:var(--zv-surface);padding:8px">
    <span class="zv-todo-frist zv-todo-frist-achtung zv-mono zv-pruef-heute-frist">seit 3 Tagen</span>
    <span class="zv-lage-folge zv-lage-folge-achtung zv-pruef-heute-folge">4 offen</span>
  </div>
  <div style="position:relative;height:32px;background:var(--zv-surface)"><button class="zv-zl-balken zv-pruef-zl-balken" style="left:4px;top:4px;width:120px"><span>Sophie B.</span></button></div>
  <table class="zv-journal" style="background:var(--zv-surface)"><thead><tr><th class="zv-pruef-journal-kopf">Datum</th></tr></thead><tbody><tr class="zv-journal-storniert"><td class="zv-journal-zahl zv-pruef-journal-storno">12,00 &euro;</td></tr></tbody></table>
  <ol class="zv-zeitleiste" style="background:var(--zv-bg);padding:8px">
    <li class="zv-zeit-naechster"><span class="zv-zeit-uhr zv-mono zv-pruef-heute-uhr">14:00&ndash;15:00</span></li>
    <li class="zv-zeit-vorbei"><span class="zv-zeit-titel zv-pruef-heute-vorbei">Vorbei</span></li>
  </ol>
  <!-- Eigene Flaeche bewusst transparent: gemessen wird der Rand gegen den
       Seitenhintergrund AUSSERHALB des Felds, die haertere Seite. -->
  <div class="zv-pruef-input-bg" style="border:1px solid var(--zv-border-strong);height:8px"></div>
  <div style="background:var(--zv-accent-soft)">
    <span class="zv-pruef-nav-aktiv" style="color:var(--zv-accent-strong)">Heute</span>
    <span class="zv-pruef-auswahl-tg" style="color:var(--zv-text-gedaempft)">Metazeile</span>
  </div>
  <div style="background:var(--zv-surface-3)">
    <span class="zv-pruef-hover-tg" style="color:var(--zv-text-gedaempft)">Metazeile</span>
  </div>
</div>`;

async function main() {
  const browser = await starteBrowser();
  let fehlerZahl = 0;
  const zusammenfassung = [];

  try {
    for (const theme of ["hell", "dunkel"]) {
      const ctx = await browser.newContext({
        colorScheme: theme === "dunkel" ? "dark" : "light",
        viewport: { width: 1200, height: 900 },
      });
      const page = await ctx.newPage();
      await page.goto(BASIS_URL, { waitUntil: "networkidle" });
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);

      for (const [name, hex] of PALETTEN) {
        const { h, c } = akzentAbleiten(hex);
        await page.evaluate(
          ({ h, c, html }) => {
            const w = document.documentElement;
            w.style.setProperty("--zv-accent-h", String(h));
            w.style.setProperty("--zv-accent-c", String(c));
            document.body.innerHTML = html;
          },
          { h, c, html: PRUEFSEITE }
        );

        const paare = await messePaare(page);

        /*
         * Schriften wirklich geladen? Fehlt eine woff2 (Pfad, Hash, falscher
         * Schnitt), faellt die Oberflaeche still auf die Systemschrift
         * zurueck und sieht "fast richtig" aus -- gemessen wird deshalb
         * ueber document.fonts, nicht ueber den CSS-Wert.
         */
        const fehlendeSchriften = await page.evaluate(async () => {
          const wanted = [
            '700 32px "Figtree Variable"',
            '400 15px "Source Sans 3 Variable"',
            '400 13px "IBM Plex Mono"',
            '500 13px "IBM Plex Mono"',
          ];
          const fehlt = [];
          for (const w of wanted) {
            // load() liefert die passenden, nun geladenen Faces; leer =
            // keine @font-face-Regel trifft, "error" = Datei nicht ladbar.
            const faces = await document.fonts.load(w, "Aa1").catch(() => []);
            // Gewicht muss exakt vorhanden sein: fehlt der 500er-Schnitt,
            // liefert der Browser still den 400er und load() meldet Erfolg.
            const gewicht = w.slice(0, 3);
            const trifft = faces.some((f) => f.weight === gewicht || f.weight.includes(" "));
            if (!faces.length || !trifft || faces.some((f) => f.status !== "loaded")) fehlt.push(w);
          }
          return fehlt;
        });
        if (fehlendeSchriften.length) {
          console.error(`  SCHRIFT NICHT GELADEN (${theme}/${name}): ${fehlendeSchriften.join(", ")}`);
          fehlerZahl += fehlendeSchriften.length;
        }

        /*
         * Ohne diese Schranke ist das ganze Skript wertlos: misst es nichts,
         * ist "kein Paar unter der Schwelle" trivialerweise wahr und meldet
         * Erfolg. Genau das ist in der ersten Fassung passiert -- der
         * Farbparser kam mit oklch() nicht zurecht und lieferte still null,
         * die Ausgabe sagte trotzdem "alles in Ordnung" bei 0 Messungen.
         */
        if (paare.length < ERWARTETE_PAARE) {
          console.error(
            `\n  ABBRUCH: nur ${paare.length} von mindestens ${ERWARTETE_PAARE} Paaren gemessen ` +
              `(${theme} / ${name}). Das Skript misst nicht, was es messen soll -- ` +
              `ein Ergebnis daraus waere wertlos.`
          );
          process.exit(2);
        }

        const schlecht = paare.filter((p) => p.wert < p.schwelle);
        const schlechtestes = paare.reduce((a, p) => (p.wert < a.wert ? p : a), paare[0]);

        zusammenfassung.push({
          theme,
          name,
          gemessen: paare.length,
          schlechtestes: schlechtestes ? `${schlechtestes.label} ${schlechtestes.wert.toFixed(2)}:1` : "-",
          ok: schlecht.length === 0,
        });

        if (schlecht.length) {
          fehlerZahl += schlecht.length;
          console.log(`\n  FEHLSCHLAG  ${theme} / ${name}:`);
          for (const s of schlecht) {
            console.log(`      ${s.label}: ${s.wert.toFixed(2)}:1 (noetig ${s.schwelle}:1)`);
          }
        }
      }
      await ctx.close();
    }

    console.log("\n=== Kontrastmatrix ===");
    console.log("Theme   Palette              gemessen  schlechtestes Paar");
    for (const z of zusammenfassung) {
      console.log(
        `${z.ok ? "OK  " : "FEHL"}  ${z.theme.padEnd(7)} ${z.name.padEnd(20)} ${String(z.gemessen).padStart(3)}      ${z.schlechtestes}`
      );
    }

    if (SCHREIBE_SCREENSHOTS) {
      await mkdir(AUSGABE, { recursive: true }).catch(() => {});
    }
  } finally {
    await browser.close();
  }

  console.log(
    fehlerZahl === 0
      ? `\nAlle Paare ueber der Schwelle, in ${zusammenfassung.length} Kombinationen.`
      : `\n${fehlerZahl} Paar(e) unter der Schwelle.`
  );
  process.exit(fehlerZahl === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
