// Prüft das Zimmer-Panel (Rückmeldung d5f8252d) im echten Browser, gemessen
// statt angesehen. Braucht API (:3000) + Dev-Server (:5173) und einen
// Mandanten mit Zimmer 1.02 (zwei Bewohner:innen, vier offene Aufgaben,
// davon eine überfällig und eine von einer anderen Person angelegt) sowie
// Zimmer 0.03 ohne Bewohner:in.
//
//   node scripts/zimmer-panel-pruefung.mjs <slug> <email> <passwort> [bilder-ordner]
//
// Bricht mit Exit-Code 1 ab, sobald eine Prüfung fehlschlägt -- und auch,
// wenn weniger Prüfungen liefen als erwartet (ein Skript, das nichts misst,
// darf nicht "alles in Ordnung" melden).
import { chromium } from "playwright";

const [, , slug, email, passwort, bilderOrdner] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node scripts/zimmer-panel-pruefung.mjs <slug> <email> <passwort> [bilder-ordner]");
  process.exit(1);
}
const ERWARTETE_PRUEFUNGEN = 25;
const BASIS = "http://localhost:5173/";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fehler = [];
let anzahl = 0;
function pruefe(bedingung, beschreibung) {
  anzahl++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function oeffneStandorte({ breite, hoehe, theme, faktor = 1 }) {
  // Angemeldet und navigiert wird immer in Desktopbreite (die Handy-
  // Navigation ist hier nicht Gegenstand); erst danach auf die Zielbreite.
  const kontext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: faktor });
  await kontext.addInitScript(
    ([t]) => {
      localStorage.setItem("zimmerakte_theme", t);
      localStorage.setItem("zimmerakte_raumplan_ansicht", "verwalten");
    },
    [theme]
  );
  const page = await kontext.newPage();
  await page.goto(BASIS);
  await page.getByLabel(/Träger-Kennung/i).fill(slug);
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Standorte/ }).first().click();
  await page.waitForSelector(".zv-room-card-knopf");
  await page.setViewportSize({ width: breite, height: hoehe });
  await page.waitForTimeout(600);
  return { kontext, page };
}

