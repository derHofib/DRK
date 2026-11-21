// Prüft Rückmeldung d8bea340: Eine offene Klienten-Akte (Seitenpanel) muss
// sich schließen, sobald man über die Seitenleiste zu den Anwärter:innen
// (oder ins Archiv) wechselt -- sonst verdeckt sie die neue Liste.
// Nutzung: node scripts/anwaerter-wechsel-pruefung.mjs <slug> <email> <passwort> <klient-name> [bilderOrdner]
import { chromium } from "playwright";

const [, , slug, email, passwort, klientName, bilder] = process.argv;
if (!slug || !email || !passwort || !klientName) {
  console.error("Nutzung: node anwaerter-wechsel-pruefung.mjs <slug> <email> <passwort> <klient-name> [bilderOrdner]");
  process.exit(1);
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5173/");
await page.getByLabel(/Träger-Kennung/i).fill(slug);
await page.getByLabel(/E-Mail/i).fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.waitForTimeout(1500);

const panelOffen = () => page.locator(".zv-seitenpanel.zv-offen").count().then((n) => n > 0);
const seitenleiste = page.locator(".zv-sidebar");

await seitenleiste.getByRole("button", { name: /^Klienten$/ }).first().click();
await page.waitForTimeout(500);
await page.getByText(klientName).first().click();
await page.waitForTimeout(500);
pruefe(await panelOffen(), "Akte öffnet sich nach Klick auf die Klientin");
if (bilder) await page.screenshot({ path: `${bilder}/1-akte-offen.png` });

await seitenleiste.getByRole("button", { name: /^Anwärter$/ }).first().click();
await page.waitForTimeout(600);
pruefe(!(await panelOffen()), "Wechsel zu Anwärter schließt die Akte");
pruefe(await page.locator(".zv-segmented[aria-label='Status']").isVisible(), "Anwärter-Liste ist sichtbar");
if (bilder) await page.screenshot({ path: `${bilder}/2-anwaerter.png` });

await seitenleiste.getByRole("button", { name: /^Klienten$/ }).first().click();
await page.waitForTimeout(500);
pruefe(!(await panelOffen()), "Zurück bei Klienten bleibt die Akte geschlossen");

await page.getByText(klientName).first().click();
await page.waitForTimeout(500);
await seitenleiste.getByRole("button", { name: /^Archiv$/ }).first().click();
await page.waitForTimeout(600);
pruefe(!(await panelOffen()), "Wechsel ins Archiv schließt die Akte ebenfalls");

// Gegenrichtung: Wer aus der Anwärter-Ansicht über die Befehlspalette eine
// Akte öffnet, springt selbst nach „Klienten" -- dieser Wechsel darf die
// gerade geöffnete Akte NICHT wieder zuklappen.
await seitenleiste.getByRole("button", { name: /^Anwärter$/ }).first().click();
await page.waitForTimeout(500);
await page.keyboard.press("Control+k");
await page.waitForTimeout(300);
await page.keyboard.type(klientName.split(" ")[0]);
await page.waitForTimeout(800);
await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
pruefe(await panelOffen(), "Akte aus der Befehlspalette öffnet sich auch aus der Anwärter-Ansicht heraus");
if (bilder) await page.screenshot({ path: `${bilder}/3-befehlspalette.png` });

await browser.close();
if (messungen < 6) {
  console.error(`Nur ${messungen} Messungen -- Prüfung unvollständig.`);
  process.exit(1);
}
if (fehler.length) {
  console.error(`${fehler.length} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log(`Alle ${messungen} Prüfungen bestanden.`);
