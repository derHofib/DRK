/**
 * Browserpruefung "Abwesenheiten als Strahl" (Rueckmeldung "Kalender",
 * 021a5a76) gegen laufende API + Dev-Server. Gemessen statt angesehen:
 *   - Woche (breit): je Abwesenheit genau ein Balken in der Zeile
 *     "Abwesend", ueber genau die Tage, die sie in dieser Woche dauert;
 *     ueber den Wochenrand hinaus mit offener Kante; Klick oeffnet sie;
 *   - Monat und Woche am Handy: der Strahl beginnt und endet an den
 *     richtigen Kacheln, liegt am Kachelfuss unter Zahl und Punkten und
 *     ist ein durchgehendes Element ueber die Luecken;
 *   - Personenfilter blendet den Strahl der anderen aus;
 *   - Text im Balken >= 4.5:1 (hell und dunkel), kein horizontaler Ueberlauf.
 *
 * Voraussetzung: Mandant PRUEF_MANDANT, Konto PRUEF_LEITUNG mit
 * abwesenheiten.verwalten und zwei weitere Konten (PRUEF_ANDERE,
 * PRUEF_DRITTE). Die Pruefung storniert alle Abwesenheiten der drei Wochen
 * um heute und traegt ihre eigenen ein -- nur gegen eine Entwicklungs-DB.
 * Aufruf aus apps/web:  node scripts/abwesenheit-strahl-pruefung.mjs
 * Ein Lauf, der nichts misst, schlaegt fehl (siehe unten).
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of [process.env.PLAYWRIGHT_PFAD, "playwright", "/opt/node22/lib/node_modules/playwright"].filter(Boolean)) {
    try { return require(p); } catch { /* naechster */ }
  }
  throw new Error("Playwright nicht gefunden -- PLAYWRIGHT_PFAD setzen.");
})();

async function starteBrowser() {
  try { return await chromium.launch(); } catch (e) {
    const basis = "/opt/pw-browsers";
    const kandidaten = [process.env.CHROMIUM_PFAD, ...(existsSync(basis) ? readdirSync(basis) : []).filter((n) => n.startsWith("chromium-")).flatMap((n) => [`${basis}/${n}/chrome-linux64/chrome`, `${basis}/${n}/chrome-linux/chrome`]), `${basis}/chromium/chrome-linux/chrome`].filter(Boolean);
    for (const executablePath of kandidaten) if (existsSync(executablePath)) { try { return await chromium.launch({ executablePath }); } catch { /* naechster */ } }
    throw e;
  }
}

const URL = process.env.BASIS_URL ?? "http://localhost:5173";
const MANDANT = process.env.PRUEF_MANDANT ?? "demo";
const PW = process.env.PRUEF_PASSWORT ?? "demo-passwort-123";
const ANDERE = process.env.PRUEF_ANDERE ?? "ma@demo.test";
const LEITUNG = process.env.PRUEF_LEITUNG ?? "voll@demo.test";
const BILDER = process.env.PRUEF_BILDER ?? "/tmp/abwesenheit-strahl-bilder";
mkdirSync(BILDER, { recursive: true });

const fehler = [];
let messungen = 0;
const ok = (b, m) => { messungen++; console.log(`  ${b ? "OK  " : "FEHL"}  ${m}`); if (!b) fehler.push(m); };

const browser = await starteBrowser();

async function anmelden(page, email) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill("#mandantSlug", MANDANT);
  await page.fill("#email", email);
  await page.fill("#passwort", PW);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".zv-content", { timeout: 10000 });
}

async function zu(page, label) {
  const sidebar = page.locator(`.zv-sidebar-nav button:has-text("${label}")`);
  if (await sidebar.first().isVisible().catch(() => false)) await sidebar.first().click();
  else {
    await page.click('.zv-tabbar-app button:has-text("Mehr")');
    await page.waitForSelector("#zv-sammelmenue-panel");
    await page.click(`#zv-sammelmenue-panel button:has-text("${label}")`);
  }
  // Die Einstellungen tragen als Ueberschrift den gewaehlten Bereich, nicht "Einstellungen".
  await page.waitForSelector(label === "Einstellungen" ? ".zv-einstellungen" : `h2:has-text('${label}')`);
}

