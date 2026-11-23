/**
 * Smileys und Reaktionen im Chat (migrations/0086) im echten Browser, gegen
 * laufende API + Dev-Server.
 *
 * Misst:
 *   1 Maus: Ueberfahren zeigt die Leiste, Klick setzt eine Reaktion (Knopf
 *     mit Anzahl, als "meine" markiert), zweiter Klick nimmt sie zurueck.
 *   2 Echtzeit: die andere Person sieht die Reaktion ohne Neuladen.
 *   3 "+" oeffnet die Auswahl im Fenster, die Wahl landet als Knopf.
 *   4 "Wer hat reagiert?" listet Namen, die eigene Zeile als "Du".
 *   5 Smiley-Knopf in der Eingabe: Suche "daumen" trifft 👍, Einsetzen an
 *     der Cursorposition, Escape schliesst.
 *   6 Leiste ganz oben im Verlauf klappt nach unten (wird nicht abgeschnitten).
 *   7 Handy (Touch, hover: none): kein Smiley-Knopf, kein Reagieren-Knopf;
 *     lang druecken oeffnet das Menue, Doppeltippen gibt 👍.
 *   8 Kein horizontaler Ueberlauf bei 320/390/768/1280 px in Hell und Dunkel.
 *   9 Kontrast der Reaktionsknoepfe (normal und "meine") >= 4,5:1 in beiden
 *     Themes -- gemessen, nicht angesehen.
 *
 * Bricht ab, wenn weniger Messungen als erwartet zustande kommen (CLAUDE.md:
 * ein Pruefskript, das nichts misst, muss fehlschlagen).
 *
 * Aufruf (aus apps/web):
 *   node scripts/chat-reaktionen-pruefung.mjs <slug> <passwort> <leitung-email> <betreuer-email> [bilder-ordner]
 * Voraussetzung: beide Konten im selben Traeger mit gleichem Passwort. Das
 * Skript legt selbst eine Gruppe mit Nachrichten an.
 */
import { chromium } from "playwright";

const [, , slug, passwort, leitungEmail, betreuerEmail, bilderOrdner] = process.argv;
if (!slug || !passwort || !leitungEmail || !betreuerEmail) {
  console.error("Nutzung: node chat-reaktionen-pruefung.mjs <slug> <passwort> <leitung-email> <betreuer-email> [bilder-ordner]");
  process.exit(1);
}
const API = "http://localhost:3000";
const WEB = "http://localhost:5173";
const MINDEST_MESSUNGEN = 40;

