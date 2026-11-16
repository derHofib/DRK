/**
 * Browserpruefung der Rueckmeldungs-Funktion (Screenshot-Maskierung, Menue,
 * Senden). Misst statt anzusehen:
 *
 *   1 Maskierung: im Screenshot ist die Flaeche, auf der im echten Browser ein
 *     Klientenname steht, einfarbig -- und dieselbe Flaeche im UNmaskierten
 *     Playwright-Screenshot ist es nicht (sonst wuerde die Messung nichts
 *     beweisen, vgl. CLAUDE.md "Ein Pruefskript, das nichts misst, muss
 *     fehlschlagen").
 *   2 Das Senden legt Eintrag + Bild an; der Kontext hat die Ansicht, keine Ids.
 *   3 Menue: "Rueckmeldungen" nur fuer die Geschaeftsfuehrung, nicht fuer
 *     Mitarbeitende; die API sagt dasselbe (403).
 *   4 Mobil (390 px): Melden-Knopf erreichbar, kein horizontaler Ueberlauf.
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173) sowie ein
 * Traeger mit einer Geschaeftsfuehrung, einer mitarbeitenden Person und einem
 * Klienten "Maximilian Musterfrau" (Seed siehe Commit-Nachricht). Kein
 * Bestandteil der CI.
 *
 *   node scripts/rueckmeldung-pruefung.mjs <slug> <gfEmail> <mitarbeiterEmail> <passwort>
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, gfEmail, maEmail, passwort] = process.argv;
if (!slug || !gfEmail || !maEmail || !passwort) {
  console.error("Nutzung: node rueckmeldung-pruefung.mjs <slug> <gfEmail> <mitarbeiterEmail> <passwort>");
  process.exit(1);
}
const BASIS = "http://localhost:5173";
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function anmelden(page, email) {
  await page.goto(BASIS + "/");
  await page.locator("#mandantSlug").fill(slug);
  await page.locator("#email").fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.getByRole("button", { name: /^Klienten$/ }).first().waitFor({ timeout: 15000 });
}

// Token der angemeldeten Sitzung statt eines weiteren Logins: die Anmelde-Schranke
// (10 pro Minute) wuerde sonst bei wiederholten Laeufen anschlagen.
async function token(page) {
  return page.evaluate((k) => localStorage.getItem(k), "zimmerakte_token");
}

/** Farbvielfalt und Anteil der haeufigsten Farbe in einem Rechteck eines Bildes (Blob- oder Data-URL). */
async function farbenImRechteck(page, quelle, box, skala) {
  return page.evaluate(
    async ({ quelle, box, skala }) => {
      // Per <img> statt fetch(): die CSP erlaubt blob: nur fuer Bilder.
      const bild = new Image();
      bild.src = quelle;
      await bild.decode();
      const c = document.createElement("canvas");
      c.width = bild.naturalWidth;
      c.height = bild.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(bild, 0, 0);
      const d = ctx.getImageData(Math.round(box.x * skala), Math.round(box.y * skala), Math.round(box.width * skala), Math.round(box.height * skala)).data;
      const zaehler = new Map();
      for (let i = 0; i < d.length; i += 4) {
        // Grob quantisiert (16er-Stufen): Rundung an Teilpixel-Kanten ergibt +-1, keine Zeichen.
        const f = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        zaehler.set(f, (zaehler.get(f) ?? 0) + 1);
      }
      // Anteil der zwei haeufigsten Farben (Flaeche + Hintergrund): bei verdecktem
      // Text ~1, bei lesbarem Text deutlich darunter (Kantenglaettung, Strichfarbe).
      const haeufig = [...zaehler.values()].sort((a, b) => b - a);
      return { farben: zaehler.size, anteil: (haeufig[0] + (haeufig[1] ?? 0)) / (d.length / 4) };
    },
    { quelle, box, skala },
  );
}

// ===== 1 + 2: Geschaeftsfuehrung, Desktop =====
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await anmelden(page, gfEmail);
await page.getByRole("button", { name: /^Klienten$/ }).first().click();
const name = page.getByText(/Musterfrau/).first();
await name.waitFor({ timeout: 10000 });
const box = await name.boundingBox();
pruefe(!!box && box.width > 20 && box.height > 8, `Klientenname im Browser gefunden (${box ? Math.round(box.width) + "x" + Math.round(box.height) : "nicht gefunden"})`);

// Referenz: derselbe Ausschnitt UNmaskiert. Beweist, dass die Messung Text erkennt.
const referenz = "data:image/png;base64," + (await page.screenshot({ clip: box })).toString("base64");
const farbenReferenz = await farbenImRechteck(page, referenz, { x: 0, y: 0, width: box.width, height: box.height }, 1);
pruefe(farbenReferenz.farben >= 8 && farbenReferenz.anteil < 0.95, `Messung ist sensibel: unmaskierter Text hat ${farbenReferenz.farben} Farben, die zwei häufigsten Farben ${(farbenReferenz.anteil * 100).toFixed(0)} % (< 95 %)`);

await page.getByRole("button", { name: /Rückmeldung geben/ }).first().click();
await page.locator(".zv-modal").waitFor({ timeout: 15000 });
const vorschau = page.locator('img[alt^="Vorschau"]');
await vorschau.waitFor({ timeout: 15000 });
const src = await vorschau.getAttribute("src");
const farbenMaskiert = await farbenImRechteck(page, src, box, 1);
pruefe(farbenMaskiert.anteil >= 0.99, `Maskierter Screenshot: Fläche des Klientennamens besteht zu ${(farbenMaskiert.anteil * 100).toFixed(1)} % aus nur zwei Farben (>= 99 %)`);

