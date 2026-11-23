/**
 * Browserpruefung "Unterschriften in Formularen" (Rueckmeldung d8e84954,
 * Migration 0087). Misst statt anzusehen:
 *
 *   1 Editor (Leitung): der Baustein "Unterschriften" bringt die vier Rollen
 *     mit, zwei nebeneinander; "Ausprobieren" zeigt zwei Zeilen mit je zwei
 *     gleich breiten Plaetzen auf gleicher Hoehe.
 *   2 Akte (Mitarbeiter:in): ein abgeschlossenes Protokoll zeigt die Plaetze
 *     im eingestellten Raster; die Mitarbeiter:in darf Klient:in und sich
 *     selbst erfassen, die Leitungsplaetze NICHT (kein Knopf).
 *     Unterschreiben ueber das Fenster: danach steht das Bild auf der Linie.
 *   3 "Heute" (Einrichtungsleitung): die offene Unterschrift steht unter
 *     "Zu erledigen"; nach dem Unterschreiben ist sie weg.
 *   4 Schmal (390 px): Plaetze untereinander, kein waagrechter Ueberlauf.
 *
 * Voraussetzung: API (:3000) und Dev-Server (:5173), ein Traeger mit
 *   - <leitung>: Recht protokolle.formulare-verwalten
 *   - <mitarbeiter>: hat das Protokoll <protokollformular> abgeschlossen
 *   - <einrichtungsleitung>: im Organigramm Einrichtungsleitung des Standorts
 * und einem abgeschlossenen Protokoll mit Unterschriften-Baustein, dessen
 * Plaetze Einrichtungsleitung, Bereichsleitung, Klient:in (neue Zeile) und
 * Mitarbeiter:in sind. Kein Bestandteil der CI.
 *
 *   node scripts/unterschrift-pruefung.mjs <slug> <passwort> <leitung> <mitarbeiter> <einrichtungsleitung> [bilderOrdner]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , slug, passwort, leitung, mitarbeiter, el, bilder] = process.argv;
if (!slug || !passwort || !leitung || !mitarbeiter || !el) {
  console.error("Nutzung: node unterschrift-pruefung.mjs <slug> <passwort> <leitung> <mitarbeiter> <einrichtungsleitung> [bilderOrdner]");
  process.exit(1);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
const MINDEST_MESSUNGEN = 25;
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const fehler = [];
let messungen = 0;
function pruefe(bedingung, beschreibung) {
  messungen++;
  if (!bedingung) fehler.push(beschreibung);
  console.log(`${bedingung ? "OK  " : "FAIL"} ${beschreibung}`);
}

async function anmelden(email, viewport = { width: 1440, height: 900 }) {
  const handy = viewport.width < 641;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: bilder ? 2 : 1, isMobile: handy, hasTouch: handy });
  const page = await ctx.newPage();
  await page.goto(BASIS + "/");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASIS + "/");
  await page.locator("#mandantSlug").fill(slug);
  await page.locator("#email").fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/i }).click();
  await page.locator(".zv-content").waitFor({ timeout: 15000 });
  return page;
}
const bild = async (page, name, el) => bilder && (await (el ?? page).screenshot({ path: `${bilder}/${name}.png` }));

/** Zeilen des Unterschriften-Rasters: je Zeile die Rechtecke der Plaetze. */
async function raster(page, wurzel) {
  return page.evaluate((wurzel) => {
    const us = document.querySelector(`${wurzel} .zv-us`);
    if (!us) return null;
    return {
      zeilen: [...us.querySelectorAll(".zv-us-zeile")].map((z) => [...z.querySelectorAll(".zv-us-platz")].map((p) => p.getBoundingClientRect().toJSON())),
      ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, wurzel);
}

/** Strich auf die Leinwand: Zeiger-Ereignisse wie mit dem Finger. */
async function zeichne(page) {
  const c = page.locator(".zv-modal .zv-signature-canvas");
  await c.scrollIntoViewIfNeeded();
  const r = await c.boundingBox();
  await page.mouse.move(r.x + 20, r.y + r.height * 0.7);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(r.x + 20 + i * 18, r.y + r.height * (0.5 - 0.3 * Math.sin(i / 2)));
  await page.mouse.up();
}

// ===== 1 Editor =====
{
  const page = await anmelden(leitung);
  await page.locator(".zv-aktenlippe-lasche").click();
  await page.locator("#zv-organisatorisch").getByRole("button", { name: "Formulare" }).click();
  await page.getByRole("heading", { name: "Formulare", level: 2 }).waitFor();
  await page.getByRole("button", { name: "Neues Formular" }).click();
  await page.locator("#zv-neues-formular-name").fill(`Unterschriften ${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Anlegen und bauen" }).click();
  await page.getByText("In Entwicklung: wird noch nirgends").waitFor();
  await page.locator(".zv-fe-kasten").getByRole("button", { name: "Unterschriften" }).click();
  const eig = page.locator(".zv-fe-eig");
  const rollen = await eig.locator(".zv-fe-platz select").evaluateAll((s) => s.map((x) => x.value));
  pruefe(JSON.stringify(rollen) === JSON.stringify(["klient", "mitarbeiter", "einrichtungsleitung", "bereichsleitung"]), `Editor: vier Rollen vorgeschlagen (${rollen.join(", ")})`);
  pruefe((await eig.getByRole("radio", { name: "2", exact: true }).getAttribute("aria-checked")) === "true", "Editor: zwei nebeneinander vorgewählt");
  pruefe((await page.locator(".zv-fe-knoten", { hasText: "4 Plätze" }).count()) === 1, "Editor: Baum nennt „4 Plätze“");
  await page.getByText(/Entwurf gespeichert/).waitFor({ timeout: 10000 });
  await bild(page, "umgesetzt-1-editor");

  await page.getByRole("tab", { name: "Ausprobieren" }).click();
  await page.locator(".zv-fe-probe .zv-us").waitFor();
  const m = await raster(page, ".zv-fe-probe");
  pruefe(m.zeilen.length === 2 && m.zeilen.every((z) => z.length === 2), `Ausprobieren: 2 Zeilen à 2 Plätze (${m.zeilen.map((z) => z.length).join("+")})`);
  pruefe(m.zeilen.every((z) => Math.abs(z[0].top - z[1].top) < 1), "Ausprobieren: Plätze einer Zeile auf gleicher Höhe");
  pruefe(m.zeilen.every((z) => Math.abs(z[0].width - z[1].width) < 1 && z[1].left > z[0].right), "Ausprobieren: gleich breit, nebeneinander");
  await bild(page, "umgesetzt-2-ausprobieren", page.locator(".zv-fe-probe"));

  // Anordnung umstellen: untereinander.
  await page.getByLabel("Ansicht").getByRole("tab", { name: "Aufbau" }).click();
  await page.locator(".zv-fe-knoten", { hasText: "4 Plätze" }).locator(".zv-fe-zeile").click();
  await eig.getByRole("radio", { name: "untereinander" }).click();
  pruefe((await page.locator(".zv-fe-knoten", { hasText: "untereinander" }).count()) === 1, "Editor: „untereinander“ übernommen");
  await page.getByRole("tab", { name: "Ausprobieren" }).click();
  const u = await raster(page, ".zv-fe-probe");
  pruefe(u.zeilen.length === 4 && u.zeilen.every((z) => z.length === 1), `Ausprobieren untereinander: 4 Zeilen (${u.zeilen.length})`);
  await page.context().close();
}

// ===== 2 Akte, Mitarbeiter:in =====
{
  const page = await anmelden(mitarbeiter);
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: /^Dokumentation$/ }).first().click();
  await page.getByText("Alle Protokolle", { exact: true }).first().click();
  await page.locator(".zv-info-karte-klickbar", { hasText: "Hausordnung" }).first().click();
  await page.locator(".zv-protokoll-lesen .zv-us").waitFor({ timeout: 10000 });
  const m = await raster(page, ".zv-protokoll-lesen");
  pruefe(m.zeilen.map((z) => z.length).join("+") === "2+2", `Akte: Raster 2+2 (Leitungen oben, Klient:in neue Zeile) (${m.zeilen.map((z) => z.length).join("+")})`);
  pruefe(m.zeilen.every((z) => z.length < 2 || Math.abs(z[0].top - z[1].top) < 1), "Akte: Plätze einer Zeile auf gleicher Höhe");
  const knoepfe = await page.locator(".zv-us-platz").evaluateAll((ps) => ps.map((p) => ({ platz: p.dataset.usPlatz, knopf: !!p.querySelector(".zv-us-knopf") })));
  const knopf = Object.fromEntries(knoepfe.map((k) => [k.platz, k.knopf]));
  pruefe(!knopf.p1 && !knopf.p2, "Akte: Mitarbeiter:in hat KEINEN Knopf an den Leitungsplätzen");
  pruefe(knopf.p3 && knopf.p4, "Akte: Mitarbeiter:in kann Klient:in und sich selbst erfassen");
  pruefe(/0 von 4 unterschrieben/.test(await page.locator(".zv-protokoll-kopf").innerText()), "Akte: Kopf zeigt „0 von 4 unterschrieben“");
  await bild(page, "umgesetzt-3-akte-offen");

  await page.locator('.zv-us-platz[data-us-platz="p3"] .zv-us-knopf').click();
  await page.locator(".zv-modal .zv-signature-canvas").waitFor();
  pruefe((await page.locator(".zv-modal").getByRole("button", { name: "Unterschreiben" }).isDisabled()) === true, "Fenster: ohne Strich nicht speicherbar");
  await page.locator("#zv-us-ort").fill("Hamburg");
  await zeichne(page);
  await page.locator(".zv-modal").getByRole("button", { name: "Inhalt zeigen" }).click();
  pruefe((await page.locator(".zv-modal .zv-us-dialog-inhalt .zv-protokoll-zeile").count()) >= 2, "Fenster: Inhalt lässt sich vor dem Unterschreiben ansehen");
  await bild(page, "umgesetzt-4-fenster");
  await page.locator(".zv-modal").getByRole("button", { name: "Unterschreiben" }).click();
  await page.locator('.zv-us-platz[data-us-platz="p3"] img.zv-us-bild').waitFor({ timeout: 10000 });
  const lage = await page.evaluate(() => {
    const p = document.querySelector('.zv-us-platz[data-us-platz="p3"]');
    const img = p.querySelector("img").getBoundingClientRect();
    const linie = p.querySelector(".zv-us-linie").getBoundingClientRect();
    return { imgUnten: img.bottom, linieUnten: linie.bottom, hoehe: img.height, text: p.innerText };
  });
  pruefe(lage.hoehe > 10 && Math.abs(lage.imgUnten - lage.linieUnten) <= 2, `Akte: Bild steht auf der Linie (${lage.imgUnten.toFixed(1)} / ${lage.linieUnten.toFixed(1)})`);
  pruefe(/Hamburg/.test(lage.text) && /Prüfnr\./.test(lage.text), "Akte: Ort und Prüfnummer unter der Unterschrift");
  pruefe(/1 von 4 unterschrieben/.test(await page.locator(".zv-protokoll-kopf").innerText()), "Akte: Kopf zählt auf „1 von 4“");
  await bild(page, "umgesetzt-5-akte-unterschrieben");
  await page.context().close();
}

// ===== 3 Heute, Einrichtungsleitung =====
{
  const page = await anmelden(el);
  const eintrag = page.locator("li, .zv-erledigen-eintrag, [class*=eintrag]", { hasText: /Hausordnung.*unterschreiben/ }).filter({ has: page.getByRole("button", { name: "Unterschreiben" }) });
  await eintrag.first().waitFor({ timeout: 15000 });
  pruefe((await eintrag.count()) >= 1, "Heute: offene Unterschrift steht unter „Zu erledigen“");
  pruefe(/als Einrichtungsleitung/.test(await eintrag.first().innerText()), "Heute: Eintrag nennt die Rolle");
  await bild(page, "umgesetzt-6-heute");
  await eintrag.first().getByRole("button", { name: "Unterschreiben" }).click();
  await page.locator(".zv-modal .zv-signature-canvas").waitFor();
  await zeichne(page);
  await page.locator(".zv-modal").getByRole("button", { name: "Unterschreiben" }).click();
  await page.locator(".zv-modal").waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(800);
  pruefe((await page.locator("li, .zv-erledigen-eintrag, [class*=eintrag]", { hasText: /Hausordnung.*unterschreiben/ }).count()) === 0, "Heute: nach dem Unterschreiben ist der Eintrag weg");
  await page.context().close();
}

// ===== 4 Schmal =====
{
  const page = await anmelden(mitarbeiter, { width: 390, height: 844 });
  // Auf dem Handy steht "Dokumentation" als "Doku" in der Leiste unten.
  await page.locator('.zv-tabbar-app button:has-text("Doku")').first().click();
  await page.getByText("Alle Protokolle", { exact: true }).first().click();
  await page.locator(".zv-info-karte-klickbar", { hasText: "Hausordnung" }).first().click();
  await page.locator(".zv-protokoll-lesen .zv-us").waitFor({ timeout: 10000 });
  const m = await raster(page, ".zv-protokoll-lesen");
  pruefe(m.zeilen.flat().length === 4 && new Set(m.zeilen.flat().map((r) => Math.round(r.left))).size === 1, "390 px: alle Plätze untereinander");
  pruefe(m.ueberlauf <= 0, `390 px: kein waagrechter Überlauf (${m.ueberlauf})`);
  pruefe(/2 von 4 unterschrieben/.test(await page.locator(".zv-protokoll-kopf").innerText()), "390 px: Leitung ist inzwischen eingetragen (2 von 4)");
  await page.locator(".zv-us").scrollIntoViewIfNeeded();
  await bild(page, "umgesetzt-7-handy");
  // Dunkel: die Tinte ist fest dunkel, die Linie mit Bild muss papierweiss bleiben.
  await page.evaluate(() => (document.documentElement.dataset.theme = "dunkel"));
  const grund = await page.locator(".zv-us-linie:not(.zv-us-linie-leer)").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  pruefe(grund === "rgb(255, 255, 255)", `Dunkel: Unterschrift steht auf weißem Grund (${grund})`);
  await bild(page, "umgesetzt-8-handy-dunkel");
  await page.context().close();
}

await browser.close();
if (messungen < MINDEST_MESSUNGEN) {
  console.error(`Nur ${messungen} Messungen (erwartet mindestens ${MINDEST_MESSUNGEN}) -- das Skript hat zu wenig gesehen.`);
  process.exit(1);
}
console.log(`\n${messungen - fehler.length} von ${messungen} Messungen in Ordnung.`);
process.exit(fehler.length ? 1 : 0);
