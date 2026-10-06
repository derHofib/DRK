/**
 * Die Abbildung benutzer.rolle -> Systemvorlage (Organigramm-Plan,
 * "Mapping Rolle -> Systemvorlage"). Eine einzige Quelle fuer sowohl das
 * Migrationsskript (scripts/rollen-migration.ts) als auch den
 * Abgleichstest (test/rollen-migration-abgleich.e2e-spec.ts), damit beide
 * nie auseinanderlaufen koennen.
 *
 * bereichsleitung braucht keine eigene Rechte-Liste -- das deckt der
 * Geschaeftsfuehrung-Wildcard (account_typ.ist_vollzugriff) komplett ab,
 * auch die zwei heute bereichsleitung-exklusiven Sets
 * (ROLLEN_MIT_STANDORT_ANLEGEN, ROLLEN_MIT_BRANDING).
 *
 * Jede Zeile hier bildet GENAU eines der 14 heutigen ROLLEN_MIT_*-Sets ab
 * (Kommentar je Zeile nennt das abgeloeste Set) -- nicht mehr, nicht
 * weniger, damit der Abgleichstest 1:1 dagegen pruefen kann.
 */
export const SYSTEMTYP_NAME = {
  geschaeftsfuehrung: "Geschäftsführung",
  einrichtungsleitung: "Einrichtungsleitung",
  mitarbeiter: "Mitarbeiter",
} as const;

export interface RollenMappingEintrag {
  modul: string;
  aktion: string;
  scope: string;
}

/**
 * Zusaetzlich zu den Betreuer-Basisrechten (MITARBEITER_RECHTE), die
 * Einrichtungsleitung bekommt ALLES, was Betreuer auch hat (Account-Typen
 * ueberschreiben nicht, sie erweitern -- siehe die Vereinigung in
 * ensureAccountTypRechte() im Migrationsskript).
 */
export const EINRICHTUNGSLEITUNG_ZUSATZRECHTE: readonly RollenMappingEintrag[] = [
  { modul: "aufgaben", aktion: "koordinieren", scope: "einrichtung" }, // ROLLEN_MIT_AUFGABEN_KOORDINATION
  { modul: "kassenbuch", aktion: "storno-entscheiden", scope: "einrichtung" }, // ROLLEN_MIT_STORNO_ENTSCHEIDEN
  { modul: "kassenbuch", aktion: "typen-verwalten", scope: "einrichtung" }, // ROLLEN_MIT_KASSENBUCHUNG_TYP_VERWALTEN
  { modul: "standorte", aktion: "bearbeiten", scope: "einrichtung" }, // ROLLEN_MIT_STANDORT_BEARBEITEN
  { modul: "rechnungen", aktion: "status-wechseln", scope: "einrichtung" }, // ROLLEN_MIT_STATUSWECHSEL
  { modul: "anwaerter", aktion: "entscheiden", scope: "einrichtung" }, // ROLLEN_MIT_ENTSCHEIDUNG
  { modul: "klienten", aktion: "archivieren", scope: "einrichtung" }, // ROLLEN_MIT_ARCHIVIERUNG
  { modul: "zimmer", aktion: "voller-verlauf", scope: "einrichtung" }, // ROLLEN_MIT_VOLLEM_VERLAUF
  { modul: "zimmer", aktion: "bearbeiten", scope: "einrichtung" }, // ROLLEN_MIT_ZIMMER_STAMMDATEN
  { modul: "klienten", aktion: "anonymisieren", scope: "einrichtung" }, // ROLLEN_MIT_ANONYMISIERUNG
  { modul: "mitarbeitende", aktion: "anlegen", scope: "einrichtung" }, // ROLLEN_MIT_BENUTZER_ANLEGEN
  { modul: "mitarbeitende", aktion: "standort-zuweisen", scope: "einrichtung" }, // ROLLEN_MIT_STANDORT_ZUWEISEN
];

/**
 * Betreuer-Basisrechte: alles, was heute NICHT hinter einem
 * ROLLEN_MIT_*-Gate liegt -- normales Lesen/Anlegen/Bearbeiten im eigenen
 * Standort-Scope (Scope "einrichtung", weil Bereich/Team heute bei
 * Bestandsmandanten nicht befuellt sind und die heutige Sichtbarkeit
 * ohnehin schon auf ganze Standorte bezogen ist, nie auf eine Teileinheit
 * darunter -- siehe common/standort-restriction.ts). "own" nur dort, wo
 * das Fachmodul selbst heute schon zwischen eigenen/fremden Datensaetzen
 * unterscheidet (aufgabe.service.ts: eigene/zugewiesene Aufgaben).
 */
export const MITARBEITER_RECHTE: readonly RollenMappingEintrag[] = [
  { modul: "klienten", aktion: "ansehen", scope: "einrichtung" },
  { modul: "klienten", aktion: "lesen-akte", scope: "einrichtung" },
  { modul: "klienten", aktion: "anlegen", scope: "einrichtung" },
  { modul: "klienten", aktion: "bearbeiten", scope: "einrichtung" },
  { modul: "zimmer", aktion: "ansehen", scope: "einrichtung" },
  { modul: "zimmer", aktion: "belegen", scope: "einrichtung" },
  { modul: "kassenbuch", aktion: "ansehen", scope: "einrichtung" },
  { modul: "kassenbuch", aktion: "buchen", scope: "einrichtung" },
  { modul: "kostenuebernahmen", aktion: "ansehen", scope: "einrichtung" },
  { modul: "kostenuebernahmen", aktion: "anlegen", scope: "einrichtung" },
  { modul: "mitarbeitende", aktion: "ansehen", scope: "einrichtung" },
  { modul: "aufgaben", aktion: "ansehen", scope: "einrichtung" },
  { modul: "aufgaben", aktion: "bearbeiten", scope: "own" },
  { modul: "anwaerter", aktion: "ansehen", scope: "einrichtung" },
  { modul: "tagesberichte", aktion: "ansehen", scope: "einrichtung" },
  { modul: "tagesberichte", aktion: "anlegen", scope: "einrichtung" },
  { modul: "standorte", aktion: "ansehen", scope: "einrichtung" },
  { modul: "rechnungen", aktion: "ansehen", scope: "einrichtung" },
];

export const EINRICHTUNGSLEITUNG_RECHTE: readonly RollenMappingEintrag[] = [
  ...MITARBEITER_RECHTE,
  ...EINRICHTUNGSLEITUNG_ZUSATZRECHTE,
];
