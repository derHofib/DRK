/**
 * Browserpruefung "Leitung & Team" als Karten im Standort-Steckbrief
 * (Rueckmeldung "Standorte Mitarbeiter", Konzept standort-team). Misst:
 *   - 1440 px: Karten im Raster (mindestens drei nebeneinander), Leitung
 *     zuerst, Zahl im Kopf = Karten, unbesetzte Leitungsstelle sichtbar,
 *     kein waagerechter Ueberlauf;
 *   - Leitung mit abwesenheiten.art-sehen sieht den Grund, Mitarbeitende
 *     ohne das Recht nur "Abwesend";
 *   - Profil-Knopf oeffnet das Profil mit Bezugsbetreuung;
 *   - Nachricht-Knopf springt in "Nachrichten" mit offenem Chat;
 *   - 390 px: eine Spalte, Tippflaechen >= 44 px, kein Ueberlauf.
 *
 * Voraussetzung: API + Dev-Server laufen, ein Standort mit Leitung im
 * Organigramm, einer unbesetzten Leitungsstelle und mindestens drei
 * Teammitgliedern, eines davon heute krank gemeldet.
 *
 * Nutzung: node scripts/standort-team-pruefung.mjs <slug> <leitungEmail> <mitarbeiterEmail> <passwort> <standortName> <nameKrank> [bildordner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, leitungEmail, mitarbeiterEmail, passwort, standortName, nameKrank, bildordner] = process.argv;
if (!slug || !leitungEmail || !mitarbeiterEmail || !passwort || !standortName || !nameKrank) {
  console.error("Nutzung: node scripts/standort-team-pruefung.mjs <slug> <leitungEmail> <mitarbeiterEmail> <passwort> <standortName> <nameKrank> [bildordner]");
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
// Ein Pruefskript, das nichts misst, muss fehlschlagen (CLAUDE.md).
const ERWARTETE_MESSUNGEN = 15;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const bild = async (page, name, fullPage = true) => bildordner && page.screenshot({ path: `${bildordner}/${name}.png`, fullPage });

async function anmelden(email, viewport, colorScheme) {
  const page = await browser.newPage({ viewport, colorScheme, deviceScaleFactor: bildordner ? 2 : 1 });
  await page.goto(BASIS, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    try {
      localStorage.setItem("zimmerakte_sidebar_organisatorisch_aufgeklappt", "1");
    } catch {
      /* egal */
    }
  });
  await page.fill("#mandantSlug", slug);
  await page.fill("#email", email);
  await page.fill("#passwort", passwort);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content", { timeout: 10000 });
  return page;
}

const karte = (page, name) => page.locator(".zv-team-karte", { has: page.locator(`.zv-team-name:text-is("${name}")`) });

