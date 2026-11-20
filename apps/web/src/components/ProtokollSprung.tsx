import { createContext, useContext } from "react";

/** Welches Protokoll aus welchem Tagesbericht geoeffnet wird -- fuer den Ruecksprung. */
export interface ProtokollSprung {
  protokollId: string;
  klientId: string;
  berichtId: string;
  berichtDatum: string;
}

interface ProtokollSprungWege {
  /**
   * In der Klientenakte: das Protokoll im SELBEN Panel unter Dokumentation ›
   * Protokolle oeffnen (Konzept protokoll-ansicht, Variante A). Ein drittes,
   * schmales Fenster ueber der Akte war der Ausloeser der Rueckmeldung.
   */
  imSelbenPanel?: (s: ProtokollSprung) => void;
  /** Ausserhalb der Akte (Seite Dokumentation): aus dem breiten Fenster in die Akte springen. */
  inAkteOeffnen?: (s: ProtokollSprung) => void;
}

/**
 * Kontext statt durchgereichter Props: der Knopf sitzt tief in
 * TagesberichtZeile, die Akte und die Seite Dokumentation gleichermassen
 * benutzen. So entscheidet der Ort (Akte oder Shell), wie geoeffnet wird,
 * ohne dass jede Zwischenschicht davon wissen muss.
 */
export const ProtokollSprungKontext = createContext<ProtokollSprungWege>({});

export function useProtokollSprung(): ProtokollSprungWege {
  return useContext(ProtokollSprungKontext);
}
