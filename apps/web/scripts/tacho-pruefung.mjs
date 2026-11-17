// Prueft die Rechnung der Auslastungs-Kachel ohne Browser und ohne Datenbank:
//   (cd apps/api && pnpm exec tsx ../web/scripts/tacho-pruefung.mjs)
import { auslastungBerechnen, bogenPfad, tachoFarbton, tachoPunkt, tachoWinkel } from "../src/dashboard/tacho.ts";

let geprueft = 0;
const fehler = [];
function pruefe(name, ok, detail = "") {
  geprueft++;
  if (!ok) fehler.push(`${name} ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${ok ? "" : detail}`);
}
const nah = (a, b) => Math.abs(a - b) < 1e-9;

const halb = auslastungBerechnen(12, 6);
pruefe("6 von 12 belegt = 50 %", halb.belegt === 6 && halb.prozent === 50 && halb.anteil === 0.5, JSON.stringify(halb));
pruefe("2 von 3 belegt = 67 %", auslastungBerechnen(3, 1).prozent === 67);
pruefe("keine Plaetze: 0 statt NaN", auslastungBerechnen(0, 0).anteil === 0 && auslastungBerechnen(0, 0).prozent === 0);
pruefe("frei > gesamt: nicht negativ", auslastungBerechnen(4, 6).belegt === 0);
pruefe("voll = 100 %", auslastungBerechnen(5, 0).prozent === 100);

pruefe("0 % liegt links unten (-135 Grad)", tachoWinkel(0) === -135);
pruefe("50 % liegt oben (0 Grad)", tachoWinkel(0.5) === 0);
pruefe("100 % liegt rechts unten (135 Grad)", tachoWinkel(1) === 135);
pruefe("ueber 100 % wird begrenzt", tachoWinkel(1.4) === 135);

const oben = tachoPunkt(60, 60, 50, 0);
pruefe("0 Grad = 12 Uhr", nah(oben.x, 60) && nah(oben.y, 10), JSON.stringify(oben));
const rechts = tachoPunkt(60, 60, 50, 90);
pruefe("90 Grad = 3 Uhr", nah(rechts.x, 110) && nah(rechts.y, 60), JSON.stringify(rechts));

pruefe("Bogen > 180 Grad setzt large-arc", / 0 1 1 /.test(bogenPfad(60, 60, 50, -135, 135)));
pruefe("Bogen < 180 Grad ohne large-arc", / 0 0 1 /.test(bogenPfad(60, 60, 50, -135, 0)));

pruefe("Farbton frei = gruen (145)", tachoFarbton(0) === 145);
pruefe("Farbton voll = rot (25)", tachoFarbton(1) === 25);
pruefe("Farbton faellt monoton", tachoFarbton(0.3) > tachoFarbton(0.6));

// Ein Pruefskript, das nichts prueft, darf nicht gruen sein (CLAUDE.md).
if (geprueft < 16) fehler.push(`nur ${geprueft} Pruefungen gelaufen`);
console.log(`\n${geprueft} Pruefungen, ${fehler.length} Fehler`);
if (fehler.length) process.exit(1);
