// Protokoll-Ansicht, gemessen im echten Browser (Rueckmeldung "Ansicht
// Protokolle", Konzept /mnt/project-files/protokoll-ansicht/).
//
// Auslöser war ein Datum, das im 440-px-Fenster Zeichen für Zeichen
// untereinander stand: die Beschriftungsspalte nahm sich fest 14 rem, die
// Plakette eine eigene Spalte, dem Wert blieben 36 px. Gemessen wird deshalb
// an JEDER Zeile der lesenden Ansicht:
//
//   - Inhalt ab 520 px: zwei Spalten, Wertzelle >= 12 rem (192 px), Beschriftung
//     links davon. Darunter: Beschriftung über dem Wert. Langtext immer gestapelt.
//   - Einzeilige Werte (Datum, Uhrzeit, Zahl, Berechnung) haben genau eine
//     Zeilenbox (getClientRects().length === 1) und höchstens 1,6 x Schriftgrad Höhe.
//   - Kein waagrechter Überlauf (scrollWidth <= clientWidth) an Zeile,
//     Ansicht und dem umgebenden Panel bzw. Fenster.
//
// Ablauf:
//   1 Seite Dokumentation, 1780 px: Protokoll öffnet im breiten Fenster (Variante B).
//   2 "In der Akte öffnen": Akte steht auf Dokumentation › Protokolle, mit Rücksprung.
//   3 Rücksprung: Tagesberichte, der Bericht ist markiert und sichtbar.
//   4 Protokoll-Knopf in der Akte: öffnet im SELBEN Panel, kein drittes Fenster (Variante A).
//   5 Vollbild der Akte: weiter zweispaltig, Ansicht <= 760 px.
//   6 Schmal (400 px): gestapelt, Seite läuft nicht waagrecht über.
//
// Braucht API + Dev-Server und ein Konto mit mind. einem Tagesbericht, an dem
// ein abgeschlossenes Protokoll mit Datumsfeld hängt:
//   BASIS_URL=http://localhost:5173 node scripts/protokoll-ansicht-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
import { chromium } from "playwright";

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node protokoll-ansicht-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
  process.exit(2);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
// Jede Ansicht muss mindestens so viele Zeilen haben, sonst misst das Skript
// an einem leeren Protokoll "alles in Ordnung".
const MINDEST_ZEILEN = 3;
const MINDEST_MESSUNGEN = 120;

const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const page = await browser.newPage({ viewport: { width: 1780, height: 1023 }, colorScheme: "dark" });
const fehler = [];
let messungen = 0;
function pruefe(ok, text) {
  messungen += 1;
  console.log(`${ok ? "OK  " : "FEHL"} ${text}`);
  if (!ok) fehler.push(text);
}
const bild = async (name) => bilder && page.screenshot({ path: `${bilder}/${name}.png` });

