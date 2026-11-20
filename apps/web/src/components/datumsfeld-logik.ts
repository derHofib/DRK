/**
 * Reine Datumsrechnung fuer Datumsfeld, Monatsfeld und Zeitraumfeld.
 *
 * Alles laeuft ueber ISO-Strings (JJJJ-MM-TT bzw. JJJJ-MM), weil die API
 * genau das schickt und erwartet (siehe Fallstrick "pg + Zeitzone" in
 * CLAUDE.md). Wo ein Date-Objekt noetig ist, wird es ausschliesslich aus
 * lokalen Teilen gebaut (new Date(j, m - 1, t)) und ueber lokalesDatum()
 * zurueckgelesen -- nie new Date("2026-11-20"): das waere Mitternacht UTC
 * und in Berlin abends ein anderer Tag.
 */
import { formatDatum, heuteBerlin, lokalesDatum } from "../format";

export const MONATSNAMEN = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date(2026, i, 1))
);
export const MONATSNAMEN_KURZ = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat("de-DE", { month: "short" }).format(new Date(2026, i, 1)).replace(".", "")
);
/** Wochenbeginn Montag (deutscher Kalender, passt zu kalenderwoche() in format.ts). */
export const WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WOCHENTAGE_LANG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

const ISO_TAG = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONAT = /^(\d{4})-(\d{2})$/;

function zwei(n: number): string {
  return String(n).padStart(2, "0");
}

/** Gibt es den Tag? (31.11. nicht, 29.02. nur im Schaltjahr) */
export function tagGibtEs(j: number, m: number, t: number): boolean {
  if (m < 1 || m > 12 || t < 1) return false;
  return t <= new Date(j, m, 0).getDate();
}

export function istIsoTag(s: string): boolean {
  const r = ISO_TAG.exec(s);
  return Boolean(r && tagGibtEs(+r[1], +r[2], +r[3]));
}

export function teile(iso: string): { j: number; m: number; t: number } {
  const [j, m, t] = iso.split("-").map(Number);
  return { j, m, t: t || 1 };
}

/** Lokales Date nur fuer Wochentag und Ueberlauf-Rechnung, nie fuer die Ausgabe an die API. */
function alsDatum(iso: string): Date {
  const { j, m, t } = teile(iso);
  return new Date(j, m - 1, t);
}

