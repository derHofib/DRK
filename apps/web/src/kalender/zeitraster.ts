/**
 * Rechnung der Wochenansicht als Zeitraster (Rueckmeldung aus dem Betrieb:
 * Termine wie in Outlook senkrecht im Tag, oben die ganztaegigen, darunter
 * nach Stunden). Rein und ohne DOM, damit sie sich ohne Browser pruefen
 * laesst (scripts/zeitraster-pruefung.mjs).
 *
 * Gerechnet wird in lokalen Wanduhr-Minuten (0..1440) statt in
 * Millisekunden ab Mitternacht: an den Umstellungstagen hat ein Tag 23 bzw.
 * 25 Stunden, das Raster aber immer 24 Zeilen -- ein Termin um 9 Uhr soll
 * auch dann auf der 9-Uhr-Linie stehen.
 */

export interface RasterTermin {
  id: string;
  beginn: string;
  ende: string;
  ganztaegig: boolean;
}

/** Kuerzer dargestellt waere ein Termin nicht mehr anklickbar; die Ueberlappung rechnet mit derselben Mindesthoehe, sonst ueberdecken sich kurze Termine. */
export const MINDEST_MINUTEN = 30;
const TAG_MINUTEN = 24 * 60;

function datumAusKey(key: string): Date {
  const [j, m, t] = key.split("-").map(Number);
  return new Date(j, m - 1, t);
}

