/**
 * Browserpruefung Mitarbeiter-Detail (Rueckmeldung 29e0f19d, Konzept
 * /mnt/project-files/mitarbeiter-detail/). Misst:
 *   - Liste: Spalte „Zuständig für“ mit Zahl und Vertretungs-Etikett;
 *   - Klick auf den Namen oeffnet das Seitenpanel mit Bezugsklient:innen,
 *     „Vertritt …“ samt Klient:innen der vertretenen Person und „Wird
 *     vertreten von …“ (geplant);
 *   - wer einen Standort nicht sieht, bekommt dort nur die Zahl, keinen Namen;
 *   - deaktiviertes Konto mit Klient:innen zeigt die Warnung;
 *   - Klick auf eine Klientin springt in deren Akte;
 *   - kein waagerechter Ueberlauf bei 1440 und 390 px, Zeilen >= 44 px hoch.
 *
 * Voraussetzung: API + Dev-Server laufen. Testdaten (Namen unten): Leitung
 * sieht alles; Lena betreut Ahmet Yildiz, Cem Özdemir, Fatma Sahin (Haus am
 * Lindenpark) und Rita Ernst (Wohnen Birkenweg), vertritt heute Carla
 * (Hanna Brandt, Ivo Roth in Birkenweg; Jana Kurz in Lindenpark) und wird ab
 * in 10 Tagen von Sara vertreten. Ben sieht nur Haus am Lindenpark. Jonas ist
 * deaktiviert und betreut noch zwei Klient:innen.
 *
 * Nutzung: node scripts/mitarbeiter-detail-pruefung.mjs <slug> <leitungEmail> <benEmail> <passwort> [bildordner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, leitungEmail, benEmail, passwort, bildordner] = process.argv;
if (!slug || !leitungEmail || !benEmail || !passwort) {
  console.error("Nutzung: node scripts/mitarbeiter-detail-pruefung.mjs <slug> <leitungEmail> <benEmail> <passwort> [bildordner]");
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
// Ein Pruefskript, das nichts misst, muss fehlschlagen (CLAUDE.md).
const ERWARTETE_MESSUNGEN = 22;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const bild = async (page, name) => bildordner && page.screenshot({ path: `${bildordner}/${name}.png` });

async function anmelden(email, colorScheme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme, deviceScaleFactor: bildordner ? 2 : 1 });
  await page.goto(BASIS, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", slug);
  await page.fill("#email", email);
  await page.fill("#passwort", passwort);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content", { timeout: 10000 });
  await page.click('.zv-sidebar button:has-text("Mitarbeitende")');
  await page.waitForSelector(".zv-name-link");
  return page;
}
const zeile = (page, name) => page.locator(".zv-info-karte", { has: page.locator(`.zv-name-link:text-is("${name}")`) });
const panel = (page) => page.locator(".zv-seitenpanel.zv-offen");
async function oeffne(page, name) {
  const antwort = page.waitForResponse((r) => r.url().includes("/zustaendigkeiten"));
  await page.click(`.zv-name-link:text-is("${name}")`);
  await antwort;
  await page.waitForSelector(".zv-seitenpanel.zv-offen .zv-ma-abschnitt");
  await page.waitForTimeout(350); // Einfahr-Animation
}
async function schliessen(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
}

// --- Leitung, dunkel -------------------------------------------------------
{
  const page = await anmelden(leitungEmail, "dark");
  pruefe(await page.locator('.zv-liste-kopf span:text-is("Zuständig für")').isVisible(), "Liste: Spalte „Zuständig für“");
  const lena = await zeile(page, "Lena Berger").locator('[data-label="Zuständig für"]').innerText();
  pruefe(lena.includes("4 Klient:innen") && lena.includes("vertritt Carla Neumann"), `Liste Lena: Zahl und Vertretung (${lena.replace(/\n/g, " / ")})`);
  const carla = await zeile(page, "Carla Neumann").locator('[data-label="Zuständig für"]').innerText();
  pruefe(carla.includes("3 Klient:innen") && carla.includes("wird vertreten"), `Liste Carla: Zahl und „wird vertreten“`);
  pruefe(!(await ueberlauf(page)), "Liste 1440 px: kein waagerechter Überlauf");

  await oeffne(page, "Lena Berger");
  const text = await panel(page).innerText();
  for (const n of ["Ahmet Yildiz", "Cem Özdemir", "Fatma Sahin", "Rita Ernst"]) {
    pruefe(text.includes(n), `Detail Lena: Bezugsklientin ${n}`);
  }
  pruefe(/Vertritt Carla Neumann/.test(text) && text.includes("Hanna Brandt") && text.includes("Jana Kurz"), "Detail Lena: vertritt Carla, mit deren Klient:innen");
  pruefe(/Wird vertreten von Sara Yilmaz/.test(text) && /ab \d\d\.\d\d\./.test(text), "Detail Lena: wird vertreten von Sara (geplant)");
  pruefe(!/umfang|sensible/i.test(text), "Detail: keine Rechte-Details der Vertretung");
  const breite = await panel(page).evaluate((e) => e.scrollWidth <= e.clientWidth);
  pruefe(breite && !(await ueberlauf(page)), "Panel 1440 px: kein waagerechter Überlauf");
  await bild(page, "umgesetzt-1-detail-dunkel");

  // Sprung in die Akte
  await panel(page).locator('button.zv-ma-zeile:has-text("Ahmet Yildiz")').first().click();
  await page.waitForTimeout(800);
  const akte = await page.locator(".zv-content").innerText();
  pruefe(akte.includes("Yildiz") && (await page.locator('.zv-sidebar button.active:has-text("Klienten")').count()) === 1, "Klick auf Klient:in öffnet die Klienten-Akte");

  await page.click('.zv-sidebar button:has-text("Mitarbeitende")');
  await page.waitForSelector(".zv-name-link");
  await oeffne(page, "Jonas Hartmann");
  const jonas = await panel(page).innerText();
  pruefe(jonas.includes("ist deaktiviert, steht aber noch bei 2 Klient:innen"), "Deaktiviertes Konto: Warnung mit Zahl");
  await bild(page, "umgesetzt-3-deaktiviert-dunkel");
  await page.close();
}

// --- Ben (sieht nur Haus am Lindenpark), hell --------------------------------
{
  const page = await anmelden(benEmail, "light");
  const carla = await zeile(page, "Carla Neumann").locator('[data-label="Zuständig für"]').innerText();
  pruefe(carla.includes("3 Klient:innen"), "Liste aus eingeschränkter Sicht: Zahl zählt alle");
  await oeffne(page, "Carla Neumann");
  const text = await panel(page).innerText();
  pruefe(text.includes("Jana Kurz"), "Eingeschränkt: Klientin am eigenen Standort mit Namen");
  pruefe(!text.includes("Hanna Brandt") && !text.includes("Ivo Roth"), "Eingeschränkt: fremder Standort ohne Namen");
  pruefe(/2 weitere an Standorten, die du nicht siehst/.test(text), "Eingeschränkt: Hinweis „2 weitere …“");
  await bild(page, "umgesetzt-2-eingeschraenkt-hell");
  await schliessen(page);

  // Handy
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  pruefe(!(await ueberlauf(page)), "Liste 390 px: kein waagerechter Überlauf");
  await oeffne(page, "Lena Berger");
  const breite = await panel(page).evaluate((e) => Math.round(e.getBoundingClientRect().width));
  pruefe(breite >= 388, `Handy: Panel füllt die Breite (${breite} px)`);
  const hoehen = await panel(page).locator(".zv-ma-zeile").evaluateAll((l) => l.map((e) => e.getBoundingClientRect().height));
  pruefe(hoehen.length > 0 && Math.min(...hoehen) >= 44, `Handy: Klient-Zeilen mindestens 44 px hoch (${Math.round(Math.min(...hoehen))})`);
  const panelUeber = await panel(page).evaluate((e) => {
    const inhalt = e.querySelector(".zv-seitenpanel-inhalt");
    return inhalt.scrollWidth > inhalt.clientWidth;
  });
  pruefe(!panelUeber && !(await ueberlauf(page)), "Handy 390 px: Panel ohne waagerechten Überlauf");
  await bild(page, "umgesetzt-4-handy-hell");
  await page.close();
}

await browser.close();
if (messungen < ERWARTETE_MESSUNGEN) {
  console.error(`Nur ${messungen} von ${ERWARTETE_MESSUNGEN} Messungen -- Skript misst nicht, was es soll.`);
  process.exit(1);
}
if (fehler.length > 0) {
  console.error(`\n${fehler.length} Fehler`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Messungen in Ordnung.`);
