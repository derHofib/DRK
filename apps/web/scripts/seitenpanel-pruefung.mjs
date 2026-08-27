// Einmaliges, manuelles Pruefskript fuer das neue Seitenpanel (ersetzt das
// Master-Detail-Quetsch-Layout) + die volle Breite der Klienten-Liste.
import { chromium } from "playwright";

const [, , slug, email, passwort] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node seitenpanel-pruefung.mjs <slug> <email> <passwort>");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fehler = [];

function pruefe(bedingung, beschreibung) {
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function login(page) {
  await page.goto("http://localhost:5173/");
  await page.getByLabel(/Träger-Kennung/i).fill(slug);
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.waitForTimeout(1200);
}

// --- Desktop, sehr breiter Viewport: volle Breite + Panel-Verhalten -------
const desktop = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
await login(desktop);
const loginFehler = await desktop.locator(".zv-hinweis-fehler").first().textContent().catch(() => null);
if (loginFehler) {
  console.error("Login fehlgeschlagen:", loginFehler);
  process.exit(1);
}

await desktop.getByRole("button", { name: /^Klienten$/ }).first().click();
await desktop.waitForTimeout(500);

const inhaltBox = await desktop.locator(".zv-content").first().boundingBox();
console.log("Klienten .zv-content Box:", inhaltBox);
pruefe(inhaltBox.width > 1600, "Klienten-Inhalt nutzt bei 1920px Breite (fast) die volle verbleibende Breite");

const listeVorher = await desktop.locator(".zv-karten-liste").first().boundingBox();
await desktop.screenshot({ path: "/tmp/claude-0/-home-user-DRK/b85d4c03-f731-5f64-95d4-62f9bd5d6469/scratchpad/panel-1-geschlossen.png" });

// Panel oeffnen
await desktop.getByText("Ana Braune").first().click();
await desktop.waitForTimeout(400);
const panelSichtbar = await desktop.locator(".zv-seitenpanel.zv-offen").isVisible();
pruefe(panelSichtbar, "Seitenpanel wird nach Klick auf eine Zeile sichtbar");

const listeNachher = await desktop.locator(".zv-karten-liste").first().boundingBox();
pruefe(
  Math.abs(listeVorher.width - listeNachher.width) < 1 && Math.abs(listeVorher.x - listeNachher.x) < 1,
  "Liste bleibt beim Oeffnen des Panels exakt gleich breit/positioniert (keine Quetschung)"
);

const backdropOpacity = await desktop.locator(".zv-seitenpanel-hintergrund").evaluate((el) => getComputedStyle(el).opacity);
pruefe(parseFloat(backdropOpacity) > 0.5, "Hintergrund ist beim geoeffneten Panel abgedunkelt");
const backdropBlur = await desktop.locator(".zv-seitenpanel-hintergrund").evaluate((el) => getComputedStyle(el).backdropFilter);
pruefe(backdropBlur.includes("blur"), "Hintergrund ist unscharf (backdrop-filter: blur)");

const panelBox = await desktop.locator(".zv-seitenpanel").boundingBox();
const sidebarBox = await desktop.locator(".zv-sidebar").boundingBox();
pruefe(sidebarBox.width > 0 && panelBox.x >= sidebarBox.width, "Sidebar bleibt sichtbar, Panel beginnt erst danach");
pruefe(panelBox.width < inhaltBox.width, "Panel ist im Normalzustand schmaler als der volle Inhaltsbereich (kein sofortiges Vollbild)");

await desktop.screenshot({ path: "/tmp/claude-0/-home-user-DRK/b85d4c03-f731-5f64-95d4-62f9bd5d6469/scratchpad/panel-2-offen.png" });

// Vollbild umschalten
await desktop.getByRole("button", { name: /Vollbild anzeigen/i }).click();
await desktop.waitForTimeout(400);
const panelBoxVollbild = await desktop.locator(".zv-seitenpanel").boundingBox();
pruefe(
  panelBoxVollbild.width > panelBox.width && Math.abs(panelBoxVollbild.x - sidebarBox.width) < 2,
  "Vollbild weitet das Panel auf die volle Breite neben der Sidebar aus"
);
await desktop.screenshot({ path: "/tmp/claude-0/-home-user-DRK/b85d4c03-f731-5f64-95d4-62f9bd5d6469/scratchpad/panel-3-vollbild.png" });

// Zurueck aus dem Vollbild
await desktop.getByRole("button", { name: /Vollbild verlassen/i }).click();
await desktop.waitForTimeout(400);
const panelBoxNachVerlassen = await desktop.locator(".zv-seitenpanel").boundingBox();
pruefe(panelBoxNachVerlassen.width < panelBoxVollbild.width, "Vollbild verlassen macht das Panel wieder schmal");

// Escape schliesst
await desktop.keyboard.press("Escape");
await desktop.waitForTimeout(400);
const geschlossenNachEscape = await desktop.locator(".zv-seitenpanel.zv-offen").count();
pruefe(geschlossenNachEscape === 0, "Escape schliesst das Panel");

// Erneut oeffnen, dann per Klick auf den Hintergrund schliessen
await desktop.getByText("Dennis Hildegard").first().click();
await desktop.waitForTimeout(400);
await desktop.locator(".zv-seitenpanel-hintergrund").click({ position: { x: 5, y: 5 } });
await desktop.waitForTimeout(400);
const geschlossenNachBackdrop = await desktop.locator(".zv-seitenpanel.zv-offen").count();
pruefe(geschlossenNachBackdrop === 0, "Klick auf den Hintergrund schliesst das Panel");

// Erneutes Oeffnen startet wieder schmal (Vollbild-Zustand wurde nicht gemerkt)
await desktop.getByText("Ana Braune").first().click();
await desktop.waitForTimeout(400);
const panelBoxNeuGeoeffnet = await desktop.locator(".zv-seitenpanel").boundingBox();
pruefe(Math.abs(panelBoxNeuGeoeffnet.width - panelBox.width) < 2, "Panel startet beim naechsten Oeffnen wieder schmal, nicht im Vollbild");

await desktop.close();

// --- Mobil: Panel deckt automatisch den ganzen Bildschirm ab --------------
const mobil = await browser.newPage({ viewport: { width: 390, height: 844 } });
await login(mobil);
await mobil.getByRole("button", { name: /^Klienten$/ }).first().click();
await mobil.waitForTimeout(500);
await mobil.getByText("Ana Braune").first().click();
await mobil.waitForTimeout(400);
const panelBoxMobil = await mobil.locator(".zv-seitenpanel").boundingBox();
pruefe(panelBoxMobil.width >= 389, "Mobil deckt das Panel automatisch die volle Bildschirmbreite ab");
const vollbildKnopfMobilSichtbar = await mobil.getByRole("button", { name: /Vollbild anzeigen/i }).isVisible().catch(() => false);
pruefe(!vollbildKnopfMobilSichtbar, "Vollbild-Knopf ist auf dem Handy ausgeblendet (waere wirkungslos)");
await mobil.close();

console.log("\n" + (fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} PRUEFUNG(EN) FEHLGESCHLAGEN:`));
fehler.forEach((f) => console.log(" - " + f));

await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
