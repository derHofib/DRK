// Einmaliges, manuelles Pruefskript fuer Passwort-aendern + den
// Leitung-stoesst-Reset-an-Link-Fluss. Nicht Teil der CI.
import { chromium } from "playwright";

const [, , slug, leitungEmail, mitarbeiterEmail, passwort] = process.argv;
if (!slug || !leitungEmail || !mitarbeiterEmail || !passwort) {
  console.error("Nutzung: node passwort-verwaltung-pruefung.mjs <slug> <leitungEmail> <mitarbeiterEmail> <passwort>");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fehler = [];

function pruefe(bedingung, beschreibung) {
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function login(page, email, pw) {
  await page.goto("http://localhost:5173/");
  await page.getByLabel(/Träger-Kennung/i).fill(slug);
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.locator("#passwort").fill(pw);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.waitForTimeout(1200);
}

// --- Flow 1: Passwort selbst aendern (Einstellungen/Sicherheit) -----------
const seite1 = await browser.newPage();
await login(seite1, leitungEmail, passwort);
const loginFehler1 = await seite1.locator(".zv-hinweis-fehler").first().textContent().catch(() => null);
if (loginFehler1) {
  console.error("Login fehlgeschlagen:", loginFehler1);
  process.exit(1);
}

await seite1.getByRole("button", { name: /^Einstellungen$/ }).first().click();
await seite1.waitForTimeout(400);
await seite1.getByRole("button", { name: /^Sicherheit$/ }).click();
await seite1.waitForTimeout(400);

const neuesPasswort = "ein per ui gewaehltes neues passwort";
await seite1.locator('input[name="aktuellesPasswort"]').fill(passwort);
await seite1.locator('input[name="neuesPasswort"]').fill(neuesPasswort);
await seite1.getByRole("button", { name: /^Passwort ändern$/ }).click();
await seite1.waitForTimeout(600);
const erfolgText = await seite1.locator(".zv-hinweis-erfolg").first().textContent().catch(() => null);
pruefe(erfolgText?.includes("geändert") ?? false, "Erfolgsmeldung nach Passwort-Aendern sichtbar");

// Ausloggen und mit dem NEUEN Passwort erneut einloggen -- Ende-zu-Ende-Beweis
await seite1.getByRole("button", { name: /Abmelden/i }).first().click();
await seite1.waitForTimeout(500);
await login(seite1, leitungEmail, neuesPasswort);
const nachAendernEingeloggt = await seite1.getByRole("button", { name: /^Zimmer$/ }).first().isVisible().catch(() => false);
pruefe(nachAendernEingeloggt, "Login mit dem per UI geaenderten Passwort funktioniert");
await seite1.close();

// --- Flow 2: Leitung stoesst Reset an, sieht nur einen Link ---------------
const seite2 = await browser.newPage();
await login(seite2, leitungEmail, neuesPasswort);
await seite2.getByRole("button", { name: /^Mitarbeitende$/ }).first().click();
await seite2.waitForTimeout(500);

const zeile = seite2.locator(".zv-info-karte", { hasText: "Ausgesperrte Person" });
await zeile.getByRole("button", { name: /Passwort zurücksetzen/i }).click();
await seite2.waitForTimeout(600);

const modalText = await seite2.locator(".zv-modal").first().innerText();
pruefe(modalText.includes("einmal einlösbar"), "Reset-Modal warnt vor Einmaligkeit");
pruefe(!modalText.includes(passwort) && !/passwort:\s*\S+/i.test(modalText), "Reset-Modal enthaelt kein Klartext-Passwort");

const linkWert = await seite2.locator("#reset-link-feld").inputValue();
pruefe(linkWert.includes("?reset="), "Reset-Link enthaelt den erwarteten Query-Parameter");
const resetToken = new URL(linkWert).searchParams.get("reset");
pruefe(typeof resetToken === "string" && resetToken.length >= 32, "Reset-Token wurde erfolgreich ausgelesen");
await seite2.close();

// --- Flow 3: Link oeffnen (nicht eingeloggt) + eigenes Passwort setzen ----
const seite3 = await browser.newPage();
await seite3.goto(`http://localhost:5173/?reset=${resetToken}`);
await seite3.waitForTimeout(500);
const zeigtResetFormular = await seite3.getByText("Neues Passwort festlegen").isVisible().catch(() => false);
pruefe(zeigtResetFormular, "Reset-Link zeigt das Formular OHNE vorherigen Login");

const selbstGewaehltesPasswort = "von der ausgesperrten person selbst gewaehlt";
await seite3.locator("#neuesPasswort").fill(selbstGewaehltesPasswort);
await seite3.locator("#wiederholung").fill(selbstGewaehltesPasswort);
await seite3.getByRole("button", { name: /Passwort festlegen/i }).click();
await seite3.waitForTimeout(600);
const erledigtText = await seite3.getByText(/wurde geändert/i).isVisible().catch(() => false);
pruefe(erledigtText, "Nach dem Einloesen erscheint die Erfolgsmeldung");

await seite3.getByRole("button", { name: /Zur Anmeldung/i }).click();
await seite3.waitForTimeout(800);
await login(seite3, mitarbeiterEmail, selbstGewaehltesPasswort);
const eingeloggtNachReset = await seite3.getByRole("button", { name: /^Zimmer$/ }).first().isVisible().catch(() => false);
pruefe(eingeloggtNachReset, "Login mit dem SELBST gewaehlten neuen Passwort funktioniert");

// Der Link darf jetzt nicht mehr funktionieren (bereits eingeloest)
const seite4 = await browser.newPage();
await seite4.goto(`http://localhost:5173/?reset=${resetToken}`);
await seite4.locator("#neuesPasswort").fill("noch ein versuch");
await seite4.locator("#wiederholung").fill("noch ein versuch");
await seite4.getByRole("button", { name: /Passwort festlegen/i }).click();
await seite4.waitForTimeout(600);
const zweiteEinloesungFehler = await seite4.locator(".zv-hinweis-fehler").first().isVisible().catch(() => false);
pruefe(zweiteEinloesungFehler, "Wiederverwendung desselben Links wird abgelehnt");
await seite4.close();

console.log("\n" + (fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} PRUEFUNG(EN) FEHLGESCHLAGEN:`));
fehler.forEach((f) => console.log(" - " + f));

await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
