/**
 * Browserpruefung "Skala" (Rueckmeldungen 49154ec7 und 6af2300c, 21.11.2026).
 * Misst statt anzusehen:
 *
 *   1 Editor: die Endbeschriftungen heissen nach der Zahl, unter der sie
 *     stehen ("Text unter der 10"), und ein Hilfetext erklaert, wo sie
 *     erscheinen.
 *   2 Ausprobieren, Skala 1-10 und 1-5: die rechte Beschriftung endet
 *     buendig mit dem letzten Knopf, die linke beginnt mit dem ersten; alle
 *     Knoepfe stehen in EINER Zeile.
 *   3 Dasselbe auf 390 px Breite, ohne horizontalen Seitenueberlauf.
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173), ein Traeger
 * mit einer Leitung (Recht protokolle.formulare-verwalten). Kein Bestandteil
 * der CI.
 *
 *   node scripts/skala-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node skala-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
  process.exit(1);
}
const BASIS = "http://localhost:5173";
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const bild = async (page, name) => bilder && (await page.screenshot({ path: `${bilder}/${name}.png` }));

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(BASIS + "/");
await page.evaluate(() => localStorage.clear());
await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/i }).click();
await page.getByRole("button", { name: /^Klienten$/ }).first().waitFor({ timeout: 15000 });

await page.locator(".zv-aktenlippe-lasche").click();
await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
await page.getByRole("heading", { name: "Formulare", level: 2 }).waitFor();
await page.getByRole("button", { name: "Neues Formular" }).click();
await page.locator("#zv-neues-formular-name").fill(`Skala ${Date.now().toString(36)}`);
await page.getByRole("button", { name: "Anlegen und bauen" }).click();
await page.getByText("In Entwicklung: wird noch nirgends").waitFor();

// ===== 1 Editor =====
await page.locator(".zv-fe-kasten").getByRole("button", { name: "Skala" }).click();
const eig = page.locator(".zv-fe-eig");
await eig.locator("input").first().fill("Wie geht es dir?");
await eig.getByLabel("Bis", { exact: true }).fill("10");
pruefe((await eig.getByLabel("Text unter der 1", { exact: true }).count()) === 1, "Editor: Feld heißt „Text unter der 1“");
pruefe((await eig.getByLabel("Text unter der 10", { exact: true }).count()) === 1, "Editor: Feld heißt „Text unter der 10“ (folgt dem Bis-Wert)");
await eig.getByLabel("Text unter der 1", { exact: true }).fill("sehr schlecht");
await eig.getByLabel("Text unter der 10", { exact: true }).fill("sehr gut");
const hilfe = await eig.getByText(/Beim Ausfüllen steht dieser Text/).innerText();
pruefe(/kleinsten und der größten Zahl/.test(hilfe) && /7 von 10/.test(hilfe), "Editor: Hilfetext erklärt, wo die Beschriftung erscheint");
pruefe((await eig.getByLabel("Text unter der 10", { exact: true }).getAttribute("aria-describedby")) !== null, "Editor: Hilfetext ist dem Feld zugeordnet (aria-describedby)");
await page.getByText(/Entwurf gespeichert/).waitFor({ timeout: 10000 });
await bild(page, "1-editor");

async function messeSkala(p, wo) {
  const m = await p.evaluate(() => {
    const s = document.querySelector(".zv-fe-probe .zv-protokoll-skala");
    const knoepfe = [...s.querySelectorAll(".zv-protokoll-knoepfe button")].map((b) => b.getBoundingClientRect());
    const enden = [...s.querySelectorAll(".zv-protokoll-skala-enden span")].map((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      return r.getBoundingClientRect();
    });
    return {
      anzahl: knoepfe.length,
      zeilen: new Set(knoepfe.map((k) => Math.round(k.top))).size,
      ersterLinks: knoepfe[0].left,
      letzterRechts: knoepfe[knoepfe.length - 1].right,
      textLinks: enden[0].left,
      textRechts: enden[1].right,
      kleinsterKnopf: Math.min(...knoepfe.map((k) => k.width)),
      ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  pruefe(m.zeilen === 1, `${wo}: alle ${m.anzahl} Knöpfe in einer Zeile`);
  pruefe(Math.abs(m.textRechts - m.letzterRechts) <= 1, `${wo}: rechte Beschriftung endet unter dem letzten Knopf (${m.textRechts.toFixed(1)} / ${m.letzterRechts.toFixed(1)})`);
  pruefe(Math.abs(m.textLinks - m.ersterLinks) <= 1, `${wo}: linke Beschriftung beginnt unter dem ersten Knopf (${m.textLinks.toFixed(1)} / ${m.ersterLinks.toFixed(1)})`);
  pruefe(m.kleinsterKnopf >= (p.viewportSize().width > 800 ? 47 : 27), `${wo}: Knöpfe breit genug (Desktop 48, Handy ≥ 28 px) (${m.kleinsterKnopf.toFixed(1)})`);
  pruefe(m.ueberlauf <= 0, `${wo}: kein horizontaler Seitenüberlauf (${m.ueberlauf})`);
}

// ===== 2 Ausprobieren =====
await page.getByRole("tab", { name: "Ausprobieren" }).click();
await page.locator(".zv-fe-probe .zv-protokoll-skala").waitFor();
await messeSkala(page, "1440 px, Skala 1–10");
await bild(page, "2-probe-1-10");

await page.getByRole("tab", { name: "Aufbau" }).click().catch(() => {});
await page.locator(".zv-fe-knoten", { hasText: "Wie geht es dir?" }).first().click().catch(() => {});
if (await eig.getByLabel("Bis", { exact: true }).count()) {
  await eig.getByLabel("Bis", { exact: true }).fill("5");
  await page.getByRole("tab", { name: "Ausprobieren" }).click();
  await page.locator(".zv-fe-probe .zv-protokoll-skala").waitFor();
  await messeSkala(page, "1440 px, Skala 1–5");
  await bild(page, "3-probe-1-5");
  await page.getByRole("tab", { name: "Aufbau" }).click().catch(() => {});
  await page.locator(".zv-fe-knoten", { hasText: "Wie geht es dir?" }).first().click().catch(() => {});
  await eig.getByLabel("Bis", { exact: true }).fill("10");
  await page.getByText(/Entwurf gespeichert/).waitFor({ timeout: 10000 });
}

// ===== 3 Handy =====
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("tab", { name: "Ausprobieren" }).click();
await page.locator(".zv-fe-probe .zv-protokoll-skala").waitFor();
await page.locator(".zv-fe-probe .zv-protokoll-skala").scrollIntoViewIfNeeded();
await messeSkala(page, "390 px, Skala 1–10");
await bild(page, "4-probe-handy");

await browser.close();
if (messungen < 12) {
  console.error(`Zu wenige Messungen (${messungen}) -- die Prüfung hat nicht wirklich gemessen.`);
  process.exit(1);
}
console.log(fehler.length ? `\n${fehler.length} Fehler` : `\nAlle ${messungen} Prüfungen bestanden.`);
process.exit(fehler.length ? 1 : 0);
