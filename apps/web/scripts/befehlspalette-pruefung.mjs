/**
 * Befehlspalette (Phase B) im echten Browser, ausschliesslich per Tastatur
 * bedient (Login ausgenommen). Gegen laufende API + Dev-Server.
 *
 * Misst: Oeffnen mit "/" und Strg+K, "/" im Eingabefeld oeffnet NICHT, Esc
 * schliesst und gibt den Fokus zurueck, Pfeiltasten/Enter, Entprellen (wenige
 * Anfragen bei schnellem Tippen), Mindestlaenge 2 (keine Anfrage bei 1
 * Zeichen), KEIN Vorladen der Klientenliste, Belege per KB-Nummer, Navigation,
 * Aktion, Standortwechsel, "Zuletzt geoeffnet" (nur IDs in localStorage),
 * Offline-Zustand, Zielgroessen >= 44px und kein Ueberlauf bei 390px.
 *
 * Aufruf (aus apps/web): node scripts/befehlspalette-pruefung.mjs <slug> <email> <passwort>
 * Voraussetzung: Mandant mit Klient:in "Anna Maria Beispiel" in Zimmer 101 / "Haus Eins"
 * und mindestens einer Buchung (KB-00001).
 */
import { chromium } from "playwright";

const [, , slug, email, passwort] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node befehlspalette-pruefung.mjs <slug> <email> <passwort>");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

const anfragen = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/api/")) anfragen.push(u.pathname + u.search);
});
const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
const eingabe = page.getByRole("combobox", { name: /Suchen oder Befehl/ });
const optionen = () => dialog.getByRole("option");

await page.goto("http://localhost:5173/");
await page.getByLabel(/Träger-Kennung/i).fill(slug);
await page.getByLabel(/E-Mail/i).fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.getByRole("button", { name: /^Dashboard$/ }).first().waitFor();
await page.waitForTimeout(800);

// --- Oeffnen / Schliessen / Fokus ------------------------------------------
await page.getByRole("button", { name: /^Kassenbuch$/ }).first().focus();
await page.keyboard.press("/");
await dialog.waitFor();
pruefe(await eingabe.evaluate((el) => el === document.activeElement), "'/' oeffnet die Palette, Fokus liegt im Suchfeld");
await page.keyboard.press("Escape");
await dialog.waitFor({ state: "hidden" });
pruefe(await page.evaluate(() => document.activeElement?.textContent?.includes("Kassenbuch")), "Esc schliesst; Fokus kehrt zum vorherigen Element zurueck");
await page.keyboard.press("Control+k");
await dialog.waitFor();
pruefe(true, "Strg+K oeffnet die Palette");
await page.keyboard.type("/");
pruefe((await eingabe.inputValue()) === "/" && (await dialog.isVisible()), "'/' im Suchfeld ist ein Zeichen und schaltet nichts um");
await page.keyboard.press("Escape");

// Eingabefeld ausserhalb: "/" tippt, oeffnet nicht
await page.getByRole("button", { name: /^Kassenbuch$/ }).first().click();
await page.getByRole("button", { name: "Neue Buchung" }).click();
await page.locator("input[name=verwendungszweck]").focus();
await page.keyboard.type("a/b");
pruefe((await page.locator("input[name=verwendungszweck]").inputValue()) === "a/b" && !(await dialog.isVisible()), "'/' in einem Eingabefeld oeffnet die Palette nicht");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Schließen" }).first().click().catch(() => {});