const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function api(token, pfad, methode = "GET", body) {
  const res = await fetch(`${API}${pfad}`, {
    method: methode,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${methode} ${pfad}: ${res.status} ${await res.text()}`);
  return res.json();
}
const login = async (email) => (await api(null, "/auth/login", "POST", { mandantSlug: slug, email, passwort })).accessToken;

// --- Testdaten: eine Gruppe mit sechs Nachrichten -----------------------------
const tokenL = await login(leitungEmail);
const tokenB = await login(betreuerEmail);
// Alle Kontakte der Leitung -- die Betreuer:in ist darunter; so braucht das Skript keine IDs.
const kontakte = await api(tokenL, "/chat/kontakte");
const gruppe = await api(tokenL, "/chat/gruppe", "POST", {
  name: `Reaktionen ${new Date().toISOString().slice(11, 19)}`,
  teilnehmer: kontakte.map((k) => (k.art === "benutzer" ? { benutzerId: k.id } : { klientId: k.id })),
});
const texte = [
  [tokenB, "Die Heizung in Zimmer 4 läuft wieder. Hausmeister war da."],
  [tokenL, "Kann jemand morgen früh den Termin um 8:30 übernehmen? Ich bin erst ab 11 da."],
  [tokenB, "Mache ich 😊"],
  [tokenL, "Danke dir! Die Unterlagen liegen im Büro."],
  [tokenB, "Neue Kaffeemaschine ist da!"],
  [tokenL, "Teamfeier am 12.12. ist gebucht."],
];
const ids = [];
for (const [t, text] of texte) ids.push((await api(t, `/chat/${gruppe.id}/nachrichten`, "POST", { art: "text", text })).id);
await api(tokenL, `/chat/nachrichten/${ids[0]}/reaktion`, "PUT", { zeichen: "👍" });
await api(tokenL, `/chat/nachrichten/${ids[4]}/reaktion`, "PUT", { zeichen: "☕" });
await api(tokenL, `/chat/nachrichten/${ids[5]}/reaktion`, "PUT", { zeichen: "🎉" });
await api(tokenB, `/chat/nachrichten/${ids[5]}/reaktion`, "PUT", { zeichen: "❤️" });

// --- Browser ---------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// Je Person nur EINE echte Anmeldung: /auth/login ist auf 10 je Minute begrenzt (auth.controller.ts),
// danach traegt der gespeicherte Browserzustand (Token in localStorage) weitere Fenster.
const sitzungen = new Map();
async function anmelden(email, { viewport = { width: 1280, height: 900 }, colorScheme = "light", mobil = false, dsf = 1 } = {}) {
  const context = await browser.newContext({
    viewport, colorScheme, hasTouch: mobil, isMobile: mobil, deviceScaleFactor: dsf, storageState: sitzungen.get(email),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${WEB}/`);
  if (sitzungen.has(email)) {
    await page.getByRole("button", { name: /^Heute$/ }).first().waitFor();
    return { context, page };
  }
  await page.getByLabel(/Träger-Kennung/i).fill(slug);
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.getByRole("button", { name: /^Heute$/ }).first().waitFor();
  sitzungen.set(email, await context.storageState());
  return { context, page };
}

async function oeffneGruppe(page) {
  const knopf = page.getByRole("button", { name: /^Nachrichten/ }).first();
  if (await knopf.isVisible()) await knopf.click();
  else {
    await page.getByRole("button", { name: /^Mehr/ }).first().click();
    await page.getByRole("menuitem", { name: /^Nachrichten/ }).click();
  }
  await page.locator(".zv-chat-eintrag", { hasText: gruppe.name }).click();
  await page.locator(`[data-nachricht-id="${ids[5]}"]`).waitFor();
}

const reihe = (page, i) => page.locator(".zv-blase-reihe", { has: page.locator(`[data-nachricht-id="${ids[i]}"]`) });
const knoepfe = (page, i) =>
  reihe(page, i).locator(".zv-reaktion").evaluateAll((els) => els.map((e) => ({ text: e.textContent.replace(/\s+/g, ""), meine: e.classList.contains("meine") })));
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** Kontrast ueber den Canvas: wandelt jede CSS-Farbe (auch oklch) in sRGB, ohne eigenen Parser. */
async function kontrast(page, selektor) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = (farbe) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = farbe;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = ([r, g, b]) =>
      [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const cs = getComputedStyle(el);
    const [a, b] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selektor);
}

