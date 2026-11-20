/**
 * Browserpruefung Standort-Steckbrief (Konzept standort-daten, Abschnitt 9,
 * Oberflaeche). Misst statt anzusehen:
 *   - Liste bei 1440 und 390 px ohne waagerechten Ueberlauf, abgeleitete
 *     Leitung und "Angaben fehlen" sichtbar;
 *   - Steckbrief bei 1440 px zweispaltig, bei 800 px einspaltig;
 *   - Reiterleiste ohne Ueberlauf;
 *   - Codewarnung im Feld "Zugang" erscheint bei vier Ziffern am Stueck;
 *   - Speichern einer Gruppe kommt im Ueberblick an;
 *   - Mitarbeitende (390 px, hell) erreichen den Steckbrief ueber die
 *     Belegung, sehen "Im Notfall" mit tel:-Link und KEINE Kostenstelle.
 *   Phase 2:
 *   - Kontakte vor Ort im Ueberblick unter Leitung & Team, Reiter mit Liste
 *     ohne Ueberlauf (1440 und 390 px), Anlegen und Loeschen per Dialog;
 *   - Vereinbarungen nur mit Recht: Leitung sieht Reiter, Frist-Hinweis und
 *     "genehmigt"; Mitarbeitende sehen weder Reiter noch Verguetung, aber
 *     Notdienste unter "Im Notfall".
 *
 * Voraussetzung: API + Dev-Server laufen, ein Traeger mit einem Standort,
 * dessen Kostenstelle gesetzt ist, und einem Mitarbeitenden-Konto, das nur
 * diesem Standort zugeordnet ist. Fuer Phase 2 am Standort: mindestens ein
 * Notdienst-/Krisendienst-Kontakt mit Telefon, eine Vereinbarung, die in
 * hoechstens 90 Tagen endet, und eine mit genehmigten Plaetzen.
 *
 * Nutzung: node scripts/standort-steckbrief-pruefung.mjs <slug> <leitungEmail> <mitarbeiterEmail> <passwort> <standortName> <kostenstelle> [bildordner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, leitungEmail, mitarbeiterEmail, passwort, standortName, kostenstelle, bildordner] = process.argv;
if (!slug || !leitungEmail || !mitarbeiterEmail || !passwort || !standortName || !kostenstelle) {
  console.error(
    "Nutzung: node scripts/standort-steckbrief-pruefung.mjs <slug> <leitungEmail> <mitarbeiterEmail> <passwort> <standortName> <kostenstelle> [bildordner]"
  );
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
// Ein Pruefskript, das nichts misst, muss fehlschlagen (CLAUDE.md).
const ERWARTETE_MESSUNGEN = 33;
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

// --- Leitung, breit, dunkel ------------------------------------------------
{
  const page = await anmelden(leitungEmail, { width: 1440, height: 1000 }, "dark");
  const liste = page.waitForResponse((r) => r.url().endsWith("/standorte/verwaltung"));
  await page.click('#zv-organisatorisch button:has-text("Standorte")');
  await liste;
  await page.waitForSelector(".zv-standorte-liste .zv-info-karte");

  pruefe(!(await ueberlauf(page)), "Liste 1440 px: kein waagerechter Überlauf");
  const zeile = page.locator(".zv-standorte-liste .zv-info-karte", { hasText: standortName });
  const leitung = (await zeile.locator('[data-label="Leitung"]').innerText()).trim();
  pruefe(leitung.length > 0 && leitung !== "keine Leitung im Organigramm", `Liste: Leitung aus dem Organigramm abgeleitet („${leitung}“)`);
  const fehlt = await page.locator(".zv-standorte-liste .zv-pill-frist").count();
  pruefe(fehlt > 0, `Liste: „Angaben fehlen“ an mindestens einem Standort (${fehlt})`);
  await bild(page, "umgesetzt-1-standortliste-dunkel");

  await zeile.click();
  await page.waitForSelector(".zv-steckbrief .zv-akte-kopf");
  const spalten = await page.$$eval(".zv-steckbrief .zv-ueberblick-haupt, .zv-steckbrief .zv-ueberblick-rand", (e) =>
    e.map((x) => Math.round(x.getBoundingClientRect().x))
  );
  pruefe(spalten.length === 2 && spalten[0] !== spalten[1], `Steckbrief 1440 px zweispaltig (x = ${spalten.join(", ")})`);
  const y = async (sel) => page.$eval(sel, (e) => e.getBoundingClientRect().y);
  pruefe(
    (await y(".zv-steckbrief-erreichbarkeit")) < (await y(".zv-steckbrief-leitung")) && (await y(".zv-steckbrief-blick")) < (await y(".zv-steckbrief-lage")),
    "Breit: Erreichbarkeit vor Leitung, Auf einen Blick vor Lage (Handy-Reihenfolge greift nicht)"
  );
  const text = await page.locator(".zv-steckbrief").innerText();
  pruefe(text.includes(kostenstelle), "Leitung sieht die Kostenstelle");
  pruefe(!(await page.locator(".zv-steckbrief-notfall").isVisible()), "„Im Notfall“ breit ausgeblendet (steht unter Erreichbarkeit)");
  const reiter = await page.$eval(".zv-steckbrief .zv-reiter", (e) => e.scrollWidth <= e.clientWidth);
  pruefe(reiter, "Reiterleiste ohne Überlauf");
  pruefe(!(await ueberlauf(page)), "Steckbrief 1440 px: kein waagerechter Überlauf");
  await bild(page, "umgesetzt-2-steckbrief-dunkel");

  // Angaben > Lage & Zugang: Codewarnung
  await page.click('.zv-steckbrief [role="tab"]:has-text("Angaben")');
  await page.click('#steckbrief-gruppe-lage button:has-text("Bearbeiten")');
  await page.waitForSelector("#standort-zugang");
  const vorher = await page.locator(".zv-angaben-formular .zv-hinweis-fehler").count();
  await page.fill("#standort-zugang", "Schlüssel im Kasten Büro EG. Code 4711");
  const nachher = await page.locator(".zv-angaben-formular .zv-hinweis-fehler").count();
  pruefe(vorher === 0 && nachher === 1, `Codewarnung erscheint erst mit vier Ziffern (vorher ${vorher}, nachher ${nachher})`);
  // Der Dialog faehrt von rechts herein; vorher waere das Bild ein Zwischenstand.
  await page.waitForTimeout(500);
  const dialog = await page.$eval(".zv-modal", (m) => m.getBoundingClientRect().right <= window.innerWidth + 1);
  pruefe(dialog, "Bearbeiten-Dialog liegt ganz im Fenster");
  await bild(page, "umgesetzt-3-angaben-codewarnung-dunkel", false); // Dialog ist fixed: ganze Seite verschoebe ihn im Bild
  await page.fill("#standort-zugang", "Haupteingang mit Rampe; Schlüssel im Schlüsselkasten Büro EG.");
  const neuerOepnv = `Linie 3, Haltestelle Lindenplatz (${Date.now() % 10} Min.)`;
  await page.fill("#standort-oepnv", neuerOepnv);
  const gespeichert = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/standorte/"));
  await page.click('.zv-angaben-formular button[type="submit"]');
  const antwort = await gespeichert;
  pruefe(antwort.status() === 200, `Speichern Lage & Zugang: HTTP ${antwort.status()}`);
  await page.waitForSelector(".zv-angaben-formular", { state: "detached" });
  await page.click('.zv-steckbrief [role="tab"]:has-text("Überblick")');
  pruefe((await page.locator(".zv-steckbrief-lage").innerText()).includes(neuerOepnv), "Geänderte ÖPNV-Angabe steht im Überblick");

  // --- Phase 2: Kontakte vor Ort und Vereinbarungen (Leitung) ---
  const blick = await page.locator(".zv-steckbrief-blick").innerText();
  pruefe(/\d+ genehmigt/.test(blick), "Auf einen Blick: genehmigte Plätze aus der Vereinbarung");
  const achtung = await page.locator(".zv-steckbrief-achtung").innerText();
  pruefe(/endet in \d+ Tagen/.test(achtung), "Braucht Aufmerksamkeit: Vereinbarung endet bald");
  const kurz = page.locator(".zv-steckbrief-kontakte-kurz");
  const kurzAnzahl = await kurz.locator("dl > div").count();
  pruefe(kurzAnzahl >= 1 && (await y(".zv-steckbrief-leitung")) < (await y(".zv-steckbrief-kontakte-kurz")), `Überblick: ${kurzAnzahl} Kontakte vor Ort unter Leitung & Team`);
  await bild(page, "phase2-1-ueberblick-dunkel");

  await page.click('.zv-steckbrief [role="tab"]:has-text("Kontakte vor Ort")');
  await page.waitForSelector(".zv-steckbrief-kontakte .zv-info-karte");
  const kontakteVorher = await page.locator(".zv-steckbrief-kontakte .zv-info-karte").count();
  pruefe(!(await ueberlauf(page)), "Kontakte 1440 px: kein waagerechter Überlauf");
  await page.click('.zv-steckbrief-anhang button:has-text("Neuer Kontakt")');
  await page.selectOption("#kontakt-rolle", "apotheke");
  const apotheke = `Prüf-Apotheke ${Date.now() % 1000}`;
  await page.fill("#kontakt-name", apotheke);
  await page.fill("#kontakt-telefon", "0123 777");
  const kontaktGespeichert = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/kontakte"));
  await page.click('.zv-modal button[type="submit"]');
  pruefe((await kontaktGespeichert).status() === 201, "Kontakt anlegen: HTTP 201");
  await page.waitForSelector(`.zv-steckbrief-kontakte .zv-info-karte:has-text("${apotheke}")`);
  pruefe((await page.locator(".zv-steckbrief-kontakte .zv-info-karte").count()) === kontakteVorher + 1, "Neuer Kontakt steht in der Liste");
  await bild(page, "phase2-2-kontakte-dunkel");
  // Wieder entfernen, damit wiederholte Laeufe die Liste nicht fuellen.
  await page.locator(`.zv-steckbrief-kontakte .zv-info-karte:has-text("${apotheke}") .zv-liste-zelle-aktionen button`).click();
  await page.click('[role="menuitem"]:has-text("Löschen")');
  const geloescht = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/kontakte/"));
  await page.click('.zv-modal button:has-text("Jetzt löschen")');
  pruefe((await geloescht).status() === 204, "Kontakt löschen: HTTP 204");

  await page.click('.zv-steckbrief [role="tab"]:has-text("Vereinbarungen")');
  await page.waitForSelector(".zv-steckbrief-vereinbarungen .zv-info-karte");
  const vText = await page.locator(".zv-steckbrief-vereinbarungen").innerText();
  pruefe(/€ \/ Tag/.test(vText) && /Endet in \d+ Tagen/.test(vText), "Vereinbarungen: Vergütung und Frist sichtbar");
  pruefe(!(await ueberlauf(page)), "Vereinbarungen 1440 px: kein waagerechter Überlauf");
  await bild(page, "phase2-3-vereinbarungen-dunkel");
  await page.click('.zv-steckbrief-anhang button:has-text("Neue Vereinbarung")');
  await page.waitForTimeout(500);
  pruefe(await page.$eval(".zv-modal", (m) => m.getBoundingClientRect().right <= window.innerWidth + 1), "Dialog Neue Vereinbarung liegt ganz im Fenster");
  await page.click('.zv-modal button:has-text("Abbrechen")');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  pruefe(!(await ueberlauf(page)), "Vereinbarungen 390 px: kein waagerechter Überlauf");
  await bild(page, "phase2-4-vereinbarungen-handy-dunkel");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.click('.zv-steckbrief [role="tab"]:has-text("Überblick")');

  await page.setViewportSize({ width: 800, height: 1000 });
  await page.waitForTimeout(150);
  const schmal = await page.$$eval(".zv-steckbrief section", (e) => [...new Set(e.filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().x)))]);
  pruefe(schmal.length === 1, `Steckbrief 800 px einspaltig (x-Werte ${schmal.join(", ")})`);
  pruefe(!(await ueberlauf(page)), "Steckbrief 800 px: kein waagerechter Überlauf");

  await page.click(".zv-steckbrief-zurueck");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  pruefe(!(await ueberlauf(page)), "Liste 390 px: kein waagerechter Überlauf");
  await page.close();
}

// --- Mitarbeitende, Handy, hell ---------------------------------------------
{
  const page = await anmelden(mitarbeiterEmail, { width: 390, height: 844 }, "light");
  // Haus > Standorte (Belegung) ueber die Befehlspalette: am Handy liegt der
  // Punkt im "Mehr"-Panel, die Palette ist der stabile Weg.
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"] input');
  await page.keyboard.type("Belegung");
  await page.waitForSelector('[role="dialog"] :text("Standort wechseln")');
  await page.keyboard.press("Enter");
  await page.waitForSelector('button:has-text("Steckbrief")');
  await page.click('button:has-text("Steckbrief")');
  await page.waitForSelector(".zv-steckbrief .zv-akte-kopf");
  const notfall = page.locator(".zv-steckbrief-notfall");
  const tel = await notfall.locator('a[href^="tel:"]').count();
  pruefe((await notfall.isVisible()) && tel >= 1, `Handy: „Im Notfall“ oben mit ${tel} Anrufknopf/-knöpfen`);
  const notfallText = await notfall.innerText();
  pruefe(/Notdienst|Krisendienst|Polizei/.test(notfallText), "Handy: Notdienste aus den Kontakten unter „Im Notfall“");
  const text = await page.locator(".zv-steckbrief").innerText();
  pruefe(!text.includes(kostenstelle) && !text.includes("Kostenstelle"), "Mitarbeitende sehen keine Kostenstelle");
  pruefe((await page.locator('.zv-steckbrief [role="tab"]:has-text("Vereinbarungen")').count()) === 0, "Mitarbeitende: kein Reiter Vereinbarungen");
  pruefe(!/€|endet in/i.test(text) && /\d+ genehmigt/.test(text), "Mitarbeitende: keine Vergütung oder Frist, aber genehmigte Plätze");
  pruefe(!(await ueberlauf(page)), "Steckbrief 390 px: kein waagerechter Überlauf");
  await bild(page, "umgesetzt-4-handy-hell");
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
