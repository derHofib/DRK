/**
 * Browserpruefung der Einstellungen (Menuespalte "Mein Konto" / "Traeger",
 * volle Breite, Handy-Liste). Misst statt anzusehen:
 *
 *   1 Geschaeftsfuehrung sieht beide Gruppen und alle acht Bereiche.
 *   2 Betreuer sieht nur "Mein Konto" (drei Bereiche), keine Traeger-Gruppe.
 *   3 Volle Breite: bei 1780 px nutzt der Inhalt mehr als 1100 px (vorher
 *     endete er bei --zv-content-max), und die
 *     Karten der Darstellung stehen nebeneinander (zwei verschiedene x-Werte).
 *   4 Kein horizontaler Ueberlauf bei 390, 1440 und 1780 px.
 *   5 Handy (390 px): erst nur die Liste, ein Tipp zeigt nur den Bereich,
 *     "Einstellungen" fuehrt zurueck zur Liste.
 *
 * Bricht ab, wenn weniger Messungen als erwartet zustande kamen (CLAUDE.md:
 * "Ein Pruefskript, das nichts misst, muss fehlschlagen").
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173), ein Traeger mit
 * einem Konto mit Vollzugriff und einem Betreuer-Konto. Kein Bestandteil der CI.
 *
 *   node scripts/einstellungen-pruefung.mjs <slug> <gfEmail> <betreuerEmail> <passwort> [bildordner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, gfEmail, betreuerEmail, passwort, bildordner] = process.argv;
if (!slug || !gfEmail || !betreuerEmail || !passwort) {
  console.error("Nutzung: node einstellungen-pruefung.mjs <slug> <gfEmail> <betreuerEmail> <passwort> [bildordner]");
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
const ERWARTETE_MESSUNGEN = 16;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function oeffneEinstellungen(email, breite) {
  const page = await browser.newPage({ viewport: { width: breite, height: 1000 } });
  await page.goto(BASIS, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", slug);
  await page.fill("#email", email);
  await page.fill("#passwort", passwort);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content", { timeout: 10000 });
  // Die Rechte kommen asynchron nach dem Oeffnen; erst nach ihrer Antwort
  // steht fest, ob die Traeger-Gruppe erscheint. networkidle allein reichte
  // nicht (erste Fassung mass bei der GF noch den Zustand davor).
  const rechte = page.waitForResponse((r) => r.url().includes("/mandant/me/einstellungen-rechte"));
  await page.click('.zv-sidebar-foot button[title="Einstellungen"]');
  await page.waitForSelector(".zv-einstellungen-menue");
  await rechte;
  await page.waitForTimeout(100);
  return page;
}

const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const menuePunkte = (page) => page.$$eval(".zv-einstellungen-menue button", (b) => b.map((x) => x.textContent.trim()));
const gruppen = (page) => page.$$eval(".zv-einstellungen-menue .zv-gruppenlabel", (g) => g.map((x) => x.textContent.trim()));
const bild = async (page, name) => bildordner && page.screenshot({ path: `${bildordner}/${name}.png`, fullPage: true });

// 1 + 3 + 4: Geschaeftsfuehrung, breit
{
  const page = await oeffneEinstellungen(gfEmail, 1780);
  const punkte = await menuePunkte(page);
  pruefe(punkte.length === 8, `GF sieht 8 Bereiche (gemessen ${punkte.length}: ${punkte.join(", ")})`);
  const g = await gruppen(page);
  pruefe(g.length === 2 && g[1].startsWith("Träger"), `GF sieht Gruppen Mein Konto + Träger (${g.join(" | ")})`);

  await page.click('.zv-einstellungen-menue button:has-text("Darstellung")');
  const inhaltBreite = await page.$eval(".zv-einstellungen-inhalt", (e) => e.getBoundingClientRect().width);
  pruefe(inhaltBreite > 1100, `Inhalt nutzt die Breite bei 1780 px (${Math.round(inhaltBreite)} px)`);
  const xWerte = await page.$$eval(".zv-einstellungen-raster > .zv-einstellungen-abschnitt", (k) => [...new Set(k.map((x) => Math.round(x.getBoundingClientRect().x)))]);
  pruefe(xWerte.length >= 2, `Karten stehen nebeneinander (x-Werte ${xWerte.join(", ")})`);
  pruefe(!(await ueberlauf(page)), "kein waagerechter Überlauf bei 1780 px (Darstellung)");
  await bild(page, "umgesetzt-1-darstellung");

  await page.click('.zv-einstellungen-menue button:has-text("Erscheinungsbild")');
  pruefe((await page.textContent(".zv-einstellungen-geltung")).includes("Gilt für alle"), "Träger-Bereich zeigt „Gilt für alle Mitarbeitenden“");
  pruefe((await page.$$(".zv-farbwahl, .zv-einstellungen-raster > section")).length >= 2, "Erscheinungsbild zeigt Trägerfarbe und Grundfarbe");
  await bild(page, "umgesetzt-2-erscheinungsbild");

  await page.click('.zv-einstellungen-menue button:has-text("Datenschutz")');
  const titel = await page.$$eval(".zv-einstellungen-raster h3", (h) => h.map((x) => x.textContent.trim()));
  pruefe(titel.length === 2 && titel.every((t) => t.startsWith("Löschfrist")), `Datenschutz enthält genau die zwei Löschfristen (${titel.join(", ")})`);
  await bild(page, "umgesetzt-3-datenschutz");

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const name of ["Profil", "Anmeldung & Sicherheit", "Standorte", "Kassenbuch"]) {
    await page.click(`.zv-einstellungen-menue button:has-text("${name}")`);
    await page.waitForLoadState("networkidle");
  }
  pruefe(!(await ueberlauf(page)), "kein waagerechter Überlauf bei 1440 px (alle Bereiche durchgeklickt)");
  await page.close();
}

// 2: Betreuer
{
  const page = await oeffneEinstellungen(betreuerEmail, 1440);
  const punkte = await menuePunkte(page);
  pruefe(punkte.length === 3, `Betreuer sieht 3 Bereiche (gemessen ${punkte.length}: ${punkte.join(", ")})`);
  const g = await gruppen(page);
  pruefe(g.length === 1 && g[0] === "Mein Konto", `Betreuer sieht nur „Mein Konto“ (${g.join(" | ")})`);
  pruefe((await page.textContent(".zv-einstellungen-geltung")).includes("Nur für dich"), "Betreuer-Bereich zeigt „Nur für dich“");
  await bild(page, "umgesetzt-4-betreuer");

  // 5: Handy
  await page.setViewportSize({ width: 390, height: 844 });
  const sichtbar = (sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== "none");
  pruefe((await sichtbar(".zv-einstellungen-menue")) && !(await sichtbar(".zv-einstellungen-inhalt")), "Handy: zuerst nur die Liste");
  await bild(page, "umgesetzt-5-handy-liste");
  await page.click('.zv-einstellungen-menue button:has-text("Darstellung")');
  pruefe(!(await sichtbar(".zv-einstellungen-menue")) && (await sichtbar(".zv-einstellungen-inhalt")), "Handy: Tipp zeigt nur den Bereich");
  pruefe(!(await ueberlauf(page)), "kein waagerechter Überlauf bei 390 px (Darstellung)");
  await bild(page, "umgesetzt-6-handy-bereich");
  await page.click(".zv-einstellungen-zurueck");
  pruefe(await sichtbar(".zv-einstellungen-menue"), "Handy: „Einstellungen“ führt zurück zur Liste");
  await page.close();
}

await browser.close();
if (messungen < ERWARTETE_MESSUNGEN) {
  console.error(`Nur ${messungen} von ${ERWARTETE_MESSUNGEN} Messungen -- Prüfung ungültig.`);
  process.exit(1);
}
if (fehler.length) {
  console.error(`\n${fehler.length} Fehler`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Messungen in Ordnung.`);