// --- Kein Vorladen, Mindestlaenge, Entprellen ------------------------------
await page.getByRole("button", { name: /^Dashboard$/ }).first().click();
await page.waitForTimeout(500);
anfragen.length = 0;
await page.keyboard.press("Control+k");
await dialog.waitFor();
await page.waitForTimeout(400);
pruefe(!anfragen.some((a) => a.startsWith("/api/klienten") || a.startsWith("/api/zimmer") || a.startsWith("/api/benutzer")), `Oeffnen laedt keine Klienten-/Zimmer-/Benutzerlisten vor (Anfragen: ${anfragen.join(", ") || "keine"})`);
pruefe((await dialog.getByText("Navigation", { exact: true }).count()) > 0 && (await dialog.getByText("Aktionen", { exact: true }).count()) > 0, "Leerzustand zeigt Navigation und Aktionen als Vorschlaege");
anfragen.length = 0;
await page.keyboard.type("B");
await page.waitForTimeout(400);
pruefe(!anfragen.some((a) => a.startsWith("/api/suche?")), "1 Zeichen: keine Serveranfrage");
await page.keyboard.press("Backspace");
anfragen.length = 0;
await page.keyboard.type("Beispiel", { delay: 30 });
await optionen().filter({ hasText: "Beispiel" }).first().waitFor();
const sucheAnfragen = anfragen.filter((a) => a.startsWith("/api/suche?"));
pruefe(sucheAnfragen.length >= 1 && sucheAnfragen.length <= 2, `Schnelles Tippen (8 Zeichen) erzeugt ${sucheAnfragen.length} Suchanfrage(n) statt 7 (Entprellen)`);
pruefe((await dialog.getByRole("group", { name: "Klient:innen" }).count()) === 1, "Gruppe 'Klient:innen' vorhanden");
pruefe((await dialog.locator("mark").first().textContent())?.toLowerCase() === "beispiel", "Suchbegriff ist hervorgehoben (<mark>)");

// --- Pfeiltasten + Enter ----------------------------------------------------
const ersteId = await eingabe.getAttribute("aria-activedescendant");
await page.keyboard.press("ArrowDown");
const zweiteId = await eingabe.getAttribute("aria-activedescendant");
await page.keyboard.press("ArrowUp");
pruefe(ersteId && zweiteId && ersteId !== zweiteId && (await eingabe.getAttribute("aria-activedescendant")) === ersteId, "Pfeiltasten bewegen die Auswahl (aria-activedescendant), ArrowUp kehrt zurueck");
pruefe((await page.locator(`#${ersteId}`).getAttribute("aria-selected")) === "true", "Aktive Option traegt aria-selected=true");
await page.keyboard.press("Enter");
await dialog.waitFor({ state: "hidden" });
await page.getByText("Beispiel").first().waitFor();
pruefe((await page.locator(".zv-seiten-kopf h2").first().textContent())?.includes("Klient"), "Enter auf Klient:in oeffnet die Klienten-Seite");
pruefe((await page.getByRole("heading", { name: /Anna Maria Beispiel/ }).count()) > 0 || (await page.locator(".zv-seitenpanel, [class*=seitenpanel]").count()) > 0, "... und die Akte der gewaehlten Person");

// --- Zuletzt geoeffnet: nur IDs --------------------------------------------
const gespeichert = await page.evaluate(() => localStorage.getItem("zv-palette-zuletzt"));
pruefe(Boolean(gespeichert) && !/Beispiel|Anna/.test(gespeichert), `localStorage enthaelt nur IDs, keine Namen: ${gespeichert?.slice(0, 60)}`);
await page.keyboard.press("Escape").catch(() => {});
await page.keyboard.press("Control+k");
await dialog.waitFor();
await dialog.getByRole("group", { name: "Zuletzt geöffnet" }).waitFor();
pruefe((await dialog.getByRole("group", { name: "Zuletzt geöffnet" }).innerText()).includes("Beispiel"), "'Zuletzt geöffnet' zeigt die Person (Name frisch vom Server)");
await page.keyboard.press("Escape");

// --- Belege, Zimmer, Navigation, Aktion, Standort --------------------------
await page.keyboard.press("Control+k");
await dialog.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.value === "");
await page.keyboard.type("KB-1");
await dialog.getByRole("group", { name: "Belege" }).waitFor();
pruefe((await dialog.getByRole("group", { name: "Belege" }).innerText()).includes("KB-00001"), "Belegnummer 'KB-1' findet KB-00001");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
pruefe((await page.locator(".zv-seiten-kopf h2").first().textContent())?.trim() === "Kassenbuch", "Enter auf Beleg oeffnet das Kassenbuch");

