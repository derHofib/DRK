/**
 * Browserpruefung „Bausteine ausrichten“ (Rueckmeldung „Bausteine“,
 * 21.11.2026: „Abmahnung kann auch in der Mitte oder rechts stehen“).
 * Misst statt anzusehen:
 *
 *   1 Editor: am Abschnitt „Mitte“, am ersten Feld „Rechts“ waehlen; die
 *     Wahl ist ein Radio (aria-checked) und erscheint als Merkmal im Baum.
 *   2 Ausprobieren: Ueberschrift mittig (Abstand der Mitten <= 2 px), Feld-
 *     beschriftung rechtsbuendig, nicht ausgerichtete Felder bleiben links;
 *     die Kinder des mittigen Abschnitts erben die Ausrichtung NICHT.
 *   3 Ansichten › Akte (lesende Ansicht, Beispieldaten): gleiche Messung,
 *     das ausgerichtete Feld ist gestapelt (Wert unter der Beschriftung).
 *   4 Handy-Vorschau und 390 px: kein waagrechter Ueberlauf.
 *
 * Voraussetzung: API (:3000), Dev-Server (:5173), ein Formular im Entwurf,
 * dessen erster Baustein ein Abschnitt ist und darin mindestens zwei
 * Eingabefelder hat. Kein Bestandteil der CI.
 *
 *   node scripts/baustein-ausrichtung-pruefung.mjs <slug> <email> <passwort> <formularname> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, email, passwort, formularName, bilder] = process.argv;
if (!slug || !email || !passwort || !formularName) {
  console.error("Nutzung: node baustein-ausrichtung-pruefung.mjs <slug> <email> <passwort> <formularname> [bilderOrdner]");
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
const MINDEST_MESSUNGEN = 14;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}
const bild = async (page, name) => bilder && (await page.screenshot({ path: `${bilder}/${name}.png` }));
const ueberlauf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Lage des TEXTES (nicht der Box) eines Elements relativ zu seinem Behaelter. */
function textLage(page, sel, behaelter) {
  return page.evaluate(
    ([sel, behaelter]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = document.createRange();
      // Nur der erste Textknoten: Plaketten hinter der Beschriftung zaehlen nicht.
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!tn) return null;
      r.selectNodeContents(tn);
      const t = r.getBoundingClientRect();
      const b = el.closest(behaelter).getBoundingClientRect();
      const cs = getComputedStyle(el.closest(behaelter));
      const innenL = b.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      const innenR = b.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      return { links: t.left - innenL, rechts: innenR - t.right, mitte: (t.left + t.right) / 2 - (innenL + innenR) / 2, top: t.top };
    },
    [sel, behaelter]
  );
}

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
const lasche = page.locator(".zv-aktenlippe-lasche");
if ((await lasche.getAttribute("aria-expanded")) === "false") await lasche.click();
await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
await page.getByText(formularName, { exact: true }).first().click();
await page.getByRole("tab", { name: "Ausprobieren" }).waitFor();

// ===== 1 Editor =====
const knoten = page.locator(".zv-fe-zeile");
const abschnitt = knoten.first();
await abschnitt.click();
const wahl = page.getByRole("radiogroup", { name: "Ausrichtung" });
await wahl.getByRole("radio", { name: "Mitte" }).click();
pruefe((await wahl.getByRole("radio", { name: "Mitte" }).getAttribute("aria-checked")) === "true", "Abschnitt: „Mitte“ ist gewählt (aria-checked)");
pruefe((await abschnitt.locator(".zv-fe-merkmal", { hasText: "mittig" }).count()) === 1, "Baum zeigt am Abschnitt das Merkmal „mittig“");
// Erstes Eingabefeld im Abschnitt (Hinweise uebersprungen).
const felder = page.locator(".zv-fe-knoten-abschnitt .zv-fe-baum .zv-fe-zeile").filter({ hasNot: page.locator(".zv-fe-typ", { hasText: /Hinweis/i }) });
const feldName = (await felder.first().locator(".zv-fe-beschriftung").innerText()).trim();
const letzterName = (await felder.last().locator(".zv-fe-beschriftung").innerText()).trim();
await felder.first().click();
await wahl.getByRole("radio", { name: "Rechts" }).click();
pruefe((await felder.first().locator(".zv-fe-merkmal", { hasText: "rechts" }).count()) === 1, `Feld „${feldName}“: Merkmal „rechts“ im Baum`);
await bild(page, "1-editor");
await page.getByText("Entwurf gespeichert").waitFor({ timeout: 10000 });

