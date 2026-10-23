import type { TerminDto } from "@zimmerakte/shared";

/** RFC 5545 §3.3.11: Backslash zuerst, sonst wuerden die neu eingefuegten verdoppelt. */
export function icsText(wert: string): string {
  return wert
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: Zeilen sind auf 75 OKTETTE begrenzt (nicht Zeichen), die
 * Fortsetzungszeile beginnt mit einem Leerzeichen, das mitzaehlt. Umlaute
 * belegen zwei Oktette -- und ein Mehrbyte-Zeichen darf nicht zerschnitten
 * werden, sonst entsteht ungueltiges UTF-8.
 */
export function icsFalten(zeile: string): string[] {
  const teile: string[] = [];
  let aktuell = "";
  let laenge = 0;
  for (const zeichen of zeile) {
    const bytes = Buffer.byteLength(zeichen, "utf8");
    // Die erste Zeile darf 75 Oktette haben, jede Fortsetzung 74 (+ das fuehrende Leerzeichen).
    const grenze = teile.length === 0 ? 75 : 74;
    if (laenge + bytes > grenze) {
      teile.push(aktuell);
      aktuell = "";
      laenge = 0;
    }
    aktuell += zeichen;
    laenge += bytes;
  }
  teile.push(aktuell);
  return teile.map((t, i) => (i === 0 ? t : ` ${t}`));
}

function utcStempel(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function datumStempel(datum: string): string {
  return datum.replace(/-/g, "");
}

function einTagSpaeter(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Bewusst ohne Teilnehmerliste: die Datei wird verschickt/importiert und
 * verlaesst damit die Zugriffskontrolle der App; Namen von Klient:innen
 * gehoeren nicht hinein.
 */
export function terminAlsIcs(termin: TerminDto, jetzt: Date = new Date()): string {
  const zeilen: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hecaso//Kalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${termin.id}@hecaso`,
    `DTSTAMP:${utcStempel(jetzt.toISOString())}`,
  ];
  if (termin.ganztaegig) {
    // DTEND ist bei VALUE=DATE exklusiv; TerminDto.ende ist der letzte Tag.
    zeilen.push(`DTSTART;VALUE=DATE:${datumStempel(termin.beginn)}`);
    zeilen.push(`DTEND;VALUE=DATE:${datumStempel(einTagSpaeter(termin.ende))}`);
  } else {
    zeilen.push(`DTSTART:${utcStempel(termin.beginn)}`);
    zeilen.push(`DTEND:${utcStempel(termin.ende)}`);
  }
  zeilen.push(`SUMMARY:${icsText(termin.titel)}`);
  if (termin.beschreibung) zeilen.push(`DESCRIPTION:${icsText(termin.beschreibung)}`);
  if (termin.ort) zeilen.push(`LOCATION:${icsText(termin.ort)}`);
  zeilen.push(`STATUS:${termin.abgesagtAm ? "CANCELLED" : "CONFIRMED"}`);
  zeilen.push("END:VEVENT", "END:VCALENDAR");

  return zeilen.flatMap(icsFalten).join("\r\n") + "\r\n";
}
