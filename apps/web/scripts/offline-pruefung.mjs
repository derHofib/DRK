/**
 * Pruefung des Offlinebetriebs (Bauplan Phase 4) im echten Browser, gegen
 * laufende API + Dev-Server. Nicht Teil der CI.
 *
 * Abnahmekriterium aus dem Bauplan: "eine im Flugmodus erfasste Auszahlung
 * kommt nach dem Wiederverbinden genau einmal an -- auch wenn der
 * Uebertragungsversuch dreimal ausgeloest wird." Gemessen wird am Server
 * (Zeilen mit dem Pruef-Zweck), nicht an der Oberflaeche.
 *
 * Die drei Versuche sind absichtlich die unangenehmen: die ersten beiden
 * ERREICHEN den Server (er committet), aber die Antwort geht unterwegs
 * verloren -- genau der Fall, in dem der Client nicht wissen kann, ob die
 * Buchung schon steht. Ausgeloest werden sie durch drei verschiedene Wege:
 * das online-Ereignis, ein Neuladen der Seite (Eintrag muss das ueberleben)
 * und den Knopf "Jetzt übertragen".
 *
 * Ausserdem: abgelehnter Eintrag (HZL derselben Woche inzwischen anderswo
 * gebucht) bleibt sichtbar bis zum Verwerfen; keine Namen im Speicher; kein
 * horizontaler Ueberlauf der Leiste bei 390 px.
 *
 * Gegenprobe: mit --gegenprobe entfernt das Skript den Idempotency-Key aus
 * jeder Anfrage. Dann MUSS es rot werden (drei Buchungen statt einer) --
 * sonst misst es nichts.
 *
 * Aufruf (aus apps/web): node scripts/offline-pruefung.mjs <slug> <email> <passwort> [--gegenprobe]
 * Voraussetzung: Mandant mit mind. einer Klient:in mit woechentlichem
 * HZL-Rhythmus und Konto mit Buchungsrecht; Typen "Sonstiges" und "HZL".
 */
import { chromium, request as httpRequest } from "playwright";

const [, , slug, email, passwort, schalter] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node offline-pruefung.mjs <slug> <email> <passwort> [--gegenprobe]");
  process.exit(1);
}
const GEGENPROBE = schalter === "--gegenprobe";
const BASIS = "http://localhost:5173";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

// --- Netz-Simulation ---------------------------------------------------------
// verlorenBis: so viele POSTs auf /api/kassenbuchungen werden an den Server
// durchgereicht, die Antwort aber verworfen (Verbindung reisst nach dem Commit).
let verlorenBis = 0;
let offline = false;
const posts = [];
await context.route("**/api/kassenbuchungen", async (route) => {
  const req = route.request();
  if (req.method() !== "POST") return route.continue();
  // Im Flugmodus kommt nichts beim Server an -- zaehlt nicht als Versuch.
  if (offline) return route.abort("internetdisconnected");
  const headers = { ...req.headers() };
  if (GEGENPROBE) delete headers["idempotency-key"];
  posts.push(headers["idempotency-key"] ?? null);
  const antwort = await route.fetch({ headers });
  if (posts.length <= verlorenBis) {
    console.log(`     (Versuch ${posts.length}: Server antwortete ${antwort.status()}, Antwort geht verloren)`);
    return route.abort("connectionreset");
  }
  return route.fulfill({ response: antwort });
});

