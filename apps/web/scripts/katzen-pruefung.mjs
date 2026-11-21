/**
 * Prueft die Begleit-Katze im echten Browser (Unterlagen: /mnt/project-files/katze/).
 *
 * Aufruf: cd apps/web && pnpm build && pnpm exec vite preview --port 4173 &
 *         node scripts/katzen-pruefung.mjs
 * Braucht weder API noch Datenbank: die Katze lebt schon auf der Anmeldeseite.
 *
 * 1. Gang: die Bildschirmposition jeder Pfote in jedem Frame. Eine Pfote
 *    "steht", solange sie auf ihrer tiefsten Stelle ist; in dieser Zeit darf
 *    ihre x-Position nicht wandern, sonst gleitet sie ueber den Boden.
 * 2. Tageslauf im Zeitraffer (Playwright-Uhr): sie muss schlafen, aufwachen,
 *    sich putzen, im Fenster bleiben und verschiedene Dinge "sagen".
 * 3. Umgang mit dem Menschen: Zeiger belauern und anspringen, Streicheln,
 *    "es reicht", Platz machen bei Klick, Erschrecken, nie Klicks schlucken,
 *    Abgang zu Fuss und sofortiges Abschalten.
 * 4. Reduzierte Bewegung: sie sitzt still, nichts animiert, sie weicht per Schnitt.
 *
 * Wie bei design-pruefung.mjs: wer nichts misst, besteht nicht -- jeder
 * Abschnitt zaehlt seine Messungen und scheitert, wenn es zu wenige sind.
 */
import { chromium } from "playwright";

const URL = process.env.PRUEFUNG_URL ?? "http://localhost:4173";
const GRENZE_PX = 1.0;
const MIN_PHASEN = 4;

const fehler = [];
function pruefe(ok, text) {
  console.log(`${ok ? "OK    " : "FEHLER"} ${text}`);
  if (!ok) fehler.push(text);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

async function seite(optionen = {}, uhr = false) {
  const kontext = await browser.newContext({ viewport: { width: 1400, height: 760 }, ...optionen });
  const page = await kontext.newPage();
  const seitenfehler = [];
  page.on("pageerror", (e) => seitenfehler.push(e.message));
  if (uhr) await page.clock.install();
  await page.goto(URL);
  if (uhr) await page.clock.runFor(800);
  else await page.waitForTimeout(600);
  return { page, kontext, seitenfehler };
}

const stand = (page) =>
  page.evaluate(() => {
    const e = document.querySelector(".zv-katze");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { modus: e.dataset.modus, x: r.x + r.width / 2, fuss: r.y + 77, blase: document.querySelector(".zv-katze__blase")?.textContent ?? "" };
  });

/** Fuehrt den Zeiger gemaechlich an einen Ort (ein Sprung des Zeigers wuerde sie erschrecken). */
async function schlendern(page, von, nach) {
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(von[0] + ((nach[0] - von[0]) * i) / 24, von[1] + ((nach[1] - von[1]) * i) / 24);
    await page.clock.runFor(40);
  }
}

/** Laesst die Uhr laufen, bis `fertig(stand)` gilt; gibt den Stand zurueck oder null nach `sekunden`. */
async function bis(page, sekunden, fertig, jeSchritt = async () => {}) {
  for (let t = 0; t < sekunden * 1000; t += 50) {
    const s = await stand(page);
    if (s && (await fertig(s))) return s;
    await jeSchritt(s, t);
    await page.clock.runFor(50);
  }
  return null;
}

