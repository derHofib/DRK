export function formatBetrag(cent: number): string {
  return (cent / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// Reines Stringschieben statt `new Date(isoDatum)` -- date-Spalten kommen aus
// der API bereits als "YYYY-MM-DD"-String (siehe database.service.ts,
// Fallstrick pg+Zeitzone). Ueber ein Date-Objekt zu gehen wuerde genau das
// Risiko wieder einfuehren, das der eigene Parser vermeiden soll.
export function formatDatum(isoDatum: string): string {
  const [jahr, monat, tag] = isoDatum.split("-");
  return `${tag}.${monat}.${jahr}`;
}

const WOCHENTAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** Lokales Kalenderdatum als "YYYY-MM-DD" (nicht toISOString: das waere UTC und verschoebe Abends den Tag). */
export function lokalesDatum(d: Date): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function formatUhrzeit(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/** Chatliste: heute die Uhrzeit, gestern "Gestern", sonst das Datum. */
export function formatChatZeit(iso: string): string {
  const d = new Date(iso);
  const heute = new Date();
  const gestern = new Date();
  gestern.setDate(heute.getDate() - 1);
  if (lokalesDatum(d) === lokalesDatum(heute)) return formatUhrzeit(iso);
  if (lokalesDatum(d) === lokalesDatum(gestern)) return "Gestern";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Tagestrenner im Verlauf. */
export function formatTagTrenner(iso: string): string {
  const d = new Date(iso);
  const heute = new Date();
  const gestern = new Date();
  gestern.setDate(heute.getDate() - 1);
  if (lokalesDatum(d) === lokalesDatum(heute)) return "Heute";
  if (lokalesDatum(d) === lokalesDatum(gestern)) return "Gestern";
  return `${WOCHENTAG_KURZ[d.getDay()]}, ${formatDatum(lokalesDatum(d))}`;
}

/** Datum eines Termin-Zeitpunkts in lokaler Zeit; ganztaegige Termine tragen schon ein reines Datum. */
export function terminTag(wert: string, ganztaegig: boolean): string {
  return ganztaegig ? wert : lokalesDatum(new Date(wert));
}

function wochentagVon(datum: string): string {
  const [j, m, t] = datum.split("-").map(Number);
  return WOCHENTAG_KURZ[new Date(j, m - 1, t).getDay()];
}

/** "Fr, 24.10.2026, 14:00–15:30 Uhr" bzw. "Fr, 24.10.2026, ganztägig" -- mehrtaegig mit beiden Enden. */
export function formatTerminZeit(t: { beginn: string; ende: string; ganztaegig: boolean }): string {
  const von = terminTag(t.beginn, t.ganztaegig);
  const bis = terminTag(t.ende, t.ganztaegig);
  const vonText = `${wochentagVon(von)}, ${formatDatum(von)}`;
  if (t.ganztaegig) {
    return von === bis ? `${vonText}, ganztägig` : `${vonText} – ${wochentagVon(bis)}, ${formatDatum(bis)}, ganztägig`;
  }
  const uhrVon = formatUhrzeit(t.beginn);
  const uhrBis = formatUhrzeit(t.ende);
  if (t.beginn === t.ende) return `${vonText}, ${uhrVon} Uhr`;
  if (von === bis) return `${vonText}, ${uhrVon}–${uhrBis} Uhr`;
  return `${vonText}, ${uhrVon} Uhr – ${wochentagVon(bis)}, ${formatDatum(bis)}, ${uhrBis} Uhr`;
}

/** Kurz fuer Listen: nur die Uhrzeit bzw. "Ganztägig". */
export function formatTerminUhrzeit(t: { beginn: string; ende: string; ganztaegig: boolean }): string {
  if (t.ganztaegig) return "Ganztägig";
  return t.beginn === t.ende ? formatUhrzeit(t.beginn) : `${formatUhrzeit(t.beginn)}–${formatUhrzeit(t.ende)}`;
}

export function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

export function formatKoordinate(wert: number): string {
  return wert.toLocaleString("de-DE", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
}

/** ISO-Kalenderwoche (Donnerstagsregel), lokal gerechnet. */
export function kalenderwoche(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const tag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - tag);
  const jahrStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - jahrStart) / 86400000 + 1) / 7);
}

/**
 * Kontextzeile ueber dem Seitentitel: "MO 26.10.2026 · KW 44 · FRUEHDIENST".
 */
export function kontextzeile(jetzt: Date = new Date(), dienst?: string): string {
  const tag = WOCHENTAG_KURZ[jetzt.getDay()];
  const teile = [
    `${tag} ${formatDatum(lokalesDatum(jetzt))}`,
    `KW ${kalenderwoche(jetzt)}`,
  ];
  if (dienst) teile.push(dienst);
  return teile.join(" \u00b7 ");
}
