/**
 * Erzeugt die Bildschirmfotos in design-sources/screenshots neu: Anmeldung,
 * Heute, Belegung (Zeitleiste), Klientenakte, Kassenbuch, Einstellungen --
 * hell und dunkel bei 1440 px, dazu vier Ansichten bei 390 px (mobil).
 *
 * Bricht ab, wenn weniger Dateien entstehen als erwartet (ein Skript, das
 * nichts liefert, darf nicht "fertig" melden).
 *
 * Aufruf (aus apps/web, mit laufendem `pnpm dev` und `pnpm dev:api`):
 *   node scripts/screenshots.mjs
 * Anmeldedaten wie in ueberlauf-pruefung.mjs (PRUEF_MANDANT, PRUEF_LEITUNG, PRUEF_PASSWORT).
 */
import { createRequire } from "node:module";
import { mkdir, readdir, rm } from "node:fs/promises";
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
const AUSGABE = "design-sources/screenshots";
const ERWARTET = 6 * 2 + 4;

const browser = await chromium.launch().catch(async () => {
  const { readdirSync } = await import("node:fs");
  const ordner = readdirSync("/opt/pw-browsers").filter((n) => n.startsWith("chromium-"));
  for (const n of ordner) for (const u of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
    try { return await chromium.launch({ executablePath: `/opt/pw-browsers/${n}/${u}` }); } catch { /* weiter */ }
  }
  throw new Error("Chromium nicht startbar");
});

async function reiter(page, label, mobil) {
  const seite = page.locator(`.zv-sidebar-nav button:has-text("${label}")`).first();
  if (!mobil && (await seite.isVisible().catch(() => false))) return seite.click();
  const direkt = page.locator(`.zv-tabbar-app button:has-text("${label}")`).first();
  if (await direkt.isVisible().catch(() => false)) {
    await direkt.click();
    const unter = page.locator(`.zv-sammelmenue:not(#zv-sammelmenue-panel) button:has-text("${label}")`).first();
    if (await unter.isVisible({ timeout: 600 }).catch(() => false)) await unter.click();
    return;
  }
  await page.click('.zv-tabbar-app button:has-text("Mehr")');
  await page.waitForSelector("#zv-sammelmenue-panel");
  await page.click(`#zv-sammelmenue-panel button:has-text("${label}")`);
  const unter = page.locator(`.zv-sammelmenue:not(#zv-sammelmenue-panel) button:has-text("${label}")`).first();
  if (await unter.isVisible({ timeout: 600 }).catch(() => false)) await unter.click();
}

async function anmelden(page) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", MANDANT);
  await page.fill("#email", LEITUNG);
  await page.fill("#passwort", PW);
}

async function aufnahme(page, datei) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${AUSGABE}/${datei}.png`, fullPage: false });
  console.log("  geschrieben:", datei);
}

await mkdir(AUSGABE, { recursive: true });
for (const f of await readdir(AUSGABE)) if (f.endsWith(".png")) await rm(`${AUSGABE}/${f}`);

for (const theme of ["hell", "dunkel"]) {
  // colorScheme statt data-theme setzen: der Umschalter steht auf "System", so folgt
  // die ganze App (auch nach Seitenwechseln) dem Medium, ohne dass das Skript
  // ein Attribut gegen die Theme-Logik halten muss.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme === "hell" ? "light" : "dark" });
  const page = await ctx.newPage();
  await anmelden(page);
  await aufnahme(page, `${theme}-01-anmeldung`);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content");
  await page.waitForSelector(".zv-lage");
  await aufnahme(page, `${theme}-02-heute`);
  await reiter(page, "Belegung");
  await page.waitForSelector(".zv-zl-zeile");
  await aufnahme(page, `${theme}-03-belegung`);
  await reiter(page, "Klienten");
  await page.locator(".zv-info-karte-klickbar").first().click();
  await page.waitForSelector(".zv-akte-kopf");
  await aufnahme(page, `${theme}-04-klientenakte`);
  await page.keyboard.press("Escape");
  await reiter(page, "Kassenbuch");
  await page.waitForSelector(".zv-kassenstand");
  await aufnahme(page, `${theme}-05-kassenbuch`);
  await reiter(page, "Einstellungen");
  await aufnahme(page, `${theme}-06-einstellungen`);
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await anmelden(page);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-lage");
  await aufnahme(page, "mobil-heute");
  await reiter(page, "Belegung", true);
  await page.waitForSelector(".zv-zl-zeile");
  await aufnahme(page, "mobil-belegung");
  await reiter(page, "Kassenbuch", true);
  await page.waitForSelector(".zv-kassenstand");
  await aufnahme(page, "mobil-kassenbuch");
  await reiter(page, "Einstellungen", true);
  await aufnahme(page, "mobil-einstellungen");
  await ctx.close();
}
await browser.close();

const dateien = (await readdir(AUSGABE)).filter((f) => f.endsWith(".png"));
if (dateien.length < ERWARTET) {
  console.error(`ABBRUCH: nur ${dateien.length} von ${ERWARTET} Bildschirmfotos.`);
  process.exit(2);
}
console.log(`\n${dateien.length} Bildschirmfotos in ${AUSGABE}.`);
