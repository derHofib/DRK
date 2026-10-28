/**
 * Chat-Löschfrist (migrations/0061) im echten Browser, gegen laufende API +
 * Dev-Server.
 *
 * Misst: Hinweis auf die Frist steht im Chatverlauf und folgt einer
 * Änderung; die Einstellung unter Einstellungen → Sicherheit warnt vor dem
 * Verkürzen, speichert für die Leitung und lehnt für Betreuer:innen mit
 * Fehlermeldung ab; kein horizontaler Überlauf bei 320/768/1280 px in Hell
 * und Dunkel.
 *
 * Aufruf (aus apps/web): node scripts/chat-loeschfrist-pruefung.mjs <slug> <passwort> <leitung-email> <betreuer-email>
 * Voraussetzung: beide Konten mit gleichem Passwort, Leitung mit Vollzugriff,
 * ein Direktchat zwischen beiden mit mindestens einer Nachricht, Frist 90 Tage.
 */
import { chromium } from "playwright";

const [, , slug, passwort, leitungEmail, betreuerEmail] = process.argv;
if (!slug || !passwort || !leitungEmail || !betreuerEmail) {
  console.error("Nutzung: node chat-loeschfrist-pruefung.mjs <slug> <passwort> <leitung-email> <betreuer-email>");
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

async function anmelden(email, viewport = { width: 1280, height: 900 }, colorScheme = "light") {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto("http://localhost:5173/");
  await page.getByLabel(/Träger-Kennung/i).fill(slug);
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.getByRole("button", { name: /^Heute$/ }).first().waitFor();
  return { context, page };
}

async function reiter(page, name) {
  const knopf = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
  if (await knopf.isVisible()) {
    await knopf.click();
    return;
  }
  // Mobil: nicht jeder Reiter steht in der unteren Leiste.
  await page.getByRole("button", { name: /^Mehr/ }).first().click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
}

async function oeffneChat(page) {
  await reiter(page, "Nachrichten");
  await page.locator(".zv-chat-eintrag").first().click();
  await page.locator(".zv-chat-frist").waitFor();
}

async function zurFrist(page) {
  await reiter(page, "Einstellungen");
  await page.getByRole("button", { name: "Sicherheit" }).click();
  await page.getByRole("heading", { name: "Löschfrist für Chatnachrichten" }).waitFor();
}

const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

try {
  // --- Hinweis im Verlauf ------------------------------------------------------
  const b = await anmelden(betreuerEmail);
  await oeffneChat(b.page);
  pruefe((await b.page.locator(".zv-chat-frist").innerText()).includes("nach 90 Tagen"), "Verlauf nennt die Frist (90 Tage)");

  // --- Betreuer:in darf nicht ändern ---------------------------------------------
  await zurFrist(b.page);
  const feldB = b.page.locator("#chat-loeschfrist");
  pruefe((await feldB.inputValue()) === "90", "Feld zeigt den gespeicherten Wert 90");
  await feldB.fill("60");
  await b.page.getByRole("button", { name: "Speichern" }).last().click();
  await b.page.locator(".zv-einstellungen-abschnitt .zv-hinweis-fehler", { hasText: /Leitung/ }).waitFor();
  pruefe(true, "Betreuer:in bekommt beim Speichern eine Fehlermeldung (403)");
  await b.context.close();

  // --- Leitung ändert ----------------------------------------------------------
  const l = await anmelden(leitungEmail);
  await zurFrist(l.page);
  const feld = l.page.locator("#chat-loeschfrist");
  await feld.fill("3");
  pruefe((await l.page.getByRole("button", { name: "Speichern" }).last().isDisabled()) && (await l.page.getByText("Bitte zwischen 7 und 3650 Tagen.").count()) === 1, "3 Tage: Speichern gesperrt, Grenzen genannt");
  await feld.fill("30");
  pruefe((await l.page.getByText(/älter als 30 Tage sind, werden innerhalb der nächsten Stunde gelöscht/).count()) === 1, "Verkürzen zeigt die Warnung vor dem endgültigen Löschen");
  await l.page.getByRole("button", { name: "Speichern" }).last().click();
  await l.page.getByText("Löschfrist gespeichert: 30 Tage.").waitFor();
  pruefe(true, "Leitung speichert 30 Tage");
  await l.page.reload();
  await zurFrist(l.page);
  pruefe((await l.page.locator("#chat-loeschfrist").inputValue()) === "30", "Nach Neuladen steht 30 im Feld (serverseitig gespeichert)");
  await oeffneChat(l.page);
  pruefe((await l.page.locator(".zv-chat-frist").innerText()).includes("nach 30 Tagen"), "Verlauf folgt der neuen Frist");

  // zurück auf den Ausgangswert, damit die Prüfung wiederholbar ist
  await zurFrist(l.page);
  await l.page.locator("#chat-loeschfrist").fill("90");
  await l.page.getByRole("button", { name: "Speichern" }).last().click();
  await l.page.getByText("Löschfrist gespeichert: 90 Tage.").waitFor();
  await l.context.close();

  // --- Überlauf -----------------------------------------------------------------
  // Ein Login je Farbschema und dann nur die Breite ändern: sechs Logins
  // hintereinander laufen in die Raten-Schranke des Logins.
  for (const scheme of ["light", "dark"]) {
    const s = await anmelden(leitungEmail, { width: 1280, height: 800 }, scheme);
    for (const width of [320, 768, 1280]) {
      await s.page.setViewportSize({ width, height: 800 });
      await zurFrist(s.page);
      const ohneEinst = !(await ueberlauf(s.page));
      await oeffneChat(s.page);
      const ohneChat = !(await ueberlauf(s.page));
      pruefe(ohneEinst && ohneChat, `${width}px ${scheme}: kein horizontaler Überlauf (Einstellungen ${ohneEinst}, Chat ${ohneChat})`);
    }
    await s.context.close();
  }
} catch (err) {
  fehler.push(`Abbruch: ${err instanceof Error ? err.message : String(err)}`);
  console.log(`FAIL Abbruch: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await browser.close();
}

// Ein Prüfskript, das nichts misst, muss fehlschlagen (CLAUDE.md).
if (messungen < 14) fehler.push(`nur ${messungen} Messungen statt mindestens 14`);
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
process.exit(fehler.length === 0 ? 0 : 1);
