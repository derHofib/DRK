// Einmaliges Pruefskript: bestaetigt, dass Eingabefelder (.zv-field input)
// unter der mobilen Breite (<=640px) auf mindestens 16px Schriftgroesse
// stehen (verhindert den iOS-Auto-Zoom-beim-Fokussieren-Bug), waehrend die
// Desktop-Breite unveraendert bei der kleineren Feldschrift bleibt.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fehler = [];

function pruefe(bedingung, beschreibung) {
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function fontSizeDesEingabefelds(breite) {
  const page = await browser.newPage({ viewport: { width: breite, height: 800 } });
  await page.goto("http://localhost:5173/");
  const groesse = await page.locator(".zv-field input").first().evaluate((el) => getComputedStyle(el).fontSize);
  await page.close();
  return parseFloat(groesse);
}

const mobil = await fontSizeDesEingabefelds(390);
console.log("Schriftgroesse Eingabefeld bei 390px:", mobil);
pruefe(mobil >= 16, "Bei mobiler Breite (390px) ist die Feldschrift >= 16px (kein iOS-Auto-Zoom)");

const desktop = await fontSizeDesEingabefelds(1280);
console.log("Schriftgroesse Eingabefeld bei 1280px:", desktop);
pruefe(desktop < 16, "Bei Desktop-Breite (1280px) bleibt die urspruengliche, kleinere Feldschrift erhalten");

console.log("\n" + (fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} PRUEFUNG(EN) FEHLGESCHLAGEN:`));
fehler.forEach((f) => console.log(" - " + f));

await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
