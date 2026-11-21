/**
 * Browserpruefung Standortfilter im Organigramm (Rueckmeldung 1d0d9f97:
 * "nur die dazugehoerigen Mitarbeiter und Leiter, Geschaeftsfuehrer und
 * Bereichsleiter bleiben"). Misst, welche Namen auf den Karten stehen --
 * nicht, ob es gut aussieht.
 *
 * Voraussetzung: API + Dev-Server und ein Traeger mit diesem Aufbau
 * (Konto der Geschaeftsfuehrung mit Vollzugriff):
 *   Traeger: Geschaeftsfuehrung (Gerda), darunter Bereichsleitung Nord
 *     (Bea, weitere Einheiten Linde + Eiche), Bereichsleitung Sued (Bodo,
 *     Birke), Bereichsleitung West (Wanda, ohne weitere Einheiten), Stabsstelle Verwaltung (Vera), Sammelrang Mitarbeiter mit
 *     Mia (Linde), Max (Eiche), Mo (Linde + Birke), Nina (ohne Standort);
 *   Haus Linde: Einrichtungsleitung (Lena), darunter Hauswirtschaft (Hanna);
 *   Haus Eiche: Einrichtungsleitung (Emil); Haus Birke: Einrichtungsleitung (Berta).
 *
 * Nutzung: node scripts/organigramm-filter-pruefung.mjs <slug> <passwort> <gfEmail> [bildordner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, passwort, gfEmail, bildordner] = process.argv;
if (!gfEmail) {
  console.error("Nutzung: node scripts/organigramm-filter-pruefung.mjs <slug> <passwort> <gfEmail> [bildordner]");
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
// Ein Pruefskript, das nichts misst, muss fehlschlagen (CLAUDE.md).
const ERWARTETE_MESSUNGEN = 32;
const ALLE = ["Gerda", "Bea", "Bodo", "Wanda", "Vera", "Lena", "Hanna", "Emil", "Berta", "Mia", "Max", "Mo ", "Nina"];
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const bild = async (page, name) => bildordner && page.screenshot({ path: `${bildordner}/${name}.png` });

async function anmelden(viewport, colorScheme) {
  const page = await browser.newPage({ viewport, colorScheme, deviceScaleFactor: bildordner ? 2 : 1 });
  await page.goto(BASIS, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", slug);
  await page.fill("#email", gfEmail);
  await page.fill("#passwort", passwort);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content", { timeout: 10000 });
  await page.evaluate(() => {
    const knopf = [...document.querySelectorAll(".zv-sidebar button")].find((b) => b.textContent.includes("Organigramm"));
    knopf?.click();
  });
  await page.waitForSelector(".zv-organigramm-knoten");
  return page;
}
// Namen auf den Karten (+ Leerzeichen, damit "Mo " nicht in "Mona" o.ae. trifft).
const kartenText = async (page) =>
  (await page.locator(".zv-organigramm-knoten").allInnerTexts()).map((t) => t.replace(/\s+/g, " ") + " ").join("|");
function erwarte(text, sichtbar, wann) {
  for (const n of ALLE) pruefe(text.includes(n) === sichtbar.includes(n), `${wann}: ${n.trim()} ${sichtbar.includes(n) ? "sichtbar" : "ausgeblendet"}`);
}
async function standortUmschalten(page, name) {
  if (!(await page.locator('[role=dialog][aria-label="Standort"]').count())) await page.click(".zv-filter-pille-knopf:has-text('Standort')");
  await page.click(`[role=dialog][aria-label="Standort"] [role=option]:has-text("${name}")`);
}

{
  const page = await anmelden({ width: 1440, height: 1000 }, "dark");
  const ohne = await kartenText(page);
  pruefe(ALLE.every((n) => ohne.includes(n)), "ohne Filter: alle dreizehn Personen sichtbar");

  await standortUmschalten(page, "Haus Linde");
  await page.keyboard.press("Escape");
  const linde = await kartenText(page);
  erwarte(linde, ["Gerda", "Bea", "Wanda", "Lena", "Hanna", "Mia", "Mo "], "Haus Linde");
  pruefe((await page.locator(".zv-filter-pille.aktiv").innerText()).includes("Haus Linde"), "Pille zeigt „Haus Linde“");
  await bild(page, "1-filter-linde-dunkel");

  await standortUmschalten(page, "Haus Birke");
  await page.keyboard.press("Escape");
  const beide = await kartenText(page);
  erwarte(beide, ["Gerda", "Bea", "Bodo", "Wanda", "Lena", "Hanna", "Berta", "Mia", "Mo "], "Linde + Birke");
  pruefe((await page.locator(".zv-filter-pille.aktiv").innerText()).includes("2 gewählt"), "Pille zeigt „2 gewählt“");

  await page.click('button[aria-label="Filter Standort entfernen"]');
  pruefe((await kartenText(page)) === ohne, "Filter entfernt: wieder derselbe Baum wie ohne Filter");
  await page.close();
}

{
  const page = await anmelden({ width: 390, height: 844 }, "light");
  await standortUmschalten(page, "Haus Birke");
  await page.keyboard.press("Escape");
  const birke = await kartenText(page);
  pruefe(birke.includes("Berta") && birke.includes("Bodo") && birke.includes("Wanda") && !birke.includes("Lena") && !birke.includes("Bea"), "Handy, Haus Birke: Berta, Bodo, Wanda, aber weder Lena noch Bea");
  const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  pruefe(!ueberlauf, "Handy 390 px: kein waagerechter Überlauf der Seite");
  await bild(page, "2-filter-birke-handy-hell");
  await page.close();
}

await browser.close();
if (messungen < ERWARTETE_MESSUNGEN) fehler.push(`nur ${messungen} von ${ERWARTETE_MESSUNGEN} Messungen`);
console.log(fehler.length ? `\n${fehler.length} Fehler` : `\nAlle ${messungen} Messungen bestanden.`);
process.exit(fehler.length ? 1 : 0);
