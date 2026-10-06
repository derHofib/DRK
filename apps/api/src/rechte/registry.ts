/**
 * Modul x Aktion ist eine Code-Registry, nicht die Datenbank -- "neue
 * Module erscheinen automatisch in der Matrix" (Organigramm-Plan) heisst:
 * diese Liste hier erweitern, dann rendert die kuenftige
 * Account-Typ-Verwaltung die neue Zeile automatisch, ohne dass irgendeine
 * account_typ_recht-Zeile nachgepflegt werden muesste (eine fehlende Zeile
 * ist einfach ein impliziter Deny).
 *
 * Scopes (siehe Organigramm-Plan): "own" | "team" | "wohngruppe" |
 * "subtree" | "einrichtung" | "bereich" | "tenant" | "assigned". Diese
 * Liste hier macht keine Aussage, WELCHE Scopes fuer eine Aktion sinnvoll
 * sind -- das entscheidet die Account-Typ-/Positions-Konfiguration pro
 * Mandant.
 */
export interface RechtRegistryEintrag {
  modul: string;
  aktion: string;
  /**
   * Sensible Rechte sind eigene Aktionen, nicht in "bearbeiten" versteckt
   * (Organigramm-Plan): Klientenakte lesen, Kassenbuch buchen/freigeben,
   * Kostenuebernahme genehmigen. Bei einer Vertretung ist eine sensible
   * Aktion per Default ausgeschlossen (delegation.sensible_rechte_eingeschlossen).
   */
  sensibel?: boolean;
  /** manage-permissions ist strukturell nie delegierbar, unabhaengig vom Umfang. */
  nieDelegierbar?: boolean;
}

export const RECHTE_REGISTRY: readonly RechtRegistryEintrag[] = [
  { modul: "klienten", aktion: "ansehen" },
  { modul: "klienten", aktion: "lesen-akte", sensibel: true },
  { modul: "klienten", aktion: "anlegen" },
  { modul: "klienten", aktion: "bearbeiten" },
  { modul: "klienten", aktion: "archivieren" },

  { modul: "zimmer", aktion: "ansehen" },
  { modul: "zimmer", aktion: "bearbeiten" },
  { modul: "zimmer", aktion: "belegen" },

  { modul: "kassenbuch", aktion: "ansehen" },
  { modul: "kassenbuch", aktion: "buchen", sensibel: true },
  { modul: "kassenbuch", aktion: "freigeben", sensibel: true },

  { modul: "kostenuebernahmen", aktion: "ansehen" },
  { modul: "kostenuebernahmen", aktion: "anlegen" },
  { modul: "kostenuebernahmen", aktion: "genehmigen", sensibel: true },

  { modul: "mitarbeitende", aktion: "ansehen" },
  { modul: "mitarbeitende", aktion: "anlegen" },

  { modul: "aufgaben", aktion: "ansehen" },
  { modul: "aufgaben", aktion: "bearbeiten" },

  { modul: "anwaerter", aktion: "ansehen" },
  { modul: "anwaerter", aktion: "entscheiden" },

  { modul: "tagesberichte", aktion: "ansehen" },
  { modul: "tagesberichte", aktion: "anlegen" },

  { modul: "organigramm", aktion: "ansehen" },
  { modul: "organigramm", aktion: "bearbeiten" },
  { modul: "organigramm", aktion: "manage-permissions", nieDelegierbar: true },
  // Sichtbarkeit von Personendaten im Organigramm selbst ist ueber Rechte
  // steuerbar (DSGVO/Need-to-know, Organigramm-Plan) -- ohne dieses Recht
  // zeigt das Organigramm nur Titel/Status, keine Namen.
  { modul: "organigramm", aktion: "personendaten-sehen" },

  // Chat steuert bewusst nur den Kanalzugriff, nie Nachrichteninhalte --
  // es gibt deshalb hier absichtlich KEINE Aktion "nachrichten-lesen".
  // Damit fehlt dafuer strukturell jeder Pfad, auch fuer
  // ist_vollzugriff-Konten -- nicht nur per Konvention.
  { modul: "chat", aktion: "kanal-zugriff" },
] as const;

function findeEintrag(modul: string, aktion: string): RechtRegistryEintrag | undefined {
  return RECHTE_REGISTRY.find((e) => e.modul === modul && e.aktion === aktion);
}

export function istGueltigesRecht(modul: string, aktion: string): boolean {
  return findeEintrag(modul, aktion) !== undefined;
}

export function istSensibel(modul: string, aktion: string): boolean {
  return findeEintrag(modul, aktion)?.sensibel === true;
}

/** Unbekannte (modul,aktion)-Paare gelten als nicht delegierbar -- sicherer Default. */
export function istDelegierbar(modul: string, aktion: string): boolean {
  const eintrag = findeEintrag(modul, aktion);
  return eintrag !== undefined && !eintrag.nieDelegierbar;
}
