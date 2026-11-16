/**
 * Browserpruefung der Stundenbuchung (Migration 0072) gegen laufende API +
 * Dev-Server: buchen, Saldo, stornieren, Rechte-Sicht, und -- gemessen statt
 * angesehen -- kein horizontaler Ueberlauf bei 1440 und 390 px.
 *
 * Voraussetzung: ein Mandant mit zwei Klient:innen, einer Person mit
 * Vollzugriff (PRUEF_LEITUNG) und einer Person mit Mitarbeitenden-Rechten
 * (PRUEF_ANDERE). Aufruf aus apps/web: node scripts/stunden-pruefung.mjs
 * Ein Lauf, der nichts misst, schlaegt fehl (siehe unten).
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of [process.env.PLAYWRIGHT_PFAD, "playwright", "/opt/node22/lib/node_modules/playwright"].filter(Boolean)) {
    try { return require(p); } catch { /* naechster */ }
  }
  throw new Error("Playwright nicht gefunden -- PLAYWRIGHT_PFAD setzen.");
})();

async function starteBrowser() {
  try { return await chromium.launch(); } catch (e) {
    const basis = "/opt/pw-browsers";
    const kandidaten = [process.env.CHROMIUM_PFAD, ...(existsSync(basis) ? readdirSync(basis) : []).filter((n) => n.startsWith("chromium-")).flatMap((n) => [`${basis}/${n}/chrome-linux64/chrome`, `${basis}/${n}/chrome-linux/chrome`]), `${basis}/chromium/chrome-linux/chrome`].filter(Boolean);
    for (const executablePath of kandidaten) if (existsSync(executablePath)) { try { return await chromium.launch({ executablePath }); } catch { /* naechster */ } }
    throw e;
  }
}

const URL = process.env.BASIS_URL ?? "http://localhost:5173";
const MANDANT = process.env.PRUEF_MANDANT ?? "demo";
const PW = process.env.PRUEF_PASSWORT ?? "demo-passwort-123";
const LEITUNG = process.env.PRUEF_LEITUNG ?? "voll@demo.test";
const ANDERE = process.env.PRUEF_ANDERE ?? "ma@demo.test";
const BILDER = process.env.PRUEF_BILDER ?? "/tmp/stunden-bilder";
mkdirSync(BILDER, { recursive: true });

// Je Lauf eindeutig: Buchungen sind unveraenderlich, ein zweiter Lauf trifft
// sonst auf die Zeilen des ersten und misst die falsche Zeile.
const LAUF = Date.now().toString(36);
const fehler = [];
let messungen = 0;
const ok = (b, m) => { messungen++; console.log(`  ${b ? "OK  " : "FEHL"}  ${m}`); if (!b) fehler.push(m); };

const browser = await starteBrowser();

async function anmelden(page, email) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", MANDANT);
  await page.fill("#email", email);
  await page.fill("#passwort", PW);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content", { timeout: 10000 });
}

async function zuStunden(page) {
  const sidebar = page.locator('.zv-sidebar-nav button:has-text("Stunden")');
  if (await sidebar.first().isVisible().catch(() => false)) await sidebar.first().click();
  else {
    await page.click('.zv-tabbar-app button:has-text("Mehr")');
    await page.waitForSelector("#zv-sammelmenue-panel");
    await page.click('#zv-sammelmenue-panel button:has-text("Stunden")');
  }
  await page.waitForSelector("h2:has-text('Stunden')");
}

const ueberlauf = (page) => page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));

