/**
 * Schichtuebergabe (Phase C) im echten Browser, zwei Personen: Autor:in
 * schreibt und sendet, Kolleg:in bestaetigt, macht eine Aufgabe, ergaenzt
 * einen Nachtrag. Gegen laufende API + Dev-Server.
 *
 * Misst: Enter fuegt Punkte hinzu, der Entwurf ueberlebt Neuladen und
 * verschwindet beim Senden und beim Abmelden, Karte erscheint nur fuer
 * die anderen und nur bis "Gelesen", Aufgabe/Nachtrag, Offline-Zustand,
 * Zielgroessen >= 44px und kein Ueberlauf bei 390px.
 *
 * Aufruf (aus apps/web): node scripts/schichtuebergabe-pruefung.mjs <slug> <passwort> <autor-email> <kollegin-email>
 * Voraussetzung: Mandant mit Standort "Haus Eins", Klient:in "Anna Maria Beispiel"
 * in Zimmer 101 und zwei Konten mit gleichem Passwort und Uebergaberechten.
 */
import { chromium } from "playwright";

const [, , slug, passwort, autorEmail, kollegEmail] = process.argv;
if (!slug || !passwort || !autorEmail || !kollegEmail) {
  console.error("Nutzung: node schichtuebergabe-pruefung.mjs <slug> <passwort> <autor-email> <kollegin-email>");
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

async function anmelden(email, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto("http://localhost:5173/");
  await page.getByLabel(/Träger-Kennung/i).fill(slug);
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.getByRole("button", { name: /^Dashboard$/ }).first().waitFor();
  return { context, page };
}
async function zurUebergabe(page) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  await dialog.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.value === "");
  await page.keyboard.type("Schichtübergabe");
  await dialog.getByRole("option", { name: /Schichtübergabe/ }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Schichtübergabe", exact: true }).waitFor();
}
const entwurf = (page) => page.evaluate(() => localStorage.getItem("zv-schichtuebergabe-entwurf"));

