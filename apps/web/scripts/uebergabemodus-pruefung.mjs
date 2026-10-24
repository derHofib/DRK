/**
 * Pruefung des HZL-Uebergabemodus (Phase A) im echten Browser, gegen laufende
 * API + Dev-Server. Nicht Teil der CI.
 *
 * Misst, statt zu behaupten:
 *   - in KEINEM Schritt gibt es Navigationselemente im DOM (nicht nur
 *     versteckt: nav, Sidebar, Tabbar kommen gar nicht vor),
 *   - auf der Klient:innen-Seite stehen nur Kurzname, Betrag, KW, Erklaerung,
 *     Unterschriftsfeld und die zwei Knoepfe -- keine anderen Namen/Salden,
 *   - Verlassen (Abbrechen, Unterschreiben) fuehrt IMMER ueber die
 *     Passwortabfrage; Zurueck-Taste und Neuladen fuehren nicht heraus,
 *   - Sammelmodus: naechste Person, Ueberspringen, Uebersicht,
 *   - alle Knoepfe >= 44 px, kein horizontaler Ueberlauf (Tablet hoch/quer).
 *
 * Aufruf (aus apps/web): node scripts/uebergabemodus-pruefung.mjs <slug> <email> <passwort>
 * Voraussetzung: Mandant mit mind. 3 Klient:innen (woechentlicher HZL-Rhythmus,
 * Barbetrag > 20 EUR) und Konto mit Buchungsrecht; das Passwort wird auch
 * fuer die Bestaetigung benutzt.
 */
import { chromium } from "playwright";

const [, , slug, email, passwort] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node uebergabemodus-pruefung.mjs <slug> <email> <passwort>");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

const NAV = "nav, .zv-sidebar, .zv-tabbar-app, [role=navigation], .zv-sidebar-nav";
const keineNav = async (wo) => pruefe((await page.locator(NAV).count()) === 0, `${wo}: keine Navigationselemente im DOM`);
const modus = page.getByRole("main", { name: "Übergabemodus HZL" });

