/**
 * Browserpruefung „Bausteine per Griff verschieben“ (Rueckmeldung 41c5627f).
 * Misst statt anzusehen:
 *
 *   1 Jede Zeile im Aufbau hat rechts am Ende einen Griff aus drei Strichen.
 *   2 Ziehen in einen Abschnitt hinein, zwischen zwei seiner Bausteine.
 *   3 Ziehen aus einem Abschnitt hinaus, unter den Abschnitt.
 *   4 Einen ganzen Abschnitt verschieben (bleibt oben, nie in einem anderen).
 *   5 Escape bricht einen Zug ab, nichts aendert sich.
 *   6 Tastatur: Pfeiltasten am Griff verschieben, der Fokus bleibt am Griff.
 *   7 Die neue Reihenfolge ist gespeichert (nach dem Neuladen noch da).
 *   8 Griff verhindert das Scrollen per Finger (touch-action: none), Ziel
 *     mind. 32 px hoch; kein horizontaler Ueberlauf bei 1440 px.
 *
 * Voraussetzung: laufende API (:3000) und Dev-Server (:5173), eine Leitung
 * mit Recht protokolle.formulare-verwalten. Kein Bestandteil der CI.
 *
 *   node scripts/formular-griff-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node formular-griff-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
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
const formularName = `Griffprobe ${Date.now().toString(36)}`;
await page.locator("#zv-neues-formular-name").fill(formularName);
await page.getByRole("button", { name: "Anlegen und bauen" }).click();
await page.locator(".zv-fe").waitFor();

const kasten = page.locator(".zv-fe-kasten");
const beschriften = (t) => page.locator(".zv-fe-eig input").first().fill(t);
await kasten.getByRole("button", { name: "Ja/Nein" }).click();
await beschriften("Eins");
await kasten.getByRole("button", { name: "Abschnitt" }).click();
await beschriften("Teil");
await kasten.getByRole("button", { name: "Kurztext", exact: true }).click();
await beschriften("Zwei");
await kasten.getByRole("button", { name: "Kurztext", exact: true }).click();
await beschriften("Drei");

/** Baum als Text, z. B. "Eins|Teil[Zwei,Drei]". */
const baum = () =>
  page.evaluate(() => {
    const lauf = (ul) =>
      [...ul.querySelectorAll(":scope > li[data-fe-knoten]")]
        .map((li) => {
          const t = li.querySelector(":scope > .zv-fe-zeilen-rahmen .zv-fe-beschriftung").textContent.trim();
          const kinder = li.querySelector(":scope > ul");
          return kinder ? `${t}[${lauf(kinder).join(",")}]` : t;
        });
    return lauf(document.querySelector(".zv-fe-mitte > .zv-fe-baum")).join("|");
  });
const zeile = (t) => page.locator(".zv-fe-zeilen-rahmen", { has: page.locator(".zv-fe-beschriftung", { hasText: new RegExp(`^${t}$`) }) }).first();
const knoten = (t) => page.locator("li[data-fe-knoten]", { has: zeile(t) }).last();

pruefe((await baum()) === "Eins|Teil[Zwei,Drei]", `Ausgangslage: ${await baum()}`);

// ===== 1 Griff =====
const griffe = await page.evaluate(() =>
  [...document.querySelectorAll(".zv-fe-zeilen-rahmen")].map((r) => {
    const g = r.querySelector(".zv-fe-griff");
    const z = r.querySelector(".zv-fe-zeile");
    if (!g) return null;
    const gr = g.getBoundingClientRect();
    const rr = r.getBoundingClientRect();
    return {
      rechtsBuendig: Math.abs(gr.right - rr.right) <= 1,
      rechtsNebenZeile: gr.left >= z.getBoundingClientRect().right,
      striche: g.querySelectorAll("svg line, svg path").length,
      hoehe: gr.height,
      touch: getComputedStyle(g).touchAction,
    };
  })
);
pruefe(griffe.length === 4 && griffe.every(Boolean), `jede der 4 Zeilen hat einen Griff (${griffe.filter(Boolean).length})`);
pruefe(griffe.every((g) => g?.rechtsBuendig && g.rechtsNebenZeile), "Griff sitzt rechts am Ende der Zeile");
pruefe(griffe.every((g) => g?.striche === 3), `Griff zeigt drei Striche (${griffe.map((g) => g?.striche).join(",")})`);
pruefe(griffe.every((g) => g?.hoehe >= 32), `Griff mindestens 32 px hoch (${griffe.map((g) => Math.round(g?.hoehe)).join(",")})`);
pruefe(griffe.every((g) => g?.touch === "none"), "Griff: touch-action none (Finger zieht statt zu scrollen)");

