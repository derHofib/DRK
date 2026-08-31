// Einmaliges, manuelles Pruefskript fuer Zimmer-Kapazitaet + Vier-Augen-
// Aenderung. Nicht Teil der CI -- Zugangsdaten aus der Kommandozeile
// (siehe apps/api/scratch-live-kapazitaet-seed.mjs fuer das Seeding).
import { chromium } from "playwright";

const [, , slug, blEmail, elEmail, passwort, klient0, klient1, klient2] = process.argv;
if (!slug || !blEmail || !elEmail || !passwort) {
  console.error("Nutzung: node kapazitaet-vier-augen-pruefung.mjs <slug> <blEmail> <elEmail> <passwort> <klient0> <klient1> <klient2>");
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

// ===== Als Bereichsleitung: Zimmer mit Kapazitaet 2 anlegen =====
const blPage = await browser.newPage();
await login(blPage, blEmail);
await blPage.getByRole("button", { name: /^Zimmer$/ }).first().click();
await blPage.waitForTimeout(500);

await blPage.getByRole("button", { name: /Neues Zimmer/i }).click();
await blPage.waitForTimeout(300);
await blPage.locator("#zimmer-nummer").fill("K1");
await blPage.locator("#zimmer-kapazitaet").fill("2");
await blPage.getByRole("button", { name: /Zimmer anlegen/i }).click();
await blPage.waitForTimeout(800);

const karteK1 = blPage.locator(".zv-room-card", { has: blPage.locator(".zv-room-nummer", { hasText: "K1" }) });
pruefe(await karteK1.isVisible(), "Zimmer K1 mit Kapazitaet 2 wurde angelegt und angezeigt");
pruefe((await karteK1.locator(".zv-sub-inline").first().textContent())?.includes("0 / 2"), "Belegungsanzeige zeigt 0 / 2 Plaetze belegt");

// Ersten Bewohner zuweisen
await karteK1.getByRole("button", { name: /Klient zuweisen/i }).click();
await blPage.waitForTimeout(300);
await blPage.locator("#zuweisung-klient").selectOption(klient0);
await blPage.getByRole("button", { name: /^Einziehen$/ }).click();
await blPage.waitForTimeout(800);
pruefe((await karteK1.locator(".zv-sub-inline").first().textContent())?.includes("1 / 2"), "Nach 1. Zuweisung: 1 / 2 Plaetze belegt");
pruefe(await karteK1.getByRole("button", { name: /Klient zuweisen/i }).isVisible(), "Zimmer noch nicht voll -- 'Klient zuweisen' weiter sichtbar");

// Zweiten Bewohner zuweisen -- Zimmer sollte danach voll sein
await karteK1.getByRole("button", { name: /Klient zuweisen/i }).click();
await blPage.waitForTimeout(300);
await blPage.locator("#zuweisung-klient").selectOption(klient1);
await blPage.getByRole("button", { name: /^Einziehen$/ }).click();
await blPage.waitForTimeout(800);
pruefe((await karteK1.locator(".zv-sub-inline").first().textContent())?.includes("2 / 2"), "Nach 2. Zuweisung: 2 / 2 Plaetze belegt");
const statusPillText = await karteK1.locator(".zv-pill").first().textContent();
pruefe(statusPillText?.includes("Vergeben") || statusPillText?.includes("vergeben"), "Status-Pille zeigt 'Vergeben' bei voller Kapazitaet");
pruefe(!(await karteK1.getByRole("button", { name: /Klient zuweisen/i }).isVisible()), "'Klient zuweisen' bei voller Kapazitaet nicht mehr angeboten (UI-Ebene)");

// Direkter API-Aufruf: dritte Zuweisung MUSS mit Fehlermeldung abgelehnt werden
const dritteZuweisung = await blPage.evaluate(async ({ zimmerNummer, klientId }) => {
  const token = localStorage.getItem("zimmerakte_token");
  const zimmerRes = await fetch("/api/zimmer", { headers: { Authorization: `Bearer ${token}` } });
  const zimmerListe = await zimmerRes.json();
  const zimmer = zimmerListe.find((z) => z.nummer === zimmerNummer);
  const res = await fetch("/api/belegungen", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ zimmerId: zimmer.id, klientId, einzug: new Date().toISOString().slice(0, 10) }),
  });
  return { status: res.status, body: await res.json() };
}, { zimmerNummer: "K1", klientId: klient2 });
pruefe(dritteZuweisung.status === 409, `3. Zuweisung zu Kapazitaet-2-Zimmer wird mit 409 abgelehnt (erhalten: ${dritteZuweisung.status})`);
pruefe(
  typeof dritteZuweisung.body.message === "string" && dritteZuweisung.body.message.length > 0,
  `Fehlermeldung vorhanden: "${dritteZuweisung.body.message}"`
);