async function zielgroessen(wo) {
  const kleine = await page.evaluate(() =>
    [...document.querySelectorAll(".zv-uebergabe button, .zv-uebergabe input")]
      .map((el) => ({ t: el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
      .map((x) => `${x.t} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`)
  );
  pruefe(kleine.length === 0, `${wo}: alle Knoepfe/Felder >= 44px${kleine.length ? " -- zu klein: " + kleine.join(", ") : ""}`);
  const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  pruefe(!ueberlauf, `${wo}: kein horizontaler Ueberlauf`);
}

async function unterschreiben() {
  const box = await page.locator("canvas.zv-signature-canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
}

await page.goto("http://localhost:5173/");
await page.getByLabel(/Träger-Kennung/i).fill(slug);
await page.getByLabel(/E-Mail/i).fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /^HZL$/ }).first().click();
await page.waitForTimeout(800);
pruefe((await page.locator(".zv-sidebar, .zv-tabbar-app").count()) > 0, "Vorbedingung: in der normalen App ist die Navigation vorhanden");

// --- Sammelmodus starten ---------------------------------------------------
await page.getByRole("button", { name: "Alle offenen nacheinander" }).click();
await modus.waitFor();
await keineNav("Vorbereitung");
await zielgroessen("Vorbereitung (768x1024)");

const erstesName = (await page.locator(".zv-uebergabe h1").first().textContent())?.trim();
pruefe(Boolean(erstesName), `Vorbereitung zeigt die erste Person (${erstesName})`);

// --- Klient:innen-Seite ----------------------------------------------------
await page.locator(".zv-uebergabe-feld input").fill("20,00");
await page.getByRole("button", { name: /Gerät übergeben/ }).click();
await page.locator("canvas.zv-signature-canvas").waitFor();
await keineNav("Unterschrift");
const sichtbar = (await modus.innerText()).replace(/\s+/g, " ");
pruefe(/^\S+( \S+)? \S\. /.test(sichtbar) || /\b\p{L}+ \p{L}\.\s/u.test(sichtbar), `Unterschrift zeigt Kurzname (Vorname + Initial): "${sichtbar.slice(0, 40)}"`);
pruefe(sichtbar.includes("20,00") && sichtbar.includes("Ich habe den Betrag erhalten"), "Unterschrift zeigt Betrag und Erklaerung");
pruefe(!/Beispiel|Zimmermann|Östlich|Barbetrag|Saldo/.test(sichtbar), "Unterschrift zeigt keine Nachnamen, anderen Personen oder Salden");
await zielgroessen("Unterschrift (768x1024)");
pruefe(await page.getByRole("button", { name: /Unterschreiben/ }).isDisabled(), "'Unterschreiben' ist ohne Unterschrift gesperrt");

// Zurueck-Taste fuehrt nicht heraus
await page.goBack().catch(() => {});
await page.waitForTimeout(300);
pruefe(await modus.isVisible(), "Browser-Zurueck: Modus bleibt bestehen");
// Neuladen fuehrt nicht heraus
await page.reload();
await modus.waitFor();
await keineNav("nach Neuladen");
pruefe(true, "Neuladen: Modus wird wiederhergestellt");

// Nach Neuladen steht die Person wieder in der Vorbereitung; erneut bis zur Unterschrift
await page.locator(".zv-uebergabe-feld input").fill("20,00");
await page.getByRole("button", { name: /Gerät übergeben/ }).click();
await page.locator("canvas.zv-signature-canvas").waitFor();

// Abbrechen -> Passwortabfrage, NICHT direkt heraus
await page.getByRole("button", { name: "Abbrechen" }).click();
pruefe(await page.getByRole("heading", { name: "Mitarbeitende bestätigen" }).isVisible(), "Abbrechen fuehrt zur Passwortabfrage");
await page.getByLabel("Passwort").fill("falsch-falsch-falsch");
await page.getByRole("button", { name: "Bestätigen" }).click();
await page.getByText("Das Passwort ist falsch.").waitFor();
pruefe(await page.getByRole("heading", { name: "Mitarbeitende bestätigen" }).isVisible(), "Falsches Passwort: bleibt in der Abfrage (kein Abmelden, kein Verlassen)");
await page.getByLabel("Passwort").fill(passwort);
await page.getByRole("button", { name: "Bestätigen" }).click();
await page.getByRole("button", { name: /Gerät übergeben/ }).waitFor();
pruefe(true, "Richtiges Passwort nach Abbrechen: zurueck zur Vorbereitung");

// --- Vollstaendiger Durchlauf fuer Person 1 ---------------------------------
await page.getByRole("button", { name: /Gerät übergeben/ }).click();
await unterschreiben();
await page.getByRole("button", { name: /^Unterschreiben/ }).click();
pruefe(await page.getByRole("heading", { name: "Mitarbeitende bestätigen" }).isVisible(), "Unterschreiben fuehrt zur Passwortabfrage");
await page.getByLabel("Passwort").fill(passwort);
await page.getByRole("button", { name: "Bestätigen" }).click();
await page.getByRole("heading", { name: "Buchung prüfen" }).waitFor();
await keineNav("Kontrolle");
await zielgroessen("Kontrolle (768x1024)");
const kontrolle = (await page.locator(".zv-uebergabe-kontrolle").innerText()).replace(/\s+/g, " ");
pruefe(kontrolle.includes("20,00") && kontrolle.includes("Neuer Barbetrag"), `Kontrolle zeigt Betrag und neuen Barbetrag: ${kontrolle.slice(0, 90)}`);
pruefe((await page.locator("img.zv-uebergabe-vorschau").count()) === 1, "Kontrolle zeigt die erfasste Unterschrift");
await page.getByRole("button", { name: "Buchen", exact: true }).click();

// --- Sammelmodus: naechste Person, Ueberspringen, Uebersicht ----------------
await page.getByRole("button", { name: /Gerät übergeben/ }).waitFor();
const zweiter = (await page.locator(".zv-uebergabe h1").first().textContent())?.trim();
pruefe(zweiter && zweiter !== erstesName, `Sammelmodus: naechste Person erscheint (${zweiter})`);
await page.getByRole("button", { name: "Überspringen" }).click();
await page.getByRole("button", { name: /Gerät übergeben/ }).waitFor();
await page.getByRole("button", { name: "Überspringen" }).click();
await page.getByRole("heading", { name: /Übersicht KW/ }).waitFor();
const uebersicht = await page.locator(".zv-uebergabe-liste li").allInnerTexts();
pruefe(uebersicht.filter((t) => t.includes("Gebucht")).length === 1 && uebersicht.filter((t) => t.includes("Übersprungen")).length === 2, `Uebersicht: 1 gebucht, 2 uebersprungen (${uebersicht.length} Zeilen)`);
await keineNav("Uebersicht");
await page.getByRole("button", { name: "Fertig" }).click();
await page.getByRole("heading", { name: "HZL", exact: true }).waitFor();
pruefe((await page.locator(".zv-sidebar, .zv-tabbar-app").count()) > 0, "Nach 'Fertig': normale App mit Navigation");
await page.locator(".zv-pill-ok").first().waitFor({ timeout: 5000 }).catch(() => {});
pruefe((await page.locator(".zv-pill-ok").count()) >= 1, "Nach 'Fertig': die Uebersicht zeigt die gebuchte Person als bezahlt");

// --- Tablet quer -----------------------------------------------------------
await page.setViewportSize({ width: 1024, height: 768 });
await page.getByRole("button", { name: /Auszahlen \+ unterschreiben/ }).first().click();
await modus.waitFor();
await page.locator(".zv-uebergabe-feld input").fill("5");
await page.getByRole("button", { name: /Gerät übergeben/ }).click();
await page.locator("canvas.zv-signature-canvas").waitFor();
await zielgroessen("Unterschrift (1024x768 quer)");
const imViewport = await page.evaluate(() => {
  const r = document.querySelector("canvas.zv-signature-canvas").getBoundingClientRect();
  const k = [...document.querySelectorAll(".zv-uebergabe button")].map((b) => b.getBoundingClientRect().bottom);
  return r.bottom <= innerHeight && Math.max(...k) <= innerHeight;
});
pruefe(imViewport, "Quer: Unterschriftsfeld und Knoepfe liegen ohne Scrollen im Bild");
await page.getByRole("button", { name: "Abbrechen" }).click();
await page.getByLabel("Passwort").fill(passwort);
await page.getByRole("button", { name: "Bestätigen" }).click();
await page.getByRole("button", { name: "Modus beenden" }).click();
await page.getByRole("heading", { name: "HZL", exact: true }).waitFor();

await browser.close();
if (messungen < 30) {
  console.error(`Zu wenige Messungen (${messungen}) -- die Pruefung hat nicht gemessen, was sie sollte.`);
  process.exit(1);
}
if (fehler.length) {
  console.error(`\n${fehler.length} von ${messungen} Pruefungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Pruefungen bestanden.`);
