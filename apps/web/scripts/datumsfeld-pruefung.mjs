// Datumsfeld, Monatsfeld und Zeitraum, gemessen im echten Browser
// (Rueckmeldung "Datum auswahl", Konzept datumsfeld).
//
//   0 Quelltext: type="date"/"month" steht nur noch in Datumsfeld.tsx.
//   1 Datumsrechnung in drei Zeitzonen (Berlin, Los Angeles, Kiritimati):
//     keine Verschiebung um einen Tag, Zeitumstellung, Schaltjahr, Parser.
//   2 Monatsabschluss (Akte > Finanzen > Kassenbuch): Feld so hoch wie der
//     Knopf daneben (+-1 px), Beschriftung mit Abstand, mittig.
//   3 Tagesbericht anlegen: Kalender per Maus und per Tastatur (Alt+Pfeil,
//     Pfeile, Enter, Esc), Datum per API zuruecklesen (ISO, kein Versatz).
//   4 Ungueltiges Datum blockiert das Absenden und wird in Worten gemeldet.
//   5 Zeitraum im Filter: tippen, klicken, Uebernehmen -> Anfrage mit
//     von/bis; kein Ueberlauf bei 1440 und 390 px.
//   6 Zeitraum-Kalender im Seitenpanel bleibt im Bild.
//   7 Touch-Emulation: natives Feld, Schnellwahl darunter, Monatsfeld eigen.
//
// Braucht API + Vite-DEV-Server (Schritt 1 laedt das TS-Modul direkt):
//   BASIS_URL=http://localhost:5173 node scripts/datumsfeld-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]
// Legt einen Tagesbericht mit dem Text "Datumsfeld-Prüfung <Zeit>" an.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [, , slug, email, passwort, bilder] = process.argv;
if (!slug || !email || !passwort) {
  console.error("Nutzung: BASIS_URL=... node datumsfeld-pruefung.mjs <slug> <email> <passwort> [bilderOrdner]");
  process.exit(2);
}
const BASIS = process.env.BASIS_URL ?? "http://localhost:5173";
const MINDEST_MESSUNGEN = 45;
// LANGUAGE: das native Datumsfeld (Touch) formatiert nach der Sprache des
// Browserprozesses, nicht nach locale des Kontexts -- sonst zeigt das
// Handybild 11/19/2026. --lang wirkt unter Linux nicht (ausprobiert).
const browser = await chromium.launch({
  env: { ...process.env, LANGUAGE: "de", LANG: "de_DE.UTF-8" },
  ...(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {}),
});
const fehler = [];
let messungen = 0;
function pruefe(ok, text) {
  messungen += 1;
  console.log(`${ok ? "OK  " : "FEHL"} ${text}`);
  if (!ok) fehler.push(text);
}
const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
function plusTage(iso, n) {
  const [j, m, t] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + n));
  return d.toISOString().slice(0, 10);
}
const anzeige = (iso) => iso.split("-").reverse().join(".");

