/**
 * Browserpruefung "Eigene Termintypen" (Organisatorisch › Typen & Listen,
 * Termin-Dialog, Kalender) gegen laufende API + Dev-Server. Gemessen statt
 * angesehen:
 *   - die Seite buendelt alle vier Listen, die Typliste zeigt genau die
 *     Typen der API, der Standardtyp ist markiert;
 *   - ein Typ laesst sich ueber den Dialog anlegen (8 Farben, 3
 *     Betreuungszeit-Moeglichkeiten) und, solange unbenutzt, loeschen;
 *   - der Termin-Dialog bietet genau die aktiven Typen an, "vorbelegen"
 *     setzt den Betreuungszeit-Haken, "nicht vorbelegen" nimmt ihn weg;
 *   - eigene Typen erscheinen in Legende und Farbmarke, Kontrast der Marke
 *     auf jeder verwendeten Typfarbe >= 4.5 (hell und dunkel);
 *   - kein horizontaler Ueberlauf bei 1440 und 390 px.
 *
 * Voraussetzung: Mandant PRUEF_MANDANT, Konto PRUEF_LEITUNG mit
 * kalender.typen-verwalten und stunden.einstellungen-verwalten, Klient:in
 * "Jonas Becker". Die Pruefung legt die Typen Hausbesuch, Amtstermin und
 * Hilfeplangespräch an (falls noch nicht da) und je einen Termin damit.
 * Aufruf aus apps/web:  node scripts/termin-typen-pruefung.mjs
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
const BILDER = process.env.PRUEF_BILDER ?? "/tmp/termin-typen-bilder";
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


const LAUF = Date.now().toString(36).slice(-4);

async function vorbereiten() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await anmelden(page, LEITUNG);
  // Betreuungszeit aus dem Kalender muss an sein, sonst gibt es den Kasten nicht.
  await api(page, "/stundenbuchungen/kalender/traeger", "PUT", { erlaubt: true, vorauswahl: false });
  const gewuenscht = [
    { bezeichnung: "Hausbesuch", farbe: "orange", betreuungszeit: "vorbelegen", leistungsart: "einzelbetreuung" },
    { bezeichnung: "Amtstermin", farbe: "blau", betreuungszeit: "vorbelegen", leistungsart: "begleitung" },
    { bezeichnung: "Hilfeplangespräch", farbe: "rose", betreuungszeit: "vorbelegen", leistungsart: "beratung" },
  ];
  for (const t of gewuenscht) await api(page, "/kalender/typen", "POST", t); // 409 beim zweiten Lauf ist gewollt
  let typen = (await api(page, "/kalender/typen")).body;
  const besprechung = typen.find((t) => t.bezeichnung === "Besprechung");
  await api(page, `/kalender/typen/${besprechung.id}`, "PATCH", { betreuungszeit: "nicht_vorbelegen" });
  typen = (await api(page, "/kalender/typen")).body;
  // Je ein Termin heute mit den bunten Typen -- fuer Marke, Legende und Kontrast.
  const heute = new Date();
  const um = (h) => { const d = new Date(heute); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const antwort = await api(page, `/kalender/termine?von=${encodeURIComponent(um(0))}&bis=${encodeURIComponent(um(23))}`);
  if (antwort.status !== 200) throw new Error(`Termine laden: ${antwort.status} ${JSON.stringify(antwort.body)}`);
  const vorhanden = antwort.body;
  for (const [i, name] of ["Hausbesuch", "Amtstermin", "Hilfeplangespräch", "Besprechung", "Klient:innentermin"].entries()) {
    const typ = typen.find((t) => t.bezeichnung === name);
    if (vorhanden.some((t) => t.typ.id === typ.id)) continue;
    await api(page, "/kalender/termine", "POST", { titel: `${name} (Prüfung)`, beginn: um(8 + i), ende: um(9 + i), typId: typ.id });
  }
  await ctx.close();
  return typen;
}

async function oeffneTypenSeite(page) {
  const lasche = page.locator(".zv-aktenlippe-lasche");
  // Die Lasche erscheint erst, wenn die Rechte geladen sind -- darauf warten statt sofort zu fragen.
  if (page.viewportSize().width > 900) {
    await lasche.waitFor({ timeout: 10000 });
    if ((await lasche.getAttribute("aria-expanded")) === "false") await lasche.click();
    await page.locator("#zv-organisatorisch button:has-text('Typen & Listen')").click();
  } else {
    await page.click('.zv-tabbar-app button:has-text("Mehr")');
    await page.waitForSelector("#zv-sammelmenue-panel");
    await page.click('#zv-sammelmenue-panel button:has-text("Typen & Listen")');
  }
  await page.waitForSelector("h2:has-text('Typen & Listen')");
  await page.waitForSelector(".zv-typen-liste .zv-info-karte");
}

async function durchlauf(breite, hoehe, schema, typenApi, mitAnlegen) {
  const name = `${breite}-${schema}`;
  console.log(`\n${name}`);
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 2, colorScheme: schema === "dunkel" ? "dark" : "light" });
  const page = await ctx.newPage();
  const serverFehler = [];
  page.on("response", (r) => { if (r.status() >= 500) serverFehler.push(`${r.status()} ${r.url()}`); });
  await anmelden(page, LEITUNG);

  // --- Typen & Listen ---
  await oeffneTypenSeite(page);
  const punkte = await page.locator(".zv-typen-nav-punkt").allTextContents();
  ok(["Termintypen", "Abwesenheitsgründe", "Buchungstypen", "Leistungsarten"].every((l) => punkte.some((p) => p.startsWith(l))), `Alle vier Listen auf einer Seite (${punkte.length})`);
  ok(punkte.filter((p) => p.includes("fest")).length === 2, "Abwesenheitsgründe und Leistungsarten als „fest“ markiert");
  const zeilen = await page.locator(".zv-typen-liste .zv-info-karte .zv-liste-zelle-titel").allTextContents();
  ok(zeilen.length === typenApi.length, `Typliste zeigt alle ${typenApi.length} Typen der API (${zeilen.length})`);
  ok(zeilen[0].includes("Standard"), "Erster Typ ist der Standardtyp und so markiert");
  ok(zeilen.every((z, i) => z.startsWith(typenApi[i].bezeichnung)), "Reihenfolge wie in der API");
  let u = await ueberlauf(page);
  ok(u.s <= u.c, `Typen & Listen: kein horizontaler Ueberlauf (${u.s} <= ${u.c})`);
  const k1 = await kontrast(page, ".zv-typen-nav-punkt.aktiv");
  ok(k1 !== null && k1 >= 4.5, `Kontrast gewählte Liste ${k1} >= 4.5`);
  const k2 = await kontrast(page, ".zv-typen-fest");
  ok(k2 !== null && k2 >= 4.5, `Kontrast Hinweis „fest“ ${k2} >= 4.5`);
  await page.screenshot({ path: `${BILDER}/${name}-1-typen-und-listen.png`, fullPage: breite < 600 });

  await page.locator("button:has-text('Neuer Termintyp')").click();
  const dlg = page.locator("form:has(#typ-bezeichnung)");
  await dlg.waitFor();
  ok((await dlg.locator("input[name=typ-farbe]").count()) === 8, "Dialog: 8 feste Farben");
  ok((await dlg.locator("input[name=typ-betreuungszeit]").count()) === 3, "Dialog: 3 Möglichkeiten für die Betreuungszeit");
  if (mitAnlegen) {
    const neu = `Teamtag ${LAUF}`;
    await dlg.locator("#typ-bezeichnung").fill(neu);
    await dlg.locator("label:has(input[value=sand])").click();
    await dlg.locator("label:has(input[value=nicht_vorbelegen])").click();
    await page.screenshot({ path: `${BILDER}/${name}-2-neuer-typ.png` });
    await dlg.locator("button[type=submit]").click();
    await page.locator(`.zv-typen-liste .zv-liste-zelle-titel:has-text("${neu}")`).waitFor();
    ok(true, `Über den Dialog angelegt: ${neu}`);
    await page.locator(".zv-typen-liste .zv-info-karte", { hasText: neu }).locator("button:has-text('Bearbeiten')").click();
    await page.locator("form:has(#typ-bezeichnung) button:has-text('Löschen')").click();
    await page.locator(`.zv-typen-liste .zv-liste-zelle-titel:has-text("${neu}")`).waitFor({ state: "detached" });
    ok(true, "Unbenutzter Typ lässt sich löschen");
  } else {
    await page.keyboard.press("Escape");
  }

  // --- Termin-Dialog ---
  await zu(page, "Kalender");
  await page.locator("button:has-text('Neuer Termin')").first().click();
  await page.waitForSelector("#termin-suche");
  const form = page.locator("form:has(#termin-suche)");
  const aktiv = typenApi.filter((t) => t.aktiv);
  ok((await form.locator("input[name=termin-typ]").count()) === aktiv.length, `Termin-Dialog bietet die ${aktiv.length} aktiven Typen an`);
  ok(await form.locator("input[name=termin-typ]").first().isChecked(), "Ohne Wahl ist der Standardtyp gewählt");
  await form.locator("label.zv-kontakt-zeile", { hasText: "Jonas Becker" }).click();
  const haken = page.locator(".zv-stunden-kasten input[type=checkbox]");
  await form.locator("label.zv-art-wahl-option", { hasText: "Hausbesuch" }).click();
  ok(await haken.isChecked(), "„Hausbesuch“ (vorbelegen): Betreuungszeit angehakt");
  ok(await page.locator(".zv-stunden-kasten", { hasText: "Vorbelegt, weil der Typ „Hausbesuch“" }).isVisible(), "Hinweis nennt den Typ");
  ok((await page.locator("#termin-leistung").inputValue()) === "einzelbetreuung", "Leistung aus dem Typ übernommen");
  await form.locator("label.zv-art-wahl-option", { hasText: "Hausbesuch" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${BILDER}/${name}-3-termin-dialog.png` });
  await form.locator("label.zv-art-wahl-option", { hasText: "Besprechung" }).click();
  ok(!(await haken.isChecked()), "„Besprechung“ (nicht vorbelegen): Haken weg");
  u = await ueberlauf(page);
  ok(u.s <= u.c, `Termin-Dialog: kein horizontaler Ueberlauf (${u.s} <= ${u.c})`);
  await page.keyboard.press("Escape");

  // --- Kalender: Marken und Legende ---
  await page.locator(".zv-segmented button:has-text('Monat')").click();
  await page.waitForSelector(".zv-kal-termin-text .zv-art-marke");
  const marken = await page.locator(".zv-kal-termin-text .zv-art-marke").allTextContents();
  ok(["Hausbesuch", "Amtstermin", "Hilfeplangespräch"].every((m) => marken.includes(m)), `Eigene Typen als Marke am Termin (${[...new Set(marken)].join(", ")})`);
  for (const farbe of ["orange", "blau", "rose", "petrol", "gruen"]) {
    const k = await kontrast(page, `.zv-kal-termin-text .zv-art-marke.zv-typ-${farbe}`);
    ok(k !== null && k >= 4.5, `Kontrast Marke auf „${farbe}“ ${k} >= 4.5`);
  }
  await page.locator(".zv-kal-termin-text .zv-art-marke").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${BILDER}/${name}-4-kalender-monat.png` });
  await page.locator(".zv-segmented button:has-text('Jahr')").click();
  const farbeNachArt = page.locator(".zv-kal-farbmodus button:has-text('Art')");
  if (await farbeNachArt.isVisible().catch(() => false)) await farbeNachArt.click();
  await page.waitForSelector(".zv-kal-legende");
  const legende = await page.locator(".zv-kal-legende").textContent();
  ok(["Hausbesuch", "Amtstermin", "Hilfeplangespräch"].every((m) => legende.includes(m)), "Eigene Typen in der Legende");
  u = await ueberlauf(page);
  ok(u.s <= u.c, `Jahreskalender: kein horizontaler Ueberlauf (${u.s} <= ${u.c})`);
  ok(serverFehler.length === 0, `Keine 5xx-Antworten (${serverFehler.join(", ") || "keine"})`);
  await ctx.close();
}

const typenApi = await vorbereiten();
await durchlauf(1440, 900, "dunkel", typenApi, true);
await durchlauf(1440, 900, "hell", typenApi, false);
await durchlauf(390, 844, "hell", typenApi, false);
await browser.close();

// 1. Lauf 28 Messungen (mit Anlegen/Loeschen), danach je 26.
const ERWARTET = 28 + 2 * 26;
if (messungen < ERWARTET) {
  console.log(`\nNur ${messungen} von ${ERWARTET} Messungen -- Pruefung unvollstaendig.`);
  process.exit(1);
}
if (fehler.length > 0) {
  console.log(`\n${fehler.length} Fehler:`);
  for (const f of fehler) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Messungen in Ordnung. Bilder: ${BILDER}`);