await page.keyboard.press("Control+k");
await dialog.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.value === "");
await page.keyboard.type("101");
await dialog.getByRole("group", { name: "Zimmer" }).waitFor();
pruefe(true, "Zimmernummer '101' findet Zimmer");
await page.keyboard.press("Control+a");
await page.keyboard.type("Haus Eins");
await dialog.getByText("Standort: Haus Eins").waitFor();
await page.keyboard.press("ArrowDown");
pruefe((await dialog.getByText("Standort wechseln").count()) > 0, "Standortwechsel ist ueber die Palette erreichbar");
await page.keyboard.press("Escape");

await page.keyboard.press("Control+k");
await dialog.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.value === "");
await page.keyboard.type("hzl");
await dialog.getByRole("option", { name: /HZL/ }).first().waitFor();
await page.keyboard.press("Enter");
await page.getByRole("heading", { name: "HZL", exact: true }).waitFor();
pruefe(true, "Navigation: 'hzl' + Enter oeffnet HZL");

await page.keyboard.press("Control+k");
await dialog.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.value === "");
await page.keyboard.type("Neue Buchung");
await dialog.getByRole("option", { name: /Neue Buchung/ }).first().waitFor();
await page.keyboard.press("Enter");
await page.getByRole("dialog", { name: /Neue Buchung/ }).waitFor();
pruefe(true, "Aktion 'Neue Buchung' oeffnet das Buchungsformular");
await page.keyboard.press("Escape");

await page.keyboard.press("Control+k");
await dialog.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.value === "");
await page.keyboard.type("Beispiel");
await dialog.getByText("Tagesbericht für Anna Maria Beispiel schreiben").waitFor();
await page.getByText("Tagesbericht für Anna Maria Beispiel schreiben").click();
await page.getByRole("dialog").getByText("Anna Maria Beispiel").first().waitFor({ timeout: 5000 }).catch(() => {});
pruefe((await page.locator("select[name=klientId]").inputValue()) !== "", "Aktion 'Tagesbericht für … schreiben' oeffnet das Formular mit vorgewaehlter Person");
await page.keyboard.press("Escape");

// --- Leer, Zielgroessen, Offline -------------------------------------------
await page.keyboard.press("Control+k");
await dialog.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox" && document.activeElement.value === "");
await page.keyboard.type("qqqzzz");
await dialog.getByText(/Nichts gefunden für/).first().waitFor();
pruefe(true, "Leerzustand 'Nichts gefunden' mit Hinweis");
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
const klein = await page.evaluate(() => [...document.querySelectorAll(".zv-palette [role=option]")].filter((o) => o.getBoundingClientRect().height < 44).length);
pruefe(klein === 0, "Alle Optionen >= 44px hoch");
await context.setOffline(true);
await page.keyboard.type("Beispiel");
await dialog.getByText(/Offline/).first().waitFor();
pruefe((await dialog.getByRole("group", { name: "Klient:innen" }).count()) === 0, "Offline: keine Serverergebnisse, Hinweis sichtbar");
await context.setOffline(false);
await page.keyboard.press("Escape");

await page.setViewportSize({ width: 390, height: 800 });
await page.keyboard.press("Control+k");
await dialog.waitFor();
const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
pruefe(!ueberlauf, "390px: kein horizontaler Ueberlauf");
await page.keyboard.press("Escape");

await browser.close();
if (messungen < 25) {
  console.error(`Zu wenige Messungen (${messungen}) -- die Pruefung hat nicht gemessen, was sie sollte.`);
  process.exit(1);
}
if (fehler.length) {
  console.error(`\n${fehler.length} von ${messungen} Pruefungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Pruefungen bestanden.`);