async function neueSeite({ breite = 1440, hoehe = 900, schema = "dark", touch = false, zeitzone = "Europe/Berlin" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: breite, height: hoehe },
    colorScheme: schema,
    locale: "de-DE",
    timezoneId: zeitzone,
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pruefe(false, `Seitenfehler: ${e.message}`));
  return page;
}
async function anmelden(page) {
  await page.goto(BASIS + "/");
  await page.locator("#mandantSlug").fill(slug);
  await page.locator("#email").fill(email);
  await page.locator("#passwort").fill(passwort);
  await page.getByRole("button", { name: /Anmelden/ }).click();
  await page.locator(".zv-sidebar-nav:visible, .zv-tabbar-app:visible").first().waitFor({ timeout: 15000 });
}
async function geheZu(page, name) {
  const seite = page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: new RegExp(`^${name}$`) }).first();
  if (await seite.isVisible().catch(() => false)) return seite.click();
  const mobil = { Dokumentation: "Doku" }[name] ?? name;
  const direkt = page.locator(`.zv-tabbar-app button:has-text("${mobil}")`).first();
  if (await direkt.isVisible().catch(() => false)) await direkt.click();
  else {
    await page.click('.zv-tabbar-app button:has-text("Mehr")');
    await page.click(`#zv-sammelmenue-panel button:has-text("${mobil}")`);
  }
  // Reiter mit Unterseiten (Klienten: Anwaerter, Archiv) oeffnen am Handy erst ein Menue.
  const menue = page.locator(".zv-sammelmenue:not(#zv-sammelmenue-panel)");
  if (await menue.first().isVisible({ timeout: 600 }).catch(() => false)) await menue.first().locator(`button:has-text("${name}")`).first().click();
}
async function bild(page, name) {
  if (bilder) await page.screenshot({ path: `${bilder}/${name}.png` });
}
/** Ueberlauf eines Elements: eigener Inhalt, Kinder ueber den Rand, Lage im Fenster, Seite. */
async function ueberlauf(page, selektor) {
  return page.evaluate((s) => {
    const p = document.querySelector(s);
    if (!p) return null;
    const r = p.getBoundingClientRect();
    const raus = [...p.querySelectorAll("*")].filter((e) => {
      const q = e.getBoundingClientRect();
      return q.width > 0 && (q.right > r.right + 0.5 || q.left < r.left - 0.5);
    }).length;
    return {
      sw: p.scrollWidth,
      cw: p.clientWidth,
      raus,
      links: Math.round(r.left),
      rechts: Math.round(r.right),
      unten: Math.round(r.bottom),
      vw: innerWidth,
      vh: innerHeight,
      seite: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, selektor);
}

// ===== 0 Quelltext =====
{
  const src = join(dirname(fileURLToPath(import.meta.url)), "../src");
  const dateien = [];
  const lauf = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? lauf(join(d, n)) : /\.tsx?$/.test(n) && dateien.push(join(d, n))));
  lauf(src);
  const treffer = dateien.filter((f) => /type="(date|month)"/.test(readFileSync(f, "utf8"))).map((f) => relative(src, f));
  pruefe(dateien.length > 50, `Quelltext gelesen (${dateien.length} Dateien)`);
  pruefe(
    treffer.length === 1 && treffer[0].endsWith("components/Datumsfeld.tsx"),
    `type="date"/"month" nur in Datumsfeld.tsx (${treffer.join(", ") || "nirgends"})`
  );
}

// ===== 1 Datumsrechnung in drei Zeitzonen =====
for (const zeitzone of ["Europe/Berlin", "America/Los_Angeles", "Pacific/Kiritimati"]) {
  const page = await neueSeite({ zeitzone });
  await page.goto(BASIS + "/");
  const r = await page
    .evaluate(async () => {
      const l = await import("/src/components/datumsfeld-logik.ts");
      const blatt = l.monatsblatt("2026-03");
      const iso = (t) => {
        const e = l.leseDatum(t, true, "2026-11-20");
        return e ? (e.iso ?? `FEHLER: ${e.fehler}`) : null;
      };
      return {
        blattStart: blatt[0],
        blattEnde: blatt[41],
        blattEindeutig: new Set(blatt).size,
        sommerzeit: [l.plusTage("2026-03-28", 1), l.plusTage("2026-03-29", 1), l.plusTage("2026-10-25", 1)],
        tageMaerz: l.tageZwischen("2026-03-01", "2026-03-31"),
        monatsende: l.plusMonate("2026-01-31", 1),
        schaltjahr: [iso("29.02.2028"), iso("29.02.2027")],
        kurz: [iso("20.11.26"), iso("2011"), iso("20.11."), iso("gestern"), iso("201126"), iso("05.03.85"), iso("2026-11-20")],
        unfertig: l.leseDatum("2", false, "2026-11-20"),
        wochentag: l.tagLang("2026-11-20"),
      };
    })
    .catch((e) => ({ ladefehler: e.message }));
  if (r.ladefehler) {
    pruefe(false, `${zeitzone}: Modul nicht ladbar (Dev-Server noetig?) ${r.ladefehler}`);
  } else {
    pruefe(r.blattStart === "2026-02-23" && r.blattEnde === "2026-04-05" && r.blattEindeutig === 42, `${zeitzone}: Monatsblatt März 2026 = 23.02.–05.04., 42 verschiedene Tage`);
    pruefe(r.sommerzeit.join() === "2026-03-29,2026-03-30,2026-10-26", `${zeitzone}: über die Zeitumstellung kein Tag doppelt/verloren (${r.sommerzeit.join(", ")})`);
    pruefe(r.tageMaerz === 31 && r.monatsende === "2026-02-28", `${zeitzone}: März hat 31 Tage, 31.01. + 1 Monat = 28.02. (${r.tageMaerz}, ${r.monatsende})`);
    pruefe(r.schaltjahr[0] === "2028-02-29" && r.schaltjahr[1]?.startsWith("FEHLER"), `${zeitzone}: 29.02.2028 gültig, 29.02.2027 nicht`);
    pruefe(
      r.kurz.join() === "2026-11-20,2026-11-20,2026-11-20,2026-11-19,2026-11-20,1985-03-05,2026-11-20",
      `${zeitzone}: Kurzformen 20.11.26 / 2011 / 20.11. / gestern / 201126 / 05.03.85 / ISO (${r.kurz.join(", ")})`
    );
    pruefe(r.unfertig === null, `${zeitzone}: halb getippt ("2") wird nicht gedeutet`);
    pruefe(r.wochentag === "Freitag, 20. November 2026", `${zeitzone}: Vorlesename „${r.wochentag}“`);
  }
  await page.context().close();
}

