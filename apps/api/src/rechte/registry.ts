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
  { modul: "klienten", aktion: "anonymisieren" },
  { modul: "klienten", aktion: "zugang-verwalten", sensibel: true },

  { modul: "zimmer", aktion: "ansehen" },
  { modul: "zimmer", aktion: "bearbeiten" },
  { modul: "zimmer", aktion: "belegen" },
  // Heutiges ROLLEN_MIT_VOLLEM_VERLAUF (zimmer.service.ts) -- ohne dieses
  // Recht zeigt der Belegungsverlauf anonymisierte Initialen statt des
  // vollen Namens (siehe common/anonymisierung.ts, CLAUDE.md Regel 6).
  { modul: "zimmer", aktion: "voller-verlauf" },
  // Vier-Augen bei Kapazitaetsaenderungen (zimmer.service.ts,
  // kapazitaetEntscheiden()) -- eigenes, frei vergebbares Recht statt der
  // frueheren festen "Gegenrolle": wer bestaetigen darf, legt der Mandant
  // selbst ueber die Account-Typ-Rechte fest. Selbstbestaetigung bleibt
  // unabhaengig davon im Service ausgeschlossen.
  { modul: "zimmer", aktion: "kapazitaet-entscheiden" },

  { modul: "kassenbuch", aktion: "ansehen" },
  { modul: "kassenbuch", aktion: "buchen", sensibel: true },
  { modul: "kassenbuch", aktion: "freigeben", sensibel: true },
  // Heutiges ROLLEN_MIT_STORNO_ENTSCHEIDEN -- die Vier-Augen-Entscheidung
  // ueber einen Stornoantrag, nicht die Buchung selbst.
  { modul: "kassenbuch", aktion: "storno-entscheiden", sensibel: true },
  // Heutiges ROLLEN_MIT_KASSENBUCHUNG_TYP_VERWALTEN.
  { modul: "kassenbuch", aktion: "typen-verwalten" },

  { modul: "kostenuebernahmen", aktion: "ansehen" },
  { modul: "kostenuebernahmen", aktion: "anlegen" },
  { modul: "kostenuebernahmen", aktion: "genehmigen", sensibel: true },

  { modul: "mitarbeitende", aktion: "ansehen" },
  { modul: "mitarbeitende", aktion: "anlegen" },
  // Heutiges ROLLEN_MIT_STANDORT_ZUWEISEN (benutzer.service.ts).
  { modul: "mitarbeitende", aktion: "standort-zuweisen" },
  // Deaktivieren UND Reaktivieren (benutzer.aktiv) -- "Entfernen" loescht nie,
  // siehe migrations/0050_benutzer_deaktivieren.sql. Sensibel: sperrt eine
  // Person sofort aus.
  { modul: "mitarbeitende", aktion: "deaktivieren", sensibel: true },

  { modul: "aufgaben", aktion: "ansehen" },
  { modul: "aufgaben", aktion: "bearbeiten" },
  // Heutiges ROLLEN_MIT_AUFGABEN_KOORDINATION -- bearbeiten/loeschen/
  // erledigen FREMDER Aufgaben. Ersteller/Zugewiesene duerfen ihre eigene
  // Aufgabe weiterhin unabhaengig davon bearbeiten (bleibt eine separate
  // ODER-Bedingung im jeweiligen Service, nicht Teil der Rechte-Engine --
  // siehe Lieferreihenfolge Schritt 4).
  { modul: "aufgaben", aktion: "koordinieren" },

  { modul: "anwaerter", aktion: "ansehen" },
  { modul: "anwaerter", aktion: "entscheiden" },

  { modul: "tagesberichte", aktion: "ansehen" },
  { modul: "tagesberichte", aktion: "anlegen" },

  // Protokolle aus Formularen (migrations/0075). "ausfuellen" legt Entwuerfe an
  // und schliesst sie ab; das EIGENE abgeschlossene Protokoll darf die
  // Autor:in immer korrigieren (mit Grund, Historie per Trigger). Fremde
  // korrigieren ist sensibel: es veraendert die Dokumentation einer anderen
  // Person gegenueber dem Amt. "formulare-verwalten" uebernimmt Vorlagen und
  // legt Formulare still (Editor folgt in Schritt 2).
  { modul: "protokolle", aktion: "ansehen" },
  { modul: "protokolle", aktion: "ausfuellen" },
  { modul: "protokolle", aktion: "korrigieren-fremde", sensibel: true },
  { modul: "protokolle", aktion: "formulare-verwalten" },
  // PDF-Exporte (migrations/0082): ein externes PDF (Bericht an das Amt,
  // Brief an die Klient:in) verlaesst die Einrichtung -- eigenes Recht, damit
  // ein Traeger es auf Bezugsbetreuung und Leitung beschraenken kann.
  { modul: "protokolle", aktion: "pdf-extern" },

  // Verlauf der Klientenakte (migrations/0078): Notizen, Telefonate,
  // Gespraeche, Entscheidungen. Entscheidungen eintragen ist eigenes Recht --
  // eine Entscheidung bindet gegenueber Amt und Team. Fremde (oder eigene,
  // aelter als 24 Stunden) korrigieren ist sensibel wie bei Protokollen.
  { modul: "verlauf", aktion: "ansehen" },
  { modul: "verlauf", aktion: "anlegen" },
  { modul: "verlauf", aktion: "entscheidungen-anlegen" },
  { modul: "verlauf", aktion: "korrigieren-fremde", sensibel: true },

  // Stundenbuchung (migrations/0072). "buchen" gilt fuer die eigene Leistung;
  // fuer eine andere Person buchen darf nur, wer "fuer-andere-buchen" hat.
  // "stornieren" betrifft FREMDE Buchungen -- die eigene darf die buchende
  // Person immer stornieren. Sensibel: Stunden sind die Grundlage der
  // Abrechnung gegenueber dem Amt, ein Storno gehoert nicht in eine
  // stillschweigende Vertretung.
  { modul: "stunden", aktion: "ansehen" },
  { modul: "stunden", aktion: "buchen" },
  { modul: "stunden", aktion: "fuer-andere-buchen" },
  { modul: "stunden", aktion: "stornieren", sensibel: true },
  // Traeger-Schalter "Stunden aus dem Kalender" (migrations/0080): ob
  // Kalendertermine ueberhaupt als Betreuungszeit einfliessen duerfen.
  { modul: "stunden", aktion: "einstellungen-verwalten" },

  // Abwesenheiten im Kalender (migrations/0074). Eintragen und stornieren
  // darf jede:r fuer sich selbst ohne Recht. "art-sehen" zeigt den GRUND
  // fremder Abwesenheiten (krank ist ein Gesundheitsdatum), "verwalten"
  // erlaubt Eintragen und Stornieren fuer andere. Beides sensibel.
  { modul: "abwesenheiten", aktion: "art-sehen", sensibel: true },
  { modul: "abwesenheiten", aktion: "verwalten", sensibel: true },
  // Eigene Termintypen des Traegers (migrations/0085): anlegen, umbenennen,
  // Farbe, Reihenfolge, ausblenden. Nicht sensibel -- ein Typ ist eine
  // Auswahlliste, keine personenbezogene Information.
  { modul: "kalender", aktion: "typen-verwalten" },


  // Heutiges ROLLEN_MIT_STANDORT_ANLEGEN/-BEARBEITEN (standort.service.ts).
  { modul: "standorte", aktion: "ansehen" },
  { modul: "standorte", aktion: "anlegen" },
  { modul: "standorte", aktion: "bearbeiten" },
  // Vereinbarungen mit Kostentraegern inkl. Verguetungssaetzen (0081):
  // eigenes Recht, weil eine Einrichtungsleitung den Steckbrief pflegt,
  // aber nicht zwingend die Verguetung sehen soll.
  { modul: "standorte", aktion: "vereinbarungen" },

  // Heutiges ROLLEN_MIT_STATUSWECHSEL (rechnung.service.ts).
  { modul: "rechnungen", aktion: "ansehen" },
  { modul: "rechnungen", aktion: "status-wechseln" },

  // Heutiges ROLLEN_MIT_BRANDING (mandant.service.ts) -- bewusst eigenes
  // Modul statt "organigramm.bearbeiten": Trägerfarbe/Branding ist fachlich
  // unabhaengig von der Organisationsstruktur.
  { modul: "mandanten", aktion: "branding-bearbeiten" },
  // Loeschfrist fuer Chatinhalte (migrations/0061) -- eigenes Recht, weil
  // sie bestimmt, wann Sozialdaten unwiderruflich verschwinden.
  { modul: "mandanten", aktion: "datenschutz-bearbeiten" },

  { modul: "organigramm", aktion: "ansehen" },
  { modul: "organigramm", aktion: "bearbeiten" },
  { modul: "organigramm", aktion: "manage-permissions", nieDelegierbar: true },
  // Sichtbarkeit von Personendaten im Organigramm selbst ist ueber Rechte
  // steuerbar (DSGVO/Need-to-know, Organigramm-Plan) -- ohne dieses Recht
  // zeigt das Organigramm nur Titel/Status, keine Namen.
  { modul: "organigramm", aktion: "personendaten-sehen" },

  // Rueckmeldungen (Ideen/Fehler aus der App, migrations/0073): Melden darf
  // jede angemeldete Person und braucht deshalb kein Recht. Sichten und
  // Freigeben ist sensibel -- die Rueckmeldung kann Sozialdaten enthalten, und
  // die Freigabe entscheidet, ob der Hersteller sie lesen darf. Standard nur
  // ueber ist_vollzugriff (Geschaeftsfuehrung, Entwickler).
  { modul: "rueckmeldungen", aktion: "verwalten", sensibel: true },

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
