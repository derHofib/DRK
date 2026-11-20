// Klientenakte im Seitenpanel und Verlauf, gemessen im echten Browser
// (Rueckmeldungen "Ansicht Klienten" und "Überblick / Chronik",
// Konzepte klienten-ansicht und chronik).
//
//   1 Seitenpanel 1780 px: alle Reiter sichtbar (scrollWidth <= clientWidth),
//     sechs Reiter, Kopf <= 120 px hoch, Ueberblick einspaltig.
//   2 Vollbild: Ueberblick zweispaltig (Umbruch nach Aktenbreite).
//   3 "+ Eintrag" -> Telefonat -> erscheint im Verlauf und im Ueberblick.
//   4 Gemerkter Reiter: Finanzen bleibt offen beim Wechsel der Klient:in.
//   5 Schmal (400 px): Leiste laeuft ueber, Pfeil rechts da, Mausrad
//     verschiebt die Leiste waagrecht, Seite laeuft nicht waagrecht ueber.
//   6 Tastatur: Pfeil rechts wechselt den Reiter.
//
// Braucht API + Dev-Server und ein Konto mit Verlaufsrecht und mind. zwei
// aktiven Klient:innen:
//   node scripts/akte-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
import { chromium } from "playwright";

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: node akte-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
  process.exit(2);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const page = await browser.newPage({ viewport: { width: 1780, height: 1000 } });
const fehler = [];
let messungen = 0;
function pruefe(ok, text) {
  messungen += 1;
  console.log(`${ok ? "OK  " : "FEHL"} ${text}`);
  if (!ok) fehler.push(text);
}
const bild = async (name) => bilder && page.screenshot({ path: `${bilder}/${name}.png` });

await page.goto(BASIS + "/");
await page.locator("#mandantSlug").fill(slug);
await page.locator("#email").fill(email);
await page.locator("#passwort").fill(passwort);
await page.getByRole("button", { name: /Anmelden/ }).click();
await page.getByRole("navigation", { name: "Hauptmenü" }).waitFor({ timeout: 15000 });
// Frische Sitzung ohne gemerkten Reiter.
await page.evaluate(() => sessionStorage.removeItem("zv-akte-ansicht"));

await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: /^Klienten$/ }).first().click();
const zeilen = page.locator(".zv-info-karte-klickbar");
await zeilen.first().waitFor({ timeout: 10000 });
await zeilen.nth(0).click();
const leiste = page.getByRole("tablist", { name: "Bereiche der Akte" });
await leiste.waitFor({ timeout: 10000 });
await page.locator(".zv-kennwerte").waitFor({ timeout: 10000 });
await page.waitForTimeout(400);

// ===== 1 Seitenpanel =====
const m1 = await page.evaluate(() => {
  const l = document.querySelector(".zv-akte .zv-reiter");
  const kopf = document.querySelector(".zv-akte-kopf");
  const akte = document.querySelector(".zv-akte");
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  return {
    scroll: l.scrollWidth,
    client: l.clientWidth,
    reiter: l.querySelectorAll("[role=tab]").length,
    kopf: kopf.getBoundingClientRect().height,
    akte: akte.getBoundingClientRect().width,
    blick: r(".zv-ueberblick-blick"),
    verlauf: r(".zv-ueberblick-verlauf"),
  };
});
pruefe(m1.scroll <= m1.client, `Panel ${Math.round(m1.akte)} px: alle Reiter sichtbar (scrollWidth ${m1.scroll} <= clientWidth ${m1.client})`);
pruefe(m1.reiter === 6, `sechs Reiter (${m1.reiter})`);
pruefe(m1.kopf <= 120, `Kopf ${Math.round(m1.kopf)} px <= 120 px`);
pruefe(
  Math.abs(m1.blick.left - m1.verlauf.left) < 2 && m1.verlauf.top > m1.blick.bottom,
  `Überblick einspaltig im Panel, „Auf einen Blick“ über „Zuletzt im Verlauf“ (x ${Math.round(m1.blick.left)}/${Math.round(m1.verlauf.left)})`
);
const pfeileImPanel = await page.locator(".zv-akte .zv-reiter-pfeil").count();
pruefe(pfeileImPanel === 0, `keine Pfeilknöpfe, wenn alles passt (${pfeileImPanel})`);
await bild("1-panel");

// Hover faerbt die ganze Flaeche, nicht nur die Schrift.
const hinter = await leiste.getByRole("tab", { name: "Hilfeplan" }).evaluate((el) => getComputedStyle(el).backgroundColor);
await leiste.getByRole("tab", { name: "Hilfeplan" }).hover();
const hover = await leiste.getByRole("tab", { name: "Hilfeplan" }).evaluate((el) => getComputedStyle(el).backgroundColor);
pruefe(hinter !== hover, `Hover ändert die Fläche des Reiters (${hinter} -> ${hover})`);

// ===== 2 Vollbild =====
await page.getByRole("button", { name: "Vollbild anzeigen" }).click();
await page.waitForTimeout(600);
const m2 = await page.evaluate(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  return { akte: r(".zv-akte").width, blick: r(".zv-ueberblick-blick"), verlauf: r(".zv-ueberblick-verlauf") };
});
pruefe(
  m2.blick.left > m2.verlauf.right - 1 && Math.abs(m2.blick.top - m2.verlauf.top) < 4,
  `Vollbild ${Math.round(m2.akte)} px: zwei Spalten, „Auf einen Blick“ rechts neben dem Verlauf`
);
await bild("2-vollbild");
await page.getByRole("button", { name: "Vollbild verlassen" }).click();
await page.waitForTimeout(400);