/** Misst alle Zeilen der lesenden Ansicht innerhalb von `rahmen` (CSS-Selektor). */
async function messeAnsicht(name, rahmen) {
  const m = await page.evaluate((rahmen) => {
    const r = document.querySelector(rahmen);
    const lesen = r?.querySelector(".zv-protokoll-lesen");
    if (!r || !lesen) return null;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const zeilen = [...lesen.querySelectorAll(".zv-protokoll-zeile")].map((z) => {
      const label = z.querySelector(".zv-protokoll-label").getBoundingClientRect();
      const zelle = z.querySelector(".zv-protokoll-wertzelle").getBoundingClientRect();
      const wert = z.querySelector(".zv-protokoll-wert");
      return {
        text: z.querySelector(".zv-protokoll-label").textContent.trim(),
        voll: z.classList.contains("zv-protokoll-zeile-voll"),
        labelRechts: label.right,
        labelUnten: label.bottom,
        zelleLinks: zelle.left,
        zelleOben: zelle.top,
        zelleBreite: zelle.width,
        ueberlauf: z.scrollWidth - z.clientWidth,
        einzeilig: wert.classList.contains("zv-protokoll-wert-einzeilig"),
        zeilenboxen: wert.getClientRects().length,
        hoehe: wert.getBoundingClientRect().height,
        schrift: parseFloat(getComputedStyle(wert).fontSize),
      };
    });
    return {
      rem,
      breite: lesen.clientWidth,
      lesenUeberlauf: lesen.scrollWidth - lesen.clientWidth,
      rahmenUeberlauf: r.scrollWidth - r.clientWidth,
      rahmenBreite: r.getBoundingClientRect().width,
      zeilen,
    };
  }, rahmen);
  if (!m) {
    pruefe(false, `${name}: keine lesende Protokoll-Ansicht in ${rahmen}`);
    return null;
  }
  const breit = m.breite >= 520;
  const minWert = 12 * m.rem;
  pruefe(m.zeilen.length >= MINDEST_ZEILEN, `${name}: ${m.zeilen.length} Zeilen gemessen (>= ${MINDEST_ZEILEN})`);
  pruefe(m.zeilen.some((z) => z.einzeilig), `${name}: mind. ein einzeiliger Wert (Datum/Uhrzeit/Zahl) dabei`);
  for (const z of m.zeilen) {
    if (breit && !z.voll) {
      pruefe(
        z.zelleLinks >= z.labelRechts - 0.5 && z.zelleBreite >= minWert - 0.5,
        `${name} „${z.text}“: zweispaltig, Wertzelle ${Math.round(z.zelleBreite)} px >= ${minWert} px`
      );
    } else {
      pruefe(z.zelleOben >= z.labelUnten - 0.5, `${name} „${z.text}“: Beschriftung über dem Wert${z.voll ? " (volle Breite)" : ""}`);
    }
    if (z.einzeilig) {
      pruefe(
        z.zeilenboxen === 1 && z.hoehe <= z.schrift * 1.6,
        `${name} „${z.text}“: Wert einzeilig (${z.zeilenboxen} Zeilenbox, ${Math.round(z.hoehe)} px <= ${Math.round(z.schrift * 1.6)} px)`
      );
    }
    pruefe(z.ueberlauf <= 0, `${name} „${z.text}“: kein waagrechter Überlauf (${z.ueberlauf})`);
  }
  pruefe(m.lesenUeberlauf <= 0 && m.rahmenUeberlauf <= 0, `${name}: Ansicht ${m.breite} px und Rahmen ${Math.round(m.rahmenBreite)} px ohne Überlauf (${m.lesenUeberlauf}/${m.rahmenUeberlauf})`);
  return m;
}

await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/ }).click();
const nav = page.getByRole("navigation", { name: "Hauptmenü" });
await nav.waitFor({ timeout: 15000 });
await page.evaluate(() => {
  sessionStorage.removeItem("zv-akte-ansicht");
  sessionStorage.setItem("zv-dokumentation-teil", "tagesberichte");
});

// ===== 1 Seite Dokumentation: breites Fenster =====
await nav.getByRole("button", { name: /^Dokumentation$/ }).first().click();
const knopf = page.locator(".zv-tagesbericht-protokoll").first();
await knopf.waitFor({ timeout: 10000 });
await knopf.click();
await page.locator(".zv-modal .zv-protokoll-lesen .zv-protokoll-zeile").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
const fensterBreite = await page.evaluate(() => document.querySelector(".zv-modal").getBoundingClientRect().width);
pruefe(
  (await page.locator(".zv-modal.zv-modal-breit").count()) === 1 && fensterBreite >= 780,
  `Seite Dokumentation: breites Fenster ${Math.round(fensterBreite)} px (>= 780 px statt 440 px)`
);
pruefe((await page.locator(".zv-modal .zv-modal-vollbild-knopf").count()) === 1, "breites Fenster hat einen Vollbild-Knopf");
await messeAnsicht("Fenster", ".zv-modal-inhalt");
await bild("1-fenster");

// Der Fall aus der Rueckmeldung: dieselbe Ansicht im 440-px-Fenster bei 1780 px
// Fensterbreite. Das allgemeine Modal bleibt 440 px breit (kurze Formulare),
// und die Formular-Vorschau benutzt dieselbe Ansicht -- sie muss dort stapeln.
await page.evaluate(() => document.querySelector(".zv-modal").classList.remove("zv-modal-breit"));
await page.waitForTimeout(300);
const m440 = await messeAnsicht("440-px-Fenster", ".zv-modal-inhalt");
if (m440) pruefe(m440.breite < 520, `440-px-Fenster: Ansicht ${m440.breite} px < 520 px -- sonst misst dieser Teil keine Stapelung`);
await bild("1b-fenster-440");
await page.evaluate(() => document.querySelector(".zv-modal").classList.add("zv-modal-breit"));
await page.waitForTimeout(300);