function lokalesDatum(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function folgetag(key: string): Date {
  const d = datumAusKey(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

/**
 * Gehoert ein Termin in die Ganztagszeile? Ganztaegige ja -- und auch
 * Termine mit Uhrzeit, die 24 Stunden oder laenger dauern: eine Dienstreise
 * von Mo 8 Uhr bis Mi 18 Uhr waere im Stundenraster drei vollflaechige
 * Bloecke, die alles andere verdecken. Outlook macht es genauso.
 */
export function inGanztagszeile(t: RasterTermin): boolean {
  return t.ganztaegig || new Date(t.ende).getTime() - new Date(t.beginn).getTime() >= TAG_MINUTEN * 60_000;
}

function ersterUndLetzterTag(t: RasterTermin): [string, string] {
  if (t.ganztaegig) return [t.beginn, t.ende < t.beginn ? t.beginn : t.ende];
  const von = lokalesDatum(new Date(t.beginn));
  // Endet um Mitternacht: der Folgetag gehoert nicht mehr dazu.
  const bis = lokalesDatum(new Date(Math.max(new Date(t.beginn).getTime(), new Date(t.ende).getTime() - 1)));
  return [von, bis];
}

export interface GanztagsBalken<T> {
  termin: T;
  /** Spalte 0..6 (Mo..So), auf die Woche begrenzt. */
  von: number;
  bis: number;
  /** Zeile innerhalb der Ganztagszeile, ab 0. */
  spur: number;
  /** Faengt vor bzw. endet nach dieser Woche -- die Kante wird dann offen gezeichnet. */
  vorher: boolean;
  nachher: boolean;
}

/**
 * Ganztagsbalken ueber mehrere Tage, in moeglichst wenige Zeilen gepackt:
 * frueher beginnende und laengere zuerst, jeder in die erste freie Zeile.
 */
export function ganztagsBalken<T extends RasterTermin>(termine: T[], wochenTage: string[]): GanztagsBalken<T>[] {
  const erster = wochenTage[0];
  const letzter = wochenTage[wochenTage.length - 1];
  const balken = termine
    .filter(inGanztagszeile)
    .map((termin) => {
      const [a, b] = ersterUndLetzterTag(termin);
      return { termin, a, b };
    })
    .filter(({ a, b }) => b >= erster && a <= letzter)
    .map(({ termin, a, b }) => ({
      termin,
      von: a < erster ? 0 : wochenTage.indexOf(a),
      bis: b > letzter ? wochenTage.length - 1 : wochenTage.indexOf(b),
      vorher: a < erster,
      nachher: b > letzter,
      spur: 0,
    }))
    .sort((x, y) => x.von - y.von || y.bis - y.von - (x.bis - x.von) || x.termin.beginn.localeCompare(y.termin.beginn));
  const spurEnde: number[] = [];
  for (const b of balken) {
    let spur = spurEnde.findIndex((ende) => ende < b.von);
    if (spur === -1) spur = spurEnde.length;
    spurEnde[spur] = b.bis;
    b.spur = spur;
  }
  return balken;
}

export interface ZeitBlock<T> {
  termin: T;
  /** Wanduhr-Minuten im Tag, 0..1440. */
  anfang: number;
  ende: number;
  /** Nebeneinander ueberlappender Termine: Spalte und Spaltenzahl der Gruppe. */
  spalte: number;
  spalten: number;
  /** Laeuft vom Vortag herein bzw. in den Folgetag hinaus. */
  vorher: boolean;
  nachher: boolean;
}

/**
 * Bloecke eines Tages im Stundenraster. Ueberlappende Termine stehen
 * nebeneinander: jede Gruppe sich (auch mittelbar) ueberschneidender Termine
 * bekommt so viele Spalten, wie gleichzeitig noetig sind -- wie in Outlook.
 */
export function zeitBloecke<T extends RasterTermin>(termine: T[], tag: string): ZeitBlock<T>[] {
  const tagAnfang = datumAusKey(tag).getTime();
  const tagEnde = folgetag(tag).getTime();
  const bloecke: ZeitBlock<T>[] = [];
  for (const termin of termine) {
    if (inGanztagszeile(termin)) continue;
    const b = new Date(termin.beginn);
    const e = new Date(termin.ende);
    // Punkttermine (Beginn = Ende) gehoeren in den Tag, in dem sie liegen.
    const beruehrt = b.getTime() < tagEnde && (e.getTime() > tagAnfang || (b.getTime() >= tagAnfang && b.getTime() === e.getTime()));
    if (!beruehrt) continue;
    const vorher = b.getTime() < tagAnfang;
    const nachher = e.getTime() > tagEnde;
    const anfang = vorher ? 0 : b.getHours() * 60 + b.getMinutes();
    const ende = e.getTime() >= tagEnde ? TAG_MINUTEN : Math.max(anfang, e.getHours() * 60 + e.getMinutes());
    bloecke.push({ termin, anfang, ende, spalte: 0, spalten: 1, vorher, nachher });
  }
  bloecke.sort((x, y) => x.anfang - y.anfang || y.ende - x.ende);

  const sichtbaresEnde = (b: ZeitBlock<T>) => Math.min(TAG_MINUTEN, Math.max(b.ende, b.anfang + MINDEST_MINUTEN));
  let gruppe: ZeitBlock<T>[] = [];
  let spaltenEnde: number[] = [];
  let gruppenEnde = -1;
  const abschliessen = () => {
    for (const b of gruppe) b.spalten = spaltenEnde.length;
    gruppe = [];
    spaltenEnde = [];
  };
  for (const b of bloecke) {
    if (b.anfang >= gruppenEnde) abschliessen();
    let spalte = spaltenEnde.findIndex((ende) => ende <= b.anfang);
    if (spalte === -1) spalte = spaltenEnde.length;
    spaltenEnde[spalte] = sichtbaresEnde(b);
    b.spalte = spalte;
    gruppe.push(b);
    gruppenEnde = Math.max(gruppenEnde, sichtbaresEnde(b));
  }
  abschliessen();
  return bloecke;
}

/**
 * Wohin das Stundenraster beim Oeffnen scrollt: auf den fruehesten Termin
 * der Woche, aber nie spaeter als 7 Uhr -- sonst fehlt morgens der Anfang
 * des Arbeitstags, und ein Termin um 5 Uhr soll trotzdem sichtbar sein.
 */
export function startStunde(fruehesteMinute: number | null, standard = 7): number {
  if (fruehesteMinute === null) return standard;
  return Math.max(0, Math.min(standard, Math.floor(fruehesteMinute / 60)));
}
