/**
 * Browserpruefung „Aufbau Formular“ (Reiter Übersicht, Aufbau, Ansichten,
 * Einstellungen, Versionen eines Formulars). Misst statt anzusehen:
 *
 *   1 Volle Breite: bei 1780 px (Viewport aus der Rueckmeldung) nutzen
 *     Übersicht, Aufbau, Ansichten und Einstellungen mindestens 85 % der
 *     Inhaltsbreite -- vorher waren es 760 px, also weniger als die Haelfte.
 *   2 Übersicht ist der Startreiter eines veroeffentlichten Formulars, zeigt
 *     vier Kennzahlen, je Version eine Zeile und 12 Wochensaeulen; keine
 *     Klientennamen, nur Initialen.
 *   3 Aufbau: Versionswahl schaltet die Definition um, Änderungsmarkierung
 *     zur Vorversion ist sichtbar, Klick auf ein Feld fuellt die Feld-Info.
 *   4 Ansichten: Handy-Vorschau ist 390 px breit, eine Regel wirkt live
 *     (bedingtes Feld erscheint/verschwindet), PDF-Eintraege sind gesperrt.
 *   5 Einstellungen: zwei Spalten nebeneinander, Speichern-Knopf oben.
 *   6 Kein horizontaler Ueberlauf bei 1780, 1280 und 390 px in allen Reitern.
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173), ein Formular
 * mit mindestens zwei veroeffentlichten Versionen, einem Entwurf, einem
 * Ja/Nein-Feld, von dem ein anderes Feld abhaengt, und abgeschlossenen
 * Protokollen. Kein Bestandteil der CI.
 *
 *   node scripts/formular-aufbau-pruefung.mjs <slug> <email> <passwort> <formularname> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, formularName, bilder] = process.argv;
if (!slug || !email || !passwort || !formularName) {
  console.error("Nutzung: node formular-aufbau-pruefung.mjs <slug> <email> <passwort> <formularname> [bilderOrdner]");
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
const bild = async (page, name, voll = false) => bilder && (await page.screenshot({ path: `${bilder}/${name}.png`, fullPage: voll }));

const ctx = await browser.newContext({ viewport: { width: 1780, height: 1023 }, deviceScaleFactor: 1, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto(BASIS + "/");
await page.evaluate(() => localStorage.clear());
await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.getByRole("button", { name: /^Klienten$/ }).first().waitFor({ timeout: 15000 });

await page.locator(".zv-aktenlippe-lasche").click();
await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
await page.getByRole("heading", { name: "Formulare", level: 2 }).waitFor();
const listenZeile = page.locator(".zv-info-karte", { hasText: formularName });
pruefe(/\d/.test(await listenZeile.locator("[data-label='Letzte 30 Tage']").innerText()), "Liste: Spalte „30 Tage“ hat eine Zahl");
await listenZeile.click();

const reiter = page.getByRole("tablist", { name: "Bereiche des Formulars" });
const breiteAnteil = (selektor) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    const kopf = document.querySelector(".zv-formular-detail .zv-reiter");
    if (!el || !kopf) return 0;
    return el.getBoundingClientRect().width / kopf.getBoundingClientRect().width;
  }, selektor);

// ===== 2 Übersicht =====
await page.locator(".zv-fo-kennzahlen").waitFor({ timeout: 10000 });
pruefe((await reiter.locator("button.active").innerText()).trim() === "Übersicht", "Startreiter eines veröffentlichten Formulars ist „Übersicht“");
await page.locator(".zv-fo-wochen").waitFor({ timeout: 10000 });
pruefe((await page.locator(".zv-fo-kennzahlen .zv-fo-karte").count()) === 4, "Übersicht: vier Kennzahlen");
const gesamt = Number(await page.locator(".zv-fo-kennzahlen .zv-fo-zahl").first().innerText());
const jeVersion = await page.locator(".zv-fo-version-anzahl").allInnerTexts();
const summe = jeVersion.map((t) => parseInt(t, 10)).filter((n) => !Number.isNaN(n)).reduce((a, b) => a + b, 0);
pruefe(gesamt > 0 && gesamt === summe, `Übersicht: „Ausgefüllt insgesamt“ (${gesamt}) = Summe je Version (${summe})`);
pruefe((await page.locator(".zv-fo-versionen li").count()) >= 3, "Übersicht: je Version eine Zeile (mind. 3 mit Entwurf)");
pruefe((await page.locator(".zv-fo-woche").count()) === 12, "Übersicht: 12 Wochensäulen");
const saeulenHoehe = await page.evaluate(() => Math.max(...[...document.querySelectorAll(".zv-fo-saeule")].map((e) => e.getBoundingClientRect().height)));
pruefe(saeulenHoehe > 40, `Übersicht: höchste Säule ist sichtbar hoch (${saeulenHoehe.toFixed(0)} px)`);
const letzte = await page.locator(".zv-fo-letzte li").allInnerTexts();
pruefe(letzte.length > 0 && letzte.every((t) => /[A-ZÄÖÜ]\. [A-ZÄÖÜ]\./.test(t)), `Zuletzt ausgefüllt: nur Initialen (${letzte.length} Zeilen)`);
const anteilUebersicht = await breiteAnteil(".zv-fo");
pruefe(anteilUebersicht > 0.95, `Übersicht nutzt die volle Breite (${(anteilUebersicht * 100).toFixed(0)} %)`);
await bild(page, "1-uebersicht", true);

// ===== 3 Aufbau =====
await reiter.getByRole("tab", { name: "Aufbau" }).click();
// Mit Entwurf oeffnet der Aufbau im Editor; die veroeffentlichte Version waehlen.
const versionKnoepfe = page.locator(".zv-fa-wahl .zv-segmented button");
await versionKnoepfe.first().waitFor();
const texte = await versionKnoepfe.allInnerTexts();
pruefe(texte.some((t) => /Entwurf/.test(t)), "Aufbau: Versionswahl enthält den Entwurf");
pruefe((await page.locator(".zv-fe").count()) === 1, "Aufbau mit Entwurf: Editor ist offen");
const veroeffentlicht = texte.filter((t) => !/Entwurf/.test(t));
await versionKnoepfe.filter({ hasText: new RegExp(`^${veroeffentlicht.at(-1)}$`) }).click();
await page.locator(".zv-fa-drei").waitFor();
pruefe((await page.locator(".zv-fe").count()) === 0, "Ältere Version: kein Editor, nur Ansicht");
const markiert = await page.locator(".zv-fa-neu, .zv-fa-geaendert").count();
pruefe(markiert > 0, `Aufbau: Änderungen zur Vorversion markiert (${markiert})`);
const ohneMarkierung = await (async () => {
  await page.getByLabel(/Änderungen zu Version/).uncheck();
  const n = await page.locator(".zv-fa-neu, .zv-fa-geaendert").count();
  await page.getByLabel(/Änderungen zu Version/).check();
  return n;
})();
pruefe(ohneMarkierung === 0, "Gegenprobe: Markierung abgeschaltet → keine markierten Felder");
const spalten = await page.evaluate(() => {
  const r = document.querySelector(".zv-fa-raster");
  return getComputedStyle(r).gridTemplateColumns.split(" ").length;
});
pruefe(spalten === 2, `Aufbau: Felder zweispaltig (${spalten} Spalten)`);
const feld = page.locator(".zv-fa-feld").nth(2);
const feldTitel = (await feld.locator(".zv-fa-feld-titel").innerText()).replace(/\s*\*.*$/s, "").split("\n")[0].trim();
await feld.click();
pruefe((await page.locator(".zv-fa-info h3").innerText()).startsWith(feldTitel), `Feld-Info zeigt das angeklickte Feld („${feldTitel}“)`);
pruefe(/Protokollen|noch keine/.test(await page.locator(".zv-fa-info").innerText()), "Feld-Info nennt, wie oft das Feld ausgefüllt wurde");
const anteilAufbau = await breiteAnteil(".zv-fa");
pruefe(anteilAufbau > 0.95, `Aufbau nutzt die volle Breite (${(anteilAufbau * 100).toFixed(0)} %)`);
await bild(page, "2-aufbau");

// ===== 4 Ansichten =====
await reiter.getByRole("tab", { name: "Ansichten" }).click();
await page.locator(".zv-fv").waitFor();
pruefe((await page.locator(".zv-fv-liste button:disabled").count()) === 2, "Ansichten: PDF-Einträge gesperrt („später“)");
await page.locator(".zv-fv-liste button", { hasText: "Ausfüllen am Handy" }).click();
const handyBreite = await page.evaluate(() => document.querySelector(".zv-fv-handy").getBoundingClientRect().width);
pruefe(Math.abs(handyBreite - 390) <= 1, `Handy-Vorschau ist 390 px breit (${handyBreite.toFixed(0)})`);
// Beispieldaten: Ja/Nein steht auf Ja -> bedingte Felder sichtbar; „Nein“ beim
// letzten Ja/Nein-Feld (im Testformular: das, von dem die Vorfall-Felder abhaengen)
// blendet sie aus.
const handy = page.locator(".zv-fv-handy");
const vorher = await handy.locator(".zv-field, .zv-protokoll-feld, fieldset").count();
await handy.locator("[role=radio]", { hasText: /^Nein$/ }).last().click();
const nachher = await handy.locator(".zv-field, .zv-protokoll-feld, fieldset").count();
pruefe(nachher < vorher, `Regel wirkt live in der Vorschau (${vorher} → ${nachher} Elemente)`);
await bild(page, "3-ansicht-handy");
await page.locator(".zv-fv-liste button", { hasText: "Lesen in der Akte" }).click();
await page.locator(".zv-fv-buehne .zv-protokoll-lesen").waitFor();
pruefe(true, "Ansicht „Lesen in der Akte“ zeigt die Leseansicht");
await page.locator(".zv-fv .zv-segmented button", { hasText: "Echtes Protokoll" }).click();
await page.locator("#zv-fv-echt").waitFor();
await page.waitForTimeout(500);
const lesen = await page.locator(".zv-fv-buehne .zv-protokoll-lesen").innerText();
pruefe(!/Beispiel/.test(lesen), "Echtes Protokoll: Werte stammen nicht aus den Beispieldaten");
await bild(page, "4-ansicht-echt");
const anteilAnsichten = await breiteAnteil(".zv-fv");
pruefe(anteilAnsichten > 0.95, `Ansichten nutzen die volle Breite (${(anteilAnsichten * 100).toFixed(0)} %)`);

// ===== 5 Einstellungen =====
await reiter.getByRole("tab", { name: "Einstellungen" }).click();
await page.locator(".zv-fe-spalten").waitFor();
const spaltenLage = await page.evaluate(() => {
  const [a, b] = [...document.querySelectorAll(".zv-fe-spalte")].map((e) => e.getBoundingClientRect());
  return { nebeneinander: Math.abs(a.top - b.top) < 2 && b.left > a.right };
});
pruefe(spaltenLage.nebeneinander, "Einstellungen: zwei Spalten nebeneinander");
const knopfOben = await page.evaluate(() => {
  const k = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Einstellungen speichern")).getBoundingClientRect();
  const sp = document.querySelector(".zv-fe-spalten").getBoundingClientRect();
  return k.bottom <= sp.top;
});
pruefe(knopfOben, "Einstellungen: „Einstellungen speichern“ steht über den Karten");
const anteilEinstellungen = await breiteAnteil(".zv-formular-einstellungen");
pruefe(anteilEinstellungen > 0.95, `Einstellungen nutzen die volle Breite (${(anteilEinstellungen * 100).toFixed(0)} %)`);
await bild(page, "5-einstellungen");

// ===== Versionen: „Ansehen“ springt in den Aufbau mit der Version =====
await reiter.getByRole("tab", { name: "Versionen" }).click();
await page.locator(".zv-formular-versions-knoepfe button", { hasText: "Ansehen" }).last().click();
pruefe((await reiter.locator("button.active").innerText()).trim() === "Aufbau", "Versionen › Ansehen öffnet den Aufbau");
pruefe((await page.locator(".zv-fa-wahl .zv-segmented button.active").innerText()).trim() === "1", "… mit der gewählten Version 1");

// ===== 6 Ueberlauf =====
for (const breite of [1780, 1280, 390]) {
  await page.setViewportSize({ width: breite, height: 900 });
  for (const r of ["Übersicht", "Aufbau", "Ansichten", "Einstellungen", "Versionen"]) {
    const knopf = reiter.getByRole("tab", { name: r });
    await knopf.scrollIntoViewIfNeeded();
    await knopf.click();
    await page.waitForTimeout(250);
    const u = await ueberlauf(page);
    pruefe(u <= 0, `${breite} px, ${r}: kein horizontaler Überlauf (${u})`);
    if (breite === 390 && bilder) await page.screenshot({ path: `${bilder}/6-handy-${r}.png`, fullPage: true });
  }
}

await browser.close();
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
if (messungen < 30) {
  console.error("Zu wenige Messungen -- die Prüfung hat nicht alles erreicht.");
  process.exit(1);
}
process.exit(fehler.length ? 1 : 0);