const karte = (page, nr) => page.locator(".zv-room-card-knopf", { has: page.locator(".zv-room-nummer", { hasText: nr }) });
const panel = (page) => page.locator('.zv-seitenpanel[aria-label="Zimmerdetails"]');
const ueberlauf = (page, sel) =>
  page.$$eval(sel, (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.className} ${e.scrollWidth}>${e.clientWidth}`));

// ===== Desktop 1440, dunkel: angedockt neben dem Raster =====
{
  const { kontext, page } = await oeffneStandorte({ breite: 1440, hoehe: 900, theme: "dunkel", faktor: 2 });
  const k102 = karte(page, "1.02");
  pruefe((await k102.locator(".zv-pill-danger > span[aria-hidden]").innerText()).trim() === "4", "Karte 1.02: rote Zahl 4 (eine Aufgabe überfällig)");
  pruefe(/davon 1 überfällig/.test(await k102.locator(".zv-sr-only").first().innerText()), "Karte 1.02: Überfälliges auch als Text, nicht nur Farbe");
  pruefe((await k102.locator(".zv-link-btn").count()) === 0, "Karte trägt keine Links mehr");

  await k102.click();
  await page.waitForTimeout(500);
  pruefe(await panel(page).evaluate((e) => e.classList.contains("zv-seitenpanel-angedockt")), "1440 px: Panel angedockt");
  pruefe(!(await panel(page).evaluate((e) => e.previousElementSibling.classList.contains("zv-offen"))), "1440 px: kein Abdunkeln");
  pruefe((await k102.getAttribute("aria-pressed")) === "true", "Karte 1.02 als ausgewählt markiert");
  const panelLinks = await panel(page).evaluate((e) => e.getBoundingClientRect().left);
  const rechtesteKarte = Math.max(...(await page.$$eval(".zv-room-card-knopf", (els) => els.map((e) => e.getBoundingClientRect().right))));
  pruefe(rechtesteKarte <= panelLinks, `Raster endet vor dem Panel (${Math.round(rechtesteKarte)} ≤ ${Math.round(panelLinks)})`);
  const seite = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  pruefe(seite[0] <= seite[1], `Seite ohne waagrechten Überlauf (${seite[0]} ≤ ${seite[1]})`);

  const zeilen = panel(page).locator(".zv-aufgabe-kompakt");
  pruefe((await zeilen.count()) === 4, `Panel zeigt 4 offene Aufgaben (${await zeilen.count()})`);
  const fremde = zeilen.filter({ hasText: "Fenstergriff klemmt" });
  pruefe(await fremde.getByRole("button", { name: "Erledigen" }).isVisible(), "Erledigen auch an der Aufgabe, die jemand anders angelegt hat");
  const ueberPanel = await ueberlauf(page, ".zv-seitenpanel-inhalt, .zv-aufgabe-kompakt, .zv-zimmer-liste > li");
  pruefe(ueberPanel.length === 0, `Panel ohne waagrechten Überlauf ${ueberPanel.join(", ")}`);

  if (bilderOrdner) await page.screenshot({ path: `${bilderOrdner}/umgesetzt-1-desktop-dunkel.png` });

  await zeilen.filter({ hasText: "Rauchmelder prüfen" }).getByRole("button", { name: "Erledigen" }).click();
  await page.waitForTimeout(700);
  pruefe((await zeilen.count()) === 3, "Nach Erledigen: 3 offene Aufgaben im Panel");
  pruefe((await k102.locator(".zv-pill-danger > span[aria-hidden]").innerText()).trim() === "3", "Nach Erledigen: Karte zählt 3");

  await panel(page).getByRole("button", { name: "Erledigt", exact: true }).click();
  await page.waitForTimeout(600);
  const erledigt = await zeilen.allInnerTexts();
  pruefe(erledigt.some((t) => t.includes("Rauchmelder")) && erledigt.some((t) => t.includes("Schlüssel")), "Umschalter Erledigt zeigt erledigte Aufgaben");

  // Wechsel auf ein anderes Zimmer, ohne zu schließen
  await karte(page, "0.03").click();
  await page.waitForTimeout(600);
  pruefe((await panel(page).locator("h2").first().innerText()).includes("Zimmer 0.03"), "Klick auf zweite Karte wechselt den Inhalt");
  pruefe((await zeilen.count()) === 2, "Zimmer 0.03: wieder Ansicht Offen mit 2 Aufgaben");

  // Anlegen über den Kopf-Knopf
  await panel(page).getByRole("button", { name: /^Aufgabe$/ }).click();
  await panel(page).locator('input[name="titel"]').fill("Fußleiste lose");
  await panel(page).getByRole("button", { name: "Anlegen" }).click();
  await page.waitForTimeout(700);
  pruefe((await zeilen.filter({ hasText: "Fußleiste lose" }).count()) === 1, "Neue Aufgabe erscheint im Panel");
  pruefe((await karte(page, "0.03").locator(".zv-pill-offen > span[aria-hidden]").innerText()).trim() === "3", "Karte 0.03 zählt danach 3");

  // Akte im selben Panel
  await karte(page, "1.02").click();
  await page.waitForTimeout(600);
  await panel(page).getByRole("button", { name: "Akte" }).first().click();
  await page.waitForTimeout(1200);
  const zurueck = panel(page).getByRole("button", { name: "Zurück zu Zimmer 1.02" });
  pruefe(await zurueck.isVisible(), "Akte öffnet im Panel mit „Zurück zu Zimmer 1.02“");
  await zurueck.click();
  await page.waitForTimeout(500);
  pruefe((await panel(page).locator("h2").first().innerText()).includes("Zimmer 1.02"), "Zurück führt zum Zimmer");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  pruefe(!(await panel(page).evaluate((e) => e.classList.contains("zv-offen"))), "Esc schließt das Panel");
  await kontext.close();
}

// ===== Schmaler Desktop 1100: darüberliegend wie bei Klienten =====
{
  const { kontext, page } = await oeffneStandorte({ breite: 1100, hoehe: 800, theme: "hell" });
  await karte(page, "1.02").click();
  await page.waitForTimeout(500);
  pruefe(!(await panel(page).evaluate((e) => e.classList.contains("zv-seitenpanel-angedockt"))), "1100 px: Panel nicht angedockt");
  pruefe(await panel(page).evaluate((e) => e.previousElementSibling.classList.contains("zv-offen")), "1100 px: Raster abgedunkelt");
  await kontext.close();
}

// ===== Handy 390, hell: Vollbild =====
{
  const { kontext, page } = await oeffneStandorte({ breite: 390, hoehe: 844, theme: "hell", faktor: 2 });
  const seiteVorher = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (bilderOrdner) await page.screenshot({ path: `${bilderOrdner}/umgesetzt-3-handy-karten-hell.png` });
  await karte(page, "1.02").click();
  await page.waitForTimeout(600);
  const breite = await panel(page).evaluate((e) => e.getBoundingClientRect().width);
  pruefe(Math.round(breite) === 390, `Handy: Panel im Vollbild (${Math.round(breite)} px)`);
  const ueberPanel = await ueberlauf(page, ".zv-seitenpanel-inhalt, .zv-aufgabe-kompakt, .zv-zimmer-liste > li, .zv-akte-kopf");
  pruefe(ueberPanel.length === 0 && seiteVorher[0] <= seiteVorher[1], `Handy: kein waagrechter Überlauf ${ueberPanel.join(", ")}`);
  if (bilderOrdner) await page.screenshot({ path: `${bilderOrdner}/umgesetzt-2-handy-panel-hell.png` });
  await kontext.close();
}

await browser.close();
if (anzahl < ERWARTETE_PRUEFUNGEN) fehler.push(`nur ${anzahl} von ${ERWARTETE_PRUEFUNGEN} Prüfungen gelaufen`);
console.log(fehler.length ? `\n${fehler.length} FEHLER` : `\nAlle ${anzahl} Prüfungen bestanden.`);
process.exit(fehler.length ? 1 : 0);