const api = async (pfad, init = {}) =>
  page.evaluate(
    async ({ pfad, init }) => {
      const res = await fetch(`/api${pfad}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("zimmerakte_token")}` },
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { pfad, init }
  );
const zeilenMitZweck = async (zweck) => (await api("/kassenbuchungen")).body.filter((b) => b.verwendungszweck === zweck).length;
const speicher = () => page.evaluate(() => localStorage.getItem("zv-kassenbuch-warteschlange"));
const leiste = page.getByTestId("warteschlange");

async function unterschreiben() {
  const box = await page.locator("canvas.zv-signature-canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
}

async function auszahlungErfassen({ typ, zweck, betrag, isoJahr, isoWoche }) {
  await page.getByRole("button", { name: "Neue Buchung" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("select[name=klientId]").selectOption({ index: 1 });
  await dialog.locator("#kassenbuch-typ").selectOption({ label: typ });
  await dialog.locator("select[name=richtung]").selectOption("auszahlung");
  if (isoJahr) await dialog.locator("input[name=isoJahr]").fill(String(isoJahr));
  if (isoWoche) await dialog.locator("input[name=isoWoche]").fill(String(isoWoche));
  await dialog.locator("input[name=betrag]").fill(betrag);
  await dialog.locator("#kassenbuch-verwendungszweck").fill(zweck);
  await unterschreiben();
  await dialog.getByRole("button", { name: "Buchung speichern" }).click();
}

// --- Anmelden, Kassenbuch oeffnen -----------------------------------------
await page.goto(`${BASIS}/`);
await page.getByLabel(/Träger-Kennung/i).fill(slug);
await page.getByLabel(/E-Mail/i).fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /^Kassenbuch$/ }).first().click();
await page.getByRole("button", { name: "Neue Buchung" }).waitFor();
await page.waitForTimeout(800); // Klient:innen und Typen laden, solange noch Netz da ist

const zweck = `Offline-Probe ${Date.now()}`;
pruefe((await zeilenMitZweck(zweck)) === 0, "Vorbedingung: noch keine Buchung mit dem Pruef-Zweck");

// --- Flugmodus: erfassen ---------------------------------------------------
offline = true;
await context.setOffline(true);
pruefe(!(await page.evaluate(() => navigator.onLine)), "Flugmodus: navigator.onLine ist false");
await auszahlungErfassen({ typ: "Sonstiges", zweck, betrag: "12,34" });
await leiste.waitFor();
pruefe(!(await page.getByRole("dialog").isVisible().catch(() => false)), "Flugmodus: Formular schliesst nach dem Speichern");
const text = (await leiste.innerText()).replace(/\s+/g, " ");
pruefe(text.includes("1 Buchung noch nicht übertragen") && text.includes("Keine Verbindung"), `Leiste meldet den wartenden Eintrag: "${text.slice(0, 70)}…"`);
pruefe(text.includes("12,34") && text.includes(zweck), "Leiste nennt Betrag und Zweck");
const roh = await speicher();
const gespeichert = JSON.parse(roh ?? "[]");
pruefe(gespeichert.length === 1 && /^[0-9a-f-]{36}$/.test(gespeichert[0].schluessel), "Genau ein Eintrag mit UUID-Schluessel im Geraetespeicher");
pruefe(gespeichert[0]?.payload?.unterschriftBase64?.startsWith("data:image/png"), "Unterschrift liegt mit im Eintrag");
const klientName = await page.evaluate(async () => {
  const res = await fetch("/api/klienten", { headers: { Authorization: `Bearer ${localStorage.getItem("zimmerakte_token")}` } }).catch(() => null);
  return res ? null : "offline";
});
pruefe(klientName === "offline", "Waehrend des Flugmodus erreicht keine Anfrage den Server");

// --- Wiederverbinden: drei Versuche, die ersten zwei verlieren die Antwort ---
verlorenBis = 2;
offline = false;
await context.setOffline(false); // Versuch 1: online-Ereignis
await page.waitForTimeout(1500);
pruefe(posts.length === 1, `online-Ereignis loest genau einen Versuch aus (gezaehlt: ${posts.length})`);
pruefe((await speicher()) !== null, "Antwort verloren: Eintrag bleibt im Geraetespeicher");

await page.reload(); // Versuch 2: Shell montiert neu, sendet beim Start
await leiste.waitFor();
await page.waitForTimeout(1500);
pruefe(posts.length === 2, `nach Neuladen: Eintrag ueberlebt und wird erneut gesendet (Versuche: ${posts.length})`);

await page.getByRole("button", { name: "Jetzt übertragen" }).click(); // Versuch 3: Knopf
await page.waitForTimeout(1500);
pruefe(posts.length === 3, `"Jetzt übertragen" loest den dritten Versuch aus (Versuche: ${posts.length})`);
pruefe(new Set(posts).size === 1 && posts[0] !== null, "alle drei Versuche tragen denselben Idempotency-Key");

const anzahl = await zeilenMitZweck(zweck);
pruefe(anzahl === 1, `Server: genau EINE Buchung nach drei Versuchen (gezaehlt: ${anzahl})`);
pruefe((await speicher()) === null, "Nach Bestaetigung: Geraetespeicher ist leer");
pruefe((await leiste.count()) === 0, "Nach Bestaetigung: Leiste verschwindet");
await page.getByRole("button", { name: /^Kassenbuch$/ }).first().click();
await page.waitForTimeout(800);
pruefe((await page.getByText(zweck).count()) === 1, "Kassenbuch-Liste zeigt die Buchung genau einmal");

// --- Abgelehnt: HZL der Woche inzwischen anderswo gebucht -------------------
verlorenBis = 0;
const hzlZweck = `HZL-Probe ${Date.now()}`;
offline = true;
await context.setOffline(true);
// Eigene, sonst unbenutzte Woche je Lauf, damit wiederholte Laeufe sich nicht
// gegenseitig die HZL-Woche wegnehmen.
const lauf = Math.floor(Date.now() / 1000);
await auszahlungErfassen({ typ: "HZL", zweck: hzlZweck, betrag: "20,00", isoJahr: 2030 + (lauf % 70), isoWoche: 1 + (Math.floor(lauf / 70) % 52) });
await leiste.waitFor();
const eintrag = JSON.parse((await speicher()) ?? "[]")[0];
// "Anderes Geraet" bucht dieselbe Woche, waehrend dieses noch offline ist --
// ueber einen eigenen HTTP-Kontext ausserhalb des Browsers.
const token = await page.evaluate(() => localStorage.getItem("zimmerakte_token"));
const anderesGeraet = await httpRequest.newContext({ baseURL: BASIS, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
const anderswo = await anderesGeraet.post("/api/kassenbuchungen", {
  data: { ...eintrag.payload, verwendungszweck: `${hzlZweck} (anderes Geraet)` },
});
pruefe(anderswo.status() === 201, `Vorbedingung: anderes Geraet bucht dieselbe HZL-Woche (${anderswo.status()})`);
await anderesGeraet.dispose();
offline = false;
await context.setOffline(false); // online-Ereignis sendet automatisch
await page.getByText(/wurde nicht gebucht/).waitFor({ timeout: 5000 }).catch(() => {});
const abgelehntText = (await leiste.innerText().catch(() => "")).replace(/\s+/g, " ");
pruefe(/wurde nicht gebucht/.test(abgelehntText) && /HZL/.test(abgelehntText), `Abgelehnt: Leiste zeigt die Meldung des Servers ("${abgelehntText.slice(0, 80)}…")`);
pruefe(JSON.parse((await speicher()) ?? "[]")[0]?.status === "abgelehnt", "Abgelehnt: Eintrag bleibt gespeichert, Status 'abgelehnt'");
const vorherPosts = posts.length;
await page.waitForTimeout(1500);
pruefe(posts.length === vorherPosts, "Abgelehnt: kein weiterer automatischer Versuch");

// --- Layout bei 390 px ------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
pruefe(!ueberlauf, "390 px: kein horizontaler Ueberlauf mit sichtbarer Leiste");
const leisteBox = await leiste.boundingBox();
pruefe(leisteBox && leisteBox.x >= 0 && leisteBox.x + leisteBox.width <= 390, "390 px: Leiste liegt vollstaendig im Viewport");

await page.getByRole("button", { name: "Verwerfen" }).click();
pruefe((await speicher()) !== null, "Verwerfen braucht ein zweites Tippen");
await page.getByRole("button", { name: "Wirklich verwerfen" }).click();
pruefe((await speicher()) === null && (await leiste.count()) === 0, "Nach 'Wirklich verwerfen': Eintrag und Leiste weg");

// --- Keine Namen im Speicher -----------------------------------------------
pruefe(!(roh ?? "").match(/"(vorname|nachname|klientName)"/), "Geraetespeicher enthaelt keine Namensfelder");

await browser.close();
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler${GEGENPROBE ? " (Gegenprobe: Idempotency-Key entfernt)" : ""}`);
if (messungen < 25) {
  console.log("Zu wenige Messungen -- das Skript hat nicht vollstaendig gemessen.");
  process.exit(1);
}
process.exit(fehler.length ? 1 : 0);
