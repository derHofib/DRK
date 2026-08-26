// Einmaliges, manuelles Pruefskript fuer die Tagesberichte- und
// Zimmer-Gruppierungs-Features (Sitzung mit Etage/Standort-Gruppierung).
// Nicht Teil der CI -- nutzt Zugangsdaten aus der Kommandozeile.
import { chromium } from "playwright";

const [, , slug, email, passwort, klientId] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node tagesberichte-zimmer-pruefung.mjs <slug> <email> <passwort> <klientId>");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const fehler = [];

function pruefe(bedingung, beschreibung) {
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

await page.goto("http://localhost:5173/");
await page.getByLabel(/Träger-Kennung/i).fill(slug);
await page.getByLabel(/E-Mail/i).fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.waitForTimeout(1500);
const loginFehler = await page.locator(".zv-hinweis-fehler").first().textContent().catch(() => null);
if (loginFehler) {
  console.error("Login fehlgeschlagen:", loginFehler);
  await browser.close();
  process.exit(1);
}

// --- Zimmer: Standort > Etage > Karten -----------------------------------
await page.getByRole("button", { name: /^Zimmer$/ }).first().click();
await page.waitForTimeout(500);
const standortUeberschriften = await page.locator(".zv-seiten-kopf h2").allTextContents();
pruefe(standortUeberschriften.some((t) => t.includes("Haus A")), "Standort 'Haus A' als Ueberschrift sichtbar");
pruefe(standortUeberschriften.some((t) => t.includes("Haus B")), "Standort 'Haus B' als Ueberschrift sichtbar");

const etagenUeberschriften = await page.locator(".zv-etagen-kopf").allTextContents();
console.log("Etagen-Ueberschriften:", etagenUeberschriften);
pruefe(etagenUeberschriften.includes("EG"), "Etage 'EG' als Block-Ueberschrift sichtbar");
pruefe(etagenUeberschriften.includes("1. OG"), "Etage '1. OG' als Block-Ueberschrift sichtbar");
pruefe(etagenUeberschriften.includes("Dachgeschoss"), "Etage 'Dachgeschoss' als Block-Ueberschrift sichtbar");

// Reihenfolge: innerhalb Haus A soll EG vor 1. OG vor Dachgeschoss kommen
const idxEg = etagenUeberschriften.indexOf("EG");
const idx1Og = etagenUeberschriften.indexOf("1. OG");
const idxDach = etagenUeberschriften.indexOf("Dachgeschoss");
pruefe(idxEg < idx1Og && idx1Og < idxDach, "Etagen innerhalb eines Standorts in aufsteigender Reihenfolge");

const zimmerKarten = await page.locator(".zv-room-card .zv-room-nummer").allTextContents();
console.log("Zimmerkarten:", zimmerKarten);
pruefe(zimmerKarten.includes("101") && zimmerKarten.includes("201") && zimmerKarten.includes("301"), "Alle Testzimmer als Karten sichtbar");

// Neues Zimmer anlegen mit Etage-Feld pruefen
await page.getByRole("button", { name: /Neues Zimmer/i }).click();
await page.waitForTimeout(300);
const etageFeldSichtbar = await page.locator("#zimmer-etage").isVisible();
pruefe(etageFeldSichtbar, "Etage-Eingabefeld im 'Neues Zimmer'-Formular vorhanden");
const etageVorgabe = await page.locator("#zimmer-etage").inputValue();
pruefe(etageVorgabe === "EG", "Etage-Feld hat Vorgabewert 'EG'");
await page.getByRole("button", { name: /Abbrechen|✕|close/i }).first().click().catch(() => {});
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// --- Tagesberichte: allgemeiner Menuepunkt --------------------------------
await page.getByRole("button", { name: /^Tagesberichte$/ }).first().click();
await page.waitForTimeout(500);
const leerHinweis = await page.locator(".zv-leerzustand, .zv-leer").first().isVisible().catch(() => false);
console.log("Leerzustand sichtbar (vor Anlegen):", leerHinweis);

await page.getByRole("button", { name: /Neuer Bericht/i }).click();
await page.waitForTimeout(300);
await page.locator("select[name=klientId]").selectOption(klientId);
const berichtText = `Testbericht ueber den allgemeinen Menuepunkt (${Date.now()}).`;
await page.locator("textarea[name=text]").fill(berichtText);
await page.locator("input[name=tags]").fill("Beobachtung, Freizeit");
await page.getByRole("button", { name: /Anlegen/i }).click();
await page.waitForTimeout(800);

const berichtSichtbar = await page.getByText(berichtText).isVisible();
pruefe(berichtSichtbar, "Neu angelegter Tagesbericht erscheint in der allgemeinen Liste");
const tagPillsText = await page.locator(".zv-pill-info").allTextContents();
pruefe(tagPillsText.some((t) => t.includes("Beobachtung")), "Tag 'Beobachtung' als Pille sichtbar");
pruefe(tagPillsText.some((t) => t.includes("Freizeit")), "Tag 'Freizeit' als Pille sichtbar");

// Tag nachtraeglich hinzufuegen
const tagInput = page.locator('input[placeholder="+ Tag"]').first();
await tagInput.fill("Vorfall");
await tagInput.press("Enter");
await page.waitForTimeout(800);
const tagPillsNachher = await page.locator(".zv-pill-info").allTextContents();
pruefe(tagPillsNachher.some((t) => t.includes("Vorfall")), "Nachtraeglich hinzugefuegter Tag 'Vorfall' sichtbar");

// Tag wieder entfernen
await page.locator('button[aria-label="Tag Vorfall entfernen"]').first().click();
await page.waitForTimeout(800);
const tagPillsNachEntfernen = await page.locator(".zv-pill-info").allTextContents();
pruefe(!tagPillsNachEntfernen.some((t) => t.includes("Vorfall")), "Tag 'Vorfall' nach Entfernen nicht mehr sichtbar");

// --- Tagesberichte: Tab im Klienten ---------------------------------------
await page.getByRole("button", { name: /^Klienten$/ }).first().click();
await page.waitForTimeout(500);
await page.getByText("Max Mustermann").first().click();
await page.waitForTimeout(500);
// Scoped auf die INNERE Reiterleiste der Klientenakte -- "Tagesberichte" ist
// sonst mehrdeutig (Desktop-Sidebar, mobile Tabbar, innerer Klienten-Reiter).
const klientTabbar = page.locator(".zv-tabbar", { has: page.getByRole("button", { name: "Übersicht" }) });
await klientTabbar.getByRole("button", { name: /^Tagesberichte$/ }).click();
await page.waitForTimeout(500);
const berichtImTab = await page.getByText(berichtText).isVisible();
pruefe(berichtImTab, "Im allgemeinen Menuepunkt angelegter Bericht erscheint auch im Klienten-Tab (gleicher Klient)");
const klientSpalteImTab = await page.locator(".zv-liste-kopf span", { hasText: /^Klient$/ }).count();
pruefe(klientSpalteImTab === 0, "Klienten-Tab zeigt KEINE Klient-Spalte (Kontext ist bereits der Klient)");

console.log("\n" + (fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} PRUEFUNG(EN) FEHLGESCHLAGEN:`));
fehler.forEach((f) => console.log(" - " + f));

await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
