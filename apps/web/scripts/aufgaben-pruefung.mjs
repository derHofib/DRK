// Einmaliges, manuelles Pruefskript fuer Phase 8 (Aufgaben). Nicht Teil
// der CI -- Zugangsdaten aus der Kommandozeile (siehe
// apps/api/scratch-live-aufgaben-seed.mjs fuer das Seeding).
import { chromium } from "playwright";

const [, , slug, blEmail, btEmail, passwort] = process.argv;
if (!slug || !blEmail || !btEmail) {
  console.error("Nutzung: node aufgaben-pruefung.mjs <slug> <blEmail> <btEmail> <passwort>");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fehler = [];

function pruefe(bedingung, beschreibung) {
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function login(page, email) {
  await page.goto("http://localhost:5173/");
  await page.getByLabel(/Träger-Kennung/i).fill(slug);
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.waitForTimeout(1200);
  const loginFehler = await page.locator(".zv-hinweis-fehler").first().textContent().catch(() => null);
  if (loginFehler) {
    console.error("Login fehlgeschlagen:", loginFehler);
    process.exit(1);
  }
}

// ===== Navigation: "Aufgaben" ist einer der vier direkt sichtbaren Reiter =====
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await login(page, blEmail);
pruefe(await page.getByRole("button", { name: /^Aufgaben$/ }).first().isVisible(), "Reiter 'Aufgaben' direkt sichtbar (Desktop-Sidebar)");

// ===== Zimmer: Badge + Inline-Anlegen + Erledigen =====
await page.getByRole("button", { name: /^Zimmer$/ }).first().click();
await page.waitForTimeout(500);
const karte = page.locator(".zv-room-card", { has: page.locator(".zv-room-nummer", { hasText: "101" }) });
pruefe(await karte.isVisible(), "Zimmer 101 sichtbar");

await karte.getByRole("button", { name: /^Aufgaben/ }).click();
await page.waitForTimeout(400);
await karte.locator('input[name="titel"]').fill("Fenstergriff defekt");
await karte.locator('select[name="prioritaet"]').selectOption("hoch");
await karte.getByRole("button", { name: /Anlegen/i }).click();
await page.waitForTimeout(600);

const aufgabenZeile = karte.locator(".zv-info-karte", { hasText: "Fenstergriff defekt" });
pruefe(await aufgabenZeile.isVisible(), "Neue Zimmer-Aufgabe erscheint inline in der Zimmerkarte");
pruefe(
  (await aufgabenZeile.locator(".zv-pill-danger").first().textContent())?.includes("Hoch"),
  "Priorität 'Hoch' als Pille mit Icon sichtbar (nicht nur Farbe)"
);

// Badge auf der Zimmerkarte (Kopfbereich) zeigt jetzt >=1
await karte.getByRole("button", { name: /Aufgaben ausblenden/ }).click();
await page.waitForTimeout(300);
const badgeText = await karte.locator(".zv-pill-offen").first().textContent();
pruefe(badgeText?.trim() === "1", `Badge im Kartenkopf zeigt 1 offene Aufgabe (erhalten: "${badgeText}")`);

// Erledigen
await karte.getByRole("button", { name: /^Aufgaben/ }).click();
await page.waitForTimeout(400);
await aufgabenZeile.getByRole("button", { name: /Erledigen/i }).click();
await page.waitForTimeout(600);
await karte.getByRole("button", { name: /Aufgaben ausblenden/ }).click();
await page.waitForTimeout(300);
const badgeNachErledigen = await karte.locator(".zv-pill-offen").count();
pruefe(badgeNachErledigen === 0, "Badge verschwindet, nachdem die einzige Aufgabe erledigt wurde");

// ===== Aufgaben-Ansicht: persönliche Aufgabe anlegen, gruppiert nach "Ohne Termin" =====
await page.getByRole("button", { name: /^Aufgaben$/ }).first().click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /Neue Aufgabe/i }).click();
await page.waitForTimeout(300);
await page.locator("#aufgabe-titel").fill("Streng persönlich, niemandem zugewiesen");
await page.getByRole("button", { name: /^Anlegen$/ }).click();
await page.waitForTimeout(600);
pruefe(
  await page.getByText("Streng persönlich, niemandem zugewiesen").isVisible(),
  "Persönliche Aufgabe erscheint in der eigenen Aufgaben-Ansicht (Gruppe 'Ohne Termin')"
);
const ohneTerminUeberschrift = await page.locator(".zv-etagen-kopf", { hasText: "Ohne Termin" }).isVisible();
pruefe(ohneTerminUeberschrift, "Gruppierung 'Ohne Termin' als Überschrift sichtbar");