// ===== 3 + Eintrag -> Telefonat =====
const kennung = `Pruefung ${Date.now()}`;
await page.locator(".zv-akte-kopf").getByRole("button", { name: /^Eintrag$/ }).click();
const dialog = page.getByRole("dialog", { name: /^Neuer Eintrag/ });
await dialog.getByRole("radio", { name: "Telefonat" }).click();
await dialog.getByLabel("Mit wem").fill("Jugendamt");
await dialog.getByRole("radio", { name: "Ausgehend" }).click();
await dialog.getByLabel("Worum ging es?").fill(kennung);
await bild("3-eintrag");
await dialog.getByRole("button", { name: "Telefonat speichern" }).click();
await dialog.waitFor({ state: "detached", timeout: 10000 });
await page.locator(".zv-ueberblick-verlauf", { hasText: kennung }).waitFor({ timeout: 10000 });
pruefe(true, "neues Telefonat steht sofort unter „Zuletzt im Verlauf“");
await leiste.getByRole("tab", { name: "Verlauf" }).click();
const zeile = page.locator(".zv-verlauf-zeile", { hasText: kennung });
await zeile.waitFor({ timeout: 10000 });
pruefe(/Jugendamt · ausgehend/.test(await zeile.innerText()), "Verlauf: Titel „Jugendamt · ausgehend“");
pruefe((await zeile.getByRole("button", { name: "Korrigieren" }).count()) === 1, "eigener Eintrag ist korrigierbar");
await page.getByRole("button", { name: /^Telefonate/ }).click();
const nurTelefonate = await page.locator(".zv-verlauf-zeile").evaluateAll((els) => els.every((e) => e.classList.contains("zv-verlauf-telefonat")));
pruefe(nurTelefonate, "Filter „Telefonate“ zeigt nur Telefonate");
await bild("3-verlauf");

// ===== 4 Gemerkter Reiter =====
await leiste.getByRole("tab", { name: "Finanzen" }).click();
await page.getByRole("radio", { name: "Kostenübernahmen" }).click();
await page.getByRole("button", { name: "Schließen" }).click();
await page.waitForTimeout(400);
await zeilen.nth(1).click();
await leiste.waitFor();
await page.waitForTimeout(400);
const aktiv = (await leiste.locator("[aria-selected=true]").innerText()).trim();
const teil = (await page.locator(".zv-akte-umschalter [aria-checked=true]").innerText()).trim();
pruefe(aktiv === "Finanzen" && teil === "Kostenübernahmen", `nächste Klient:in öffnet in Finanzen › Kostenübernahmen (${aktiv} › ${teil})`);

// ===== 6 Tastatur =====
await leiste.locator("[aria-selected=true]").focus();
await page.keyboard.press("ArrowRight");
const nachPfeil = (await leiste.locator("[aria-selected=true]").innerText()).trim();
pruefe(nachPfeil === "Akte", `Pfeil rechts wechselt zu „Akte“ (${nachPfeil})`);
await page.keyboard.press("Home");
pruefe((await leiste.locator("[aria-selected=true]").innerText()).trim() === "Überblick", "Pos1 springt auf „Überblick“");

// ===== 5 Schmal =====
await page.setViewportSize({ width: 400, height: 800 });
await page.waitForTimeout(500);
const m5 = await page.evaluate(() => {
  const l = document.querySelector(".zv-akte .zv-reiter");
  return { scroll: l.scrollWidth, client: l.clientWidth, links: l.scrollLeft, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
pruefe(m5.scroll > m5.client, `400 px: Leiste läuft über (${m5.scroll} > ${m5.client}) -- sonst misst der Rest nichts`);
pruefe(m5.doc <= 0, `400 px: Seite läuft nicht waagrecht über (${m5.doc})`);
pruefe((await page.locator(".zv-reiter-pfeil-rechts").count()) === 1, "Pfeil rechts sichtbar");
const box = await page.locator(".zv-akte .zv-reiter").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, 200);
await page.waitForTimeout(300);
const nachRad = await page.evaluate(() => document.querySelector(".zv-akte .zv-reiter").scrollLeft);
pruefe(nachRad > m5.links, `Mausrad über der Leiste verschiebt sie waagrecht (${m5.links} -> ${nachRad})`);
pruefe((await page.locator(".zv-reiter-pfeil-links").count()) === 1, "danach Pfeil links sichtbar");
await page.locator(".zv-reiter-pfeil-links").click();
await page.waitForTimeout(600);
const nachPfeilKnopf = await page.evaluate(() => document.querySelector(".zv-akte .zv-reiter").scrollLeft);
pruefe(nachPfeilKnopf < nachRad, `Pfeil links schiebt zurück (${nachRad} -> ${nachPfeilKnopf})`);
await bild("5-schmal");

await browser.close();
if (messungen < 20) {
  console.error(`Nur ${messungen} Messungen -- das Skript hat nicht alles erreicht.`);
  process.exit(1);
}
console.log(`\n${fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} FEHLGESCHLAGEN`} (${messungen} Messungen)`);
process.exit(fehler.length === 0 ? 0 : 1);
