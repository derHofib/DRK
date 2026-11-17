// Prueft die Rechnung der Wochenansicht (Zeitraster) ohne Browser und ohne Datenbank:
//   (cd apps/api && TZ=Europe/Berlin pnpm exec tsx ../web/scripts/zeitraster-pruefung.mjs)
// TZ fest, weil Termine mit Uhrzeit als UTC-Zeitpunkte kommen und die
// Spalten lokale Tage sind -- inklusive Umstellungstag.
import { ganztagsBalken, inGanztagszeile, startStunde, zeitBloecke } from "../src/kalender/zeitraster.ts";

let geprueft = 0;
const fehler = [];
function pruefe(name, ok, detail = "") {
  geprueft++;
  if (!ok) fehler.push(`${name} ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${ok ? "" : detail}`);
}

const lokal = (tag, uhr) => new Date(`${tag}T${uhr}`).toISOString();
const t = (id, tag, von, bisTag, bis) => ({ id, beginn: lokal(tag, von), ende: lokal(bisTag, bis), ganztaegig: false });
const g = (id, von, bis) => ({ id, beginn: von, ende: bis, ganztaegig: true });
const woche = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];

// Ganztagszeile
pruefe("ganztaegig gehoert in die Ganztagszeile", inGanztagszeile(g("a", "2026-11-17", "2026-11-17")));
pruefe("2 Stunden gehoeren ins Stundenraster", !inGanztagszeile(t("a", "2026-11-17", "09:00", "2026-11-17", "11:00")));
pruefe("genau 24 Stunden gehoeren in die Ganztagszeile", inGanztagszeile(t("a", "2026-11-17", "08:00", "2026-11-18", "08:00")));

const balken = ganztagsBalken(
  [g("lang", "2026-11-14", "2026-11-18"), g("di", "2026-11-17", "2026-11-17"), g("do", "2026-11-19", "2026-11-25"), g("weg", "2026-11-01", "2026-11-02")],
  woche,
);
const b = Object.fromEntries(balken.map((x) => [x.termin.id, x]));
pruefe("Termin ausserhalb der Woche faellt weg", !b.weg && balken.length === 3);
pruefe("aus der Vorwoche: beginnt Mo, Kante offen", b.lang.von === 0 && b.lang.bis === 2 && b.lang.vorher && !b.lang.nachher, JSON.stringify(b.lang));
pruefe("in die Folgewoche: endet So, Kante offen", b.do.von === 3 && b.do.bis === 6 && b.do.nachher);
pruefe("ueberlappende Balken in getrennten Zeilen", b.lang.spur !== b.di.spur);
pruefe("nicht ueberlappender Balken nutzt die erste Zeile mit", b.do.spur === 0);

const nacht = ganztagsBalken([t("reise", "2026-11-17", "08:00", "2026-11-19", "00:00")], woche);
pruefe("Uhrzeit-Termin bis Mitternacht endet am Vortag", nacht[0].von === 1 && nacht[0].bis === 2, JSON.stringify(nacht[0]));

// Stundenraster
const tag = "2026-11-17";
const bl = zeitBloecke(
  [t("a", tag, "09:00", tag, "10:00"), t("b", tag, "09:30", tag, "11:00"), t("c", tag, "10:00", tag, "10:30"), t("d", tag, "14:00", tag, "15:00"), g("x", tag, tag)],
  tag,
);
const z = Object.fromEntries(bl.map((x) => [x.termin.id, x]));
pruefe("ganztaegige stehen nicht im Stundenraster", !z.x && bl.length === 4);
pruefe("9:00 = Minute 540, 10:00 = 600", z.a.anfang === 540 && z.a.ende === 600);
pruefe("drei ueberlappende teilen sich zwei Spalten", z.a.spalten === 2 && z.b.spalten === 2 && z.c.spalten === 2, JSON.stringify([z.a, z.b, z.c].map((x) => [x.spalte, x.spalten])));
pruefe("c rueckt in die frei gewordene Spalte von a", z.c.spalte === z.a.spalte && z.b.spalte !== z.a.spalte);
pruefe("allein liegender Termin hat die volle Breite", z.d.spalte === 0 && z.d.spalten === 1);

const kurz = zeitBloecke([t("p", tag, "09:00", tag, "09:00"), t("q", tag, "09:10", tag, "09:20")], tag);
pruefe("kurze Termine ueberlappen ueber ihre Mindesthoehe", kurz[0].spalten === 2 && kurz[0].spalte !== kurz[1].spalte, JSON.stringify(kurz.map((x) => [x.spalte, x.spalten])));
pruefe("Punkttermin erscheint an seinem Tag", kurz.some((x) => x.termin.id === "p" && x.anfang === 540));

const ueber = t("n", "2026-11-17", "22:00", "2026-11-18", "02:00");
const am17 = zeitBloecke([ueber], "2026-11-17")[0];
const am18 = zeitBloecke([ueber], "2026-11-18")[0];
pruefe("ueber Mitternacht: erster Tag bis 24 Uhr", am17.anfang === 1320 && am17.ende === 1440 && am17.nachher, JSON.stringify(am17));
pruefe("ueber Mitternacht: zweiter Tag ab 0 Uhr", am18.anfang === 0 && am18.ende === 120 && am18.vorher, JSON.stringify(am18));
pruefe("bis genau Mitternacht: Folgetag leer", zeitBloecke([t("m", tag, "22:00", "2026-11-18", "00:00")], "2026-11-18").length === 0);

// Umstellungstag (25.10.2026, 3 Uhr -> 2 Uhr): 9 Uhr bleibt auf der 9-Uhr-Linie.
const umstellung = zeitBloecke([t("u", "2026-10-25", "09:00", "2026-10-25", "10:00")], "2026-10-25")[0];
pruefe("Zeitumstellung: 9 Uhr bleibt Minute 540", umstellung.anfang === 540 && umstellung.ende === 600, JSON.stringify(umstellung));

pruefe("Start: ohne Termine 7 Uhr", startStunde(null) === 7);
pruefe("Start: frueher Termin 5:30 -> 5 Uhr", startStunde(330) === 5);
pruefe("Start: spaete Termine -> trotzdem 7 Uhr", startStunde(14 * 60) === 7);

// Ein Pruefskript, das nichts prueft, darf nicht gruen sein (CLAUDE.md).
if (geprueft < 22) fehler.push(`nur ${geprueft} Pruefungen gelaufen`);
console.log(`\n${geprueft} Pruefungen, ${fehler.length} Fehler`);
if (fehler.length) process.exit(1);
