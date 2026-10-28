/**
 * Misst in jeder Hauptansicht, ob die SEITE horizontal scrollt
 * (scrollWidth > clientWidth) -- bei 390 px (Handy) und 1440 px (Desktop),
 * hell und dunkel. Breite Inhalte duerfen in einem eigenen overflow-x-
 * Container scrollen, nie das Dokument (siehe .zv-table, .zv-reiter).
 *
 * "Layoutaussagen gehoeren gemessen, nicht angesehen" (CLAUDE.md): das
 * Skript bricht ab, wenn es weniger Ansichten misst als erwartet --
 * misst es nichts, waere "kein Ueberlauf" trivial wahr.
 *
 * Aufruf (aus apps/web, mit laufendem `pnpm dev` und `pnpm dev:api`):
 *   node scripts/ueberlauf-pruefung.mjs
 * Anmeldedaten wie in funktions-pruefung.mjs (PRUEF_MANDANT, PRUEF_LEITUNG, PRUEF_PASSWORT).
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function ladePlaywright() {
  for (const pfad of [process.env.PLAYWRIGHT_PFAD, "playwright", "/opt/node22/lib/node_modules/playwright"].filter(Boolean)) {
    try { return require(pfad); } catch { /* naechster Kandidat */ }
  }
  throw new Error("Playwright nicht gefunden -- global installieren oder PLAYWRIGHT_PFAD setzen.");
}
const { chromium } = ladePlaywright();

const URL = process.env.BASIS_URL ?? "http://localhost:5173";
const MANDANT = process.env.PRUEF_MANDANT ?? "drk-musterverband";
const PW = process.env.PRUEF_PASSWORT ?? "dev-passwort-nur-lokal";
const LEITUNG = process.env.PRUEF_LEITUNG ?? "leitung@drk-musterverband.test";

/** Seite -> Ueberschrift/Marker, damit "gerendert" gemessen wird und nicht ein leeres Geruest. */
const ANSICHTEN = ["Heute", "Nachrichten", "Kalender", "Aufgaben", "Klienten", "Mitarbeitende", "Standorte", "Tagesberichte", "Kassenbuch", "Einstellungen", "HZL", "Vertretung", "Organigramm", "Belegung (Zeitleiste)", "Klientenakte"];
const ELTERN = { HZL: "Kassenbuch", Vertretung: "Mitarbeitende", Organigramm: "Mitarbeitende", Belegung: "Standorte" };
const MOBIL_NAME = { Tagesberichte: "Bericht" };
const BREITEN = [390, 1440];

const browser = await chromium.launch().catch(async () => {
  const { readdirSync } = await import("node:fs");
  const ordner = readdirSync("/opt/pw-browsers").filter((n) => n.startsWith("chromium-"));
  for (const n of ordner) for (const u of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
    try { return await chromium.launch({ executablePath: `/opt/pw-browsers/${n}/${u}` }); } catch { /* weiter */ }
  }
  throw new Error("Chromium nicht startbar");
});

/** Ansichten, die erst nach einem zweiten Schritt erscheinen -> Marker, der sie belegt. */
const TIEFE = {
  "Belegung (Zeitleiste)": { basis: "Belegung", marker: ".zv-zl-zeile" },
  Klientenakte: { basis: "Klienten", klick: ".zv-info-karte-klickbar", marker: ".zv-akte-kopf" },
};

async function waehlen(page, label) {
  const tiefe = TIEFE[label];
  if (tiefe) {
    await waehlen(page, tiefe.basis);
    await page.waitForTimeout(500);
    if (tiefe.klick) await page.locator(tiefe.klick).first().click();
    await page.waitForSelector(tiefe.marker, { timeout: 8000 });
    return;
  }
  const side = page.locator(`.zv-sidebar-nav button:has-text("${label}")`);
  if (await side.first().isVisible().catch(() => false)) { await side.first().click(); return; }
  const knopf = ELTERN[label] ?? label;
  const direkt = page.locator(`.zv-tabbar-app button:has-text("${MOBIL_NAME[knopf] ?? knopf}")`);
  if (await direkt.first().isVisible().catch(() => false)) await direkt.first().click();
  else {
    await page.click('.zv-tabbar-app button:has-text("Mehr")');
    await page.waitForSelector("#zv-sammelmenue-panel");
    await page.click(`#zv-sammelmenue-panel button:has-text("${knopf}")`);
  }
  const panel = page.locator(".zv-sammelmenue:not(#zv-sammelmenue-panel)");
  if (await panel.first().isVisible({ timeout: 600 }).catch(() => false)) await panel.first().locator(`button:has-text("${label}")`).first().click();
}

let gemessen = 0;
const fehler = [];
for (const breite of BREITEN) {
  for (const theme of ["hell", "dunkel"]) {
    const ctx = await browser.newContext({ viewport: { width: breite, height: 900 }, isMobile: breite < 641, hasTouch: breite < 641 });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.fill("#mandantSlug", MANDANT);
    await page.fill("#email", LEITUNG);
    await page.fill("#passwort", PW);
    await page.click('button[type="submit"]');
    await page.waitForSelector(".zv-content", { timeout: 10000 });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    for (const ansicht of ANSICHTEN) {
      await waehlen(page, ansicht);
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        inhalt: (document.querySelector(".zv-content")?.innerText ?? "").trim().length,
      }));
      gemessen++;
      const ok = m.sw <= m.cw && m.inhalt > 0;
      console.log(`  ${ok ? "OK  " : "FEHL"}  ${breite}px ${theme.padEnd(6)} ${ansicht.padEnd(16)} scrollWidth ${m.sw} <= clientWidth ${m.cw}${m.inhalt > 0 ? "" : "  (Seite leer!)"}`);
      if (!ok) fehler.push(`${breite}px/${theme}/${ansicht}`);
    }
    await ctx.close();
  }
}
await browser.close();

const erwartet = ANSICHTEN.length * BREITEN.length * 2;
if (gemessen < erwartet) {
  console.error(`\nABBRUCH: nur ${gemessen} von ${erwartet} Messungen -- das Skript misst nicht, was es messen soll.`);
  process.exit(2);
}
console.log(fehler.length ? `\n${fehler.length} Ansicht(en) mit Seiten-Scroll: ${fehler.join(", ")}` : `\nAlle ${gemessen} Messungen ohne horizontalen Seiten-Scroll.`);
process.exit(fehler.length ? 1 : 0);
