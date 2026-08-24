/**
 * "Anonymisiert wird beim Lesen, nicht beim Speichern" (Bauplan Punkt 03).
 * Gespeichert wird immer der volle Name -- diese Funktion entscheidet nur,
 * was eine bestimmte Antwort tatsächlich ausliefert.
 */
export function initialen(vorname: string, nachname: string): string {
  return `${vorname.charAt(0)}. ${nachname.charAt(0)}.`;
}