// --- Leitung, breit, dunkel ------------------------------------------------
{
  const page = await anmelden(leitungEmail, { width: 1440, height: 1000 }, "dark");
  await page.click('#zv-organisatorisch button:has-text("Standorte")');
  await page.locator(".zv-standorte-liste .zv-info-karte", { hasText: standortName }).click();
  await page.waitForSelector(".zv-team-karte");

  const personen = await page.locator(".zv-team-karte:not(.zv-team-karte-offen)").count();
  const kopf = await page.locator(".zv-team-kopfzahl").innerText();
  pruefe(kopf.startsWith(`${personen} Personen`), `Kopfzahl passt zu den Karten („${kopf}“, ${personen} Karten)`);
  const ersteKarte = page.locator(".zv-team-karte").first();
  const leitungKarten = await page.locator(".zv-team-karte-leitung").count();
  pruefe(
    (await ersteKarte.getAttribute("class")).includes("zv-team-karte-leitung") && leitungKarten < personen,
    `Leitung steht zuerst, Team getrennt (${leitungKarten} Leitung von ${personen})`
  );
  pruefe((await page.locator(".zv-team-karte-offen", { hasText: "Stelle unbesetzt" }).count()) >= 1, "Unbesetzte Leitungsstelle als gestrichelte Karte");
  const reihe = await page.$$eval(".zv-team-karten", (listen) => {
    const team = listen[listen.length - 1];
    const ys = [...team.children].map((k) => Math.round(k.getBoundingClientRect().y));
    return ys.filter((y) => y === ys[0]).length;
  });
  pruefe(reihe >= 3, `1440 px: ${reihe} Karten nebeneinander`);
  const grund = await karte(page, nameKrank).locator(".zv-team-abwesend").innerText();
  pruefe(/^Krank/.test(grund), `Leitung mit Recht sieht den Grund („${grund}“)`);
  pruefe(!(await ueberlauf(page)), "Steckbrief 1440 px: kein waagerechter Überlauf");
  await bild(page, "umgesetzt-1-steckbrief-team-dunkel");

  // Profil
  const mitBezug = page.locator(".zv-team-karte", { has: page.locator(".zv-team-zeilen li", { hasText: "Bezug für" }) }).first();
  const bezugName = await mitBezug.locator(".zv-team-name").innerText();
  await mitBezug.locator('button[title="Profil"]').click();
  await page.waitForSelector('.zv-modal :text("Bezugsbetreuung hier")');
  pruefe((await page.locator(".zv-modal").innerText()).includes(bezugName.replace(" (du)", "")), `Profil von ${bezugName} mit Bezugsbetreuung`);
  await page.waitForTimeout(500);
  await bild(page, "umgesetzt-2-profil-dunkel", false);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".zv-modal", { state: "detached" });

  // Nachricht
  const chatAngelegt = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/chat/direkt"));
  await mitBezug.locator('button[aria-label^="Nachricht an"]').click();
  const antwort = await chatAngelegt;
  pruefe([200, 201].includes(antwort.status()), `Direktchat: HTTP ${antwort.status()}`);
  await page.waitForTimeout(800);
  const chatText = await page.locator(".zv-content").innerText();
  pruefe(chatText.includes(bezugName.replace(" (du)", "")) && (await page.locator("textarea, [contenteditable]").count()) > 0, "Nachrichten offen mit dem Chat der Person");
  await page.close();
}

// --- Mitarbeitende, Handy, hell ---------------------------------------------
{
  const page = await anmelden(mitarbeiterEmail, { width: 390, height: 844 }, "light");
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"] input');
  await page.keyboard.type("Belegung");
  await page.waitForSelector('[role="dialog"] :text("Standort wechseln")');
  await page.keyboard.press("Enter");
  await page.waitForSelector('button:has-text("Steckbrief")');
  await page.click('button:has-text("Steckbrief")');
  await page.waitForSelector(".zv-team-karte");

  const grund = await karte(page, nameKrank).locator(".zv-team-abwesend").innerText();
  pruefe(grund.startsWith("Abwesend"), `Ohne Recht nur „Abwesend“ („${grund}“)`);
  pruefe(!/krank/i.test(await page.locator(".zv-steckbrief-leitung").innerText()), "Ohne Recht steht „krank“ nirgends im Abschnitt");
  const handyPersonen = await page.locator(".zv-team-karte:not(.zv-team-karte-offen)").count();
  const nachrichtKnoepfe = await page.locator('.zv-team-karte button[aria-label^="Nachricht an"]').count();
  pruefe(nachrichtKnoepfe === handyPersonen - 1, `Handy: Nachricht an alle außer sich selbst (${nachrichtKnoepfe} von ${handyPersonen})`);
  const xs = await page.$$eval(".zv-team-karten > li", (k) => [...new Set(k.map((x) => Math.round(x.getBoundingClientRect().x)))]);
  pruefe(xs.length === 1, `390 px: eine Spalte (x-Werte ${xs.join(", ")})`);
  const kleinste = await page.$$eval(".zv-team-fuss a, .zv-team-fuss button", (k) =>
    Math.min(...k.filter((x) => x.offsetParent).map((x) => Math.min(x.getBoundingClientRect().width, x.getBoundingClientRect().height)))
  );
  pruefe(kleinste >= 44, `390 px: Tippflächen mindestens 44 px (kleinste ${Math.round(kleinste)})`);
  pruefe(!(await ueberlauf(page)), "Steckbrief 390 px: kein waagerechter Überlauf");
  await page.locator(".zv-steckbrief-leitung").scrollIntoViewIfNeeded();
  await bild(page, "umgesetzt-3-handy-hell");
  await page.close();
}

await browser.close();
if (messungen < ERWARTETE_MESSUNGEN) {
  console.error(`Nur ${messungen} von ${ERWARTETE_MESSUNGEN} Messungen -- das Skript misst nicht, was es soll.`);
  process.exit(1);
}
if (fehler.length > 0) {
  console.error(`\n${fehler.length} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Prüfungen bestanden.`);
