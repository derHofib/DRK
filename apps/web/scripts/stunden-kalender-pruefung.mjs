/**
 * Browserpruefung "Stunden aus dem Kalender" (migrations/0080) gegen laufende
 * API + Dev-Server: Kasten im Termindialog (gesperrt mit Grund, live
 * berechnete Dauer, Gruppenangebot), Buchung nach Terminende mit Herkunft in
 * der Stundenliste, automatisches Storno + Neubuchung nach einer Aenderung,
 * Termindetail, Einstellungen -- und gemessen statt angesehen: kein
 * horizontaler Ueberlauf bei 1440 und 390 px, Kontrast der neuen Elemente in
 * hell und dunkel.
 *
 * Voraussetzung wie stunden-pruefung.mjs: Mandant PRUEF_MANDANT mit einer
 * Mitarbeiter:in PRUEF_ANDERE (Recht stunden.buchen) und den Klient:innen
 * "Jonas Becker" und "Mira Sommer" mit aktivem Zugang (sonst sind sie keine
 * Kontakte im Termindialog). Aufruf aus apps/web:
 *   node scripts/stunden-kalender-pruefung.mjs
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
const BILDER = process.env.PRUEF_BILDER ?? "/tmp/stunden-kalender-bilder";
mkdirSync(BILDER, { recursive: true });

// Je Lauf eindeutig: Buchungen sind unveraenderlich, ein zweiter Lauf trifft
// sonst auf die Zeilen des ersten.
const LAUF = Date.now().toString(36);
const TITEL = `Begleitung zum Hausarzt ${LAUF}`;
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
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, colorScheme: schema === "dunkel" ? "dark" : "light" });
  const page = await ctx.newPage();
  const serverFehler = [];
  page.on("response", (r) => { if (r.status() >= 500) serverFehler.push(`${r.status()} ${r.url()}`); });
  await anmelden(page, ANDERE);

  // --- Termindialog: Kasten ---
  await zu(page, "Kalender");
  await page.locator("button:has-text('Neuer Termin')").first().click();
  await page.waitForSelector(".zv-stunden-kasten");
  ok(await page.locator(".zv-stunden-kasten-gesperrt").isVisible(), "Ohne Klient:in: Kasten gesperrt");
  ok(await page.locator(".zv-stunden-kasten", { hasText: "Nur Termine mit einer Klient:in" }).isVisible(), "… mit Grund im Kasten");
  const zeileDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".zv-field label.zv-kontakt-zeile")).display);
  ok(zeileDisplay === "flex", `Teilnehmendenzeile nebeneinander (display ${zeileDisplay})`);
  await page.locator("label.zv-kontakt-zeile", { hasText: "Jonas Becker" }).click();
  const kasten = page.locator(".zv-stunden-kasten");
  ok(await kasten.locator("input[type=checkbox]").isChecked(), "Mit Klient:in: Haken gesetzt (Voreinstellung an)");
  ok(await kasten.locator("text=1:00 h").isVisible(), "Dauer live aus Von/Bis (1:00 h)");
  ok((await kasten.textContent()).includes("Jonas Becker"), "Klient:in im Kastentext");
  await page.fill("#termin-bis", "11:30");
  ok(await kasten.locator("text=2:30 h").isVisible(), "Dauer folgt dem Bis-Feld (2:30 h)");
  await page.locator("label.zv-kontakt-zeile", { hasText: "Mira Sommer" }).click();
  ok((await kasten.textContent()).includes("(je)"), "Zwei Klient:innen: „je“");
  ok((await page.locator("#termin-leistung option").first().textContent()).includes("Gruppenangebot"), "Automatisch = Gruppenangebot");
  await page.locator("[role=dialog] label.zv-checkbox-zeile", { hasText: "Ganztägig" }).locator("input").check();
  ok(await kasten.locator("text=Ganztägige Termine haben keine Dauer").isVisible(), "Ganztägig: gesperrt mit Grund");
  await page.locator("[role=dialog] label.zv-checkbox-zeile", { hasText: "Ganztägig" }).locator("input").uncheck();
  await page.waitForTimeout(600); // Einblend-Animation des Panels abwarten
  const dlg = await page.evaluate(() => {
    const m = document.querySelector("[role=dialog]") ?? document.querySelector(".zv-modal");
    const r = m.getBoundingClientRect();
    return { rechts: Math.round(r.right), links: Math.round(r.left), sw: m.scrollWidth, cw: m.clientWidth, fenster: window.innerWidth };
  });
  ok(dlg.rechts <= dlg.fenster && dlg.links >= 0 && dlg.sw <= dlg.cw, `Termindialog ohne Ueberlauf (${dlg.links}..${dlg.rechts} von ${dlg.fenster}, ${dlg.sw}/${dlg.cw})`);
  const kText = await kontrast(page, ".zv-stunden-kasten-text");
  ok(kText >= 4.5, `Kontrast Kastentext ${kText} >= 4.5`);
  await kasten.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${BILDER}/dialog-${name}.png` });
  await page.keyboard.press("Escape");

  // --- Termin in der Vergangenheit (das Formular legt nur neue an), dann Stunden ---
  const kontakte = (await api(page, "/chat/kontakte")).body;
  const jonas = kontakte.find((k) => k.art === "klient" && k.name.startsWith("Jonas"));
  const zeiten = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0); const e = new Date(b.getTime() + 90 * 60000);
    return { beginn: b.toISOString(), ende: e.toISOString(), spaeter: new Date(b.getTime() + 120 * 60000).toISOString() };
  });
  const titel = `${TITEL} ${name}`;
  const t = await api(page, "/kalender/termine", "POST", { titel, art: "klient", beginn: zeiten.beginn, ende: zeiten.ende, teilnehmer: [{ klientId: jonas.id }], stundenErfassen: true });
  ok(t.status === 201, `Termin von gestern mit Haken angelegt (${t.status})`);

  await zu(page, "Stunden");
  const zeile = page.locator(".zv-info-karte", { hasText: `Kalender: ${titel}` });
  await zeile.first().waitFor({ timeout: 8000 });
  ok((await zeile.count()) === 1, "Nach dem Ende gebucht: genau eine Zeile mit „Kalender: …“");
  ok(await zeile.locator("text=1:30 h").isVisible(), "Dauer 1:30 h");
  // Schmal faellt der Listenkopf weg, die Zellen tragen ihr Label dann selbst (data-label).
  const spalte = breite > 700 ? page.locator(".zv-liste-kopf:has-text('davon aus Kalender')") : page.locator("[data-label='davon aus Kalender']").first();
  ok(await spalte.isVisible(), "Saldo-Spalte „davon aus Kalender“");
  const kHerkunft = await kontrast(page, ".zv-stunden-herkunft");
  ok(kHerkunft >= 4.5, `Kontrast Herkunft-Verweis ${kHerkunft} >= 4.5`);
  let u = await ueberlauf(page);
  ok(u.s <= u.c, `Stundenliste ohne Ueberlauf (${u.s} <= ${u.c})`);

  // --- Aenderung nach der Buchung: automatisch storniert und neu gebucht ---
  const p = await api(page, `/kalender/termine/${t.body.id}`, "PATCH", { ende: zeiten.spaeter });
  ok(p.status === 200 && p.body.stunden.buchungen.length === 2, `Termin verlängert, zwei eigene Buchungen am Termin (${p.status})`);
  await zu(page, "Kalender");
  await zu(page, "Stunden");
  await zeile.nth(1).waitFor({ timeout: 8000 });
  ok((await zeile.count()) === 2, "Stundenliste zeigt beide Zeilen");
  const neu = zeile.filter({ hasText: "Automatisch neu gebucht" });
  const alt = zeile.filter({ hasText: "Automatisch storniert: Termin nachträglich geändert" });
  ok((await neu.count()) === 1 && (await neu.locator("text=2:00 h").isVisible()), "Neue Zeile 2:00 h mit „Automatisch neu gebucht“");
  ok((await alt.count()) === 1, "Alte Zeile „Automatisch storniert: Termin nachträglich geändert“");
  const kPill = await kontrast(page, ".zv-stunden-notiz .zv-pill-offen .zv-pill-text");
  ok(kPill >= 4.5, `Kontrast Hinweis-Pille ${kPill} >= 4.5`);
  u = await ueberlauf(page);
  ok(u.s <= u.c, `Stundenliste mit Hinweisen ohne Ueberlauf (${u.s} <= ${u.c})`);
  await neu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${BILDER}/stundenliste-${name}.png`, fullPage: breite > 500 });

  // --- Vormerkung in der Zukunft: Kasten ueber dem Saldo ---
  const morgen = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 2); const b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0); return { beginn: b.toISOString(), ende: new Date(b.getTime() + 45 * 60000).toISOString() }; });
  const z = await api(page, "/kalender/termine", "POST", { titel: `Zukunft ${LAUF} ${name}`, art: "klient", ...morgen, teilnehmer: [{ klientId: jonas.id }], stundenErfassen: true });
  ok(z.status === 201, "Termin in der Zukunft vorgemerkt");
  await zu(page, "Kalender");
  await zu(page, "Stunden");
  await page.locator(".zv-stunden-vormerkungen").waitFor({ timeout: 8000 });
  ok((await page.locator(".zv-stunden-vormerkungen").textContent()).includes("vorgemerkt"), "Kasten „… vorgemerkt“ über dem Saldo");
  const kVorm = await kontrast(page, ".zv-stunden-vormerkungen .zv-sub");
  ok(kVorm >= 4.5, `Kontrast Vormerkungstext ${kVorm} >= 4.5`);

  // --- Termindetail: Abschnitt "Stunden" ---
  const d = await api(page, `/kalender/termine/${t.body.id}`);
  ok(d.body.stunden?.vorgemerkt === true && d.body.stunden.minuten === 120, "Termindetail (API): vorgemerkt, 120 Minuten");
  await zu(page, "Kalender");
  // Gestern liegt montags in der Vorwoche. Breit zeigt das Zeitraster den
  // Termin als Block (title), schmal die Tagesliste (Text).
  const block = page.locator(`button[title*="${titel}"], button.zv-kal-termin:has-text("${titel}")`).filter({ visible: true }).first();
  const sichtbar = await block.waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (!sichtbar) await page.locator("button[aria-label^='Vorherige']").first().click();
  await block.click();
  const abschnitt = page.locator(".zv-termin-stunden");
  await abschnitt.waitFor({ timeout: 8000 });
  ok((await abschnitt.textContent()).includes("Automatisch neu gebucht"), "Termindetail: Abschnitt „Stunden“ mit „Automatisch neu gebucht“");
  ok(await abschnitt.locator("input[type=checkbox]").isChecked(), "Termindetail: eigener Haken gesetzt");
  const dlg2 = await page.evaluate(() => { const m = document.querySelector("[role=dialog]"); return { sw: m.scrollWidth, cw: m.clientWidth }; });
  ok(dlg2.sw <= dlg2.cw, `Termindetail ohne Ueberlauf (${dlg2.sw} <= ${dlg2.cw})`);
  const kDetail = await kontrast(page, ".zv-termin-stunden .zv-hinweis-info span");
  ok(kDetail >= 4.5, `Kontrast Stunden-Hinweis im Termindetail ${kDetail} >= 4.5`);
  await page.screenshot({ path: `${BILDER}/termindetail-${name}.png` });
  await page.keyboard.press("Escape");

  // --- Einstellungen: Konto-Bereich ---
  await zu(page, "Einstellungen");
  await page.locator(".zv-einstellungen-menue button:has-text('Kalender & Stunden')").click();
  await page.waitForSelector("h3:has-text('Termine als Betreuungszeit')");
  ok(await page.locator("h3:has-text('Deine Vormerkungen')").isVisible(), "Einstellungen: „Kalender & Stunden“ mit Vormerkungen");
  ok((await page.locator(".zv-einstellungen-menue button:has-text('Stunden')").count()) === 1, "Ohne Recht kein Träger-Bereich „Stunden“");
  u = await ueberlauf(page);
  ok(u.s <= u.c, `Einstellungen ohne Ueberlauf (${u.s} <= ${u.c})`);
  await page.screenshot({ path: `${BILDER}/einstellungen-${name}.png`, fullPage: breite > 500 });

  ok(serverFehler.length === 0, `Keine 5xx-Antworten (${serverFehler.join(", ") || "keine"})`);
  await ctx.close();
}

/** Leitung: Traeger-Bereich "Stunden" sichtbar und schmal ohne Ueberlauf. */
async function traeger(breite) {
  console.log(`\nTraeger-Bereich bei ${breite} px`);
  const ctx = await browser.newContext({ viewport: { width: breite, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await anmelden(page, LEITUNG);
  await zu(page, "Einstellungen");
  await page.locator(".zv-einstellungen-menue button", { hasText: /^Stunden$/ }).click();
  await page.waitForSelector("h3:has-text('Stunden aus dem Kalender')");
  ok(await page.locator("text=Termine dürfen als Betreuungszeit erfasst werden").isVisible(), "Leitung sieht den Träger-Schalter");
  const u = await ueberlauf(page);
  ok(u.s <= u.c, `Träger-Bereich ohne Ueberlauf (${u.s} <= ${u.c})`);
  await page.screenshot({ path: `${BILDER}/traeger-${breite}.png` });
  await ctx.close();
}

await durchlauf(1440, 900, "dunkel");
await durchlauf(390, 800, "hell");
await traeger(1440);
await traeger(390);
await browser.close();

if (messungen < 70) { console.log(`\nNur ${messungen} Messungen -- erwartet >= 70. Ein Lauf, der nichts misst, ist kein Ergebnis.`); process.exit(1); }
if (fehler.length) { console.log(`\n${fehler.length} Fehler:\n- ${fehler.join("\n- ")}`); process.exit(1); }
console.log(`\nAlle ${messungen} Pruefungen bestanden. Bilder: ${BILDER}`);