/** API-Aufruf mit dem Token der angemeldeten Person -- fuer Termine in der Vergangenheit, die das Formular nicht anlegt. */
const api = (page, pfad, methode = "GET", body) =>
  page.evaluate(async ({ pfad, methode, body }) => {
    const r = await fetch(`/api${pfad}`, {
      method: methode,
      headers: { Authorization: `Bearer ${localStorage.getItem("zimmerakte_token")}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { pfad, methode, body });

const ueberlauf = (page) => page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));

/**
 * WCAG-Kontrast zwischen Text eines Elements und dem ersten nicht
 * transparenten Hintergrund darueber. Farben ueber ein Canvas in sRGB
 * aufgeloest -- getComputedStyle liefert oklch() woertlich zurueck, und genau
 * daran ist die erste design-pruefung.mjs gescheitert (CLAUDE.md).
 */
const kontrast = (page, selektor) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    const rgb = (farbe) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = farbe; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
    let hg = null;
    for (let e = el; e; e = e.parentElement) { const f = rgb(getComputedStyle(e).backgroundColor); if (f[3] > 250) { hg = f; break; } }
    hg ??= rgb(getComputedStyle(document.body).backgroundColor);
    const vg = rgb(getComputedStyle(el).color);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = [lum(vg), lum(hg)].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  }, selektor);


const DRITTE = process.env.PRUEF_DRITTE ?? "ka@demo.test";

function tagKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const heute = new Date();
const montag = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - ((heute.getDay() + 6) % 7));
const plus = (n) => tagKey(new Date(montag.getFullYear(), montag.getMonth(), montag.getDate() + n));

// A: ueber die ganze Woche hinaus (beide Kanten offen), B: Do-Fr, C: naechste Woche.
let A, B, C, namen;
async function vorbereiten() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await anmelden(page, LEITUNG);
  const benutzer = (await api(page, "/benutzer")).body ?? [];
  const id = (email) => benutzer.find((b) => b.email === email)?.id;
  const [ma, ka] = [id(ANDERE), id(DRITTE)];
  if (!ma || !ka) throw new Error(`Konten ${ANDERE} / ${DRITTE} fehlen.`);
  namen = { ma: benutzer.find((b) => b.id === ma).name, ka: benutzer.find((b) => b.id === ka).name };
  const alt = (await api(page, `/kalender/abwesenheiten?von=${plus(-14)}&bis=${plus(28)}`)).body ?? [];
  for (const a of alt) await api(page, `/kalender/abwesenheiten/${a.id}/stornieren`, "POST");
  const neu = async (benutzerId, art, von, bis) => {
    const r = await api(page, "/kalender/abwesenheiten", "POST", { benutzerId, art, von, bis });
    if (r.status >= 300) throw new Error(`Abwesenheit anlegen: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  A = await neu(ma, "urlaub", plus(-5), plus(11));
  B = await neu(ka, "krank", plus(3), plus(4));
  C = await neu(undefined, "fortbildung", plus(8), plus(9));
  await ctx.close();
}

/** Lage eines Strahls gegen die Kacheln seiner Zeile: Anfang/Ende an den richtigen Kacheln, unten in der Kachel, unter Zahl und Punkten. */
const strahlLage = (page, rasterSel) =>
  page.evaluate((sel) => {
    const raster = document.querySelector(sel);
    if (!raster || raster.offsetParent === null) return null;
    const box = (e) => e.getBoundingClientRect();
    const kacheln = [...raster.querySelectorAll(".zv-kal-tag")];
    return [...raster.querySelectorAll(".zv-kal-strahl-linie")].map((l) => {
      const r = box(l);
      const zeile = kacheln.filter((k) => { const b = box(k); return b.top <= r.top && b.bottom >= r.bottom; });
      const erste = zeile.find((k) => box(k).right > r.left + 1);
      const letzte = [...zeile].reverse().find((k) => box(k).left < r.right - 1);
      const inhaltUnten = Math.max(...[erste, letzte].flatMap((k) => [...k.querySelectorAll(".zv-kal-tag-zahl, .zv-kal-punkte")].map((e) => box(e).bottom)));
      return {
        id: l.dataset.strahl,
        breite: r.width,
        vonTag: erste?.getAttribute("aria-label") ?? null,
        vonIndex: kacheln.indexOf(erste),
        bisIndex: kacheln.indexOf(letzte),
        offenLinks: l.classList.contains("vorher"),
        offenRechts: l.classList.contains("nachher"),
        bodenAbstand: erste ? box(erste).bottom - r.bottom : null,
        ueberInhalt: r.top - inhaltUnten,
        hoehe: r.height,
        farbe: getComputedStyle(l).backgroundColor,
      };
    });
  }, rasterSel);

async function durchlauf(breite, hoehe, schema) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 2, colorScheme: schema === "dunkel" ? "dark" : "light" });
  const page = await ctx.newPage();
  const tag = `${breite}-${schema}`;
  await anmelden(page, LEITUNG);
  await zu(page, "Kalender");
  await page.waitForTimeout(600);
  console.log(`\n${tag}: Woche`);

  if (breite > 700) {
    const balken = page.locator(".zv-kal-abwesend-zeile .zv-kal-strahl");
    await balken.first().waitFor({ timeout: 5000 }).catch(() => {});
    const lage = await page.evaluate(() => {
      const spalten = [...document.querySelectorAll(".zv-kal-woche-tag")].map((e) => e.getBoundingClientRect());
      return [...document.querySelectorAll(".zv-kal-abwesend-zeile .zv-kal-strahl")].map((b) => {
        const r = b.getBoundingClientRect();
        const von = spalten.findIndex((s) => s.right > r.left + 1);
        const bis = spalten.length - 1 - [...spalten].reverse().findIndex((s) => s.left < r.right - 1);
        return { text: b.textContent, von, bis, offenL: b.classList.contains("vorher"), offenR: b.classList.contains("nachher") };
      });
    });
    ok(lage.length === 2, `zwei Abwesenheitsbalken in der Woche (gemessen ${lage.length}; C liegt in der Folgewoche)`);
    const a = lage.find((l) => l.text.includes(namen.ma));
    const b = lage.find((l) => l.text.includes(namen.ka));
    ok(a && a.von === 0 && a.bis === 6 && a.offenL && a.offenR, `Urlaub über die Woche hinaus: Mo–So, beide Kanten offen (${JSON.stringify(a)})`);
    ok(b && b.von === 3 && b.bis === 4 && !b.offenL && !b.offenR, `Krank Do–Fr: genau Spalten 4–5 (${JSON.stringify(b)})`);
    const k = await kontrast(page, ".zv-kal-abwesend-zeile .zv-kal-strahl strong");
    ok(k !== null && k >= 4.5, `Kontrast Name im Balken ${k} >= 4.5`);
    const kArt = await kontrast(page, ".zv-kal-abwesend-zeile .zv-kal-strahl .zv-art-marke");
    ok(kArt !== null && kArt >= 4.5, `Kontrast Art im Balken ${kArt} >= 4.5`);
    // Zeile liegt ueber den ganztaegigen Terminen und unter dem Kopf.
    const reihenfolge = await page.evaluate(() => {
      const z = document.querySelector(".zv-kal-abwesend-zeile");
      return z?.previousElementSibling?.classList.contains("zv-kal-woche-kopf") && z?.nextElementSibling?.classList.contains("zv-kal-ganztag");
    });
    ok(reihenfolge, "Zeile „Abwesend“ zwischen Wochenkopf und „Ganztägig“");
    await page.screenshot({ path: `${BILDER}/1-woche-${tag}.png` });
    await balken.filter({ hasText: namen.ma }).click();
    const dialog = page.locator(".zv-modal, [role=dialog]").first();
    await dialog.waitFor({ timeout: 3000 }).catch(() => {});
    ok((await dialog.textContent().catch(() => ""))?.includes(namen.ma), "Klick auf den Balken öffnet die Abwesenheit");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.click('.zv-segmented [role=tab]:has-text("Monat")');
    await page.waitForTimeout(500);
    console.log(`${tag}: Monat`);
  }

  const lagen = await strahlLage(page, ".zv-kal-raster");
  ok(Array.isArray(lagen) && lagen.length > 0, `Strahlen im Raster vorhanden (${lagen?.length ?? 0})`);
  const ids = new Set((lagen ?? []).map((l) => l.id));
  ok(ids.has(A.id) && ids.has(B.id), "Urlaub und Krank als Strahl im Raster");
  // Je Wochenzeile: Anfang/Ende an der richtigen Kachel.
  const ka = await page.evaluate(() => [...document.querySelectorAll(".zv-kal-raster .zv-kal-tag")].map((k) => k.getAttribute("aria-label")));
  const datumVon = (label) => label?.split(",")[0];
  const fmt = (key) => new Date(`${key}T12:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  for (const l of lagen ?? []) {
    const abw = [A, B, C].find((x) => x.id === l.id);
    if (!abw) continue;
    const erste = datumVon(ka[l.vonIndex]);
    const letzte = datumVon(ka[l.bisIndex]);
    const tageZeile = ka.slice(l.vonIndex - (l.vonIndex % 7), l.vonIndex - (l.vonIndex % 7) + 7).map(datumVon);
    const erwVon = tageZeile.includes(fmt(abw.von)) ? fmt(abw.von) : tageZeile[0];
    const erwBis = tageZeile.includes(fmt(abw.bis)) ? fmt(abw.bis) : tageZeile[6];
    ok(erste === erwVon && letzte === erwBis, `Strahl ${abw.art}: ${erste}–${letzte} (erwartet ${erwVon}–${erwBis})`);
    ok(l.offenLinks === (erwVon !== fmt(abw.von)) && l.offenRechts === (erwBis !== fmt(abw.bis)), `Strahl ${abw.art}: offene Kanten nur am Wochenrand`);
    ok(l.bodenAbstand >= 0 && l.bodenAbstand <= 16 && l.ueberInhalt >= 0, `Strahl ${abw.art}: am Kachelfuss, unter Zahl/Punkten (Abstand unten ${l.bodenAbstand.toFixed(1)}, über Inhalt ${l.ueberInhalt.toFixed(1)})`);
    ok(l.hoehe >= 4 && !/rgba\(0, 0, 0, 0\)|transparent/.test(l.farbe), `Strahl ${abw.art}: sichtbar (${l.hoehe}px, ${l.farbe})`);
  }
  // Kacheln behalten ihre Zellen: keine zwei Kacheln uebereinander.
  const doppelt = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".zv-kal-raster .zv-kal-tag")].filter((k) => k.offsetParent).map((k) => { const r = k.getBoundingClientRect(); return `${Math.round(r.left)}:${Math.round(r.top)}`; });
    return p.length - new Set(p).size;
  });
  ok(doppelt === 0, `jede Kachel in eigener Zelle (${doppelt} doppelt)`);
  const u = await ueberlauf(page);
  ok(u.s <= u.c, `kein horizontaler Überlauf (${u.s} <= ${u.c})`);
  await page.screenshot({ path: `${BILDER}/2-${breite > 700 ? "monat" : "woche-handy"}-${tag}.png`, fullPage: breite <= 700 });

  // Personenfilter: nur Kai -> kein Strahl von Maria.
  await page.click('.zv-filterleiste button:has-text("Mitarbeitende")');
  await page.locator(`[role=option]:has-text("${namen.ka}"), label:has-text("${namen.ka}")`).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const gefiltert = await strahlLage(page, ".zv-kal-raster");
  const gIds = new Set((gefiltert ?? []).map((l) => l.id));
  ok(!gIds.has(A.id) && gIds.has(B.id), "Personenfilter: nur noch der Strahl der gewählten Person");
  await ctx.close();
}

await vorbereiten();
await durchlauf(1440, 900, "dunkel");
await durchlauf(1440, 900, "hell");
await durchlauf(390, 844, "hell");
await browser.close();

const ERWARTET = 40;
if (messungen < ERWARTET) {
  console.error(`\nNur ${messungen} Messungen (erwartet mindestens ${ERWARTET}) -- die Pruefung hat nicht gemessen, was sie soll.`);
  process.exit(1);
}
if (fehler.length) {
  console.error(`\n${fehler.length} Fehler:`);
  for (const f of fehler) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nAlles in Ordnung (${messungen} Messungen). Bilder: ${BILDER}`);