// Ganzes Bild: kein Text irgendwo. Fläche der Klientenliste (Inhaltsbereich) auf Farbvielfalt pruefen.
const inhalt = await page.locator(".zv-content").first().boundingBox();
const farbenInhalt = await farbenImRechteck(page, src, { x: inhalt.x, y: inhalt.y + 60, width: inhalt.width, height: Math.min(inhalt.height - 60, 400) }, 1);
const farbenInhaltRef = await farbenImRechteck(
  page,
  "data:image/png;base64," + (await page.screenshot({ clip: { x: inhalt.x, y: inhalt.y + 60, width: inhalt.width, height: Math.min(inhalt.height - 60, 400) } })).toString("base64"),
  { x: 0, y: 0, width: inhalt.width, height: Math.min(inhalt.height - 60, 400) },
  1,
);
pruefe(farbenInhalt.farben < farbenInhaltRef.farben / 2, `Inhaltsbereich deutlich ärmer an Farben im Screenshot (${farbenInhalt.farben}) als in der Seite (${farbenInhaltRef.farben})`);

// Navigation bleibt lesbar (data-screenshot-sichtbar): dort darf es Text geben.
const nav = await page.locator("nav[aria-label='Hauptmenü']").boundingBox();
const farbenNav = await farbenImRechteck(page, src, nav, 1);
pruefe(farbenNav.farben >= 8 && farbenNav.anteil < 0.95, `Navigation bleibt im Bild lesbar (${farbenNav.farben} Farben, zwei häufigste ${(farbenNav.anteil * 100).toFixed(0)} %)`);

// Senden
await page.locator("#rueckmeldung-titel").fill("Prüfmeldung Filter");
await page.locator("#rueckmeldung-beschreibung").fill("Der Filter vergisst seine Auswahl.");
await page.getByRole("button", { name: /^Senden$/ }).click();
await page.getByText(/Danke für Ihre Rückmeldung/).waitFor({ timeout: 10000 });

const t = await token(page);
const liste = await (await page.request.get(`${BASIS}/api/rueckmeldungen?status=neu`, { headers: { Authorization: `Bearer ${t}` } })).json();
const meine = liste.find((r) => r.titel === "Prüfmeldung Filter");
pruefe(!!meine, "Rückmeldung ist angekommen (Status neu)");
pruefe(meine?.hatBild === true, "Screenshot wurde mitgespeichert");
const detail = await (await page.request.get(`${BASIS}/api/rueckmeldungen/${meine.id}`, { headers: { Authorization: `Bearer ${t}` } })).json();
pruefe(detail.kontext.seite === "klienten" && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(JSON.stringify(detail.kontext)), `Kontext hat die Ansicht und keine Ids (seite=${detail.kontext.seite})`);

// Menue: Eingang sichtbar, oeffnet, zeigt den Eintrag
await page.locator(".zv-modal").getByRole("button", { name: /^Schließen$/ }).last().click();
const eingang = page.getByRole("button", { name: /^Rückmeldungen/ }).first();
pruefe(await eingang.isVisible(), "Geschäftsführung sieht den Menüpunkt Rückmeldungen");
await eingang.click();
pruefe(await page.getByText("Prüfmeldung Filter").first().waitFor({ timeout: 8000 }).then(() => true, () => false), "Eintrag erscheint im Eingang");
await ctx.close();

// ===== 3: Mitarbeitende Person =====
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page2 = await ctx2.newPage();
await anmelden(page2, maEmail);
pruefe((await page2.getByRole("button", { name: /^Rückmeldungen/ }).count()) === 0, "Mitarbeitende sehen den Menüpunkt Rückmeldungen NICHT");
pruefe(await page2.getByRole("button", { name: /Rückmeldung geben/ }).first().isVisible(), "Mitarbeitende können Rückmeldung geben");
const t2 = await token(page2);
pruefe((await page2.request.get(`${BASIS}/api/rueckmeldungen`, { headers: { Authorization: `Bearer ${t2}` } })).status() === 403, "API verweigert Mitarbeitenden die Liste (403)");
await ctx2.close();

// ===== 4: Mobil =====
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 800 } });
const page3 = await ctx3.newPage();
await anmelden(page3, gfEmail).catch(async () => {
  await page3.waitForTimeout(500);
});
const knopf = page3.getByRole("button", { name: /Rückmeldung geben/ }).first();
pruefe(await knopf.isVisible(), "Mobil: Melden-Knopf in der Kopfzeile sichtbar");
await knopf.click();
await page3.locator(".zv-modal").waitFor({ timeout: 15000 });
const ueberlauf = await page3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
pruefe(ueberlauf <= 0, `Mobil: kein horizontaler Überlauf mit offenem Dialog (${ueberlauf}px)`);
await ctx3.close();

await browser.close();
if (messungen < 10) fehler.push(`Nur ${messungen} Messungen -- das Skript hat nicht gemessen, was es sollte.`);
if (fehler.length) {
  console.error(`\n${fehler.length} Fehler:\n- ${fehler.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nAlles in Ordnung (${messungen} Messungen).`);