try {
  // 1 + 2: Maus, Echtzeit ---------------------------------------------------------
  const l = await anmelden(leitungEmail, { colorScheme: "dark" });
  const b = await anmelden(betreuerEmail);
  await oeffneGruppe(l.page);
  await oeffneGruppe(b.page);

  await reihe(l.page, 1).locator(".zv-blase").hover();
  const leiste = reihe(l.page, 1).locator(".zv-reaktionsleiste");
  pruefe(await leiste.isVisible(), "Maus: Ueberfahren zeigt die Reaktionsleiste");
  pruefe((await leiste.locator(".zv-reaktionsleiste-zeichen").count()) === 6, "Leiste hat genau sechs Schnellreaktionen");
  pruefe(
    (await leiste.locator(".zv-reaktionsleiste-zeichen").allTextContents()).join("") === "👍❤️✅👀😊🙏",
    "Schnellreaktionen sind 👍 ❤️ ✅ 👀 😊 🙏 (ohne 😂/😢)"
  );
  await leiste.getByRole("button", { name: "Mit ✅ reagieren" }).or(leiste.getByRole("button", { name: /Mit erledigt reagieren/ })).click();
  await reihe(l.page, 1).locator(".zv-reaktion").first().waitFor();
  let k = await knoepfe(l.page, 1);
  pruefe(k.length === 1 && k[0].text === "✅1" && k[0].meine, `Klick setzt Reaktion ✅1 (meine) – ${JSON.stringify(k)}`);

  await reihe(b.page, 1).locator(".zv-reaktion").first().waitFor({ timeout: 5000 }).catch(() => undefined);
  k = await knoepfe(b.page, 1);
  pruefe(k.length === 1 && k[0].text === "✅1" && !k[0].meine, `Echtzeit: andere Person sieht ✅1 ohne Neuladen – ${JSON.stringify(k)}`);

  // Mit-reagieren per Knopf, dann zuruecknehmen
  await reihe(b.page, 1).locator(".zv-reaktion").first().click();
  await l.page.waitForFunction((id) => document.querySelector(`[data-nachricht-id="${id}"]`)?.parentElement?.querySelector(".zv-reaktion")?.textContent?.includes("2"), ids[1]);
  k = await knoepfe(l.page, 1);
  pruefe(k[0]?.text === "✅2", `Klick auf fremden Knopf = mit-reagieren (✅2 bei der Leitung) – ${JSON.stringify(k)}`);
  await reihe(b.page, 1).locator(".zv-reaktion").first().click();
  await b.page.waitForFunction((id) => document.querySelector(`[data-nachricht-id="${id}"]`)?.parentElement?.querySelector(".zv-reaktion")?.textContent?.includes("1"), ids[1]);
  k = await knoepfe(b.page, 1);
  pruefe(k[0]?.text === "✅1" && !k[0].meine, `Zweiter Klick nimmt zurück (✅1, nicht meine) – ${JSON.stringify(k)}`);

  // 3: "+" -> Fenster ---------------------------------------------------------------
  await reihe(l.page, 3).locator(".zv-blase").hover();
  await reihe(l.page, 3).getByRole("button", { name: "Anderen Smiley wählen" }).click();
  const fenster = l.page.getByRole("dialog", { name: "Reaktion wählen" });
  pruefe(await fenster.isVisible(), "\"+\" öffnet die Smiley-Auswahl im Fenster");
  await fenster.getByLabel("Smiley suchen").fill("kaffee");
  await fenster.locator(".zv-smiley").first().click();
  await reihe(l.page, 3).locator(".zv-reaktion").first().waitFor();
  k = await knoepfe(l.page, 3);
  pruefe(k[0]?.text === "☕1" && k[0].meine && !(await fenster.isVisible()), `Wahl über Suche "kaffee" setzt ☕ und schließt das Fenster – ${JSON.stringify(k)}`);

  // 4: Wer hat reagiert ----------------------------------------------------------------
  await reihe(l.page, 5).locator(".zv-blase").hover();
  await reihe(l.page, 5).getByRole("button", { name: "Wer hat reagiert?" }).click();
  const wer = l.page.getByRole("dialog", { name: "Reaktionen" });
  const zeilen = await wer.locator(".zv-reaktionen-personen li").allInnerTexts();
  pruefe(zeilen.length === 2 && zeilen[0].startsWith("Du"), `Namensliste: zwei Zeilen, eigene zuerst als „Du“ – ${JSON.stringify(zeilen)}`);
  pruefe(zeilen.some((z) => z.length > 3 && !z.startsWith("Du")), "Namensliste nennt die andere Person mit Namen");
  await wer.getByRole("button", { name: "Entfernen" }).click();
  await l.page.waitForFunction((id) => document.querySelector(`[data-nachricht-id="${id}"]`)?.parentElement?.querySelectorAll(".zv-reaktion").length === 1, ids[5]);
  pruefe((await knoepfe(l.page, 5)).length === 1, "„Entfernen“ in der Namensliste nimmt die eigene Reaktion zurück");
  await l.page.keyboard.press("Escape");

  // 5: Smiley-Knopf in der Eingabe -----------------------------------------------------
  const feld = l.page.getByLabel("Nachricht", { exact: true });
  await feld.fill("Bis morgen");
  await feld.evaluate((el) => el.setSelectionRange(3, 3));
  await l.page.getByRole("button", { name: "Smiley einfügen" }).click();
  const aufklapp = l.page.locator(".zv-chat-smiley-aufklapp");
  pruefe(await aufklapp.isVisible(), "Smiley-Knopf öffnet die Auswahl über dem Textfeld");
  pruefe((await aufklapp.locator(".zv-smiley-titel").first().innerText()).toLowerCase().includes("zuletzt"), "Auswahl beginnt mit „Zuletzt verwendet“");
  await aufklapp.getByLabel("Smiley suchen").fill("daumen");
  const erster = await aufklapp.locator(".zv-smiley").first().innerText();
  pruefe(erster === "👍", `Suche „daumen“ liefert zuerst 👍 (war ${erster})`);
  await aufklapp.locator(".zv-smiley").first().click();
  pruefe((await feld.inputValue()) === "Bis👍 morgen", `Einsetzen an der Cursorposition (${await feld.inputValue()})`);
  pruefe(await aufklapp.isVisible(), "Auswahl bleibt für weitere Smileys offen");
  await l.page.keyboard.press("Escape");
  pruefe(!(await aufklapp.isVisible()), "Escape schließt die Auswahl");
  await feld.fill("");

  // 6: Leiste ganz oben klappt nach unten -------------------------------------------------
  await l.page.locator(".zv-chat-nachrichten").evaluate((el) => (el.scrollTop = 0));
  const oberste = l.page.locator(".zv-blase-reihe").first();
  await oberste.locator(".zv-blase").hover();
  const lage = await l.page.evaluate(() => {
    const leiste = document.querySelector(".zv-reaktionsleiste-schwebend");
    const bereich = document.querySelector(".zv-chat-nachrichten");
    if (!leiste || !bereich) return null;
    return { unten: leiste.classList.contains("unten"), oben: leiste.getBoundingClientRect().top - bereich.getBoundingClientRect().top };
  });
  pruefe(lage !== null && lage.oben >= 0, `Oberste Nachricht: Leiste liegt im Scrollbereich (Abstand ${lage?.oben?.toFixed(0)} px, unten=${lage?.unten})`);

  if (bilderOrdner) {
    // Zustand fuer das Bild: Leiste ueber einer Nachricht, Auswahl in der Eingabe offen
    const shot = await anmelden(leitungEmail, { colorScheme: "dark", viewport: { width: 1440, height: 900 }, dsf: 2 });
    await oeffneGruppe(shot.page);
    await shot.page.waitForTimeout(300);
    await reihe(shot.page, 3).locator(".zv-blase").hover();
    await shot.page.screenshot({ path: `${bilderOrdner}/umgesetzt-1-reagieren-dunkel.png` });
    await shot.page.getByRole("button", { name: "Smiley einfügen" }).click();
    await shot.page.mouse.move(5, 5);
    await shot.page.screenshot({ path: `${bilderOrdner}/umgesetzt-2-smiley-auswahl-dunkel.png` });
    await shot.context.close();
  }

  // 9: Kontrast -------------------------------------------------------------------------
  for (const schema of ["light", "dark"]) {
    await l.page.emulateMedia({ colorScheme: schema });
    await l.page.evaluate((s) => document.documentElement.setAttribute("data-theme", s === "dark" ? "dunkel" : "hell"), schema);
    await l.page.waitForTimeout(100);
    const normal = await kontrast(l.page, ".zv-reaktion:not(.meine)");
    const meine = await kontrast(l.page, ".zv-reaktion.meine");
    pruefe(normal !== null && normal >= 4.5, `Kontrast Reaktionsknopf (${schema}): ${normal?.toFixed(2)}:1`);
    pruefe(meine !== null && meine >= 4.5, `Kontrast eigener Reaktionsknopf (${schema}): ${meine?.toFixed(2)}:1`);
  }
  await l.context.close();
  await b.context.close();

  // 7: Handy ------------------------------------------------------------------------------
  const h = await anmelden(betreuerEmail, { viewport: { width: 390, height: 800 }, mobil: true, dsf: bilderOrdner ? 3 : 1 });
  await oeffneGruppe(h.page);
  pruefe(await h.page.evaluate(() => window.matchMedia("(hover: none)").matches), "Handy-Kontext meldet (hover: none)");
  pruefe(!(await h.page.getByRole("button", { name: "Smiley einfügen" }).isVisible()), "Handy: kein eigener Smiley-Knopf (Tastatur hat Emojis)");
  pruefe((await h.page.locator(".zv-blase-reagieren:visible").count()) === 0, "Handy: kein Reagieren-Knopf in der Blase");

  const cdp = await h.context.newCDPSession(h.page);
  async function langDruecken(i) {
    const box = await reihe(h.page, i).locator(".zv-blase-text").boundingBox();
    const p = { x: box.x + 20, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await h.page.waitForTimeout(650);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await langDruecken(1);
  const menue = h.page.getByRole("dialog");
  pruefe(await menue.isVisible(), "Lang drücken öffnet das Nachrichten-Menü");
  pruefe((await menue.locator(".zv-reaktionsleiste-zeichen").count()) === 6, "Menü zeigt die sechs Schnellreaktionen");
  pruefe(await menue.getByRole("button", { name: /Text kopieren/ }).isVisible(), "Menü bietet „Text kopieren“");
  pruefe((await menue.getByRole("button", { name: /löschen/i }).count()) === 0, "Fremde Nachricht: kein „Löschen“ im Menü");
  if (bilderOrdner) await h.page.screenshot({ path: `${bilderOrdner}/umgesetzt-3-handy-lang-druecken-hell.png` });
  await menue.getByRole("button", { name: /Mit herz reagieren/ }).click();
  await reihe(h.page, 1).locator(".zv-reaktion.meine").first().waitFor();
  k = await knoepfe(h.page, 1);
  pruefe(k.some((x) => x.text === "❤️1" && x.meine), `Tippen auf ❤️ im Menü setzt die Reaktion – ${JSON.stringify(k)}`);

  // Doppeltippen auf eine Nachricht ohne eigene Reaktion
  const box = await reihe(h.page, 3).locator(".zv-blase-text").boundingBox();
  await h.page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
  await h.page.waitForTimeout(80);
  await h.page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
  await h.page.waitForFunction((id) => document.querySelector(`[data-nachricht-id="${id}"]`)?.parentElement?.querySelector(".zv-reaktion.meine"), ids[3]).catch(() => undefined);
  k = await knoepfe(h.page, 3);
  pruefe(k.some((x) => x.text.startsWith("👍") && x.meine), `Doppeltippen gibt 👍 – ${JSON.stringify(k)}`);

  // Lang druecken auf eigene Nachricht: Loeschen wird angeboten
  await langDruecken(2);
  pruefe(await h.page.getByRole("dialog").getByRole("button", { name: /Nachricht löschen/ }).isVisible(), "Eigene Nachricht: „Nachricht löschen“ im Menü");
  await h.page.keyboard.press("Escape");
  if (bilderOrdner) {
    await h.page.waitForTimeout(200);
    await h.page.screenshot({ path: `${bilderOrdner}/umgesetzt-4-handy-reaktionen-hell.png` });
  }
  await h.context.close();

  // 8: Ueberlauf --------------------------------------------------------------------------
  for (const breite of [320, 390, 768, 1280]) {
    for (const schema of ["light", "dark"]) {
      const mobil = breite < 768;
      const c = await anmelden(leitungEmail, { viewport: { width: breite, height: 800 }, colorScheme: schema, mobil });
      await oeffneGruppe(c.page);
      pruefe(!(await ueberlauf(c.page)), `Kein horizontaler Überlauf bei ${breite} px (${schema})`);
      await c.context.close();
    }
  }
} catch (err) {
  fehler.push(`Abbruch: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
}

if (messungen < MINDEST_MESSUNGEN) fehler.push(`Nur ${messungen} Messungen, erwartet mindestens ${MINDEST_MESSUNGEN}`);
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
if (fehler.length > 0) {
  for (const f of fehler) console.log(`  - ${f}`);
  process.exit(1);
}
