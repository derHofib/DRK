/**
 * Messt, ob die Katze beim Gehen rutscht (Konzept: /mnt/project-files/katze/bewegungskonzept.md).
 *
 * Aufruf: cd apps/web && pnpm build && pnpm exec vite preview --port 4173 &
 *         node scripts/katzen-pruefung.mjs
 *
 * Gemessen wird die Bildschirmposition jeder Pfote in jedem Frame. Eine Pfote
 * "steht", solange sie auf ihrer tiefsten Stelle ist; in dieser Zeit darf ihre
 * x-Position nicht wandern, sonst gleitet sie ueber den Boden. Die ersten
 * 1,2 s (Anlauf, Fuesse blenden in den Gang) zaehlen nicht.
 *
 * Wie bei design-pruefung.mjs: wer nichts misst, besteht nicht -- es muessen
 * mindestens 4 Standphasen je Pfote gefunden werden.
 */
import { chromium } from "playwright";

const URL = process.env.PRUEFUNG_URL ?? "http://localhost:4173";
const GRENZE_PX = 1.0;
const MIN_PHASEN = 4;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
await page.goto(URL);
await page.waitForTimeout(600);
await page.keyboard.press("Alt+Shift+KeyK");
await page.evaluate(() => {
  window.__rec = [];
  const f = () => {
    const e = document.querySelector(".zv-katze");
    if (e && /pose-gehen/.test(e.className)) {
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
await page.waitForTimeout(6500);
const rec = await page.evaluate(() => window.__rec);
await browser.close();

if (rec.length < 100) {
  console.error(`FEHLER: nur ${rec.length} Frames im Gehen aufgezeichnet -- Messung ungueltig`);
  process.exit(1);
}
const t0 = rec[0].t;
let schlecht = 0;
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
      if (j - start >= 5 && rec[start].t - t0 > 1200) {
        const xs = rec.slice(start, j).map((r) => r.f[i][0]);
        worst = Math.max(worst, Math.max(...xs) - Math.min(...xs));
        phasen++;
      }
      start = -1;
    }
  }
  const ok = phasen >= MIN_PHASEN && worst <= GRENZE_PX;
  console.log(`Pfote ${i}: ${phasen} Standphasen, groesstes Rutschen ${worst.toFixed(2)} px ${ok ? "OK" : "FEHLER"}`);
  if (!ok) schlecht++;
}
if (schlecht) process.exit(1);
console.log("Gang rutscht nicht.");
