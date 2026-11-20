/**
 * Browserpruefung "Tagesbericht Formular" (Rueckmeldung 18.11.2026, Migration
 * 0077): Beim neuen Tagesbericht kommt gleich das eingestellte Formular, und
 * es kann die Standardsicht ersetzen. Misst statt anzusehen:
 *
 *   1 Klient:in zuerst: ohne Auswahl nur ein Hinweis, kein Freitextfeld,
 *     kein Speichern (nicht die alte Sicht, die danach umspringt).
 *   2 "ersetzt": nach der Auswahl steht das Formular oben, der Freitext ist
 *     eine zugeklappte, optionale Bemerkung; ohne Antworten wird nicht
 *     gespeichert, mit Antworten entsteht ein Bericht ohne Freitext, die
 *     Liste zeigt die Kurzfassung.
 *   3 An einem Standort ohne Formular bleibt der freie Bericht (Pflicht).
 *   4 Klientenakte: "Tagesbericht schreiben" im Aktenmenue oeffnet das Fenster.
 *   5 Formular-Einstellungen zeigen "Ersetzt die Standardsicht".
 *   6 "ergaenzt": Freitext vor dem Formular, wie bisher.
 *   7 Kein horizontaler Ueberlauf bei 1440 und 390 px.
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173), ein Traeger mit
 * einer Leitung (Recht protokolle.formulare-verwalten), einer Klient:in
 * "Mira Beispiel" an einem Standort A und "Erika Probe" an einem Standort B.
 * Das Formular legt das Skript selbst ueber die API an (nur fuer Standort A).
 * Kein Bestandteil der CI.
 *
 *   node scripts/tagesbericht-formular-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node tagesbericht-formular-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
  process.exit(1);
}
const BASIS = "http://localhost:5173";
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

// ----- Formular ueber die API anlegen (nur fuer den Standort von Mira) -----
async function api(token, methode, pfad, body) {
  const res = await fetch(`${BASIS}/api${pfad}`, {
    method: methode,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${methode} ${pfad}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const { accessToken: token } = await api(null, "POST", "/auth/login", { mandantSlug: slug, email, passwort });
const klienten = await api(token, "GET", "/klienten");
const mira = klienten.find((k) => k.vorname === "Mira" && k.nachname === "Beispiel");
const erika = klienten.find((k) => k.vorname === "Erika" && k.nachname === "Probe");
const standorte = await api(token, "GET", "/standorte");
const standortMira = standorte.find((s) => s.name === mira.aktuellesZimmer.standortName);
// Reste eines abgebrochenen Laufs stilllegen -- zwei ersetzende Formulare
// wuerden beide erscheinen und die Messungen verfaelschen.
for (const f of await api(token, "GET", "/formulare")) {
  if (f.name.startsWith("Pruef-Nachtdienst ") && f.status !== "stillgelegt") {
    await api(token, "POST", `/formulare/${f.id}/archivieren`, { archiviert: true });
  }
}
const name = `Pruef-Nachtdienst ${Date.now().toString(36)}`;
const formular = await api(token, "POST", "/formulare", { name });
await api(token, "PUT", `/formulare/${formular.id}/entwurf`, {
  definition: {
    bausteine: [
      { typ: "auswahl", schluessel: "schlaf", beschriftung: "Schlaf", pflicht: true, optionen: [{ wert: "ruhig", label: "ruhig" }, { wert: "unruhig", label: "unruhig" }] },
      { typ: "ja_nein", schluessel: "vorfall", beschriftung: "Vorfall in der Nacht?", pflicht: true },
      { typ: "zahl", schluessel: "kontrollgaenge", beschriftung: "Kontrollgänge", min: 0, max: 10 },
    ],
  },
});
await api(token, "POST", `/formulare/${formular.id}/veroeffentlichen`);
const einstellen = (darstellung, pflicht = true) =>
  api(token, "PUT", `/formulare/${formular.id}/einstellungen`, {
    name,
    standortIds: [standortMira.id],
    anheftungen: [{ anheftpunkt: "tagesbericht", modus: "automatisch", pflicht, darstellung }],
  });
await einstellen("ersetzt");

// ----- Browser -----
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const bild = async (page, n) => bilder && (await page.screenshot({ path: `${bilder}/${n}.png` }));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(BASIS + "/");
await page.evaluate(() => localStorage.clear());
await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.getByRole("button", { name: /^Klienten$/ }).first().waitFor({ timeout: 15000 });

// ===== 1 Klient:in zuerst =====
await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: /^Dokumentation$/ }).click();
await page.getByRole("button", { name: "Neuer Tagesbericht" }).click();
const dialog = page.getByRole("dialog");
await dialog.waitFor();
await dialog.getByTestId("ntb-hinweis").waitFor();
pruefe(await dialog.getByTestId("ntb-hinweis").isVisible(), "ohne Klient:in: Hinweis statt alter Sicht");
pruefe((await dialog.locator("textarea[name=text]").count()) === 0, "ohne Klient:in: kein Freitextfeld");
pruefe((await dialog.getByRole("button", { name: "Tagesbericht speichern" }).count()) === 0, "ohne Klient:in: kein Speichern");
await bild(page, "1-klient-zuerst");

// ===== 2 Formular ersetzt die Standardsicht =====
await dialog.locator("#ntb-klient").selectOption(mira.id);
const fs = dialog.locator(".zv-angeheftet-formular", { hasText: name });
await fs.waitFor({ timeout: 10000 });
pruefe(true, "nach der Auswahl erscheint das Formular sofort");
const bemerkung = dialog.locator("details.zv-ntb-bemerkung");
pruefe((await bemerkung.count()) === 1 && !(await bemerkung.evaluate((d) => d.open)), "Freitext ist eine zugeklappte Bemerkung");
pruefe(!(await dialog.locator("textarea[name=text]").isVisible()), "Freitextfeld ist nicht sichtbar");
pruefe((await dialog.locator("textarea[name=text]").getAttribute("required")) === null, "Bemerkung ist nicht Pflicht");
const yForm = (await fs.boundingBox()).y;
const yTags = (await dialog.locator("#ntb-tags").boundingBox()).y;
const yBem = (await bemerkung.boundingBox()).y;
pruefe(yForm < yBem && yBem < yTags, `Reihenfolge: Formular (${Math.round(yForm)}) vor Bemerkung (${Math.round(yBem)}) vor Tags (${Math.round(yTags)})`);
await bild(page, "2-formular-ersetzt");
await dialog.getByRole("button", { name: "Tagesbericht speichern" }).click();
await dialog.getByText(/bitte die markierten Felder prüfen/).waitFor();
pruefe(await dialog.isVisible(), "ohne Antworten wird nicht gespeichert");
await fs.locator("[role=radio]", { hasText: "unruhig" }).click();
await fs.locator("[role=radio]", { hasText: "Nein" }).click();
await fs.locator("input[type=number]").first().fill("2");
await dialog.getByRole("button", { name: "Tagesbericht speichern" }).click();
await dialog.waitFor({ state: "detached", timeout: 10000 }).catch(async (e) => {
  console.log("Fehler im Fenster:", await dialog.locator(".zv-hinweis-fehler").allTextContents());
  throw e;
});
const karte = page.locator(".zv-info-karte", { hasText: name }).first();
await karte.waitFor({ timeout: 10000 });
const kurz = await karte.locator(".zv-tagesbericht-kurzfassung").innerText();
pruefe(/Schlaf: unruhig/.test(kurz) && /Vorfall in der Nacht\?: Nein/.test(kurz) && /Kontrollgänge: 2/.test(kurz), `Liste zeigt die Kurzfassung („${kurz}“)`);
pruefe((await ueberlauf(page)) <= 0, "1440 px: Liste ohne horizontalen Überlauf");
await bild(page, "3-liste-kurzfassung");

// Suche findet den Bericht ueber die Kurzfassung.
await page.getByRole("searchbox", { name: "Tagesberichte durchsuchen" }).fill("unruhig");
pruefe((await page.locator(".zv-info-karte", { hasText: name }).count()) >= 1, "Suche findet den Formular-Bericht über die Kurzfassung");
await page.getByRole("searchbox", { name: "Tagesberichte durchsuchen" }).fill("");

// ===== 3 Standort ohne Formular: freier Bericht =====
await page.getByRole("button", { name: "Neuer Tagesbericht" }).click();
await dialog.waitFor();
await dialog.locator("#ntb-klient").selectOption(erika.id);
await dialog.locator("textarea[name=text]").waitFor({ timeout: 10000 });
pruefe((await dialog.locator("textarea[name=text]").getAttribute("required")) !== null, "Standort ohne Formular: Bericht bleibt Pflicht");
pruefe((await dialog.locator(".zv-angeheftet-formular").count()) === 0, "Standort ohne Formular: kein Formular");
await dialog.getByRole("button", { name: /Schließen/ }).first().click().catch(() => page.keyboard.press("Escape"));
await dialog.waitFor({ state: "detached" }).catch(() => undefined);

// ===== 4 Klientenakte: Tagesbericht aus dem Aktenmenue =====
// Seit dem Verlauf gibt es im Ueberblick keinen Freitext-Schnelleintrag
// mehr ("+ Eintrag" legt Verlaufseintraege an); der Tagesbericht steht im
// Menue der Akte und oeffnet das Fenster samt angeheftetem Formular.
await page.goto(`${BASIS}/klienten/${mira.id}`).catch(() => undefined);
let menue = page.getByRole("button", { name: "Weitere Aktionen zur Akte" });
if (!(await menue.isVisible().catch(() => false))) {
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: /^Klienten$/ }).first().click();
  await page.getByText("Mira Beispiel").first().click();
}
menue = page.getByRole("button", { name: "Weitere Aktionen zur Akte" });
await menue.waitFor({ timeout: 10000 });
pruefe((await page.locator("#schnelleintrag").count()) === 0, "Klientenakte: kein Freitext-Schnelleintrag mehr im Überblick");
await bild(page, "4-akte-knopf");
await menue.click();
await page.getByRole("menuitem", { name: "Tagesbericht schreiben" }).click();
await page.getByRole("dialog").locator(".zv-angeheftet-formular", { hasText: name }).waitFor({ timeout: 10000 });
pruefe(true, "Menüpunkt öffnet das Fenster mit dem Formular");
await page.keyboard.press("Escape");

// ===== 5 Einstellungen zeigen die Darstellung =====
await page.getByRole("button", { name: /Organisatorisch/ }).first().click().catch(() => undefined);
await page.getByRole("button", { name: /^Formulare$/ }).first().click();
await page.locator(".zv-info-karte", { hasText: name }).click();
await page.getByRole("tablist", { name: "Bereiche des Formulars" }).getByRole("tab", { name: "Einstellungen" }).click();
const ersetztRadio = page.getByRole("radio", { name: /Ersetzt die Standardsicht/ });
await ersetztRadio.waitFor();
pruefe(await ersetztRadio.isChecked(), "Einstellungen: „Ersetzt die Standardsicht“ ist gewählt");
pruefe(await page.getByRole("checkbox", { name: /Pflicht: speichern erst/ }).isDisabled(), "Einstellungen: Pflicht ist bei „ersetzt“ fest an");
await bild(page, "5-einstellungen");

// ===== 6 ergaenzt: Freitext vor dem Formular =====
await einstellen("ergaenzt");
await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: /^Dokumentation$/ }).click();
await page.getByRole("button", { name: "Neuer Tagesbericht" }).click();
await dialog.waitFor();
await dialog.locator("#ntb-klient").selectOption(mira.id);
await fs.waitFor({ timeout: 10000 });
const yText = (await dialog.locator("textarea[name=text]").boundingBox()).y;
pruefe(yText < (await fs.boundingBox()).y && (await dialog.locator("textarea[name=text]").getAttribute("required")) !== null, "„ergänzt“: Pflicht-Freitext steht vor dem Formular");

// ===== 7 Handy =====
await einstellen("ersetzt");
const handy = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, storageState: await ctx.storageState() });
const p2 = await handy.newPage();
await p2.goto(BASIS + "/");
// Unten in der Handy-Leiste heisst der Punkt kurz "Doku".
await p2.getByRole("button", { name: /^Doku$/ }).click();
await p2.getByRole("button", { name: "Neuer Tagesbericht" }).click();
const d2 = p2.getByRole("dialog");
await d2.locator("#ntb-klient").selectOption(mira.id);
await d2.locator(".zv-angeheftet-formular", { hasText: name }).waitFor({ timeout: 10000 });
const ue = await p2.evaluate(() => {
  const d = document.querySelector("[role=dialog]");
  return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, d.scrollWidth - d.clientWidth);
});
pruefe(ue <= 0, `390 px: Fenster mit Formular ohne horizontalen Überlauf (${ue})`);
await bild(p2, "6-handy");

// Aufraeumen: Formular stilllegen, damit es bei einem zweiten Lauf nicht doppelt haengt.
await api(token, "POST", `/formulare/${formular.id}/archivieren`, { archiviert: true });

await browser.close();
if (messungen < 20) fehler.push(`zu wenige Messungen (${messungen})`);
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
process.exit(fehler.length ? 1 : 0);
