/**
 * Funktionspruefung des Designsystems im echten Browser, gegen laufende
 * API + Dev-Server. Ergaenzt design-pruefung.mjs (Kontrastmatrix) um das,
 * was sich nur im Zusammenspiel zeigt:
 *
 *   1 Navigation und Icons
 *   2 Theme-Umschalter kippt messbar etwas
 *   3 Kein Aufblitzen des falschen Themes beim Laden
 *   4 Akzentfarbe: live, gespeichert, ueber Neuladen, ueber Benutzer
 *     hinweg -- und 403 fuer Rollen ohne Branding-Recht
 *   5 Kein horizontaler Ueberlauf bei 390px, mobile Navigation intakt
 *
 * Voraussetzung: Dev-Anmeldedaten (siehe Aufrufparameter unten). Bewusst
 * kein Bestandteil der CI -- dort laeuft design-pruefung.mjs, die ohne
 * Datenbank auskommt.
 *
 * Aufruf (aus apps/web, mit laufendem `pnpm dev` und `pnpm dev:api`):
 *   node scripts/funktions-pruefung.mjs
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
function ladePlaywright() {
  for (const pfad of [process.env.PLAYWRIGHT_PFAD, "playwright",
                      "/opt/node22/lib/node_modules/playwright"].filter(Boolean)) {
    try { return require(pfad); } catch { /* naechster Kandidat */ }
  }
  throw new Error("Playwright nicht gefunden -- global installieren oder PLAYWRIGHT_PFAD setzen.");
}
const { chromium } = ladePlaywright();

/**
 * Sucht die Chromium-Ordner unter /opt/pw-browsers von Hand statt ueber
 * fs.globSync: das gibt es im "node:fs"-Modul erst seit Node 22. Zwar
 * laeuft dieses Skript nicht in der CI, aber lokal reicht schon ein aelterer
 * Node darunter, um denselben SyntaxError beim Skriptstart auszuloesen wie
 * bei design-pruefung.mjs -- dieselbe Loesung.
 */
function chromiumOrdnerKandidaten(basisPfad) {
  try {
    return readdirSync(basisPfad)
      .filter((name) => name.startsWith("chromium-"))
      .map((name) => `${basisPfad}/${name}/chrome-linux/chrome`);
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

// Ueber Umgebungsvariablen ueberschreibbar -- die Vorgaben passen zum
// lokalen Dev-Datenbestand. Es sind bewusst KEINE echten Zugangsdaten:
// das Passwort gilt nur fuer die lokale Entwicklungsdatenbank.
const URL = process.env.BASIS_URL ?? "http://localhost:5173";
const MANDANT = process.env.PRUEF_MANDANT ?? "drk-musterverband";
const PW = process.env.PRUEF_PASSWORT ?? "dev-passwort-nur-lokal";
const LEITUNG = process.env.PRUEF_LEITUNG ?? "leitung@drk-musterverband.test";
const ANDERE = process.env.PRUEF_ANDERE ?? "betreuung@drk-musterverband.test";

const fehler = [];
const ok = (b, m) => { console.log(`  ${b ? "OK  " : "FEHL"}  ${m}`); if (!b) fehler.push(m); };

const browser = await starteBrowser();

async function anmelden(page, email = LEITUNG) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", MANDANT);
  await page.fill("#email", email);
  await page.fill("#passwort", PW);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-tabbar-app", { timeout: 10000 });
}

// ---------------------------------------------------------------- 1
console.log("\n1) Anmeldung und Grundgeruest");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await anmelden(page, LEITUNG);
  ok(await page.locator(".zv-tabbar-app button").count() === 5, "Hauptnavigation hat 5 Reiter");
  const reiter = await page.locator(".zv-tabbar-app button").allInnerTexts();
  ok(reiter.includes("Einstellungen"), `Reiter "Einstellungen" vorhanden (${reiter.join(", ")})`);
  ok(!reiter.includes("Sicherheit"), "Reiter \"Sicherheit\" ist aufgegangen, nicht mehr eigenstaendig");
  ok(await page.locator(".zv-tabbar-app svg").count() >= 5, "Jeder Reiter traegt ein Icon");
  await ctx.close();
}