// ===== 2 Monatsabschluss =====
const page = await neueSeite({ breite: 1780, hoehe: 1000, schema: "dark" });
await anmelden(page);
await geheZu(page, "Klienten");
await page.locator(".zv-info-karte-klickbar").first().click();
const leiste = page.getByRole("tablist", { name: "Bereiche der Akte" });
await leiste.getByRole("tab", { name: "Finanzen" }).click();
await page.getByRole("radiogroup", { name: "Finanzbereich" }).getByRole("radio", { name: "Kassenbuch" }).click();
await page.locator(".zv-werkzeugzeile").waitFor({ timeout: 10000 });
const m2 = await page.evaluate(() => {
  const z = document.querySelector(".zv-werkzeugzeile");
  const r = (e) => e.getBoundingClientRect();
  const l = r(z.querySelector("label"));
  const f = r(z.querySelector(".zv-monatsfeld"));
  const k = r(z.querySelector(".zv-btn"));
  return { feld: f.height, knopf: k.height, abstand: f.left - l.right, mitteL: l.top + l.height / 2, mitteF: f.top + f.height / 2 };
});
pruefe(Math.abs(m2.feld - m2.knopf) <= 1, `Monatsfeld ${m2.feld} px so hoch wie „Als PDF“ ${m2.knopf} px (±1)`);
pruefe(m2.abstand > 0, `Abstand Beschriftung → Feld ${m2.abstand} px > 0`);
pruefe(Math.abs(m2.mitteL - m2.mitteF) <= 1, `Beschriftung mittig zum Feld (${m2.mitteL.toFixed(1)} / ${m2.mitteF.toFixed(1)})`);
const monatVorher = await page.locator("#kb-abschluss-monat").innerText();
await page.locator("#kb-abschluss-monat").click();
await page.locator(".zv-dkal-popover").waitFor();
await bild(page, "1-monatsabschluss-dunkel");
const aktuellerMonat = heute.slice(0, 7);
const naechsterGesperrt = await page.locator(".zv-dkal-wahl-knopf.gesperrt").count();
pruefe(naechsterGesperrt === 12 - Number(aktuellerMonat.slice(5)), `zukünftige Monate gesperrt (${naechsterGesperrt}), laufender wählbar`);
await page.keyboard.press("Escape");
pruefe((await page.locator(".zv-dkal-popover").count()) === 0 && (await page.locator(".zv-seitenpanel.zv-offen").count()) === 1, "Esc schließt nur das Monats-Popup, das Seitenpanel bleibt");
await page.getByRole("button", { name: "Vormonat" }).click();
pruefe((await page.locator("#kb-abschluss-monat").innerText()) !== monatVorher, `‹ blättert (${monatVorher} → ${await page.locator("#kb-abschluss-monat").innerText()})`);