async function ziehe(wer, zielY, { abbrechen = false, bildName } = {}) {
  const g = await zeile(wer).locator(".zv-fe-griff").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  const y = typeof zielY === "function" ? await zielY() : zielY;
  await page.mouse.move(g.x + g.width / 2, y, { steps: 12 });
  const linie = await page.evaluate(() => document.querySelectorAll(".zv-fe-ziel-vor, .zv-fe-ziel-nach, .zv-fe-ziel-anfang").length);
  if (bildName) await bild(page, bildName);
  if (abbrechen) await page.keyboard.press("Escape");
  await page.mouse.up();
  return linie;
}
const box = async (loc) => await loc.boundingBox();

// ===== 2 In den Abschnitt hinein =====
let linie = await ziehe("Eins", async () => {
  const b = await box(zeile("Drei"));
  return b.y + b.height * 0.25;
}, { bildName: "1-ziehen-in-abschnitt" });
pruefe(linie === 1, "während des Ziehens zeigt genau eine Einfügelinie das Ziel");
pruefe((await baum()) === "Teil[Zwei,Eins,Drei]", `Eins in den Abschnitt zwischen Zwei und Drei: ${await baum()}`);

// ===== 3 Aus dem Abschnitt hinaus =====
await ziehe("Drei", async () => {
  const b = await box(knoten("Teil"));
  return b.y + b.height + 16;
});
pruefe((await baum()) === "Teil[Zwei,Eins]|Drei", `Drei aus dem Abschnitt unter ihn: ${await baum()}`);

// ===== 4 Abschnitt verschieben =====
await ziehe("Teil", async () => {
  const b = await box(zeile("Drei"));
  return b.y + b.height * 0.75;
});
pruefe((await baum()) === "Drei|Teil[Zwei,Eins]", `Abschnitt unter Drei verschoben: ${await baum()}`);
await ziehe("Teil", async () => {
  const b = await box(zeile("Zwei"));
  return b.y + b.height * 0.5;
});
pruefe((await baum()).startsWith("Drei|Teil["), `Abschnitt landet nie in sich selbst/anderem Abschnitt: ${await baum()}`);

// ===== 5 Escape =====
const vorher = await baum();
await ziehe("Drei", async () => {
  const b = await box(zeile("Eins"));
  return b.y + b.height * 0.75;
}, { abbrechen: true });
pruefe((await baum()) === vorher, `Escape bricht ab: ${await baum()}`);

// ===== 6 Tastatur =====
await zeile("Eins").locator(".zv-fe-griff").focus();
await page.keyboard.press("ArrowUp");
pruefe((await baum()) === "Drei|Teil[Eins,Zwei]", `Pfeil hoch am Griff: ${await baum()}`);
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(100);
pruefe((await baum()) === "Drei|Eins|Teil[Zwei]", `Pfeil hoch am Rand: aus dem Abschnitt hinaus: ${await baum()}`);
const fokus = await page.evaluate(() => document.activeElement?.getAttribute("data-fe-griff"));
const einsSchluessel = await zeile("Eins").locator(".zv-fe-griff").getAttribute("data-fe-griff");
pruefe(fokus === einsSchluessel, "Fokus bleibt am Griff, auch beim Wechsel aus dem Abschnitt");

// Ein Klick auf den Griff waehlt den Baustein (Eigenschaften rechts).
await zeile("Zwei").locator(".zv-fe-griff").click();
pruefe((await page.locator(".zv-fe-eig input").first().inputValue()) === "Zwei", "Klick auf den Griff wählt den Baustein");

// ===== 7 Gespeichert =====
const endstand = await baum();
await page.waitForTimeout(2500);
await page.reload();
await page.waitForTimeout(1500);
await bild(page, "3-nach-neuladen");
if (!(await page.locator(".zv-fe").count())) {
  if (!(await page.locator("#zv-organisatorisch").count())) await page.locator(".zv-aktenlippe-lasche").click();
  await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
  await page.getByText(formularName).first().click();
  await page.waitForTimeout(1000);
  if (!(await page.locator(".zv-fe").count())) await page.getByRole("tab", { name: /Aufbau|Entwurf|Bearbeiten/ }).first().click().catch(() => {});
}
await page.locator(".zv-fe-baum").first().waitFor({ timeout: 15000 });
pruefe((await baum()) === endstand, `nach Neuladen gleiche Reihenfolge: ${await baum()}`);

// ===== 8 Ueberlauf =====
const ueber = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
pruefe(ueber <= 0, `kein horizontaler Überlauf bei 1440 px (${ueber})`);
await bild(page, "2-endstand");

await browser.close();
if (messungen < 18) {
  console.error(`Nur ${messungen} Messungen -- erwartet mindestens 18.`);
  process.exit(1);
}
if (fehler.length) {
  console.error(`\n${fehler.length} von ${messungen} Prüfungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${messungen} Prüfungen bestanden.`);
