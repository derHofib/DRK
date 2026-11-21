/**
 * Browserpruefung "PDF-Designer" (Grundform "frei", Konzept
 * /mnt/project-files/pdf-designer). Misst statt anzusehen:
 *
 *   1 Neuer Brief-Export -> Grundform "Frei gestaltet" -> "Aus der bisherigen
 *     Gestaltung uebernehmen": der Designer oeffnet mit den zerlegten
 *     Bausteinen (Logo, Anschriftfeld, Infospalte, Fliessbereich, ...).
 *   2 Ein Feld aus dem Baukasten aufs Blatt ziehen: es entsteht genau dort
 *     (Abweichung <= 1 mm), eingerastet auf ganze mm.
 *   3 Pfeiltaste verschiebt um einen Rasterschritt, mit Shift um 5 mm;
 *     Groesse am Griff aendern; Rueckgaengig stellt den Stand wieder her.
 *   4 "Passt es?": mit den laengsten Werten wird das zu kleine Feld als
 *     "passt nicht" markiert (Antwort des Servers, nicht geschaetzt).
 *   5 Mehrfachauswahl + "oben" richtet die Oberkanten gleich aus.
 *   6 Uebernehmen -> Speichern als neue Version; Vorschau ist ein PDF.
 *   7 Kein horizontaler Ueberlauf der Seite (1600 und 1280 px).
 *
 * Voraussetzung: API (:3000), Dev-Server (:5173), ein Traeger mit
 * Vollzugriff, ein veroeffentlichtes Formular mit Kurztextfeld
 * "Post geöffnet und sortiert" und mindestens einem abgeschlossenen
 * Protokoll mit langem Wert darin, ein Logo. Kein Bestandteil der CI.
 *
 *   node scripts/pdf-designer-pruefung.mjs <slug> <email> <passwort> <formularName> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, formularName, bilder] = process.argv;
if (!slug || !email || !passwort || !formularName) {
  console.error("Nutzung: node pdf-designer-pruefung.mjs <slug> <email> <passwort> <formularName> [bilderOrdner]");
  process.exit(1);
}
const BASIS = "http://localhost:5173";
const EXPORT = `Designer ${new Date().toISOString().slice(11, 19)}`;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const bild = async (page, name) => bilder && (await page.screenshot({ path: `${bilder}/${name}.png` }));

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: bilder ? 2 : 1 });
const page = await ctx.newPage();
await page.goto(BASIS + "/");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("zimmerakte_theme", "dunkel");
});
await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.getByRole("button", { name: /^Klienten$/ }).first().waitFor({ timeout: 15000 });

// ===== 1 Brief anlegen, auf "frei" umstellen =====
const lasche = page.locator(".zv-aktenlippe-lasche");
if ((await lasche.getAttribute("aria-expanded")) === "false") await lasche.click();
await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
await page.getByRole("heading", { name: "Formulare", level: 2 }).waitFor();
await page.getByText(formularName, { exact: true }).first().click();
await page.getByRole("tablist", { name: "Bereiche des Formulars" }).getByRole("tab", { name: "PDF-Exporte" }).click();
await page.getByRole("button", { name: "Neuer PDF-Export" }).click();
await page.locator("#pe-name").fill(EXPORT);
await page.getByRole("button", { name: "Anlegen und gestalten" }).click();
await page.locator(".zv-pe-editor").waitFor();
await page.getByRole("group", { name: "Zielgruppe" }).getByRole("button", { name: "extern" }).click();
await page.locator(".zv-pe-abschnitt summary", { hasText: "Kopf und Logo" }).click();
await page.locator("#pe-logo").selectOption({ index: 1 });
await page.locator(".zv-pe-abschnitt summary", { hasText: "Grundform" }).click();
await page.locator("#pe-vorlage").selectOption("frei");
await page.getByRole("button", { name: "Aus der bisherigen Gestaltung übernehmen" }).click();
const blatt = page.getByTestId("pd-blatt");
await blatt.waitFor();
const arten = await page.locator(".zv-pd-el").evaluateAll((l) => l.map((e) => [...e.classList].find((c) => c.startsWith("zv-pd-el-") && c !== "zv-pd-el-sel")));
pruefe(arten.length >= 8, `Designer offen mit ${arten.length} Bausteinen aus dem Brief`);
for (const art of ["zv-pd-el-logo", "zv-pd-el-anschrift", "zv-pd-el-fluss"]) pruefe(arten.includes(art), `Baustein ${art.slice(9)} übernommen`);
await page.waitForTimeout(400); // Schriften und Logo
pruefe((await ueberlauf(page)) <= 0, "Designer 1600 px: kein horizontaler Überlauf");

// Massstab: px je mm aus der Blattbreite.
const mmPx = async () => (await blatt.boundingBox()).width / 210;
const elBox = async (sel) => {
  const b = await blatt.boundingBox();
  const e = await page.locator(sel).boundingBox();
  const z = b.width / 210;
  return { x: (e.x - b.x) / z, y: (e.y - b.y) / z, b: e.width / z, h: e.height / z };
};

// ===== 2 Feld aus dem Baukasten ziehen =====
const chip = page.locator(".zv-pd-chip", { hasText: "Post geöffnet und sortiert" });
const cb = await chip.boundingBox();
const bb = await blatt.boundingBox();
const z = await mmPx();
const zielMm = { x: 30.3, y: 160.4 };
await page.mouse.move(cb.x + 20, cb.y + cb.height / 2);
await page.mouse.down();
await page.mouse.move(cb.x + 120, cb.y + 40, { steps: 4 });
await page.mouse.move(bb.x + zielMm.x * z, bb.y + zielMm.y * z, { steps: 8 });
await bild(page, "entwurf-ziehen");
await page.mouse.up();
const neuId = await page.locator(".zv-pd-el-sel").getAttribute("data-id");
pruefe(!!neuId && neuId.startsWith("feld"), `neuer Baustein angelegt und ausgewählt (${neuId})`);
const neu = await elBox(`[data-id="${neuId}"]`);
pruefe(Math.abs(neu.x - zielMm.x) <= 1 && Math.abs(neu.y - zielMm.y) <= 1, `liegt am Ablageort (x ${neu.x.toFixed(1)}, y ${neu.y.toFixed(1)} mm, Ziel ${zielMm.x}/${zielMm.y})`);
const xFeld = Number(await page.getByRole("complementary", { name: "Eigenschaften" }).locator("label", { hasText: "X" }).locator("input").inputValue());
pruefe(Number.isInteger(xFeld * 2), `Position auf 0,5-mm-Raster eingerastet (X = ${xFeld})`);

// ===== 3 Tastatur, Groesse, Rueckgaengig =====
const xInput = page.getByRole("complementary", { name: "Eigenschaften" }).locator(".zv-pd-zahl", { hasText: "X" }).locator("input");
const x0 = Number(await xInput.inputValue());
await page.locator(".zv-pd-buehne").focus().catch(() => undefined);
await page.keyboard.press("ArrowRight");
const x1 = Number(await xInput.inputValue());
await page.keyboard.press("Shift+ArrowRight");
const x2 = Number(await xInput.inputValue());
pruefe(x1 - x0 === 1 && x2 - x1 === 5, `Pfeiltaste +1 mm, mit Shift +5 mm (${x0} → ${x1} → ${x2})`);
const bInput = page.getByRole("complementary", { name: "Eigenschaften" }).locator(".zv-pd-zahl", { hasText: "B" }).locator("input");
const b0 = Number(await bInput.inputValue());
const griff = await page.locator(`[data-id="${neuId}"] .zv-pd-griffpunkt-e`).boundingBox();
await page.mouse.move(griff.x + 4, griff.y + 4);
await page.mouse.down();
await page.mouse.move(griff.x + 4 - 25 * z, griff.y + 4, { steps: 6 });
await page.mouse.up();
const b1 = Number(await bInput.inputValue());
pruefe(Math.abs(b0 - 25 - b1) <= 1, `Griff verkleinert die Breite um 25 mm (${b0} → ${b1})`);
await page.keyboard.press("Control+z");
const b2 = Number(await bInput.inputValue());
pruefe(b2 === b0, `Rückgängig stellt die Breite wieder her (${b2})`);
await page.keyboard.press("Control+Shift+z");
pruefe(Number(await bInput.inputValue()) === b1, "Wiederholen setzt sie wieder");

// ===== 4 Passt es? =====
await page.getByRole("group", { name: "Prüfen mit" }).getByRole("button", { name: "längste Werte" }).click();
await page.locator(`[data-id="${neuId}"].zv-pd-el-ueber`).waitFor({ timeout: 10000 });
pruefe(true, "längste Werte: das schmale Feld ist als „passt nicht“ markiert");
pruefe((await page.getByTestId("pd-passt-nicht").count()) === 1, "Prüfbericht meldet Bausteine, die nicht passen");
const ebenenText = await page.locator(".zv-pd-ebenen").innerText();
pruefe(ebenenText.includes("passt nicht"), "Ebenenliste zeigt „passt nicht“");
await page.locator(".zv-pd-el-aktionen").getByRole("button", { name: "Entfernen" }).click();
await page.locator(".zv-pd-el-ueber").first().waitFor({ state: "detached", timeout: 10000 }).catch(() => undefined);

// ===== 5 Mehrfachauswahl, ausrichten =====
const ids = await page.locator(".zv-pd-el-text").evaluateAll((l) => l.map((e) => e.getAttribute("data-id")));
const [a, b] = ids.filter((i) => i === "ruecksende" || i === "datum");
if (a && b) {
  await page.locator(`[data-id="${a}"]`).click({ position: { x: 5, y: 5 } });
  await page.locator(`[data-id="${b}"]`).click({ position: { x: 5, y: 5 }, modifiers: ["Shift"] });
  await page.locator(".zv-pd-leiste").waitFor();
  await page.locator(".zv-pd-leiste").getByRole("button", { name: "oben" }).click();
  const ya = (await elBox(`[data-id="${a}"]`)).y;
  const yb = (await elBox(`[data-id="${b}"]`)).y;
  pruefe(Math.abs(ya - yb) < 0.1, `„oben“ richtet zwei Bausteine gleich aus (${ya.toFixed(1)} / ${yb.toFixed(1)} mm)`);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Escape");
} else pruefe(false, "Rücksendezeile und Datumszeile zum Ausrichten gefunden");

await page.getByRole("group", { name: "Prüfen mit" }).getByRole("button", { name: "Beispieldaten" }).click();
await page.waitForTimeout(1500);
await page.locator(".zv-pd-buehne").click({ position: { x: 5, y: 5 } });
await bild(page, "umgesetzt-1-designer-dunkel");

// Folgeseiten
await page.getByRole("group", { name: "Seite" }).getByRole("button", { name: "Folgeseiten" }).click();
pruefe((await page.locator(".zv-pd-el-fluss").count()) === 1, "Folgeseiten haben einen eigenen Fließbereich");
await bild(page, "umgesetzt-2-folgeseiten-dunkel");
await page.getByRole("group", { name: "Seite" }).getByRole("button", { name: "Erste Seite" }).click();

// ===== 6 Uebernehmen, speichern =====
await page.getByRole("button", { name: "Übernehmen" }).click();
await blatt.waitFor({ state: "detached" });
await page.getByRole("button", { name: /Als Version 2 speichern/ }).click();
await page.getByText("Als Version 2 gespeichert").waitFor();
pruefe(true, "frei gestalteter Export als Version 2 gespeichert");
await page.waitForFunction(() => document.querySelector(".zv-pe-papier iframe"), null, { timeout: 15000 });
await page.waitForTimeout(1500);
const pdf = await page.evaluate(async () => {
  const src = document.querySelector(".zv-pe-papier iframe")?.getAttribute("src");
  const buf = await (await fetch(src.split("#")[0])).arrayBuffer();
  return Array.from(new Uint8Array(buf).slice(0, 5));
});
pruefe(String.fromCharCode(...pdf) === "%PDF-", "Vorschau im Editor ist ein PDF");

// ===== 7 Schmaler, hell =====
await page.setViewportSize({ width: 1280, height: 860 });
await page.evaluate(() => {
  localStorage.setItem("zimmerakte_theme", "hell");
  document.documentElement.dataset.theme = "hell";
});
await page.getByRole("button", { name: "Designer öffnen" }).click();
await blatt.waitFor();
pruefe((await ueberlauf(page)) <= 0, "Designer 1280 px: kein horizontaler Überlauf");
// Zoom und feines Raster
for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Vergrößern" }).click();
await page.locator(".zv-pd-el-anschrift").click({ position: { x: 5, y: 5 } });
await page.locator(".zv-pd-el-anschrift").scrollIntoViewIfNeeded();
await bild(page, "umgesetzt-3-zoom-hell");
await page.getByRole("button", { name: "Schließen" }).click();

// Unter 1200 px: Hinweis statt Knopf
await page.setViewportSize({ width: 1000, height: 800 });
pruefe(!(await page.getByRole("button", { name: "Designer öffnen" }).isVisible()), "unter 1200 px: kein Designer-Knopf");
pruefe(await page.getByText("Der Designer braucht mindestens 1200 px Breite").isVisible(), "unter 1200 px: Hinweis sichtbar");

await browser.close();
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
if (messungen < 20) {
  console.error("Zu wenige Messungen -- die Prüfung hat nicht gemessen, was sie soll.");
  process.exit(1);
}
if (fehler.length) {
  for (const f of fehler) console.error(`  - ${f}`);
  process.exit(1);
}