// ===== 6 Zeitraum-Kalender im Seitenpanel =====
await page.getByRole("radiogroup", { name: "Finanzbereich" }).getByRole("radio", { name: "Kostenübernahmen" }).click();
await page.getByRole("button", { name: /Neuer Zeitraum/ }).click();
pruefe((await page.getByLabel("Bis (optional)").getAttribute("id")) === "ku-bis", "Kostenübernahme: „Bis (optional)“ ist per htmlFor mit dem Feld verbunden");
await page.locator("#ku-bis").press("Alt+ArrowDown");
await page.locator(".zv-dkal-popover").waitFor();
const m6 = await ueberlauf(page, ".zv-dkal-popover");
pruefe(m6.links >= 0 && m6.rechts <= m6.vw && m6.unten <= m6.vh, `Zeitraum-Kalender im Panel im Bild (${m6.links}–${m6.rechts} von ${m6.vw}, unten ${m6.unten} von ${m6.vh})`);
pruefe(m6.sw <= m6.cw && m6.raus === 0, `Zeitraum-Kalender ohne Überlauf (scrollWidth ${m6.sw} <= ${m6.cw}, ${m6.raus} Kinder über dem Rand)`);
pruefe((await page.locator(".zv-dkal-popover table[role=grid]").count()) === 2, "Zeitraum zeigt zwei Monate nebeneinander");
await page.keyboard.press("Escape");
await page.context().close();

// ===== 3 Tagesbericht: Maus, Tastatur, API =====
const p3 = await neueSeite({ breite: 1440, hoehe: 900, schema: "dark" });
await anmelden(p3);
await geheZu(p3, "Dokumentation");
await p3.getByRole("button", { name: /Neuer Tagesbericht/ }).first().click();
const dialog = p3.locator(".zv-modal");
await p3.locator("#ntb-klient").selectOption({ index: 3 });
const klientId = await p3.locator("#ntb-klient").inputValue();
await p3.locator("#ntb-text").waitFor({ timeout: 10000 });

// Maus
await dialog.getByRole("button", { name: "Kalender öffnen" }).click();
const pop = p3.locator(".zv-dkal-popover");
await pop.waitFor();
const fokusBeimOeffnen = await p3.evaluate(() => document.activeElement?.dataset.tag);
pruefe(fokusBeimOeffnen === heute, `Kalender öffnet mit Fokus auf dem gewählten Tag (${fokusBeimOeffnen})`);
pruefe((await pop.locator("[aria-current=date]").count()) === 1, "heute trägt aria-current=date");
pruefe((await pop.locator(`button[data-tag="${plusTage(heute, 1)}"][aria-disabled=true]`).count()) === 1, "morgen gesperrt (max = heute), aria-disabled");
await bild(p3, "2-tagesfeld-dunkel");
await pop.locator(`button[data-tag="${plusTage(heute, -1)}"]`).click();
pruefe((await pop.count()) === 0, "Klick auf einen Tag schließt den Kalender");
pruefe((await p3.locator("#ntb-datum").inputValue()) === anzeige(plusTage(heute, -1)), `Maus: Feld zeigt ${await p3.locator("#ntb-datum").inputValue()}`);

// Tastatur
await p3.locator("#ntb-datum").focus();
await p3.keyboard.press("Alt+ArrowDown");
await pop.waitFor();
pruefe(true, "Alt+↓ öffnet den Kalender aus dem Tippfeld");
await p3.keyboard.press("ArrowLeft");
await p3.keyboard.press("ArrowLeft");
await p3.keyboard.press("ArrowUp");
await p3.keyboard.press("ArrowDown");
const ziel = plusTage(heute, -3);
pruefe((await p3.evaluate(() => document.activeElement?.dataset.tag)) === ziel, `Pfeile: ← ← ↑ ↓ landet auf ${ziel}`);
const umrandung = await p3.evaluate(() => {
  const s = getComputedStyle(document.activeElement);
  return `${s.outlineStyle} ${s.outlineWidth}`;
});
pruefe(umrandung === "solid 2px", `fokussierter Tag hat 2 px Umrandung (${umrandung})`);
await p3.keyboard.press("Enter");
pruefe((await pop.count()) === 0 && (await dialog.count()) === 1, "Enter wählt, schließt nur den Kalender, schickt das Formular nicht ab");
pruefe((await p3.evaluate(() => document.activeElement?.id)) === "ntb-datum", "Fokus zurück im Tippfeld");
await p3.keyboard.press("Alt+ArrowDown");
await pop.waitFor();
await p3.keyboard.press("Escape");
pruefe((await pop.count()) === 0 && (await dialog.count()) === 1, "Esc schließt den Kalender, das Fenster bleibt offen");
pruefe((await p3.evaluate(() => document.activeElement?.id)) === "ntb-datum", "nach Esc Fokus zurück im Tippfeld");
pruefe((await p3.locator('.zv-modal input[type=hidden][name="datum"]').inputValue()) === ziel, `verstecktes Formularfeld trägt ISO ${ziel}`);

