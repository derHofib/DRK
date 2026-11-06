import type { TagesberichtDto } from "@zimmerakte/shared";
import { lokalesDatum } from "../format";

export type Schnellwahl = "alle" | "heute" | "woche" | "letzte7" | "monat" | "vormonat";

export const SCHNELLWAHL_LABEL: Record<Schnellwahl, string> = {
  alle: "Alle",
  heute: "Heute",
  woche: "Aktuelle Woche",
  letzte7: "Letzte 7 Tage",
  monat: "Dieser Monat",
  vormonat: "Letzter Monat",
};

export type Sortierung = "datum-neu" | "datum-alt" | "klient-az" | "klient-za";

export const SORTIERUNG_LABEL: Record<Sortierung, string> = {
  "datum-neu": "Datum: neueste zuerst",
  "datum-alt": "Datum: älteste zuerst",
  "klient-az": "Klient:in A–Z",
  "klient-za": "Klient:in Z–A",
};

/**
 * Zeitraum einer Schnellwahl als [von, bis] in lokalen Kalendertagen.
 * Die Woche beginnt am Montag (deutscher Kalender, passt zu kalenderwoche()
 * in format.ts). Rechnet bewusst mit lokalen Datumsteilen statt mit UTC,
 * sonst springt die "aktuelle Woche" abends um einen Tag.
 */
export function zeitraumFuer(wahl: Schnellwahl, jetzt: Date = new Date()): { von: string; bis: string } {
  const tag = (offset: number) => lokalesDatum(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + offset));
  switch (wahl) {
    case "alle":
      return { von: "", bis: "" };
    case "heute":
      return { von: tag(0), bis: tag(0) };
    case "letzte7":
      return { von: tag(-6), bis: tag(0) };
    case "woche": {
      const seitMontag = (jetzt.getDay() + 6) % 7;
      return { von: tag(-seitMontag), bis: tag(6 - seitMontag) };
    }
    case "monat":
      return {
        von: lokalesDatum(new Date(jetzt.getFullYear(), jetzt.getMonth(), 1)),
        bis: lokalesDatum(new Date(jetzt.getFullYear(), jetzt.getMonth() + 1, 0)),
      };
    case "vormonat":
      return {
        von: lokalesDatum(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1)),
        bis: lokalesDatum(new Date(jetzt.getFullYear(), jetzt.getMonth(), 0)),
      };
  }
}

/**
 * Sortiert stabil und ohne die Eingabe zu veraendern. Innerhalb einer
 * Klient:in steht immer die neueste Eintragung zuerst bzw. -- bei
 * "datum-alt" -- die aelteste, damit die Berichte einer Person als
 * zusammenhaengender Verlauf lesbar bleiben.
 */
export function sortiere(berichte: TagesberichtDto[], sortierung: Sortierung): TagesberichtDto[] {
  const nachDatum = (a: TagesberichtDto, b: TagesberichtDto, aufsteigend: boolean) =>
    aufsteigend ? a.datum.localeCompare(b.datum) : b.datum.localeCompare(a.datum);
  const nachKlient = (a: TagesberichtDto, b: TagesberichtDto) =>
    a.klientSortierName.localeCompare(b.klientSortierName, "de") || a.klientId.localeCompare(b.klientId);
  return [...berichte].sort((a, b) => {
    switch (sortierung) {
      case "datum-neu":
        return nachDatum(a, b, false);
      case "datum-alt":
        return nachDatum(a, b, true);
      case "klient-az":
        return nachKlient(a, b) || nachDatum(a, b, false);
      case "klient-za":
        return nachKlient(b, a) || nachDatum(a, b, false);
    }
  });
}

/** Aufeinanderfolgende Berichte derselben Klient:in zu Gruppen zusammenfassen (Eingabe muss nach Klient sortiert sein). */
export function gruppiereNachKlient(berichte: TagesberichtDto[]): { klientId: string; klientName: string; berichte: TagesberichtDto[] }[] {
  const gruppen: { klientId: string; klientName: string; berichte: TagesberichtDto[] }[] = [];
  for (const b of berichte) {
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.klientId === b.klientId) letzte.berichte.push(b);
    else gruppen.push({ klientId: b.klientId, klientName: b.klientName, berichte: [b] });
  }
  return gruppen;
}
