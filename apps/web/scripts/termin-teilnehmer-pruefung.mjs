/**
 * Browserpruefung "Teilnehmende in einer Liste" (Termin-Dialog im Kalender)
 * gegen laufende API + Dev-Server: Klient:innen und Mitarbeitende stehen in
 * EINER durchsuchbaren Liste, jede Zeile mit Pille „Klient:in“ bzw.
 * „Mitarbeiter:in“, Klient:innen ohne Zugang zusaetzlich mit „ohne Zugang“;
 * die Betreuungszeit folgt weiter der Auswahl. Gemessen statt angesehen:
 * Zahl der Suchfelder und Listen, Reihenfolge, Pillentexte, kein
 * horizontaler Ueberlauf bei 1440 und 390 px, Kontrast der Pillen in hell
 * und dunkel.
 *
 * Voraussetzung: Mandant PRUEF_MANDANT mit der Mitarbeiter:in PRUEF_ANDERE
 * (Recht stunden.buchen), mindestens einer weiteren Mitarbeiter:in und den
 * Klient:innen "Jonas Becker" (mit Zugang) und "Karl Ohnezugang" (ohne).
 * Aufruf aus apps/web:  node scripts/termin-teilnehmer-pruefung.mjs
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
const ANDERE = process.env.PRUEF_ANDERE ?? "ma@demo.test";
const LEITUNG = process.env.PRUEF_LEITUNG ?? "voll@demo.test";
const BILDER = process.env.PRUEF_BILDER ?? "/tmp/termin-teilnehmer-bilder";
mkdirSync(BILDER, { recursive: true });

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

async function zu(page, label) {
  const sidebar = page.locator(`.zv-sidebar-nav button:has-text("${label}")`);
  if (await sidebar.first().isVisible().catch(() => false)) await sidebar.first().click();
  else {
    await page.click('.zv-tabbar-app button:has-text("Mehr")');
    await page.waitForSelector("#zv-sammelmenue-panel");
    await page.click(`#zv-sammelmenue-panel button:has-text("${label}")`);
  }
  // Die Einstellungen tragen als Ueberschrift den gewaehlten Bereich, nicht "Einstellungen".
  await page.waitForSelector(label === "Einstellungen" ? ".zv-einstellungen" : `h2:has-text('${label}')`);
}

/** API-Aufruf mit dem Token der angemeldeten Person -- fuer Termine in der Vergangenheit, die das Formular nicht anlegt. */
const api = (page, pfad, methode = "GET", body) =>
  page.evaluate(async ({ pfad, methode, body }) => {
    const r = await fetch(`/api${pfad}`, {
      method: methode,
      headers: { Authorization: `Bearer ${localStorage.getItem("zimmerakte_token")}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { pfad, methode, body });

const ueberlauf = (page) => page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));

/**
 * WCAG-Kontrast zwischen Text eines Elements und dem ersten nicht
 * transparenten Hintergrund darueber. Farben ueber ein Canvas in sRGB
 * aufgeloest -- getComputedStyle liefert oklch() woertlich zurueck, und genau
 * daran ist die erste design-pruefung.mjs gescheitert (CLAUDE.md).
 */
const kontrast = (page, selektor) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    const rgb = (farbe) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = farbe; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
    let hg = null;
    for (let e = el; e; e = e.parentElement) { const f = rgb(getComputedStyle(e).backgroundColor); if (f[3] > 250) { hg = f; break; } }
    hg ??= rgb(getComputedStyle(document.body).backgroundColor);
    const vg = rgb(getComputedStyle(el).color);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = [lum(vg), lum(hg)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  }, selektor);

async function durchlauf(breite, hoehe, schema) {
  const name = `${breite}-${schema}`;
  console.log(`\n${name}`);
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 2, colorScheme: schema === "dunkel" ? "dark" : "light" });
  const page = await ctx.newPage();
  const serverFehler = [];
  page.on("response", (r) => { if (r.status() >= 500) serverFehler.push(`${r.status()} ${r.url()}`); });
  await anmelden(page, ANDERE);
  await zu(page, "Kalender");
  await page.locator("button:has-text('Neuer Termin')").first().click();
  await page.waitForSelector("#termin-suche");
  const dialog = page.locator("form:has(#termin-suche)");

  ok((await dialog.locator("input[type=search]").count()) === 1, "Genau ein Suchfeld für Teilnehmende");
  ok((await dialog.locator(".zv-kontaktliste").count()) === 1, "Genau eine Liste");
  const zeilen = await dialog.locator("label.zv-kontakt-zeile").evaluateAll((els) =>
    els.map((e) => ({ name: e.querySelector(".zv-kontakt-name").textContent, pillen: [...e.querySelectorAll(".zv-pill")].map((p) => p.textContent) }))
  );
  const kl = zeilen.filter((z) => z.pillen.includes("Klient:in"));
  const ma = zeilen.filter((z) => z.pillen.includes("Mitarbeiter:in"));
  ok(kl.length > 0 && ma.length > 0, `Beide Arten in derselben Liste (${kl.length} Klient:innen, ${ma.length} Mitarbeitende)`);
  ok(zeilen.every((z) => z.pillen.includes("Klient:in") !== z.pillen.includes("Mitarbeiter:in")), "Jede Zeile hat genau eine Art-Pille");
  const namen = zeilen.map((z) => z.name);
  ok(namen.every((n, i) => i === 0 || namen[i - 1].localeCompare(n, "de-DE") <= 0), "Alphabetisch gemischt sortiert");
  const karl = zeilen.find((z) => z.name.startsWith("Karl"));
  const jonas = zeilen.find((z) => z.name.startsWith("Jonas"));
  ok(!!karl && karl.pillen.includes("ohne Zugang"), "Klient:in ohne Zugang: Pille „ohne Zugang“");
  ok(!!jonas && !jonas.pillen.includes("ohne Zugang"), "Klient:in mit Zugang: keine Zugangs-Pille");
  ok(ma.every((z) => !z.pillen.includes("ohne Zugang")), "Mitarbeitende nie „ohne Zugang“");

  // Suche trifft beide Arten: "be" steckt in "Bernd Betreuer" und "Jonas Becker".
  await page.fill("#termin-suche", "be");
  const treffer = await dialog.locator("label.zv-kontakt-zeile .zv-pill").allTextContents();
  ok(treffer.includes("Klient:in") && treffer.includes("Mitarbeiter:in"), "Eine Suche findet Klient:innen und Mitarbeitende");
  await page.fill("#termin-suche", "");

  // Betreuungszeit folgt der Auswahl aus der gemeinsamen Liste.
  const kasten = page.locator(".zv-stunden-kasten");
  ok(await page.locator(".zv-stunden-kasten-gesperrt").isVisible(), "Ohne Klient:in: Betreuungszeit gesperrt");
  const mitarbeiterName = ma[0].name;
  await dialog.locator("label.zv-kontakt-zeile", { hasText: mitarbeiterName }).click();
  ok(await page.locator(".zv-stunden-kasten-gesperrt").isVisible(), "Nur Mitarbeiter:in gewählt: weiterhin gesperrt");
  await dialog.locator("label.zv-kontakt-zeile", { hasText: "Karl Ohnezugang" }).click();
  ok(await kasten.locator("input[type=checkbox]").isChecked(), "Klient:in ohne Zugang gewählt: Betreuungszeit angehakt");
  ok((await kasten.textContent()).includes("Karl Ohnezugang") && !(await kasten.textContent()).includes(mitarbeiterName), "Kasten nennt nur die Klient:in");
  ok(await dialog.locator(".zv-hinweis", { hasText: "keinen Zugang" }).isVisible(), "Hinweis „keinen Zugang“ erscheint");

  const u = await ueberlauf(page);
  ok(u.s <= u.c, `Kein horizontaler Ueberlauf (${u.s} <= ${u.c})`);
  const schmal = await dialog.locator("label.zv-kontakt-zeile .zv-kontakt-name").evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
  ok(schmal >= 80, `Namen bleiben lesbar (schmalste Namensspalte ${Math.round(schmal)} px)`);
  for (const [sel, was] of [[".zv-kontakt-zeile .zv-pill-info", "Klient:in"], [".zv-kontakt-zeile .zv-pill-vergeben", "Mitarbeiter:in"], [".zv-kontakt-zeile .zv-pill-frist", "ohne Zugang"]]) {
    const k = await kontrast(page, sel);
    ok(k !== null && k >= 4.5, `Kontrast Pille „${was}“ ${k} >= 4.5`);
  }
  await dialog.locator(".zv-kontaktliste").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: `${BILDER}/${name}.png` });
  ok(serverFehler.length === 0, `Keine 5xx-Antworten (${serverFehler.join(", ") || "keine"})`);
  await ctx.close();
}

await durchlauf(1440, 900, "dunkel");
await durchlauf(390, 844, "hell");
await durchlauf(390, 844, "dunkel");
await browser.close();

// Je Durchlauf 20 Messungen; weniger heisst: etwas wurde gar nicht gemessen.
const ERWARTET = 3 * 20;
if (messungen < ERWARTET) {
  console.log(`\nNur ${messungen} von ${ERWARTET} Messungen -- Pruefung unvollstaendig.`);
  process.exit(1);
}
if (fehler.length) {
  console.log(`\n${fehler.length} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Pruefungen bestanden. Bilder: ${BILDER}`);