const kennung = `Datumsfeld-Prüfung ${Date.now()}`;
await p3.locator("#ntb-text").fill(kennung);
await dialog.getByRole("button", { name: "Tagesbericht speichern" }).click();
await dialog.waitFor({ state: "detached", timeout: 10000 });
const gespeichert = await p3.evaluate(
  async ({ klientId, kennung }) => {
    const r = await fetch(`/api/tagesberichte?klientId=${klientId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("zimmerakte_token")}` } });
    const liste = await r.json();
    return liste.find((b) => b.text === kennung)?.datum ?? null;
  },
  { klientId, kennung }
);
pruefe(gespeichert === ziel, `API liest den Tagesbericht mit Datum ${gespeichert} zurück (erwartet ${ziel})`);

// ===== 4 Ungueltig =====
await p3.getByRole("button", { name: /Neuer Tagesbericht/ }).first().click();
await p3.locator("#ntb-datum").fill("31.11.2026");
await p3.locator("#ntb-datum").press("Tab");
const meldung = await p3.locator(".zv-datum-fehler").innerText().catch(() => "");
pruefe(meldung === "Den 31. November 2026 gibt es nicht.", `31.11.2026 beim Verlassen in Worten gemeldet („${meldung}“)`);
const gueltig = await p3.locator("#ntb-datum").evaluate((e) => ({ v: e.validity.valid, i: e.getAttribute("aria-invalid"), d: e.getAttribute("aria-describedby") }));
pruefe(!gueltig.v && gueltig.i === "true" && gueltig.d.includes("ntb-datum-fehler"), "ungültig: Feld blockiert das Absenden, aria-invalid, Meldung per aria-describedby");
await p3.locator("#ntb-datum").fill(anzeige(plusTage(heute, 1)));
await p3.locator("#ntb-datum").press("Tab");
pruefe((await p3.locator(".zv-datum-fehler").innerText().catch(() => "")).startsWith("Spätestens"), "Datum nach max (morgen) wird gemeldet");
await p3.keyboard.press("Escape");

// ===== 5 Zeitraum im Filter =====
async function zeitraumPruefen(seite, breite) {
  await seite.locator(".zv-filterleiste").getByRole("button", { name: /^Zeitraum/ }).click();
  await seite.locator(".zv-zeitraumwahl").waitFor();
  const m = await ueberlauf(seite, ".zv-filter-popover");
  pruefe(m.sw <= m.cw && m.raus === 0, `${breite} px: Filter-Popover ohne Überlauf (scrollWidth ${m.sw} <= ${m.cw}, ${m.raus} Kinder über dem Rand)`);
  pruefe(m.links >= 0 && m.rechts <= m.vw && m.seite <= 0, `${breite} px: Popover im Bild (${m.links}–${m.rechts} von ${m.vw}), Seite ohne Querlauf (${m.seite})`);
  return m;
}
await zeitraumPruefen(p3, 1440);
const von = "2026-11-03";
const bis = "2026-11-05";
await p3.locator("#tb-von").fill(anzeige(von));
await p3.locator("#tb-von").press("Tab");
await p3.locator(`.zv-filter-popover button[data-tag="${bis}"]`).hover();
pruefe((await p3.locator(".zv-filter-popover .zv-dkal-tag.imbereich").count()) === 1, "Maus über dem Bis-Tag zeigt den Bereich als Vorschau");
await p3.locator(`.zv-filter-popover button[data-tag="${bis}"]`).click();
const ansage = await p3.locator(".zv-zeitraumwahl-text").innerText();
pruefe(ansage === "3. bis 5. November 2026, 3 Tage", `Zeitraum in Worten (aria-live): „${ansage}“`);
const anfrage = p3.waitForRequest((r) => r.url().includes("/tagesberichte?") && r.url().includes(`von=${von}`) && r.url().includes(`bis=${bis}`), { timeout: 5000 }).catch(() => null);
await p3.getByRole("button", { name: "Übernehmen" }).click();
pruefe((await anfrage) !== null, `„Übernehmen“ lädt mit von=${von}&bis=${bis}`);
const pille = (await p3.locator(".zv-filter-pille.aktiv").first().innerText()).replace(/\s+/g, " ").trim();
pruefe(pille === "Zeitraum: 03.11. – 05.11.2026", `Pille zeigt den Zeitraum am Stück („${pille}“)`);
await p3.context().close();