// ---------------------------------------------------------------- 2
console.log("\n2) Theme-Umschalter kippt wirklich etwas");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await anmelden(page, LEITUNG);
  const vorher = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click(".zv-topbar .zv-icon-btn");   // system -> hell
  await page.click(".zv-topbar .zv-icon-btn");   // hell   -> dunkel
  await page.waitForTimeout(300);
  const nachher = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const attr = await page.evaluate(() => document.documentElement.dataset.theme);
  const gespeichert = await page.evaluate(() => localStorage.getItem("zimmerakte_theme"));
  ok(vorher !== nachher, `body-Hintergrund aendert sich messbar (${vorher} -> ${nachher})`);
  ok(attr === "dunkel", `data-theme steht auf "dunkel" (${attr})`);
  ok(gespeichert === "dunkel", `localStorage merkt sich "dunkel" (${gespeichert})`);
  await ctx.close();
}

// ---------------------------------------------------------------- 3
console.log("\n3) Kein Aufblitzen des falschen Themes beim Laden");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.setItem("zimmerakte_theme", "dunkel"));
  // Allererster Messwert direkt bei DOMContentLoaded -- greift das
  // Inline-Skript vor dem ersten Anstrich, steht dort schon der Dunkelwert.
  await page.addInitScript(() => {
    window.__ersterWert = null;
    document.addEventListener("DOMContentLoaded", () => {
      window.__ersterWert = getComputedStyle(document.documentElement).getPropertyValue("--zv-bg").trim();
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  const ersterWert = await page.evaluate(() => window.__ersterWert);
  const themeBeimStart = await page.evaluate(() => document.documentElement.dataset.theme);
  ok(themeBeimStart === "dunkel", `data-theme steht schon beim Laden auf "dunkel" (${themeBeimStart})`);
  ok(!!ersterWert, `--zv-bg ist bei DOMContentLoaded bereits gesetzt (${ersterWert})`);
  await ctx.close();
}

// ---------------------------------------------------------------- 4
console.log("\n4) Akzentfarbe: speichern, neu laden, anderer Benutzer");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await anmelden(page, LEITUNG);
  await page.click('.zv-tabbar-app button:has-text("Einstellungen")');
  await page.waitForSelector(".zv-swatch-grid", { timeout: 5000 });

  const knopfFarbe = () => page.evaluate(() => {
    const b = document.querySelector(".zv-vorschau .zv-btn");
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const g = c.getContext("2d");
    g.fillStyle = getComputedStyle(b).backgroundColor; g.fillRect(0,0,1,1);
    return Array.from(g.getImageData(0,0,1,1).data).slice(0,3).join(",");
  });

  // Bewusst NICHT auf eine feste Palette klicken: nach einem vorherigen
  // Lauf kann genau die schon gespeichert sein, dann bleibt "Speichern"
  // deaktiviert und der Lauf haengt. Also die erste Farbe nehmen, die
  // gerade NICHT aktiv ist -- damit ist das Skript wiederholbar.
  const zielFarbe = await page.evaluate(() => {
    const felder = [...document.querySelectorAll(".zv-swatch")];
    const frei = felder.find((f) => f.getAttribute("aria-pressed") !== "true");
    return frei ? frei.getAttribute("aria-label") : null;
  });
  if (!zielFarbe) throw new Error("Keine abweichende Palette gefunden.");
  const vorher = await knopfFarbe();
  await page.click(`.zv-swatch[aria-label="${zielFarbe}"]`);
  await page.waitForTimeout(400);
  const nachAuswahl = await knopfFarbe();
  ok(vorher !== nachAuswahl, `Live-Vorschau faerbt sofort um: ${zielFarbe} (${vorher} -> ${nachAuswahl})`);

  await page.click('button:has-text("Speichern")');
  await page.waitForSelector(".zv-hinweis-erfolg", { timeout: 5000 });
  ok(true, "Speichern meldet Erfolg");

  await page.reload({ waitUntil: "networkidle" });
  await page.click('.zv-tabbar-app button:has-text("Einstellungen")');
  await page.waitForSelector(".zv-swatch-grid");
  const nachReload = await knopfFarbe();
  ok(nachReload === nachAuswahl, `Farbe ueberlebt das Neuladen (${nachReload})`);
  const erwarteterFarbton = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--zv-accent-h").trim());
  await ctx.close();

  // Anderer Benutzer DESSELBEN Traegers -> muss dieselbe Farbe sehen
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page2 = await ctx2.newPage();
  await anmelden(page2, ANDERE);
  const andererNutzer = await page2.evaluate(() => {
    const b = document.querySelector(".zv-topbar .zv-btn");
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const g = c.getContext("2d");
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--zv-accent-h").trim();
    return getComputedStyle(document.documentElement).getPropertyValue("--zv-accent-h").trim();
  });
  ok(Math.abs(parseFloat(andererNutzer) - parseFloat(erwarteterFarbton)) < 1,
     `Anderer Mitarbeiter desselben Traegers sieht dieselbe Farbe ` +
     `(h=${andererNutzer}, erwartet ${erwarteterFarbton} von "${zielFarbe}")`);

  // ... und darf sie NICHT aendern
  await page2.click('.zv-tabbar-app button:has-text("Einstellungen")');
  await page2.waitForTimeout(500);
  const hatFarbwahl = await page2.locator(".zv-swatch-grid").count();
  ok(hatFarbwahl === 0, "Bezugsbetreuung bekommt den Farbabschnitt gar nicht erst angeboten");

  const status = await page2.evaluate(async () => {
    const r = await fetch("/api/mandant/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json",
                 Authorization: "Bearer " + localStorage.getItem("zimmerakte_token") },
      body: JSON.stringify({ akzentfarbe: "#efce72" }),
    });
    return r.status;
  });
  ok(status === 403, `Direkter PATCH aus der Konsole liefert 403 (${status})`);
  await ctx2.close();
}