async function durchlauf(breite, hoehe, email, name) {
  console.log(`\n${name} bei ${breite} px`);
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const serverFehler = [];
  page.on("response", (r) => { if (r.status() >= 500) serverFehler.push(`${r.status()} ${r.url()}`); });
  await anmelden(page, email);
  await zuStunden(page);
  await page.waitForSelector("button:has-text('Stunden buchen')", { timeout: 8000 });
  ok(await page.locator("button:has-text('Stunden buchen')").first().isVisible(), "Knopf „Stunden buchen“ sichtbar");

  const vorher = await page.locator(".zv-info-karte").count();
  await page.click("button:has-text('Stunden buchen')");
  await page.waitForSelector("#std-klient");
  await page.selectOption("#std-klient", { label: "Anna Beispiel" });
  await page.fill("#std-stunden", "1");
  await page.fill("#std-minuten", "30");
  await page.selectOption("#std-art", "begleitung");
  await page.fill("#std-notiz", `Prüflauf ${LAUF} ${name} ${breite}`);
  if (email === LEITUNG) {
    ok(await page.locator("#std-ma").isVisible(), "Leitung sieht „Geleistet von“");
    await page.selectOption("#std-ma", { label: "Max Mitarbeiter" });
  } else {
    ok((await page.locator("#std-ma").count()) === 0, "Ohne Recht fehlt „Geleistet von“");
  }
  await page.waitForTimeout(600); // Einblend-Animation des Panels abwarten, sonst misst man mitten im Flug
  const dlg = await page.evaluate(() => {
    const m = document.querySelector("[role=dialog]") ?? document.querySelector(".zv-modal");
    const r = m.getBoundingClientRect();
    return { rechts: Math.round(r.right), links: Math.round(r.left), sw: m.scrollWidth, cw: m.clientWidth, fenster: window.innerWidth };
  });
  ok(dlg.rechts <= dlg.fenster && dlg.links >= 0, `Formular liegt im Fenster (${dlg.links}..${dlg.rechts} von ${dlg.fenster})`);
  ok(dlg.sw <= dlg.cw, `Formular ohne eigenen Ueberlauf (scrollWidth ${dlg.sw} <= clientWidth ${dlg.cw})`);
  await page.screenshot({ path: `${BILDER}/formular-${name}-${breite}.png` });
  await page.click("button[type=submit]:has-text('Buchen')");
  await page.waitForSelector(`text=Prüflauf ${LAUF} ${name} ${breite}`, { timeout: 8000 });
  ok(true, "Neue Buchung erscheint in der Liste");
  ok((await page.locator(".zv-info-karte").count()) > vorher, "Zeilenzahl ist gewachsen");
  ok(await page.locator("text=1:30 h").first().isVisible(), "Dauer als „1:30 h“ angezeigt");
  ok(await page.locator("[aria-label='Stundensaldo']").isVisible(), "Saldo-Abschnitt sichtbar");

  const u = await ueberlauf(page);
  ok(u.s <= u.c, `Kein horizontaler Ueberlauf (scrollWidth ${u.s} <= clientWidth ${u.c})`);
  await page.screenshot({ path: `${BILDER}/liste-${name}-${breite}.png`, fullPage: true });

  // Storno ueber das Aktionsmenue der eigenen Zeile
  const zeile = page.locator(".zv-info-karte", { hasText: `Prüflauf ${LAUF} ${name} ${breite}` });
  await zeile.locator("button[aria-haspopup]").first().click();
  await page.click("[role=menuitem]:has-text('Stornieren')");
  await page.fill("#grund-abfrage-eingabe", "Prüflauf-Storno");
  await page.click(".zv-modal button[type=submit], [role=dialog] button[type=submit]");
  // Auf die Pille warten, nicht auf den Text: der steht auch im Eingabefeld des Modals.
  await zeile.locator(".zv-pill-danger").waitFor({ timeout: 8000 });
  ok(await zeile.locator(".zv-pill-danger").isVisible(), "Stornierte Zeile zeigt Storno mit Grund");
  ok((await zeile.locator("button[aria-haspopup]").count()) === 0, "Stornierte Zeile hat kein Aktionsmenue mehr");
  await page.screenshot({ path: `${BILDER}/storniert-${name}-${breite}.png`, fullPage: true });
  ok(serverFehler.length === 0, `Keine 5xx-Antworten (${serverFehler.join(", ") || "keine"})`);
  await ctx.close();
}

await durchlauf(1440, 900, LEITUNG, "leitung");
await durchlauf(390, 800, ANDERE, "mitarbeit");
await browser.close();

if (messungen < 24) { console.log(`\nNur ${messungen} Messungen -- erwartet >= 24. Ein Lauf, der nichts misst, ist kein Ergebnis.`); process.exit(1); }
if (fehler.length) { console.log(`\n${fehler.length} Fehler:\n- ${fehler.join("\n- ")}`); process.exit(1); }
console.log(`\nAlle ${messungen} Pruefungen bestanden. Bilder: ${BILDER}`);