// Hell, Kassenbuch-Liste (gemeinsamer Listenfilter), dann 390 px
const p5 = await neueSeite({ breite: 1440, hoehe: 900, schema: "light" });
await anmelden(p5);
await geheZu(p5, "Kassenbuch");
await zeitraumPruefen(p5, 1440);
await p5.locator(".zv-zeitraumwahl-schnell").getByRole("option", { name: "Letzter Monat" }).hover();
await bild(p5, "3-zeitraum-filter-hell");
await p5.keyboard.press("Escape");
await p5.setViewportSize({ width: 390, height: 844 });
await p5.waitForTimeout(300);
await zeitraumPruefen(p5, 390);
pruefe((await p5.locator(".zv-filter-popover table[role=grid]").count()) === 1, "390 px: ein Monat statt zwei");
await p5.context().close();

// ===== 7 Touch =====
const p7 = await neueSeite({ breite: 390, hoehe: 844, schema: "light", touch: true });
await anmelden(p7);
await geheZu(p7, "Dokumentation");
await p7.getByRole("button", { name: /Neuer Tagesbericht/ }).first().click();
await p7.locator("#ntb-datum").waitFor();
pruefe((await p7.locator("#ntb-datum").getAttribute("type")) === "date", "Touch: Tagesbericht-Datum ist das native Feld");
pruefe((await p7.locator("#ntb-datum").getAttribute("name")) === "datum" && (await p7.locator("#ntb-datum").inputValue()) === heute, "Touch: natives Feld trägt name und ISO-Wert");
const chips = await p7.locator(".zv-datum-chips .zv-datum-chip").allInnerTexts();
pruefe(chips.join() === "Heute,Gestern", `Touch: Schnellwahl unter dem Feld (${chips.join(" · ")})`);
await p7.locator(".zv-datum-chips").getByRole("button", { name: "Gestern" }).click();
pruefe((await p7.locator("#ntb-datum").inputValue()) === plusTage(heute, -1), "Touch: „Gestern“ setzt das native Feld");
const m7 = await p7.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
pruefe(m7 <= 0, `Touch 390 px: kein waagrechter Überlauf (${m7})`);
await bild(p7, "4-handy-hell");
await p7.keyboard.press("Escape");
// Monat bleibt auch am Handy die eigene Variante: type="month" fehlt in
// Firefox/Safari, und ‹ › ist daumentauglich.
await geheZu(p7, "Klienten");
await p7.locator(".zv-info-karte-klickbar").first().click();
await p7.getByRole("tablist", { name: "Bereiche der Akte" }).getByRole("tab", { name: "Finanzen" }).click();
await p7.getByRole("radiogroup", { name: "Finanzbereich" }).getByRole("radio", { name: "Kassenbuch" }).click();
await p7.locator(".zv-werkzeugzeile").waitFor({ timeout: 10000 });
pruefe((await p7.locator(".zv-werkzeugzeile .zv-monatsfeld").count()) === 1 && (await p7.locator('input[type="month"]').count()) === 0, "Touch: Monatsabschluss bleibt das eigene Monatsfeld");
await p7.context().close();

await browser.close();
if (messungen < MINDEST_MESSUNGEN) {
  console.error(`ABBRUCH: nur ${messungen} von mindestens ${MINDEST_MESSUNGEN} Messungen -- das Skript hat nicht alles erreicht.`);
  process.exit(2);
}
console.log(`\n${fehler.length === 0 ? "ALLE PRUEFUNGEN OK" : `${fehler.length} FEHLGESCHLAGEN`} (${messungen} Messungen)`);
process.exit(fehler.length === 0 ? 0 : 1);