// ===== Vier-Augen-Prinzip: Bereichsleitung beantragt Kapazitaetsaenderung =====
await karteK1.getByRole("button", { name: /Kapazität ändern/i }).click();
await blPage.waitForTimeout(300);
await blPage.locator("#kapazitaet-neu").fill("3");
await blPage.getByRole("button", { name: /Änderung beantragen/i }).click();
await blPage.waitForTimeout(800);

const hinweisBox = karteK1.locator(".zv-hinweis-info");
pruefe(await hinweisBox.isVisible(), "Offener Kapazitaetsantrag als Info-Box sichtbar");
const hinweisText = await hinweisBox.textContent();
pruefe(hinweisText?.includes("2") && hinweisText?.includes("3"), "Info-Box zeigt alte -> neue Kapazitaet (2 -> 3)");
pruefe(hinweisText?.includes("Bereichsleitung"), "Info-Box nennt die antragstellende Rolle (Bereichsleitung)");

// Bereichsleitung selbst darf NICHT bestaetigen/ablehnen koennen (Selbstbestaetigung verboten)
const selbstBestaetigenSichtbar = await hinweisBox.getByRole("button", { name: /Bestätigen/i }).isVisible().catch(() => false);
pruefe(!selbstBestaetigenSichtbar, "Antragstellende Bereichsleitung sieht KEINEN eigenen Bestaetigen-Knopf (Anzeige-Ebene)");

// Server-seitige Gegenprobe: Bereichsleitung versucht per direktem API-Call selbst zu bestaetigen
const selbstBestaetigenVersuch = await blPage.evaluate(async ({ zimmerNummer }) => {
  const token = localStorage.getItem("zimmerakte_token");
  const zimmerRes = await fetch("/api/zimmer", { headers: { Authorization: `Bearer ${token}` } });
  const zimmerListe = await zimmerRes.json();
  const zimmer = zimmerListe.find((z) => z.nummer === zimmerNummer);
  const antragId = zimmer.offenerKapazitaetsantrag.id;
  const res = await fetch(`/api/zimmer/kapazitaetsantraege/${antragId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entscheidung: "bestaetigt" }),
  });
  return { status: res.status };
}, { zimmerNummer: "K1" });
pruefe(selbstBestaetigenVersuch.status === 403, `Server lehnt Selbstbestaetigung durch Bereichsleitung mit 403 ab (erhalten: ${selbstBestaetigenVersuch.status})`);

// ===== Als Einrichtungsleitung (Gegenrolle): Antrag bestaetigen =====
const elPage = await browser.newPage();
await login(elPage, elEmail);
await elPage.getByRole("button", { name: /^Zimmer$/ }).first().click();
await elPage.waitForTimeout(500);

const karteK1El = elPage.locator(".zv-room-card", { has: elPage.locator(".zv-room-nummer", { hasText: "K1" }) });
pruefe(await karteK1El.isVisible(), "Einrichtungsleitung (zugeordneter Standort) sieht Zimmer K1");
const hinweisBoxEl = karteK1El.locator(".zv-hinweis-info");
pruefe(await hinweisBoxEl.getByRole("button", { name: /Bestätigen/i }).isVisible(), "Einrichtungsleitung (Gegenrolle) sieht Bestaetigen-Knopf");
pruefe(await hinweisBoxEl.getByRole("button", { name: /Ablehnen/i }).isVisible(), "Einrichtungsleitung (Gegenrolle) sieht Ablehnen-Knopf");

await hinweisBoxEl.getByRole("button", { name: /Bestätigen/i }).click();
await elPage.waitForTimeout(800);
pruefe(!(await elPage.locator(".zv-hinweis-info").first().isVisible().catch(() => false)), "Nach Bestaetigung: keine offene Info-Box mehr");
pruefe(
  (await karteK1El.locator(".zv-sub-inline").first().textContent())?.includes("2 / 3"),
  "Nach Bestaetigung: Kapazitaet wirkt (2 / 3 Plaetze belegt)"
);

console.log("\n" + (fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} PRUEFUNG(EN) FEHLGESCHLAGEN:`));
fehler.forEach((f) => console.log(" - " + f));

await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