try {
  // --- Autor:in schreibt ----------------------------------------------------
  const a = await anmelden(autorEmail);
  const pa = a.page;
  await zurUebergabe(pa);
  await pa.getByText("Noch keine Übergabe gesendet.").waitFor().catch(() => {});
pruefe((await pa.getByText("Noch keine Übergabe gesendet.").count()) === 1, "Leerzustand: noch keine Übergabe");

  const eingabe = pa.locator("#uebergabe-punkt");
  await eingabe.fill("Frau Beispiel hat das Abendessen ausgelassen");
  await pa.selectOption('select[aria-label="Bezug (optional)"]', { label: "Anna Maria Beispiel" });
  await eingabe.press("Enter");
  pruefe((await pa.locator(".zv-uebergabe-entwurf li").count()) === 1 && (await eingabe.inputValue()) === "", "Enter fügt den Punkt hinzu und leert das Feld");
  pruefe(await eingabe.evaluate((el) => el === document.activeElement), "Fokus bleibt im Eingabefeld (schnelle Folgeeingabe)");
  await pa.keyboard.type("Heizung in 101 tropft");
  await pa.keyboard.press("Enter");
  pruefe((await pa.locator(".zv-uebergabe-entwurf li").count()) === 2, "Zweiter Punkt per Enter");

  const gesichert = await entwurf(pa);
  pruefe(Boolean(gesichert) && gesichert.includes("Heizung"), "Entwurf liegt im localStorage");
  await pa.reload();
  await pa.getByRole("heading", { name: "Schichtübergabe", exact: true }).waitFor().catch(async () => {
    await zurUebergabe(pa);
  });
  await pa.locator(".zv-uebergabe-entwurf li").first().waitFor();
  pruefe((await pa.locator(".zv-uebergabe-entwurf li").count()) === 2, "Entwurf überlebt das Neuladen (2 Punkte)");

  await pa.getByRole("button", { name: /Übergabe senden \(2\)/ }).click();
  await pa.locator(".zv-uebergabe-karte").first().waitFor();
  pruefe((await entwurf(pa)) === null, "Nach dem Senden ist der Entwurf gelöscht");
  pruefe((await pa.locator(".zv-uebergabe-entwurf li").count()) === 0, "Entwurfsliste ist leer");
  pruefe((await pa.locator(".zv-uebergabe-karte").first().getByRole("button", { name: "Gelesen" }).count()) === 0, "Eigene Übergabe hat keinen 'Gelesen'-Knopf");
  const kartenText = (await pa.locator(".zv-uebergabe-karte").first().innerText()).replace(/\s+/g, " ");
  pruefe(/(Früh|Spät|Nacht)dienst · Haus Eins/.test(kartenText) && kartenText.includes("Anna Maria Beispiel") && kartenText.includes("Heizung in 101 tropft"), `Verlauf zeigt die Übergabe mit Dienst, Standort, Punkten: ${kartenText.slice(0, 80)}`);

  await pa.keyboard.press("Control+k");
  await pa.getByRole("dialog", { name: "Befehlspalette" }).waitFor();
  await pa.keyboard.press("Escape");
  await pa.getByRole("button", { name: /^Dashboard$/ }).first().click();
  await pa.waitForTimeout(800);
  pruefe((await pa.locator('section[aria-label="Ungelesene Schichtübergaben"]').count()) === 0, "Autor:in sieht die eigene Übergabe nicht als ungelesen auf dem Dashboard");

  // Abmelden loescht einen angefangenen Entwurf
  await zurUebergabe(pa);
  await pa.locator("#uebergabe-punkt").fill("noch nicht gesendet");
  await pa.keyboard.press("Enter");
  pruefe(Boolean(await entwurf(pa)), "Neuer Entwurf wird gesichert");
  await pa.getByRole("button", { name: /Abmelden/ }).first().click();
  await pa.getByLabel(/Träger-Kennung/i).waitFor();
  pruefe((await entwurf(pa)) === null, "Abmelden löscht den Entwurf");
  await a.context.close();

  // --- Kolleg:in liest ------------------------------------------------------
  const k = await anmelden(kollegEmail);
  const pk = k.page;
  const karte = pk.locator('section[aria-label="Ungelesene Schichtübergaben"] .zv-uebergabe-karte');
  await karte.first().waitFor();
  pruefe((await karte.count()) === 1 && (await karte.first().innerText()).includes("Heizung in 101 tropft"), "Dashboard-Karte zeigt die ungelesene Übergabe mit Punkten");
  await karte.getByRole("button", { name: "Gelesen" }).click();
  await karte.first().waitFor({ state: "detached" });
  pruefe(true, "'Gelesen' lässt die Karte verschwinden");
  await pk.reload();
  await pk.getByRole("button", { name: /^Dashboard$/ }).first().waitFor();
  await pk.waitForTimeout(800);
  pruefe((await pk.locator('section[aria-label="Ungelesene Schichtübergaben"]').count()) === 0, "... auch nach Neuladen (serverseitig gespeichert)");

  await zurUebergabe(pk);
  const verlaufKarte = pk.locator(".zv-uebergabe-karte").first();
  await verlaufKarte.waitFor();
  pruefe((await verlaufKarte.getByRole("button", { name: "Gelesen" }).count()) === 0, "Nach Bestätigung kein 'Gelesen'-Knopf mehr");
  await verlaufKarte.getByRole("button", { name: "Als Aufgabe anlegen" }).first().click();
  await verlaufKarte.getByText(/Aufgabe: /).first().waitFor();
  pruefe((await verlaufKarte.getByText(/Aufgabe: /).count()) === 1 && (await verlaufKarte.getByRole("button", { name: "Als Aufgabe anlegen" }).count()) === 1, "Aufgabe aus Punkt: Verweis bleibt sichtbar, Knopf nur noch beim anderen Punkt");

  await verlaufKarte.getByLabel(/Nachtrag \(neuer Punkt/).fill("Hausmeister ist informiert");
  await verlaufKarte.getByRole("button", { name: "Nachtrag hinzufügen" }).click();
  await verlaufKarte.getByText("Hausmeister ist informiert").waitFor();
  pruefe((await verlaufKarte.locator(".zv-pill", { hasText: "Nachtrag" }).count()) === 1 && (await verlaufKarte.locator(".zv-uebergabe-punkte li").count()) === 3, "Nachtrag erscheint als dritter Punkt mit Kennzeichnung");

  // --- Zielgroessen, Offline, Mobil -----------------------------------------
  const zuKlein = await pk.evaluate(() =>
    [...document.querySelectorAll("#uebergabe-neu ~ *, #uebergabe-neu, .zv-uebergabe-karte button, .zv-uebergabe-karte input, section button, section input, section select")]
      .filter((el) => ["BUTTON", "INPUT", "SELECT"].includes(el.tagName) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height < 44)
      .map((el) => `${el.textContent?.trim() || el.getAttribute("aria-label")} ${Math.round(el.getBoundingClientRect().height)}px`)
  );
  pruefe(zuKlein.length === 0, `Knöpfe/Felder der Übergabe >= 44px hoch${zuKlein.length ? " -- zu klein: " + zuKlein.join(", ") : ""}`);

  await pk.locator("#uebergabe-punkt").fill("Offline-Test");
  await pk.keyboard.press("Enter");
  await k.context.setOffline(true);
  await pk.getByText(/Offline – der Entwurf bleibt auf diesem Gerät/).waitFor();
  pruefe(await pk.getByRole("button", { name: /Übergabe senden/ }).isDisabled(), "Offline: Senden gesperrt, Hinweis sichtbar");
  await k.context.setOffline(false);

  await pk.setViewportSize({ width: 390, height: 800 });
  await pk.waitForTimeout(300);
  const ueberlauf = await pk.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  pruefe(!ueberlauf, "390px: kein horizontaler Überlauf");
  await k.context.close();
} finally {
  await browser.close();
}
if (messungen < 20) {
  console.error(`Zu wenige Messungen (${messungen}) -- die Prüfung hat nicht gemessen, was sie sollte.`);
  process.exit(1);
}
if (fehler.length) {
  console.error(`\n${fehler.length} von ${messungen} Prüfungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Prüfungen bestanden.`);