// ---------------------------------------------------------------------------
console.log("\n1. Gang (Echtzeit)");
{
  const { page, kontext } = await seite();
  await page.keyboard.press("Alt+Shift+KeyK");
  await page.evaluate(() => {
    window.__rec = [];
    const f = () => {
      const e = document.querySelector(".zv-katze");
      if (e && e.dataset.modus === "gehen") {
        window.__rec.push({
          t: performance.now(),
          f: [...e.querySelectorAll(".k-g-pfote")].map((q) => {
            const r = q.getBoundingClientRect();
            return [r.left + r.width / 2, r.top + r.height / 2];
          }),
        });
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.waitForTimeout(8500);
  const rec = await page.evaluate(() => window.__rec);
  await kontext.close();
  pruefe(rec.length >= 100, `${rec.length} Frames im Gehen aufgezeichnet (mindestens 100)`);
  if (rec.length >= 100) {
    const t0 = rec[0].t;
    for (let i = 0; i < 4; i++) {
      const ys = rec.map((r) => r.f[i][1]);
      const maxY = Math.max(...ys);
      let start = -1;
      let phasen = 0;
      let worst = 0;
      for (let j = 0; j <= rec.length; j++) {
        const am = j < rec.length && ys[j] > maxY - 0.35;
        if (am && start < 0) start = j;
        if (!am && start >= 0) {
          // Die ersten 1,2 s (Anlauf, Fuesse blenden in den Gang) zaehlen nicht.
          if (j - start >= 5 && rec[start].t - t0 > 1200) {
            const xs = rec.slice(start, j).map((r) => r.f[i][0]);
            worst = Math.max(worst, Math.max(...xs) - Math.min(...xs));
            phasen++;
          }
          start = -1;
        }
      }
      pruefe(phasen >= MIN_PHASEN && worst <= GRENZE_PX, `Pfote ${i}: ${phasen} Standphasen, groesstes Rutschen ${worst.toFixed(2)} px (Grenze ${GRENZE_PX})`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log("\n2. Tageslauf (Zeitraffer, 9 Minuten)");
{
  const { page, kontext, seitenfehler } = await seite({}, true);
  await page.keyboard.press("Alt+Shift+KeyK");
  const modi = new Set();
  const texte = new Set();
  let draussen = 0;
  let proben = 0;
  for (let s = 0; s < 540; s++) {
    await page.clock.runFor(1000);
    const st = await stand(page);
    if (!st) break;
    proben++;
    modi.add(st.modus);
    if (st.blase) texte.add(st.blase);
    // Die ersten Sekunden kommt sie von ausserhalb hereinspaziert.
    if (s >= 8 && (st.x < 0 || st.x > 1400 || st.fuss > 760 || st.fuss < 60)) {
      draussen++;
      console.log(`       Ausreisser bei ${s} s: ${JSON.stringify(st)}`);
    }
  }
  await kontext.close();
  pruefe(proben === 540, `${proben} von 540 Sekunden beobachtet`);
  for (const m of ["sitzen", "putzen", "liegen", "schlafen", "aufwachen"]) pruefe(modi.has(m), `Zustand "${m}" kam vor`);
  pruefe(texte.size >= 3, `${texte.size} verschiedene Blasentexte (mindestens 3): ${[...texte].join(" / ")}`);
  pruefe(draussen === 0, `nie ausserhalb des Fensters (${draussen} Ausreisser)`);
  pruefe(seitenfehler.length === 0, `keine Skriptfehler (${seitenfehler.join("; ") || "0"})`);
}

// ---------------------------------------------------------------------------
console.log("\n3. Umgang mit dem Menschen (Zeitraffer)");
{
  const { page, kontext, seitenfehler } = await seite({}, true);
  await page.keyboard.press("Alt+Shift+KeyK");
  const ruhig = (s) => s.modus === "sitzen";

  // Sie schluckt nie einen Klick.
  const da = await bis(page, 20, ruhig);
  pruefe(!!da, "sie kommt herein und setzt sich");
  const getroffen = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".zv-katze"), [da?.x ?? 0, (da?.fuss ?? 0) - 25]);
  pruefe(da && !getroffen, "ein Klick auf die Katze trifft, was unter ihr liegt (pointer-events: none)");

  // Jagd: der Zeiger zappelt in Sichtweite, auf ihrer Hoehe.
  const gesehen = new Set();
  let weg = null;
  const zappeln = async (s, t) => {
    if (!s) return;
    gesehen.add(s.modus);
    // Sobald sie lauert, bleibt die "Beute" an ihrem Fleck und zappelt nur noch: dorthin muss sie springen.
    if (weg === null || (s.modus !== "lauern" && s.modus !== "flug" && s.modus !== "landen")) weg = s.x + (s.x < 700 ? 1 : -1) * 200;
    await page.mouse.move(weg + 12 * Math.sin(t / 130), s.fuss - 30 + 14 * Math.sin(t / 90));
  };
  const gefangen = await bis(page, 90, (s) => s.modus === "fangen", zappeln);
  pruefe(gesehen.has("lauern"), "zappelnder Zeiger: sie lauert");
  pruefe(!!gefangen, "danach springt sie hin und schlaegt mit der Pfote zu");
  pruefe(!gefangen || Math.abs(gefangen.x - weg) < 130, `sie landet beim Zeiger (Abstand ${gefangen ? Math.abs(gefangen.x - weg).toFixed(0) : "?"} px)`);

  // Streicheln: ruhiger Zeiger AUF ihr.
  await page.mouse.move(5, 5);
  let sitzt = await bis(page, 60, ruhig);
  const blasen = new Set();
  const streicheln = async (s, t) => {
    if (!s) return;
    if (s.blase) blasen.add(s.blase);
    await page.mouse.move(s.x + 3 * Math.sin(t / 200), s.fuss - 26);
  };
  if (sitzt) await schlendern(page, [5, 5], [sitzt.x, sitzt.fuss - 26]);
  const geniesst = await bis(page, 30, (s) => s.modus === "geniessen", streicheln);
  pruefe(!!sitzt && !!geniesst, "ruhiger Zeiger auf ihr: sie geniesst es");
  const reicht = await bis(page, 25, (s) => s.modus === "weichen" || s.modus === "anlauf" || (s.modus === "gehen" && blasen.size > 0), streicheln);
  pruefe([...blasen].some((t) => /rr|Genau|links|Weiter|bleiben/.test(t)), `sie schnurrt dabei (${[...blasen].join(" / ") || "keine Blase"})`);
  pruefe(!!reicht, "irgendwann reicht es ihr und sie geht");

  // Klick auf sie: sie macht Platz.
  await page.mouse.move(5, 5);
  sitzt = await bis(page, 60, ruhig);
  if (sitzt) {
    await schlendern(page, [5, 5], [sitzt.x, sitzt.fuss - 25]);
    await page.mouse.click(sitzt.x, sitzt.fuss - 25);
    const fort = await bis(page, 12, (s) => s.modus === "sitzen" && (Math.abs(s.x - sitzt.x) > 110 || Math.abs(s.fuss - sitzt.fuss) > 40));
    pruefe(!!fort, `Klick auf sie: sie raeumt den Platz (${fort ? Math.abs(fort.x - sitzt.x).toFixed(0) : 0} px weiter)`);
  } else pruefe(false, "Klick auf sie: sie raeumt den Platz (sie sass nie)");

  // Schreck: der Zeiger schiesst auf sie zu.
  // Vorher Ruhe: nach einem Schreck ist sie eine Weile nicht wieder zu erschrecken.
  await page.mouse.move(5, 5);
  await page.clock.runFor(30000);
  sitzt = await bis(page, 90, ruhig);
  if (sitzt) {
    // Ein Ruck mit der Maus: 680 px in gut 0,1 s.
    const von = sitzt.x < 700 ? sitzt.x + 680 : sitzt.x - 680;
    for (let i = 0; i <= 8; i++) {
      await page.mouse.move(von + ((sitzt.x - von) * i) / 8, sitzt.fuss - 30);
      await page.clock.runFor(16);
    }
    const schreck = await bis(page, 1, (s) => s.modus === "schreck");
    pruefe(!!schreck, `Zeiger schiesst auf sie zu: sie erschrickt (Buckel) -- war ${sitzt.modus}, ist ${(await stand(page))?.modus}`);
  } else pruefe(false, "Zeiger schiesst auf sie zu: sie erschrickt (sie sass nie)");

  // Abgang zu Fuss, dann sofortiges Abschalten.
  await page.mouse.move(5, 5);
  await bis(page, 60, ruhig);
  await page.keyboard.press("Alt+Shift+KeyK");
  const geht = await bis(page, 12, (s) => s.modus === "abgang");
  pruefe(!!geht, "Tastenkuerzel: sie geht zu Fuss hinaus");
  let fort = false;
  for (let t = 0; t < 12000 && !fort; t += 100) {
    await page.clock.runFor(100);
    fort = (await stand(page)) === null;
  }
  pruefe(fort, "danach ist sie weg");
  await page.keyboard.press("Alt+Shift+KeyK");
  await page.clock.runFor(300);
  await page.keyboard.press("Alt+Shift+KeyK");
  await page.clock.runFor(100);
  await page.keyboard.press("Alt+Shift+KeyK");
  await page.clock.runFor(100);
  pruefe((await stand(page)) === null, "zweimal druecken: sofort weg, ohne Abgang");

  // Die Begruessung ist nicht jedes Mal dieselbe.
  const gruesse = new Set();
  let auftritte = 0;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Alt+Shift+KeyK");
    const s = await bis(page, 20, (st) => st.blase !== "");
    if (s) {
      gruesse.add(s.blase);
      auftritte++;
    }
    await page.keyboard.press("Alt+Shift+KeyK");
    await page.keyboard.press("Alt+Shift+KeyK");
    await page.clock.runFor(100);
  }
  pruefe(auftritte === 10 && gruesse.size >= 3, `${auftritte} Auftritte, ${gruesse.size} verschiedene Begruessungen (mindestens 3): ${[...gruesse].join(" / ")}`);
  pruefe(seitenfehler.length === 0, `keine Skriptfehler (${seitenfehler.join("; ") || "0"})`);
  await kontext.close();
}

// ---------------------------------------------------------------------------
console.log("\n4. Reduzierte Bewegung (Echtzeit)");
{
  const { page, kontext } = await seite({ reducedMotion: "reduce" });
  await page.keyboard.press("Alt+Shift+KeyK");
  await page.waitForTimeout(700);
  const lage = () =>
    page.evaluate(() => {
      const e = document.querySelector(".zv-katze");
      if (!e) return null;
      return {
        t: e.style.transform,
        figur: e.querySelector(".k-koerper")?.getAttribute("d") ?? "",
        kopf: e.querySelector(".k-kopf-vorn")?.getAttribute("transform") ?? "",
        animationen: e.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
      };
    });
  const a = await lage();
  await page.waitForTimeout(1600);
  const b = await lage();
  pruefe(!!a && a.figur.length > 50, "sie ist da und gezeichnet");
  pruefe(!!a && !!b && a.t === b.t && a.figur === b.figur && a.kopf === b.kopf, "nach 1,6 s unveraendert: keine Bewegung");
  pruefe(!!b && b.animationen === 0, `keine laufende Animation (${b?.animationen})`);
  const vorher = await stand(page);
  await page.mouse.move(vorher.x, vorher.fuss - 30);
  await page.waitForTimeout(300);
  const nachher = await stand(page);
  pruefe(Math.abs(nachher.x - vorher.x) > 300, "Zeiger kommt: sie wechselt per Schnitt die Seite");
  await page.keyboard.press("Alt+Shift+KeyK");
  await page.waitForTimeout(150);
  pruefe((await stand(page)) === null, "Tastenkuerzel: sofort weg");
  await kontext.close();
}

await browser.close();
if (fehler.length > 0) {
  console.error(`\n${fehler.length} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nKatze in Ordnung.");
