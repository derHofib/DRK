import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { BenutzerListEintragDto } from "@zimmerakte/shared";
import { api } from "./api/client";

/**
 * Farbe je Mitarbeiter:in (Kalender, Mitarbeitende) -- Rueckmeldung aus dem
 * Betrieb: im Kalender soll man auf einen Blick sehen, wer wann weg ist,
 * mit Legende, und dieselbe Farbe auch bei den Mitarbeitenden.
 *
 * Abgeleitet, nicht gespeichert (CLAUDE.md, Regel 4): der Server liefert je
 * Konto farbIndex = Position in der Anlagereihenfolge des Traegers; daraus
 * folgt der Farbton ueber den goldenen Winkel (137,5°). So liegen die ersten
 * Personen maximal weit auseinander auf dem Farbkreis und jede weitere
 * faellt in die groesste Luecke -- ein reiner Hash der ID hatte im Test
 * schon bei vier Personen zwei fast gleiche Toene (319° und 322°).
 * Dieselbe Person ist dadurch auf jeder Seite, jedem Geraet und fuer alle
 * Betrachter:innen gleich gefaerbt.
 *
 * Wie bei der Akzentfarbe liefert JavaScript NUR den Farbton (--zv-person-h);
 * Helligkeit und Buntheit stehen je Theme fest im CSS (.zv-person-farbe in
 * app.css). Eine Personenfarbe kann den Kontrast so nie brechen -- sie
 * faerbt ohnehin nur Punkte und Streifen, nie Text. Ab etwa zehn Personen
 * werden sich Toene aehnlich; deshalb steht der Name immer daneben: die
 * Farbe ist Orientierung, nicht Kennung.
 */
const START = 25;
const GOLDENER_WINKEL = 137.508;

export function farbtonAusIndex(index: number): number {
  return Math.round((START + index * GOLDENER_WINKEL) % 360);
}

export function personFarbStil(farbIndex: number): CSSProperties {
  return { "--zv-person-h": farbtonAusIndex(farbIndex) } as CSSProperties;
}

/**
 * Benutzer-ID -> farbIndex fuer Seiten, die die Mitarbeitendenliste nicht
 * ohnehin laden (Kalender). Einmal je Seitenaufruf; schlaegt die Liste fehl,
 * bleiben die Termine eben neutral statt die Seite zu blockieren.
 */
export function useFarbIndizes(): Map<string, number> {
  return useMitarbeitendeMitFarbe().farbIndizes;
}

/** Wie useFarbIndizes, plus die Liste selbst (Kalender: Personenfilter und "Fuer wen"). */
export function useMitarbeitendeMitFarbe(): { liste: BenutzerListEintragDto[]; farbIndizes: Map<string, number> } {
  const [liste, setListe] = useState<BenutzerListEintragDto[]>([]);
  useEffect(() => {
    let abgebrochen = false;
    api
      .benutzerListe()
      .then((l) => !abgebrochen && setListe(l))
      .catch(() => {});
    return () => {
      abgebrochen = true;
    };
  }, []);
  const farbIndizes = useMemo(() => new Map(liste.map((b) => [b.id, b.farbIndex])), [liste]);
  return { liste, farbIndizes };
}