export function plusTage(iso: string, n: number): string {
  const d = alsDatum(iso);
  return lokalesDatum(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Monat weiterblaettern; der Tag wird auf das Monatsende gekappt (31.01. + 1 Monat = 28./29.02.). */
export function plusMonate(iso: string, n: number): string {
  const { j, m, t } = teile(iso);
  const ziel = new Date(j, m - 1 + n, 1);
  const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  return lokalesDatum(new Date(ziel.getFullYear(), ziel.getMonth(), Math.min(t, letzter)));
}

/** 0 = Montag ... 6 = Sonntag */
export function wochentag(iso: string): number {
  return (alsDatum(iso).getDay() + 6) % 7;
}

export function monatVon(iso: string): string {
  return iso.slice(0, 7);
}

export function plusMonatAufMonat(monat: string, n: number): string {
  return monatVon(plusMonate(`${monat}-01`, n));
}

/** Die 42 Tage (6 Wochen, Montag zuerst), die ein Monatsblatt zeigt. */
export function monatsblatt(monat: string): string[] {
  const erster = `${monat}-01`;
  const start = plusTage(erster, -wochentag(erster));
  return Array.from({ length: 42 }, (_, i) => plusTage(start, i));
}

export function monatTitel(monat: string): string {
  const { j, m } = teile(`${monat}-01`);
  return `${MONATSNAMEN[m - 1]} ${j}`;
}

/** Vorlesbarer Name eines Tages: "Freitag, 20. November 2026". */
export function tagLang(iso: string): string {
  const { j, m, t } = teile(iso);
  return `${WOCHENTAGE_LANG[wochentag(iso)]}, ${t}. ${MONATSNAMEN[m - 1]} ${j}`;
}

/** "20. November 2026" bzw. ohne Jahr fuer den ersten Teil eines Zeitraums im selben Jahr. */
function tagKurzInWorten(iso: string, mitJahr: boolean): string {
  const { j, m, t } = teile(iso);
  return `${t}. ${MONATSNAMEN[m - 1]}${mitJahr ? ` ${j}` : ""}`;
}

export function tageZwischen(von: string, bis: string): number {
  const a = alsDatum(von);
  const b = alsDatum(bis);
  // Math.round: ueber die Zeitumstellung hinweg sind es 23 bzw. 25 Stunden.
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/** "9. bis 20. November 2026, 12 Tage" -- fuer aria-live, damit der Zeitraum am Stueck vorgelesen wird. */
export function zeitraumInWorten(von: string, bis: string): string {
  if (!von && !bis) return "Kein Zeitraum gewählt";
  if (von && !bis) return `Ab ${tagKurzInWorten(von, true)}, Ende noch offen`;
  if (!von) return `Bis ${tagKurzInWorten(bis, true)}`;
  const n = tageZwischen(von, bis);
  if (von === bis) return `${tagKurzInWorten(von, true)}, 1 Tag`;
  const gleichesJahr = von.slice(0, 4) === bis.slice(0, 4);
  const gleicherMonat = von.slice(0, 7) === bis.slice(0, 7);
  const anfang = gleicherMonat ? `${teile(von).t}.` : tagKurzInWorten(von, !gleichesJahr);
  return `${anfang} bis ${tagKurzInWorten(bis, true)}, ${n} Tage`;
}

/** Kurz fuer die Filterpille: "09.11. – 20.11.2026". */
export function zeitraumKurz(von: string, bis: string): string {
  if (von && bis) {
    const a = formatDatum(von);
    return von.slice(0, 4) === bis.slice(0, 4) ? `${a.slice(0, 6)} – ${formatDatum(bis)}` : `${a} – ${formatDatum(bis)}`;
  }
  if (von) return `ab ${formatDatum(von)}`;
  if (bis) return `bis ${formatDatum(bis)}`;
  return "";
}

export type Ergebnis = { iso: string } | { fehler: string };

/**
 * Getippten Text in ein ISO-Datum verwandeln.
 *
 * `locker` (beim Verlassen des Felds oder Enter) nimmt zusaetzlich Kurzformen:
 * "20.11." und "2011" (aktuelles Jahr), "20.11.26", "201126", "heute",
 * "gestern", "morgen". Beim Tippen selbst nur Vollformen -- sonst wuerde
 * "2" schon als "02. des Monats" gedeutet und das Feld spraenge um,
 * waehrend man noch tippt.
 */
export function leseDatum(text: string, locker: boolean, heute: string = heuteBerlin()): Ergebnis | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  if (s === "heute") return { iso: heute };
  if (s === "gestern") return { iso: plusTage(heute, -1) };
  if (s === "morgen") return { iso: plusTage(heute, 1) };

  let j: number | undefined;
  let m: number | undefined;
  let t: number | undefined;
  const iso = ISO_TAG.exec(s);
  const punkte = /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/.exec(s);
  const ziffern = /^\d+$/.test(s) ? s : null;
  const jahrJetzt = Number(heute.slice(0, 4));
  // Zweistellige Jahre: bis 10 Jahre in die Zukunft zaehlen sie zu diesem
  // Jahrhundert, sonst zum vorigen -- "85" beim Geburtsdatum ist 1985, "27"
  // bei einer Faelligkeit ist 2027.
  const jahrhundert = (yy: number) => (yy <= (jahrJetzt % 100) + 10 ? 2000 + yy : 1900 + yy);

  if (iso) {
    [j, m, t] = [+iso[1], +iso[2], +iso[3]];
  } else if (punkte && (punkte[3]?.length === 4 || locker)) {
    t = +punkte[1];
    m = +punkte[2];
    j = punkte[3] ? (punkte[3].length === 2 ? jahrhundert(+punkte[3]) : +punkte[3]) : jahrJetzt;
  } else if (ziffern && ziffern.length === 8) {
    [t, m, j] = [+ziffern.slice(0, 2), +ziffern.slice(2, 4), +ziffern.slice(4)];
  } else if (ziffern && locker && ziffern.length === 6) {
    [t, m, j] = [+ziffern.slice(0, 2), +ziffern.slice(2, 4), jahrhundert(+ziffern.slice(4))];
  } else if (ziffern && locker && ziffern.length === 4) {
    [t, m, j] = [+ziffern.slice(0, 2), +ziffern.slice(2, 4), jahrJetzt];
  } else {
    return locker ? { fehler: "Kein gültiges Datum. Bitte als TT.MM.JJJJ eingeben, z. B. 20.11.2026." } : null;
  }
  if (j < 1900 || j > 2100) return { fehler: `Das Jahr ${j} liegt außerhalb des möglichen Bereichs.` };
  if (m < 1 || m > 12) return { fehler: `Einen ${m}. Monat gibt es nicht.` };
  if (!tagGibtEs(j, m, t)) return { fehler: `Den ${t}. ${MONATSNAMEN[m - 1]} ${j} gibt es nicht.` };
  return { iso: `${j}-${zwei(m)}-${zwei(t)}` };
}

/** Grenzen pruefen; liefert die Meldung in Worten oder null. */
export function grenzFehler(iso: string, min?: string, max?: string): string | null {
  if (min && iso < min) return `Frühestens ${formatDatum(min)} möglich.`;
  if (max && iso > max) return `Spätestens ${formatDatum(max)} möglich.`;
  return null;
}

export function istIsoMonat(s: string): boolean {
  const r = ISO_MONAT.exec(s);
  return Boolean(r && +r[2] >= 1 && +r[2] <= 12);
}

export type SchnellwahlArt = "heute-gestern" | "faelligkeit" | "heute" | "keine";

/** Schnellwahl-Chips je Einsatzort (Konzept 3.3). */
export function schnellwahlTage(art: SchnellwahlArt, heute: string = heuteBerlin()): { label: string; iso: string }[] {
  switch (art) {
    case "heute-gestern":
      return [
        { label: "Heute", iso: heute },
        { label: "Gestern", iso: plusTage(heute, -1) },
      ];
    case "faelligkeit":
      return [
        { label: "Heute", iso: heute },
        { label: "Morgen", iso: plusTage(heute, 1) },
        { label: "+ 7 Tage", iso: plusTage(heute, 7) },
      ];
    case "heute":
      return [{ label: "Heute", iso: heute }];
    case "keine":
      return [];
  }
}