// ===== Persönliche Aufgabe darf in KEINER Zimmeransicht auftauchen =====
await page.getByRole("button", { name: /^Zimmer$/ }).first().click();
await page.waitForTimeout(500);
const persoenlicheImZimmer = await page.getByText("Streng persönlich, niemandem zugewiesen").isVisible().catch(() => false);
pruefe(!persoenlicheImZimmer, "Persönliche Aufgabe taucht in KEINER Zimmeransicht auf");

// ===== Persönliche Aufgabe fuer einen zweiten Benutzer unsichtbar =====
const btPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await login(btPage, btEmail);
await btPage.getByRole("button", { name: /^Aufgaben$/ }).first().click();
await btPage.waitForTimeout(500);
const beiKollege = await btPage.getByText("Streng persönlich, niemandem zugewiesen").isVisible().catch(() => false);
pruefe(!beiKollege, "Persönliche Aufgabe der Bereichsleitung ist für einen anderen Benutzer unsichtbar");

// ===== Sammelmenue bei 390px: oeffnen, Zieleintrag anklicken, Fokus, kein Ueberlauf =====
const mobilPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await login(mobilPage, blEmail);
await mobilPage.waitForTimeout(500);

const mehrKnopf = mobilPage.getByRole("button", { name: /Mehr/i });
pruefe(await mehrKnopf.isVisible(), "'Mehr'-Knopf auf der mobilen Reiterleiste sichtbar");
pruefe((await mehrKnopf.getAttribute("aria-expanded")) === "false", "Mehr-Knopf hat aria-expanded=false im geschlossenen Zustand");

await mehrKnopf.click();
await mobilPage.waitForTimeout(300);
pruefe((await mehrKnopf.getAttribute("aria-expanded")) === "true", "Mehr-Knopf hat aria-expanded=true nach dem Öffnen");
const panel = mobilPage.locator("#zv-sammelmenue-panel");
pruefe(await panel.isVisible(), "Sammelmenue-Panel sichtbar");

const dashboardEintrag = panel.getByRole("menuitem", { name: /Dashboard/i });
await dashboardEintrag.click();
await mobilPage.waitForTimeout(400);
pruefe(!(await panel.isVisible().catch(() => false)), "Panel schließt sich nach Auswahl eines Eintrags");
pruefe(await mobilPage.getByRole("heading", { name: /Dashboard/i }).isVisible(), "Route wechselt zu Dashboard nach Klick im Sammelmenue");
pruefe(
  (await mehrKnopf.getAttribute("class"))?.includes("active"),
  "Mehr-Knopf zeigt aktiven Zustand, wenn die aktuelle Route im Sammelmenue liegt"
);

// Escape schliessen + Fokus zurueck auf den Knopf
await mehrKnopf.click();
await mobilPage.waitForTimeout(300);
await mobilPage.keyboard.press("Escape");
await mobilPage.waitForTimeout(300);
pruefe(!(await panel.isVisible().catch(() => false)), "Escape schließt das Panel");
const fokusNachEscape = await mobilPage.evaluate(() => document.activeElement?.textContent?.trim());
pruefe(fokusNachEscape?.includes("Mehr") ?? false, `Fokus liegt nach Escape auf dem Mehr-Knopf (erhalten: "${fokusNachEscape}")`);

// Kein horizontaler Ueberlauf, weder geschlossen noch offen
const ueberlaufZu = await mobilPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
pruefe(!ueberlaufZu, "Kein horizontaler Überlauf bei 390px (Panel geschlossen)");
await mehrKnopf.click();
await mobilPage.waitForTimeout(300);
const ueberlaufOffen = await mobilPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
pruefe(!ueberlaufOffen, "Kein horizontaler Überlauf bei 390px (Panel offen)");

// Screenshots fuer Kontrastkontrolle (Hell/Dunkel)
await mobilPage.screenshot({ path: "/tmp/aufgaben-sammelmenue-hell.png" });
await mobilPage.evaluate(() => {
  document.documentElement.dataset.theme = "dunkel";
  localStorage.setItem("zimmerakte_theme", "dunkel");
});
await mobilPage.reload();
await mobilPage.waitForTimeout(500);
await mehrKnopf.click();
await mobilPage.waitForTimeout(300);
await mobilPage.screenshot({ path: "/tmp/aufgaben-sammelmenue-dunkel.png" });

console.log("\n" + (fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} PRUEFUNG(EN) FEHLGESCHLAGEN:`));
fehler.forEach((f) => console.log(" - " + f));

await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
