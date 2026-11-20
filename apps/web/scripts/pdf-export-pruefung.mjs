/**
 * Browserpruefung "PDF-Exporte je Formular" (Migration 0082, Konzept
 * /mnt/project-files/formular-pdf). Misst statt anzusehen:
 *
 *   1 Einstellungen › Angaben für Dokumente: Traegername speichern, Logo
 *     hochladen (erscheint in der Liste, "nicht benutzt").
 *   2 Formular › Reiter "PDF-Exporte": der Standard-Export "Akte" ist da.
 *   3 Neuer Export "Brief" -> Editor; die Vorschau ist ein echtes PDF
 *     (%PDF-, > 5 kB) und folgt einer Aenderung (Schrift wechseln -> neue
 *     Vorschau mit anderem Inhalt). Speichern -> Version 2.
 *   4 Akte: abgeschlossenes Protokoll -> "Als PDF" -> Brief waehlen ->
 *     Download ist ein PDF.
 *   5 Kein horizontaler Ueberlauf (1440 px Editor, 390 px Liste und Dialog).
 *
 * Voraussetzung: API (:3000), Dev-Server (:5173), ein Traeger mit
 * Vollzugriff, ein veroeffentlichtes Formular mit abgeschlossenem Protokoll.
 * Kein Bestandteil der CI.
 *
 *   node scripts/pdf-export-pruefung.mjs <slug> <email> <passwort> <formularName> <logoPng> [bilderOrdner]
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, formularName, logo, bilder] = process.argv;
if (!slug || !email || !passwort || !formularName || !logo) {
  console.error("Nutzung: node pdf-export-pruefung.mjs <slug> <email> <passwort> <formularName> <logoPng> [bilderOrdner]");
  process.exit(1);
}
const BASIS = "http://localhost:5173";
// Eindeutig je Lauf, damit ein zweiter Lauf nicht an Exporten des ersten haengt.
const EXPORT = `Bericht an das Amt ${new Date().toISOString().slice(11, 19)}`;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const bild = async (page, name) => bilder && (await page.screenshot({ path: `${bilder}/${name}.png`, fullPage: true }));

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(BASIS + "/");
await page.evaluate(() => localStorage.clear());
await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.getByRole("button", { name: /^Klienten$/ }).first().waitFor({ timeout: 15000 });

// Headless Chromium zeigt PDFs im iframe nicht an; gemessen wird deshalb
// genau das Dokument, auf das das iframe zeigt (seine blob:-Adresse).
let anfragen = 0;
page.on("request", (r) => {
  if (r.url().includes("/pdf-exporte/vorschau")) anfragen++;
});
async function vorschauBytes() {
  const zahlen = await page.evaluate(async () => {
    const src = document.querySelector(".zv-pe-papier iframe")?.getAttribute("src");
    if (!src) return [];
    const b = await (await fetch(src.split("#")[0])).arrayBuffer();
    return Array.from(new Uint8Array(b));
  });
  return Buffer.from(zahlen);
}

// ===== 1 Angaben für Dokumente =====
await page.click('.zv-sidebar-foot button[title="Einstellungen"]');
await page.getByRole("button", { name: /Angaben für Dokumente/ }).click();
await page.locator("#dok-name").fill("DRK Schöneberg-Wilmersdorf hilft gGmbH");
await page.locator("#dok-hauptsitz").fill("Kranzer Str. 6/7, 14199 Berlin");
await page.locator("#dok-geschaeftsfuehrung").fill("Clemens Trautermann");
// Bei einem zweiten Lauf sind die Werte schon gespeichert (Knopf gesperrt).
const speichernKnopf = page.getByRole("button", { name: "Speichern" }).first();
if (await speichernKnopf.isEnabled()) {
  await speichernKnopf.click();
  await page.getByText("Gespeichert. Neue PDFs").waitFor();
}
pruefe(!(await speichernKnopf.isEnabled()), "Trägerangaben gespeichert");
const logosVorher = await page.locator(".zv-dok-logos li", { hasText: "drk-logo.png" }).count();
await page.locator('input[type="file"]').setInputFiles({ name: "drk-logo.png", mimeType: "image/png", buffer: readFileSync(logo) });
await page.waitForFunction(
  (n) => [...document.querySelectorAll(".zv-dok-logos li")].filter((li) => li.textContent.includes("drk-logo.png")).length > n,
  logosVorher
);
pruefe((await page.locator(".zv-dok-logos li", { hasText: "nicht benutzt" }).count()) >= 1, "Logo hochgeladen, „nicht benutzt“");
pruefe((await ueberlauf(page)) <= 0, "Einstellungen: kein horizontaler Überlauf");
await bild(page, "1-angaben-fuer-dokumente");

// ===== 2 Reiter PDF-Exporte =====
const lasche = page.locator(".zv-aktenlippe-lasche");
if ((await lasche.getAttribute("aria-expanded")) === "false") await lasche.click();
await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
await page.getByRole("heading", { name: "Formulare", level: 2 }).waitFor();
await page.getByText(formularName, { exact: true }).first().click();
await page.getByRole("tablist", { name: "Bereiche des Formulars" }).getByRole("tab", { name: "PDF-Exporte" }).click();
await page.locator(".zv-pe-karte").first().waitFor();
const karten = await page.locator(".zv-pe-karte h3").allTextContents();
pruefe(karten.includes("Akte"), `Standard-Export „Akte“ vorhanden (${karten.join(", ")})`);
pruefe((await page.locator(".zv-pe-karte", { hasText: "Akte" }).getByText("Standard").count()) === 1, "„Akte“ ist als Standard markiert");

// ===== 3 Neuer Brief-Export, Editor, Vorschau =====
await page.getByRole("button", { name: "Neuer PDF-Export" }).click();
await page.locator("#pe-name").fill(EXPORT);
await page.getByRole("button", { name: "Anlegen und gestalten" }).click();
await page.locator(".zv-pe-editor").waitFor();
await page.waitForFunction(() => document.querySelector(".zv-pe-papier iframe"), null, { timeout: 15000 });
pruefe(anfragen >= 1, `Vorschau angefordert (${anfragen})`);
const erste = await vorschauBytes();
pruefe(erste && erste.subarray(0, 5).toString() === "%PDF-" && erste.length > 5000, `Vorschau ist ein PDF (${erste?.length ?? 0} Bytes)`);
// Zielgruppe extern, Logo waehlen, Schrift wechseln: die Vorschau folgt.
await page.getByRole("group", { name: "Zielgruppe" }).getByRole("button", { name: "extern" }).click();
await page.locator(".zv-pe-abschnitt summary", { hasText: "Kopf und Logo" }).click();
await page.locator("#pe-logo").selectOption({ label: "drk-logo.png" });
await page.locator(".zv-pe-abschnitt summary", { hasText: "Schrift und Farbe" }).click();
const vorher = anfragen;
const srcVorher = await page.locator(".zv-pe-papier iframe").getAttribute("src");
await page.locator("#pe-schrift").selectOption("liberation-serif");
await page.waitForFunction((alt) => document.querySelector(".zv-pe-papier iframe")?.getAttribute("src") !== alt, srcVorher, { timeout: 15000 });
const neue = await vorschauBytes();
pruefe(anfragen > vorher, `Vorschau folgt der Änderung (${anfragen - vorher} neue Anfrage)`);
pruefe(neue.subarray(0, 5).toString() === "%PDF-" && Buffer.compare(neue, erste) !== 0, `neue Vorschau ist ein anderes PDF (${neue.length} statt ${erste.length} Bytes)`);
pruefe((await ueberlauf(page)) <= 0, "Editor 1440 px: kein horizontaler Überlauf");
if (bilder) require("node:fs").writeFileSync(`${bilder}/vorschau-brief.pdf`, neue);
await bild(page, "3-editor");
await page.getByRole("button", { name: /Als Version 2 speichern/ }).click();
await page.getByText("Als Version 2 gespeichert").waitFor();
pruefe(true, "als Version 2 gespeichert");
await page.getByRole("button", { name: /PDF-Exporte$/ }).click();
await page.locator(".zv-pe-karte", { hasText: EXPORT }).waitFor();
pruefe((await page.locator(".zv-pe-karte", { hasText: EXPORT }).getByText("Version 2").count()) === 1, "Karte zeigt Version 2");
await bild(page, "2-pdf-exporte");

// ===== 4 Export aus der Akte =====
await page.getByRole("button", { name: /^Dokumentation$/ }).first().click();
await page.getByRole("radio", { name: "Protokolle" }).click();
await page.getByText(formularName).first().click();
await page.getByRole("button", { name: "Als PDF" }).click();
const dialog = page.locator(".zv-pe-neu");
await dialog.getByText(EXPORT).waitFor();
await dialog.locator("label", { hasText: EXPORT }).click();
const empf = page.locator("#pdf-empfaenger");
pruefe((await empf.inputValue()).length > 0, `Empfänger vorgeschlagen („${(await empf.inputValue()).split("\n")[0]}“)`);
await empf.fill("Bezirksamt Musterbezirk\nTeilhabefachdienst Soziales\nMusterstraße 1\n10000 Berlin");
await bild(page, "4-export-dialog");
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF erzeugen und herunterladen" }).click()]);
const pfad = await download.path();
const bytes = readFileSync(pfad);
pruefe(bytes.subarray(0, 5).toString() === "%PDF-", `Download ist ein PDF (${download.suggestedFilename()}, ${bytes.length} Bytes)`);
if (bilder) require("node:fs").writeFileSync(`${bilder}/export-brief.pdf`, bytes);

// ===== 5 Handybreite: Akte mit offenem Export-Dialog =====
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Als PDF" }).click();
await page.locator(".zv-pe-neu").getByText(EXPORT).waitFor();
pruefe((await ueberlauf(page)) <= 0, "390 px, Export-Dialog: kein horizontaler Überlauf");
const dialogBreite = await page.evaluate(() => {
  const d = document.querySelector(".zv-pe-neu").getBoundingClientRect();
  return { links: d.left, rechts: d.right };
});
pruefe(dialogBreite.links >= 0 && dialogBreite.rechts <= 390, `Dialog passt in 390 px (${Math.round(dialogBreite.links)}–${Math.round(dialogBreite.rechts)})`);
await bild(page, "5-dialog-handy");

await browser.close();
if (messungen < 15) {
  console.error(`Zu wenige Messungen (${messungen}) -- die Prüfung hat nichts Verlässliches gemessen.`);
  process.exit(1);
}
console.log(`\n${messungen - fehler.length}/${messungen} Messungen in Ordnung`);
process.exit(fehler.length ? 1 : 0);