// ===== 2 In der Akte öffnen =====
await page.getByRole("button", { name: "In der Akte öffnen" }).click();
const ruecksprung = page.locator(".zv-seitenpanel.zv-offen .zv-protokoll-zurueck-tagesbericht");
await ruecksprung.waitFor({ timeout: 10000 });
await page.locator(".zv-seitenpanel.zv-offen .zv-protokoll-lesen .zv-protokoll-zeile").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
const rueckText = (await ruecksprung.innerText()).trim();
pruefe(/^Zurück zum Tagesbericht vom \d{2}\.\d{2}\.\d{4}$/.test(rueckText), `Akte: Rücksprung „${rueckText}“`);
pruefe((await page.locator(".zv-modal").count()) === 0, "Akte: kein zusätzliches Fenster offen");
const umschalter = await page.locator(".zv-seitenpanel.zv-offen [role=radiogroup][aria-label='Art der Dokumentation'] [aria-checked=true]").innerText();
pruefe(umschalter.trim() === "Protokolle", `Akte steht auf Dokumentation › ${umschalter.trim()}`);
await messeAnsicht("Akte aus Fenster", ".zv-seitenpanel.zv-offen .zv-seitenpanel-inhalt");

// ===== 3 Rücksprung =====
await ruecksprung.click();
const markiert = page.locator(".zv-seitenpanel.zv-offen .zv-tagesbericht-markiert");
await markiert.waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
const sicht = await page.evaluate(() => {
  const z = document.querySelector(".zv-seitenpanel.zv-offen .zv-tagesbericht-markiert").getBoundingClientRect();
  const c = document.querySelector(".zv-seitenpanel.zv-offen .zv-seitenpanel-inhalt").getBoundingClientRect();
  return { oben: z.top, unten: z.bottom, cOben: c.top, cUnten: c.bottom };
});
pruefe(
  (await markiert.count()) === 1 && sicht.oben < sicht.cUnten && sicht.unten > sicht.cOben,
  `Rücksprung: ein Bericht markiert und im Panel sichtbar (${Math.round(sicht.oben)}..${Math.round(sicht.unten)} in ${Math.round(sicht.cOben)}..${Math.round(sicht.cUnten)})`
);
pruefe(
  rueckText.endsWith(await markiert.locator(".zv-liste-zelle-titel").innerText().then((t) => t.trim())),
  "Rücksprung: markierter Bericht hat das Datum aus dem Link"
);
await bild("3-ruecksprung");

// ===== 4 Variante A: im selben Panel =====
await markiert.locator(".zv-tagesbericht-protokoll").first().click();
await page.locator(".zv-seitenpanel.zv-offen .zv-protokoll-lesen .zv-protokoll-zeile").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
pruefe((await page.locator(".zv-modal").count()) === 0, "Akte: Protokoll-Knopf öffnet kein drittes Fenster");
pruefe((await ruecksprung.count()) === 1, "Akte: Rücksprung auch beim Öffnen aus der Akte");
pruefe((await page.locator(".zv-seitenpanel.zv-offen").getByRole("button", { name: "Korrigieren" }).count()) <= 1, "Akte: Korrigieren steht (falls berechtigt) direkt in der Ansicht");
await messeAnsicht("Akte 1780", ".zv-seitenpanel.zv-offen .zv-seitenpanel-inhalt");
await bild("4-akte");

// ===== 5 Vollbild =====
await page.locator(".zv-seitenpanel.zv-offen .zv-seitenpanel-vollbild-knopf").click();
await page.waitForTimeout(600);
const mv = await messeAnsicht("Vollbild", ".zv-seitenpanel.zv-offen .zv-seitenpanel-inhalt");
if (mv) pruefe(mv.breite <= 760, `Vollbild: Ansicht auf 760 px begrenzt (${mv.breite})`);
await page.locator(".zv-seitenpanel.zv-offen .zv-seitenpanel-vollbild-knopf").click();
await page.waitForTimeout(400);

// ===== 6 Schmal =====
await page.setViewportSize({ width: 400, height: 800 });
await page.waitForTimeout(600);
const ms = await messeAnsicht("400 px", ".zv-seitenpanel.zv-offen .zv-seitenpanel-inhalt");
if (ms) pruefe(ms.breite < 520, `400 px: Ansicht ${ms.breite} px < 520 px -- sonst misst dieser Teil keine Stapelung`);
const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
pruefe(doc <= 0, `400 px: Seite läuft nicht waagrecht über (${doc})`);
await bild("6-schmal");

await browser.close();
if (messungen < MINDEST_MESSUNGEN) {
  console.error(`Nur ${messungen} Messungen (erwartet >= ${MINDEST_MESSUNGEN}) -- das Skript hat nicht alles erreicht.`);
  process.exit(1);
}
console.log(`\n${fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} FEHLGESCHLAGEN`} (${messungen} Messungen)`);
process.exit(fehler.length === 0 ? 0 : 1);