// ===== 2 Ausprobieren =====
await page.getByRole("tab", { name: "Ausprobieren" }).click();
await page.locator(".zv-protokoll legend").first().waitFor();
const leg = await textLage(page, ".zv-protokoll .zv-protokoll-abschnitt > legend", ".zv-protokoll-abschnitt");
pruefe(leg && Math.abs(leg.mitte) <= 2, `Ausprobieren: Überschrift mittig (Versatz ${leg?.mitte.toFixed(1)} px)`);
const lagen = await page.evaluate((namen) => {
  const out = {};
  for (const lab of document.querySelectorAll(".zv-protokoll .zv-field > label")) {
    const n = lab.childNodes[0]?.textContent?.trim();
    if (!namen.includes(n)) continue;
    const r = document.createRange();
    r.selectNodeContents(lab.childNodes[0]);
    const t = r.getBoundingClientRect();
    const f = lab.closest(".zv-field").getBoundingClientRect();
    const eingabe = lab.closest(".zv-field").querySelector("input");
    out[n] = { links: t.left - f.left, rechts: f.right - t.right, align: eingabe ? getComputedStyle(eingabe).textAlign : null };
  }
  return out;
}, [feldName, letzterName]);
pruefe(lagen[feldName] && lagen[feldName].rechts <= 1 && lagen[feldName].links > 40, `Ausprobieren: „${feldName}“ rechtsbündig (Rand rechts ${lagen[feldName]?.rechts.toFixed(1)} px)`);
pruefe(lagen[feldName]?.align === "right", `Ausprobieren: Eingabe in „${feldName}“ schreibt rechtsbündig (${lagen[feldName]?.align})`);
pruefe(lagen[letzterName] && lagen[letzterName].links <= 1, `Ausprobieren: „${letzterName}“ bleibt links, erbt die Mitte des Abschnitts nicht (${lagen[letzterName]?.links.toFixed(1)} px)`);
pruefe((await ueberlauf(page)) <= 0, "Ausprobieren: kein waagrechter Überlauf bei 1440 px");
await bild(page, "2-ausprobieren");

// ===== 3 Ansichten › Akte =====
await page.getByRole("tab", { name: "Ansichten" }).click();
await page.getByRole("group", { name: "Daten" }).getByRole("button", { name: "Beispieldaten" }).click();
await page.locator(".zv-fv-liste button, .zv-fv-liste a", { hasText: /Akte/ }).first().click();
await page.locator(".zv-protokoll-lesen").waitFor();
const h4 = await textLage(page, ".zv-protokoll-lesen .zv-protokoll-abschnitt > h4", ".zv-protokoll-abschnitt");
pruefe(h4 && Math.abs(h4.mitte) <= 2, `Ansicht: Überschrift mittig (Versatz ${h4?.mitte.toFixed(1)} px)`);
const zeilen = await page.evaluate((namen) => {
  const out = {};
  for (const z of document.querySelectorAll(".zv-protokoll-lesen .zv-protokoll-zeile")) {
    const lab = z.querySelector(".zv-protokoll-label");
    const n = lab.childNodes[0]?.textContent?.trim();
    if (!namen.includes(n)) continue;
    const r = document.createRange();
    r.selectNodeContents(lab.childNodes[0]);
    const t = r.getBoundingClientRect();
    const zb = z.getBoundingClientRect();
    const w = z.querySelector(".zv-protokoll-wert").getBoundingClientRect();
    out[n] = { rechts: zb.right - t.right, links: t.left - zb.left, gestapelt: w.top >= t.bottom - 1, wertRechts: zb.right - w.right };
  }
  return out;
}, [feldName, letzterName]);
pruefe(zeilen[feldName]?.gestapelt, `Ansicht: „${feldName}“ gestapelt (Wert unter der Beschriftung)`);
pruefe(zeilen[feldName] && zeilen[feldName].rechts <= 1 && zeilen[feldName].wertRechts <= 1, `Ansicht: Beschriftung und Wert von „${feldName}“ rechtsbündig (${zeilen[feldName]?.rechts.toFixed(1)} / ${zeilen[feldName]?.wertRechts.toFixed(1)} px)`);
pruefe(zeilen[letzterName] && zeilen[letzterName].links <= 1, `Ansicht: „${letzterName}“ bleibt links`);
await bild(page, "3-ansicht-akte");

// ===== 4 Handy =====
await page.locator(".zv-fv-liste button, .zv-fv-liste a", { hasText: /Handy/ }).first().click();
await page.locator(".zv-fv-handy legend").first().waitFor();
const hl = await textLage(page, ".zv-fv-handy .zv-protokoll-abschnitt > legend", ".zv-protokoll-abschnitt");
pruefe(hl && Math.abs(hl.mitte) <= 2, `Handy-Vorschau: Überschrift mittig (Versatz ${hl?.mitte.toFixed(1)} px)`);
pruefe(
  await page.evaluate(() => [...document.querySelectorAll(".zv-fv-handy *")].every((e) => e.scrollWidth <= e.clientWidth + 1 || getComputedStyle(e).overflowX !== "visible" || e.clientWidth === 0)),
  "Handy-Vorschau: nichts läuft waagrecht über"
);
await bild(page, "4-handy");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
pruefe((await ueberlauf(page)) <= 0, "390 px: kein waagrechter Überlauf");

await browser.close();
if (messungen < MINDEST_MESSUNGEN) {
  console.error(`Nur ${messungen} Messungen (erwartet >= ${MINDEST_MESSUNGEN}) -- das Skript misst nicht, was es soll.`);
  process.exit(1);
}
console.log(`\n${messungen} Messungen, ${fehler.length} Fehler`);
process.exit(fehler.length ? 1 : 0);
