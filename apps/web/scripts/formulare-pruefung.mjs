/**
 * Browserpruefung "Formulare" (Organisatorisch › Formulare, Editor,
 * Anheften an den Tagesbericht). Misst statt anzusehen:
 *
 *   1 Aktenlippe: Gruppe "Organisatorisch" ist anfangs zu, ihre Lasche ist
 *     kleiner als die Gruppenlabels oben und sitzt auf der Trennlinie zum Fuss.
 *   2 Neues Formular ohne Vorlage -> Editor -> Bausteine -> Veroeffentlichen
 *     (vorher gesperrt, solange die Pruefung Fehler meldet).
 *   3 Einstellungen: an "Tagesbericht anlegen" heften, automatisch, Pflicht.
 *   4 Tagesbericht: das Formular erscheint, ohne Antwort wird nicht
 *     gespeichert, mit Antwort entsteht Bericht + Protokoll.
 *   5 Kein horizontaler Ueberlauf bei 1440 und 390 px.
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173), ein Traeger mit
 * einer Leitung (Recht protokolle.formulare-verwalten), einer Klient:in mit
 * Belegung. Kein Bestandteil der CI.
 *
 *   node scripts/formulare-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node formulare-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
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
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const bild = async (page, name) => bilder && (await page.screenshot({ path: `${bilder}/${name}.png` }));

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

// ===== 1 Aktenlippe =====
const lasche = page.locator(".zv-aktenlippe-lasche");
await lasche.waitFor({ timeout: 10000 });
pruefe((await lasche.getAttribute("aria-expanded")) === "false", "Organisatorisch ist anfangs eingeklappt");
pruefe((await page.locator("#zv-organisatorisch").count()) === 0, "eingeklappt: kein Menüpunkt Formulare sichtbar");
const groesse = await page.evaluate(() => {
  const l = getComputedStyle(document.querySelector(".zv-aktenlippe-lasche")).fontSize;
  const g = getComputedStyle(document.querySelector(".zv-gruppenlabel")).fontSize;
  return { l: parseFloat(l), g: parseFloat(g) };
});
pruefe(groesse.l < groesse.g, `Lasche kleiner als die Gruppenlabels (${groesse.l}px < ${groesse.g}px)`);
const lage = await page.evaluate(() => {
  const l = document.querySelector(".zv-aktenlippe-lasche").getBoundingClientRect();
  const f = document.querySelector(".zv-sidebar-foot").getBoundingClientRect();
  const n = document.querySelector(".zv-sidebar-nav-haupt").getBoundingClientRect();
  return { abstand: Math.abs(l.bottom - (f.top + 1)), unterNav: l.top >= n.bottom - 1 };
});
pruefe(lage.abstand <= 1, `Lasche sitzt auf der Trennlinie zum Fuß (Abstand ${lage.abstand.toFixed(1)} px)`);
pruefe(lage.unterNav, "Lasche liegt unter dem Hauptmenü (ganz unten)");
// Rueckmeldung "Organisatorisch Reiter links im Menue" (20.11.2026): Lasche
// links, ihr Symbol beginnt dort, wo der Text der Gruppenlabels beginnt.
const links = await page.evaluate(() => {
  const icon = document.querySelector(".zv-aktenlippe-lasche svg").getBoundingClientRect();
  const lab = document.querySelector(".zv-gruppenlabel");
  const r = document.createRange();
  r.selectNodeContents(lab);
  return { icon: icon.left, label: r.getBoundingClientRect().left };
});
pruefe(Math.abs(links.icon - links.label) <= 2, `Lasche links, bündig mit den Gruppenlabels (${links.icon} / ${links.label})`);
await bild(page, "1-aktenlippe-zu");
await lasche.click();
await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
await page.getByRole("heading", { name: "Formulare", level: 2 }).waitFor();
pruefe((await lasche.getAttribute("aria-expanded")) === "true", "aufgeklappt nach Klick");
// Aufgeklappt: Lasche und Inhalt sind EINE Karteikarte -- der Inhalt steht
// direkt unter der Lasche, gleiche Flaeche, unter der Lasche kein Strich.
const karte = await page.evaluate(() => {
  const l = document.querySelector(".zv-aktenlippe-lasche");
  const k = document.querySelector("#zv-organisatorisch");
  const ls = getComputedStyle(l);
  const ks = getComputedStyle(k);
  return {
    luecke: k.getBoundingClientRect().top - l.getBoundingClientRect().bottom,
    gleicheFlaeche: ls.backgroundColor === ks.backgroundColor,
    keinStrich: ls.borderBottomColor === ks.backgroundColor,
    rahmen: ks.borderTopStyle !== "none",
  };
});
pruefe(karte.luecke <= 0 && karte.luecke >= -1, `Inhalt hängt direkt unter der Lasche (Abstand ${karte.luecke} px)`);
pruefe(karte.gleicheFlaeche && karte.keinStrich && karte.rahmen, "Lasche und Inhalt bilden eine Karteikarte (gleiche Fläche, Rahmen, kein Strich dazwischen)");

// ===== 2 Neues Formular, Editor, Veroeffentlichen =====
const name = `Nachtkontrolle ${Date.now().toString(36)}`;
await page.getByRole("button", { name: "Neues Formular" }).click();
await page.locator("#zv-neues-formular-name").fill(name);
await page.getByRole("button", { name: "Anlegen und bauen" }).click();
await page.getByText("In Entwicklung: wird noch nirgends").waitFor();
pruefe(true, "Neues Formular öffnet direkt den Editor (in Entwicklung)");

await page.getByRole("button", { name: "Veröffentlichen" }).click();
const dialog = page.locator(".zv-modal");
await dialog.waitFor();
pruefe(await dialog.getByText("noch kein Feld").isVisible(), "leeres Formular: Prüfung meldet fehlendes Feld");
pruefe(await dialog.getByRole("button", { name: "Veröffentlichen" }).isDisabled(), "Veröffentlichen gesperrt, solange die Prüfung Fehler meldet");
await dialog.getByRole("button", { name: "Abbrechen" }).click();

const kasten = page.locator(".zv-fe-kasten");
await kasten.getByRole("button", { name: "Abschnitt" }).click();
await page.locator(".zv-fe-eig input").first().fill("Nacht");
await kasten.getByRole("button", { name: "Ja/Nein" }).click();
await page.locator(".zv-fe-eig input").first().fill("Alles ruhig?");
await page.locator(".zv-fe-eig").getByRole("tab", { name: "Logik" }).click();
await page.locator(".zv-fe-eig select[aria-label='Pflicht']").selectOption("immer");
const imAbschnitt = await page.evaluate(() => document.querySelectorAll(".zv-fe-knoten-abschnitt .zv-fe-knoten").length);
pruefe(imAbschnitt === 1, `Ja/Nein landet im gewählten Abschnitt (${imAbschnitt})`);
await kasten.getByRole("button", { name: "Langtext" }).click();
await page.locator(".zv-fe-eig input").first().fill("Was war los?");
await page.locator(".zv-fe-eig").getByRole("tab", { name: "Logik" }).click();
await page.locator(".zv-fe-eig").getByRole("button", { name: "Nur unter Bedingung" }).click();
await page.locator(".zv-fe-eig select[aria-label='Wert']").first().selectOption("nein");
const satz = await page.locator(".zv-fe-knoten .zv-fe-logik").last().innerText();
pruefe(/Alles ruhig\? ist Nein/.test(satz), `Logik als Satz im Aufbau: „${satz}“`);
await page.getByText(/Entwurf gespeichert/).waitFor({ timeout: 10000 });
await bild(page, "2-editor");

await page.getByRole("tab", { name: "Ausprobieren" }).click();
pruefe((await page.getByText("Was war los?").count()) === 0, "Ausprobieren: bedingtes Feld zunächst verborgen");
await page.locator(".zv-fe-probe [role=radio]", { hasText: "Nein" }).click();
pruefe(await page.getByText("Was war los?").isVisible(), "Ausprobieren: nach „Nein“ erscheint das bedingte Feld");
await page.getByRole("tab", { name: "Aufbau" }).click();

await page.getByRole("button", { name: "Veröffentlichen" }).click();
await dialog.waitFor();
pruefe(await dialog.getByText("Keine Fehler gefunden").isVisible(), "Prüfung ohne Fehler");
pruefe((await dialog.locator(".zv-formular-aenderungen li").count()) === 3, "„Was veröffentlicht wird“ listet die 3 Bausteine");
await bild(page, "3-veroeffentlichen");
await dialog.getByRole("button", { name: "Veröffentlichen" }).click();
await dialog.waitFor({ state: "detached" });
pruefe(await page.locator(".zv-formular-kopf .zv-pill", { hasText: "Veröffentlicht" }).isVisible(), "Status jetzt Veröffentlicht");

// ===== 3 Einstellungen: anheften =====
await page.getByRole("navigation", { name: "Bereiche des Formulars" }).getByRole("button", { name: "Einstellungen" }).click();
await page.getByText("Tagesbericht anlegen").click();
await page.getByText(/Pflicht: speichern erst/).click();
await page.getByRole("button", { name: "Einstellungen speichern" }).click();
await page.locator(".zv-protokoll-status", { hasText: "Gespeichert" }).waitFor();
await bild(page, "4-einstellungen");
pruefe(true, "an Tagesbericht geheftet (automatisch, Pflicht)");

// Liste zeigt Anheftung
await page.getByRole("button", { name: /Alle Formulare/ }).click();
const zeile = page.locator(".zv-info-karte", { hasText: name });
pruefe(/Tagesbericht · Pflicht/.test(await zeile.innerText()), "Liste: Angeheftet an Tagesbericht · Pflicht");
pruefe((await ueberlauf(page)) <= 0, "1440 px: Formularliste ohne horizontalen Überlauf");
await bild(page, "5-liste");

// ===== 4 Tagesbericht mit Pflichtformular =====
await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: /^Tagesberichte$/ }).click();
await page.getByRole("button", { name: "Neuer Tagesbericht" }).click();
await dialog.waitFor();
// Die Option nennt seit 0077 auch Standort und Zimmer ("Erika Beispiel · Haus …").
const erikaWert = await dialog.locator("select[name=klientId] option", { hasText: "Erika Beispiel" }).getAttribute("value");
await dialog.locator("select[name=klientId]").selectOption(erikaWert);
const angeheftet = dialog.locator(".zv-angeheftet-formular", { hasText: name });
await angeheftet.waitFor({ timeout: 10000 });
pruefe(true, "Tagesbericht: Formular automatisch dabei");
await dialog.locator("textarea[name=text]").fill("Ruhiger Abend.");
await dialog.getByRole("button", { name: "Tagesbericht speichern" }).click();
await dialog.getByText(/bitte die markierten Felder prüfen/).waitFor();
pruefe(await dialog.isVisible(), "ohne Antwort im Pflichtformular wird nicht gespeichert");
await bild(page, "6-tagesbericht-fehler");
await angeheftet.locator("[role=radio]", { hasText: "Ja" }).click();
await dialog.getByRole("button", { name: "Tagesbericht speichern" }).click();
await dialog.waitFor({ state: "detached", timeout: 10000 });
const pille = page.locator(".zv-tagesbericht-protokoll", { hasText: name }).first();
await pille.waitFor({ timeout: 10000 });
pruefe(true, "Tagesbericht zeigt das zugehörige Protokoll");
await pille.click();
await page.locator(".zv-modal .zv-protokoll-zeile", { hasText: "Alles ruhig?" }).waitFor();
pruefe(/Ja/.test(await page.locator(".zv-modal .zv-protokoll-zeile", { hasText: "Alles ruhig?" }).innerText()), "Protokoll gespeichert mit Antwort „Ja“");
await bild(page, "7-tagesbericht-protokoll");

// ===== 5 Handy =====
const handy = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, storageState: await ctx.storageState() });
const p2 = await handy.newPage();
await p2.goto(BASIS + "/");
await p2.getByRole("button", { name: /^Mehr$/ }).click();
await p2.locator(".zv-sammelmenue-trenner", { hasText: "Organisatorisch" }).waitFor();
await p2.locator(".zv-sammelmenue").getByRole("menuitem", { name: "Formulare" }).click();
await p2.getByRole("heading", { name: "Formulare", level: 2 }).waitFor();
pruefe((await ueberlauf(p2)) <= 0, `390 px: Formularliste ohne horizontalen Überlauf (${await ueberlauf(p2)})`);
await p2.locator(".zv-info-karte", { hasText: name }).click();
await p2.getByRole("button", { name: "Bearbeiten" }).click();
await p2.locator(".zv-fe").waitFor();
pruefe((await ueberlauf(p2)) <= 0, `390 px: Editor ohne horizontalen Überlauf (${await ueberlauf(p2)})`);
await bild(p2, "8-handy-editor");
// Den angefangenen Entwurf wieder verwerfen, damit der Lauf wiederholbar bleibt.
await p2.getByRole("button", { name: "Änderungen verwerfen" }).click();

await browser.close();
if (messungen < 20) fehler.push(`zu wenige Messungen (${messungen})`);
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
process.exit(fehler.length ? 1 : 0);
