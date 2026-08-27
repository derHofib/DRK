// Einmaliges, manuelles Pruefskript fuer das Kassenbuch-Redesign (Seitenkopf,
// HZL-Box mit KW-Spanne, Auszahlungs-Spalte, Gesamtsaldo/Summe-Kacheln,
// Klient-Filter, Mitarbeiter-Spalte). Nicht Teil der CI.
import { chromium } from "playwright";

const [, , slug, email, passwort] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node kassenbuch-pruefung.mjs <slug> <email> <passwort>");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const fehler = [];

function pruefe(bedingung, beschreibung) {
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

await page.goto("http://localhost:5173/");
await page.getByLabel(/Träger-Kennung/i).fill(slug);
await page.getByLabel(/E-Mail/i).fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.waitForTimeout(1500);
const loginFehler = await page.locator(".zv-hinweis-fehler").first().textContent().catch(() => null);
if (loginFehler) {
  console.error("Login fehlgeschlagen:", loginFehler);
  await browser.close();
  process.exit(1);
}

await page.getByRole("button", { name: /^Kassenbuch$/ }).first().click();
await page.waitForTimeout(800);

// --- Seitenkopf -----------------------------------------------------------
const titel = await page.locator(".zv-seiten-kopf h2").first().textContent();
pruefe(titel?.trim() === "Kassenbuch", "Seitenkopf zeigt 'Kassenbuch' als Titel");
const untertitel = await page.getByText("Alle Buchungen aller Klienten").isVisible();
pruefe(untertitel, "Untertitel 'Alle Buchungen aller Klienten' sichtbar");

// --- HZL-Box: KW-Spanne + Subtitle -----------------------------------------
const kwOption = await page.locator('select[aria-label="Kalenderwoche"] option:checked').textContent();
console.log("Gewaehlte KW-Option:", kwOption);
pruefe(/^KW \d+ - \d{2}\.\d{2}\.-\d{2}\.\d{2}\.\d{4} \(aktuell\)$/.test(kwOption?.trim() ?? ""), "KW-Select zeigt Nummer + Datumsspanne + '(aktuell)'");

const ausgezahltText = await page.getByText(/wöchentlichen Klient\*innen für diese Woche ausgezahlt\./).textContent();
console.log("Ausgezahlt-Subtitle:", ausgezahltText);
pruefe(/^1 von 2 wöchentlichen/.test(ausgezahltText?.trim() ?? ""), "Subtitle zeigt korrektes Verhaeltnis (1 von 2)");

// --- Auszahlungs-Spalte -----------------------------------------------------
const auszahlungSpalte = await page.locator(".zv-liste-kopf span", { hasText: /^Auszahlung$/ }).count();
pruefe(auszahlungSpalte > 0, "Spaltenkopf 'Auszahlung' vorhanden");
const bezahltZeileText = await page.locator(".zv-info-karte", { hasText: "Sophie Bergmann" }).first().innerText();
console.log("Sophie-Bergmann-Zeile:", bezahltZeileText.replace(/\n/g, " | "));
pruefe(/-20,00\s?€ am \d{2}\.\d{2}\.\d{4}/.test(bezahltZeileText), "Bezahlte Zeile zeigt Betrag + Datum der Auszahlung");
const offenZeileText = await page.locator(".zv-info-karte", { hasText: "Hannah Schulz" }).first().innerText();
pruefe(offenZeileText.includes("Jetzt auszahlen"), "Offene Zeile zeigt weiterhin den 'Jetzt auszahlen'-Knopf");

// --- Stat-Kacheln ------------------------------------------------------------
const kacheln = await page.locator(".zv-stat-karte").allTextContents();
console.log("Stat-Kacheln:", kacheln);
pruefe(kacheln.some((k) => k.includes("Gesamtsaldo alle Klienten")), "Kachel 'Gesamtsaldo alle Klienten' vorhanden");
pruefe(kacheln.some((k) => k.includes("Summe (Filter)")), "Kachel 'Summe (Filter)' vorhanden");
// -20 (HZL) + 50 (Einzahlung) - 15 (Sonstiges) = +15,00 EUR
pruefe(kacheln.some((k) => k.includes("15,00")), "Gesamtsaldo-Kachel zeigt erwarteten Betrag (15,00 €)");
pruefe(kacheln.some((k) => k.includes("3 Buchungen gesamt")), "Gesamtsaldo-Kachel zeigt korrekte Buchungsanzahl (3)");

// --- Klient-Filter -----------------------------------------------------------
await page.getByLabel("Nach Klient filtern").selectOption({ label: "Sophie Bergmann" });
await page.waitForTimeout(400);
const kachelnGefiltert = await page.locator(".zv-stat-karte").allTextContents();
console.log("Stat-Kacheln nach Filter:", kachelnGefiltert);
pruefe(kachelnGefiltert.some((k) => k.includes("Summe (Filter)") && k.includes("2 Buchungen")), "Summe (Filter) zeigt nach Klient-Filter nur 2 Buchungen (Sophie Bergmann)");
// Scoped auf die Buchungsliste (erkennbar an der Mitarbeiter-Spalte) --
// .zv-liste-zelle-titel existiert auch in der unabhaengigen HZL-Box, die
// vom Klient-Filter bewusst NICHT betroffen ist.
const buchungsListe = page.locator(".zv-karten-liste", { has: page.locator(".zv-liste-kopf span", { hasText: /^Mitarbeiter$/ }) });
const zeilenNachFilter = await buchungsListe.locator(".zv-liste-zelle-titel").allTextContents();
pruefe(zeilenNachFilter.every((t) => t === "Sophie Bergmann"), "Buchungsliste zeigt nach Filter nur Zeilen von Sophie Bergmann");
await page.getByLabel("Nach Klient filtern").selectOption({ label: "Alle Klienten" });
await page.waitForTimeout(400);

// --- Mitarbeiter-Spalte -------------------------------------------------------
const mitarbeiterSpalte = await page.locator(".zv-liste-kopf span", { hasText: /^Mitarbeiter$/ }).count();
pruefe(mitarbeiterSpalte > 0, "Spaltenkopf 'Mitarbeiter' vorhanden");
const mitarbeiterWerte = await page.locator('.zv-liste-zelle[data-label="Mitarbeiter"]').allTextContents();
console.log("Mitarbeiter-Werte:", mitarbeiterWerte);
pruefe(mitarbeiterWerte.every((w) => w.trim() === "Julia Herrmann"), "Mitarbeiter-Spalte zeigt den Namen der buchenden Person");

// --- Datumformat (DD.MM.YYYY statt ISO) --------------------------------------
const datumZellen = await page.locator('.zv-liste-zelle[data-label="Datum"]').allTextContents();
console.log("Datum-Zellen:", datumZellen);
pruefe(datumZellen.every((d) => /^\d{2}\.\d{2}\.\d{4}$/.test(d.trim())), "Datum-Spalte zeigt TT.MM.JJJJ statt ISO-Format");

console.log("\n" + (fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} PRUEFUNG(EN) FEHLGESCHLAGEN:`));
fehler.forEach((f) => console.log(" - " + f));

await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
