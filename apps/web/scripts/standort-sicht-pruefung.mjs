/**
 * Browserpruefung Standort-Sicht (Migration 0084, Konzept
 * standort-sichtbarkeit). Misst statt anzusehen:
 *   - Geschaeftsfuehrung: keine Standortzeile (sieht alles); Vorschau unter
 *     Mitarbeitende nennt, wer danach weniger sieht; Einschalten kommt an,
 *     Spalte "Sieht" zeigt danach den Standort aus dem Rang;
 *   - Mitarbeiterin mit Rang an Haus A: Zeile unter dem Namen, "Deine Sicht"
 *     oeffnet und schliesst (Escape), Klientenliste nur Haus A, im
 *     Vertretungsdialog ist genau der eigene Standort vorbelegt;
 *   - Vertretung genehmigt: Pille "+ Haus A", Hinweis auf "Heute",
 *     Klientenliste beider Haeuser; am Handy (390 px, hell) Standort in der
 *     Kopfleiste, "Deine Sicht" als Blatt am unteren Rand, kein Ueberlauf;
 *   - Rang ohne Einrichtung: Zeile "Kein Standort zugeordnet" + Hinweis.
 *
 * Voraussetzung: API + Dev-Server, ein frischer Traeger mit Standort A
 * (Klientin A), Standort B (Klientin B), Geschaeftsfuehrung (Vollzugriff),
 * und drei Konten auf einem Sammelrang: <a> arbeitet an A, <b> an B, <ohne>
 * ohne Einrichtung. Die Regel "Sicht aus dem Rang" ist zu Beginn AUS.
 *
 * Nutzung: node scripts/standort-sicht-pruefung.mjs <slug> <passwort> <gfEmail>
 *   <aEmail> <bEmail> <ohneEmail> <standortA> <standortB> <klientA> <klientB> [bildordner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, passwort, gfEmail, aEmail, bEmail, ohneEmail, standortA, standortB, klientA, klientB, bildordner] = process.argv;
if (!klientB) {
  console.error(
    "Nutzung: node scripts/standort-sicht-pruefung.mjs <slug> <passwort> <gfEmail> <aEmail> <bEmail> <ohneEmail> <standortA> <standortB> <klientA> <klientB> [bildordner]"
  );
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
// Ein Pruefskript, das nichts misst, muss fehlschlagen (CLAUDE.md).
const ERWARTETE_MESSUNGEN = 26;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const bild = async (page, name, fullPage = false) => bildordner && page.screenshot({ path: `${bildordner}/${name}.png`, fullPage });
const anzeige = (iso) => iso.split("-").reverse().join(".");
const plusTage = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function anmelden(email, viewport, colorScheme) {
  const page = await browser.newPage({ viewport, colorScheme, deviceScaleFactor: bildordner ? 2 : 1 });
  await page.goto(BASIS, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", slug);
  await page.fill("#email", email);
  await page.fill("#passwort", passwort);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content", { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  return page;
}
const navi = (page, name) => page.click(`.zv-sidebar button:has-text("${name}")`);
async function klientenText(page) {
  const antwort = page.waitForResponse((r) => /\/api\/klienten(\?|$)/.test(r.url()));
  await navi(page, "Klienten");
  await antwort;
  await page.waitForLoadState("networkidle");
  return page.locator(".zv-content").innerText();
}

// --- Geschaeftsfuehrung: Vorschau und Einschalten ---------------------------
{
  const page = await anmelden(gfEmail, { width: 1440, height: 1000 }, "dark");
  pruefe((await page.locator(".zv-sicht-zeile").count()) === 0, "Geschäftsführung: keine Standortzeile (sieht alles)");
  await navi(page, "Mitarbeitende");
  await page.waitForSelector(".zv-regel-vorschau");
  const kopf = await page.locator(".zv-regel-vorschau strong").first().innerText();
  const n = Number(/(\d+) Person/.exec(kopf)?.[1] ?? 0);
  pruefe(n >= 3, `Vorschau: „${kopf}“ (erwartet mindestens 3)`);
  const zeilen = await page.locator(".zv-regel-vorschau-liste [role=row]").allInnerTexts();
  const zeileA = zeilen.find((z) => z.includes(standortA) && z.includes("heute: alle"));
  pruefe(Boolean(zeileA), `Vorschau: eine Zeile „heute: alle“ → „${standortA}“`);
  pruefe(!(await ueberlauf(page)), "Mitarbeitende 1440 px: kein waagerechter Überlauf");
  await bild(page, "umgesetzt-1-vorschau-dunkel");

  const geschaltet = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/standort-sicht/regel"));
  await page.click('.zv-regel-vorschau button:has-text("Sicht aus dem Rang einschalten")');
  pruefe((await geschaltet).status() === 200, "Einschalten: HTTP 200");
  await page.waitForSelector(".zv-regel-vorschau strong:has-text('eingeschaltet')");
  // Die Liste laedt nach dem Umschalten im Hintergrund neu.
  await page.waitForSelector(`.zv-sicht-zelle:has-text("${standortA}")`, { timeout: 5000 }).catch(() => {});
  const sieht = await page.locator(".zv-sicht-zelle").allInnerTexts();
  pruefe(sieht.some((s) => s.includes(standortA)), `Spalte „Sieht“ nennt ${standortA} aus dem Rang`);
  await bild(page, "umgesetzt-2-mitarbeitende-eingeschaltet-dunkel");
  await page.close();
}

// --- Mitarbeiterin an A: Zeile, Deine Sicht, Klienten, Vertretung ----------
{
  const page = await anmelden(aEmail, { width: 1440, height: 1000 }, "dark");
  const zeile = page.locator(".zv-sicht-zeile");
  pruefe((await zeile.innerText()).trim() === standortA, `Standortzeile unter dem Namen: „${(await zeile.innerText()).trim()}“`);
  const [nameY, zeileY] = await Promise.all([
    page.$eval(".zv-benutzer-name", (e) => e.getBoundingClientRect().y),
    zeile.evaluate((e) => e.getBoundingClientRect().y),
  ]);
  pruefe(zeileY > nameY, `Zeile steht unter dem Namen (y ${Math.round(nameY)} → ${Math.round(zeileY)})`);
  await zeile.click();
  await page.waitForSelector(".zv-sicht-blatt");
  const blatt = await page.$eval(".zv-sicht-blatt", (e) => {
    const r = e.getBoundingClientRect();
    return { innen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, text: e.innerText };
  });
  pruefe(blatt.innen && blatt.text.includes(standortA) && blatt.text.includes("Aus deinem Rang"), "„Deine Sicht“ liegt im Fenster, nennt Standort und Herkunft");
  await bild(page, "umgesetzt-3-deine-sicht-dunkel");
  await page.keyboard.press("Escape");
  pruefe((await page.locator(".zv-sicht-blatt").count()) === 0, "Escape schließt „Deine Sicht“");

  const text = await klientenText(page);
  pruefe(text.includes(klientA) && !text.includes(klientB), `Klientenliste: nur ${klientA}, nicht ${klientB}`);

  await navi(page, "Vertretung");
  await page.click('.zv-seiten-kopf button');
  await page.waitForSelector(".zv-vertretung-standorte");
  const boxen = await page.$$eval('.zv-vertretung-standorte input[name="standortIds"]', (e) =>
    e.map((x) => ({ an: x.checked, text: x.closest("label").innerText.trim() }))
  );
  pruefe(boxen.length === 1 && boxen[0].an && boxen[0].text.includes(standortA), `Vertretung: genau der eigene Standort vorbelegt (${JSON.stringify(boxen)})`);
  const vertreter = await page.$eval("#vertretung-vertreter", (s, name) => [...s.options].find((o) => o.textContent.toLowerCase().includes(name))?.value, bEmail.split("@")[0]);
  await page.selectOption("#vertretung-vertreter", vertreter ?? { index: 1 });
  await page.fill("#vertretung-von", anzeige(plusTage(0)));
  await page.locator("#vertretung-von").press("Tab");
  await page.fill("#vertretung-bis", anzeige(plusTage(6)));
  await page.locator("#vertretung-bis").press("Tab");
  await page.waitForTimeout(400);
  await bild(page, "umgesetzt-4-vertretung-dunkel");
  const angelegt = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/delegationen"));
  await page.click('.zv-modal button[type="submit"]');
  pruefe((await angelegt).status() === 201, "Vertretung mit Standort beantragt: HTTP 201");
  await page.close();
}

// --- Vertretung genehmigt: Pille, Hinweis, Handy-Kopfleiste ----------------
{
  const page = await anmelden(bEmail, { width: 1440, height: 1000 }, "light");
  await navi(page, "Vertretung");
  const genehmigt = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/genehmigen"));
  await page.click('button:has-text("Genehmigen")');
  pruefe((await genehmigt).ok(), "Vertretung genehmigt");
  await page.close();
}
{
  const page = await anmelden(bEmail, { width: 1440, height: 1000 }, "light");
  const pille = await page.locator(".zv-sicht-pille").innerText();
  pruefe(pille.includes(standortA), `Pille unter dem Namen: „${pille.trim()}“`);
  const hinweis = await page.locator(".zv-content .zv-hinweis-info").first().innerText();
  pruefe(hinweis.includes(standortA) && hinweis.includes("siehst du auch"), "Hinweis auf „Heute“ nennt den geliehenen Standort");
  await bild(page, "umgesetzt-5-heute-vertretung-hell");
  const text = await klientenText(page);
  pruefe(text.includes(klientA) && text.includes(klientB), "Klientenliste während der Vertretung: beide Häuser");
  await page.close();
}
{
  const page = await anmelden(bEmail, { width: 390, height: 844 }, "light");
  const ort = page.locator(".zv-topbar-ort");
  await ort.waitFor({ timeout: 5000 }).catch(() => {});
  pruefe(await ort.isVisible(), "Handy: Standort in der Kopfleiste sichtbar");
  pruefe((await ort.innerText()).includes(standortB), `Handy-Kopfleiste nennt ${standortB}`);
  pruefe(!(await ueberlauf(page)), "Handy 390 px: kein waagerechter Überlauf");
  await bild(page, "umgesetzt-6-handy-heute-hell");
  await ort.locator("button").click();
  await page.waitForSelector(".zv-sicht-blatt");
  await page.waitForTimeout(400);
  const r = await page.$eval(".zv-sicht-blatt", (e) => {
    const b = e.getBoundingClientRect();
    return { unten: Math.round(innerHeight - b.bottom), links: Math.round(b.left), breite: Math.round(b.width), text: e.innerText };
  });
  pruefe(r.unten <= 1 && r.links <= 1 && r.breite >= 388, `Handy: „Deine Sicht“ als Blatt am unteren Rand (Abstand ${r.unten}, Breite ${r.breite})`);
  pruefe(r.text.includes("Vertretung für") && r.text.includes(standortA), "Blatt nennt die Vertretung");
  pruefe(!(await ueberlauf(page)), "Handy mit Blatt: kein waagerechter Überlauf");
  await bild(page, "umgesetzt-7-handy-deine-sicht-hell");
  await page.close();
}

// --- Rang ohne Einrichtung: geschlossen, mit Erklaerung --------------------
{
  const page = await anmelden(ohneEmail, { width: 1440, height: 1000 }, "dark");
  pruefe((await page.locator(".zv-sicht-zeile-keiner").innerText()).includes("Kein Standort"), "Ohne Einrichtung: Zeile „Kein Standort zugeordnet“");
  const hinweis = await page.locator(".zv-content .zv-hinweis-info").first().innerText();
  pruefe(hinweis.includes("keinem Standort zugeordnet"), "Ohne Einrichtung: Hinweis auf „Heute“ erklärt die leere Seite");
  const text = await klientenText(page);
  pruefe(!text.includes(klientA) && !text.includes(klientB), "Ohne Einrichtung: keine Klient:innen");
  await page.close();
}

await browser.close();
if (messungen < ERWARTETE_MESSUNGEN) fehler.push(`nur ${messungen} von ${ERWARTETE_MESSUNGEN} Messungen`);
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
if (fehler.length) {
  for (const f of fehler) console.log(`  - ${f}`);
  process.exit(1);
}
