/**
 * Browserpruefung "Tippen im Formular-Editor" (Rueckmeldungen „Formular
 * Schlüssel“ und „beschriftung Skala fehlerhaft“, 21.11.2026): nach jedem
 * Buchstaben verlor das Eigenschaften-Feld den Fokus.
 *
 * Tippt deshalb wirklich Taste fuer Taste (pressSequentially) -- page.fill()
 * setzt den ganzen Wert auf einmal und hat den Fehler in formulare-pruefung.mjs
 * nie sehen koennen. Gemessen wird der Endwert jedes Feldes und, ob der Fokus
 * noch im selben Feld steht.
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173), eine Leitung mit
 * Recht protokolle.formulare-verwalten. Kein Bestandteil der CI.
 *
 *   node scripts/formular-tippen-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node formular-tippen-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
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

const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.locator(".zv-aktenlippe-lasche").click();
await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
await page.getByRole("button", { name: "Neues Formular" }).click();
await page.locator("#zv-neues-formular-name").fill(`Tippen ${Date.now().toString(36)}`);
await page.getByRole("button", { name: "Anlegen und bauen" }).click();
await page.getByText("In Entwicklung: wird noch nirgends").waitFor();

const eig = page.locator(".zv-fe-eig");
const kasten = page.locator(".zv-fe-kasten");

/** Tippt Taste fuer Taste ins Feld und misst Wert + Fokus danach. */
async function tippen(feld, text, erwartet, was) {
  await feld.click();
  // Markieren und drueberschreiben wie ein Mensch: der erste Buchstabe ersetzt
  // die Vorgabe ("Neue Frage") -- genau da sprang der Schluessel um.
  await feld.press("ControlOrMeta+a");
  if (text) await feld.pressSequentially(text, { delay: 30 });
  else await feld.press("Backspace");
  const wert = await feld.inputValue();
  // Am Element selbst messen, nicht an der id: die haengt am Schluessel und aendert sich beim Tippen mit.
  const fokus = await feld.evaluate((el) => el === document.activeElement);
  pruefe(wert === erwartet, `${was}: Wert „${wert}“ (erwartet „${erwartet}“)`);
  pruefe(fokus, `${was}: Fokus bleibt im Feld`);
}

// 1 Beschriftung eines Feldes: der Schluessel folgt ihr -- genau das loeste den Abbruch aus.
await kasten.getByRole("button", { name: "Kurztext" }).click();
await tippen(eig.locator("input[id$='-beschriftung']"), "Abmahnung erteilt", "Abmahnung erteilt", "Kurztext-Beschriftung");
const schluessel = eig.locator("input[id$='-schluessel']");
pruefe((await schluessel.inputValue()) === "abmahnung_erteilt", `Schlüssel folgt der Beschriftung (${await schluessel.inputValue()})`);

// 2 Feldschluessel von Hand.
await tippen(schluessel, "abmahnung_datum", "abmahnung_datum", "Feldschlüssel");

// 3 Skala: Beschriftung und Beschriftungen unten/oben.
await kasten.getByRole("button", { name: "Skala" }).click();
await tippen(eig.locator("input[id$='-beschriftung']"), "Wie zufrieden?", "Wie zufrieden?", "Skala-Beschriftung");
await tippen(eig.locator("input[id$='-lmin']"), "gar nicht", "gar nicht", "Skala: Beschriftung unten");
await tippen(eig.locator("input[id$='-lmax']"), "sehr gut", "sehr gut", "Skala: Beschriftung oben");

// 3b Auswahl-Optionen: ihr Wert folgt der Beschriftung, die Zeile hing am Wert.
await kasten.getByRole("button", { name: "Einfachauswahl", exact: true }).click();
await tippen(eig.locator("input[aria-label='Option 1']"), "Mündlich", "Mündlich", "Auswahl-Option");

// 4 Ein anderer Schluessel darf beim Tippen kurz gleich lauten (Zwischenstand).
await tippen(eig.locator("input[id$='-schluessel']"), "abmahnung_datum_2", "abmahnung_datum_2", "Feldschlüssel über vergebenen Zwischenstand");
await tippen(eig.locator("input[id$='-schluessel']"), "", "", "Feldschlüssel leeren");
pruefe(await eig.getByText("Bitte einen Schlüssel eingeben.").isVisible(), "leerer Schlüssel: Hinweis statt verweigerter Eingabe");
await eig.locator("input[id$='-beschriftung']").click();
pruefe((await eig.locator("input[id$='-schluessel']").inputValue()) !== "", "leerer Schlüssel springt beim Verlassen auf den letzten gültigen zurück");

await page.getByText(/Entwurf gespeichert/).waitFor({ timeout: 10000 });
if (bilder) await page.screenshot({ path: `${bilder}/tippen-editor.png` });

await browser.close();
if (messungen < 19) {
  console.error(`Nur ${messungen} Messungen -- Pruefung unvollstaendig.`);
  process.exit(1);
}
console.log(fehler.length ? `\n${fehler.length} Fehler` : `\nAlle ${messungen} Prüfungen bestanden.`);
process.exit(fehler.length ? 1 : 0);