// ---------------------------------------------------------------- 5
console.log("\n5) Kein horizontaler Ueberlauf, mobile Navigation intakt");
{
  for (const theme of ["hell", "dunkel"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await anmelden(page, LEITUNG);
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);

    for (const reiter of ["Zimmer", "Klienten", "Kassenbuch", "Mitarbeitende", "Einstellungen"]) {
      await page.click(`.zv-tabbar-app button:has-text("${reiter}")`);
      await page.waitForTimeout(250);
      const ueberlauf = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
      ok(!ueberlauf, `${theme}/390px "${reiter}": kein horizontaler Ueberlauf`);
    }

    const nav = await page.evaluate(() => {
      const leiste = document.querySelector(".zv-tabbar-app");
      const inhalt = document.querySelector(".zv-content");
      const l = leiste.getBoundingClientRect(), i = inhalt.getBoundingClientRect();
      return { position: getComputedStyle(leiste).position, leisteOben: l.top, inhaltOben: i.top,
               sichtbar: l.bottom <= window.innerHeight + 1 && l.top >= 0 };
    });
    ok(nav.position !== "fixed", `${theme}: Navigation ist nicht position:fixed (${nav.position})`);
    ok(nav.leisteOben > nav.inhaltOben, `${theme}: Navigation liegt unter dem Inhalt`);
    ok(nav.sichtbar, `${theme}: Navigation liegt im sichtbaren Bereich`);

    // Die ZWEITE Reiterleiste (Einstellungen) muss OBEN bleiben.
    const innen = await page.evaluate(() => {
      const alle = document.querySelectorAll(".zv-tabbar:not(.zv-tabbar-app)");
      if (!alle.length) return null;
      return alle[0].getBoundingClientRect().top;
    });
    if (innen !== null) {
      ok(innen < 400, `${theme}: innere Reiterleiste bleibt oben (top=${Math.round(innen)})`);
    }
    await ctx.close();
  }
}

await browser.close();
console.log(fehler.length === 0
  ? `\nAlle Pruefungen bestanden.`
  : `\n${fehler.length} Pruefung(en) fehlgeschlagen:\n  - ${fehler.join("\n  - ")}`);
process.exit(fehler.length ? 1 : 0);
