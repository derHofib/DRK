/**
 * Typen, die API und Web-App gemeinsam brauchen. Wächst mit jeder Phase --
 * hier steht nur, was in der jeweiligen Migration auch tatsächlich existiert.
 */

export type HzlRhythmus = "monatlich" | "woechentlich";
export type Zimmerstatus = "vergeben" | "teilweise" | "zugeordnet";

export interface LoginRequest {
  mandantSlug: string;
  email: string;
  passwort: string;
}

export type LoginResponse = { accessToken: string } | { totpErforderlich: true; pendingToken: string };

export interface TotpEinrichtenResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface MandantDto {
  id: string;
  name: string;
  slug: string;
  /** Akzentfarbe des Trägers als sRGB-Hex, z. B. "#5ec4c0". */
  akzentfarbe: string;
  /**
   * Grundfarbe (Hintergrund/Flächen) im dunklen Design als sRGB-Hex, z. B.
   * "#10131a". Unabhängig von akzentfarbe -- siehe migrations/0029.
   */
  dunkelGrundfarbe: string;
  /** Nach so vielen Tagen werden Chatinhalte endgültig gelöscht (migrations/0061). */
  chatLoeschfristTage: number;
  /**
   * Nach so vielen Tagen ab Archivierung werden Klient:innen automatisch
   * anonymisiert (migrations/0070). null = keine automatische Löschung.
   */
  klientLoeschfristTage: number | null;
  /**
   * Dürfen freigegebene Rückmeldungen an den Hersteller weitergegeben werden
   * (migrations/0073)? Standard false.
   */
  rueckmeldungWeitergabe: boolean;
  /** Duerfen Kalendertermine als Betreuungszeit gebucht werden (migrations/0080)? */
  terminStundenErlaubt: boolean;
  /** Voreinstellung des Hakens fuer Konten, die selbst nichts gewaehlt haben. */
  terminStundenVorauswahl: boolean;
}

export type RueckmeldungArt = "idee" | "fehler";
export type RueckmeldungPrioritaet = "niedrig" | "mittel" | "hoch" | "blockierend";
export type RueckmeldungStatus = "neu" | "freigegeben" | "rueckfrage" | "abgelehnt" | "duplikat" | "in_arbeit" | "umgesetzt";

/** Was die Geschäftsführung setzen darf; in_arbeit/umgesetzt gehören dem Hersteller-Zugang. */
export const RUECKMELDUNG_ENTSCHEIDUNGEN = ["neu", "freigegeben", "rueckfrage", "abgelehnt", "duplikat"] as const;
export type RueckmeldungEntscheidung = (typeof RUECKMELDUNG_ENTSCHEIDUNGEN)[number];

export const RUECKMELDUNG_STATUS_LABEL: Record<RueckmeldungStatus, string> = {
  neu: "Eingegangen",
  freigegeben: "Freigegeben",
  rueckfrage: "Rückfrage",
  abgelehnt: "Abgelehnt",
  duplikat: "Duplikat",
  in_arbeit: "In Umsetzung",
  umgesetzt: "Umgesetzt",
};

/** Rahmenbedingungen, die das Frontend automatisch mitschickt (Whitelist, siehe rueckmeldung.service.ts). */
export interface RueckmeldungKontext {
  seite?: string;
  appVersion?: string;
  browser?: string;
  betriebssystem?: string;
  viewport?: string;
  theme?: string;
  rolle?: string;
  zeitpunkt?: string;
}

export interface RueckmeldungListeDto {
  id: string;
  art: RueckmeldungArt;
  titel: string;
  prioritaet: RueckmeldungPrioritaet;
  status: RueckmeldungStatus;
  erstelltAm: string;
  erstelltVonName: string;
  hatBild: boolean;
}

export interface RueckmeldungDetailDto extends RueckmeldungListeDto {
  beschreibung: string;
  erwartet: string | null;
  kontext: RueckmeldungKontext;
  freigegebenAm: string | null;
  freigegebenVonName: string | null;
  entscheidungsnotiz: string | null;
  bearbeitungsnotiz: string | null;
  prUrl: string | null;
}

/** Eigene Meldungen der angemeldeten Person: Status ja, Bild und Kontext nein. */
export interface RueckmeldungMeineDto {
  id: string;
  art: RueckmeldungArt;
  titel: string;
  status: RueckmeldungStatus;
  erstelltAm: string;
  entscheidungsnotiz: string | null;
}

/**
 * Welche Träger-Bereiche der Einstellungen die angemeldete Person sieht
 * (GET /mandant/me/einstellungen-rechte). Nur Oberfläche: verbindlich prüft
 * jeder Speicherpfad im Service selbst.
 */
export interface EinstellungenRechteDto {
  /** Trägerfarbe, dunkle Grundfarbe -- mandanten.branding-bearbeiten. */
  erscheinungsbild: boolean;
  /** standorte.anlegen oder standorte.bearbeiten. */
  standorte: boolean;
  /** Buchungstypen -- kassenbuch.typen-verwalten. */
  kassenbuch: boolean;
  /** Löschfristen und Rückmeldungs-Weitergabe -- mandanten.datenschutz-bearbeiten. */
  datenschutz: boolean;
  /** Formulare für Protokolle -- protokolle.formulare-verwalten. */
  formulare: boolean;
  /** Stunden aus dem Kalender -- stunden.einstellungen-verwalten. */
  stunden: boolean;
}

export interface RueckmeldungBerechtigungDto {
  verwalten: boolean;
  anzahlNeu: number;
}

/** Grenzen der Klienten-Löschfrist -- dieselben wie der CHECK in Migration 0070. */
export const KLIENT_LOESCHFRIST_MIN_TAGE = 30;
export const KLIENT_LOESCHFRIST_MAX_TAGE = 7300;

/**
 * Grenzen der Chat-Löschfrist -- dieselben wie der CHECK in Migration 0061.
 * Untergrenze 7 statt 1, weil ein Tippfehler sonst fast den ganzen Verlauf
 * unwiderruflich löschen würde.
 */
export const CHAT_LOESCHFRIST_MIN_TAGE = 7;
export const CHAT_LOESCHFRIST_MAX_TAGE = 3650;

/**
 * Eine Regel, drei Prüforte: der CHECK in Migration 0019, das zod-Schema im
 * Controller und die Eingabeprüfung im Einstellungsformular. Hier steht sie
 * für die beiden letzteren -- die Datenbank hat ihre eigene Kopie, weil sie
 * auch dann gelten muss, wenn ein künftiger Codepfad an zod vorbeigeht.
 *
 * Bewusst case-insensitiv: der Browser liefert je nach Plattform "#5EC4C0"
 * oder "#5ec4c0". Kleingeschrieben wird serverseitig, nicht abgelehnt.
 */
export const AKZENTFARBE_MUSTER = /^#[0-9a-fA-F]{6}$/;

/** Tannengrün, die hecaso-Markenfarbe -- seit Migration 0063 (vorher DRK
 * Rot, 0021). Begründung dort. */
export const AKZENTFARBE_STANDARD = "#2d6a4f";

/**
 * Standardwert der neuen Spalte dunkel_grundfarbe (Migration 0029). Siehe
 * dort für die Begründung der Wahl: seine Helligkeit trifft fast exakt den
 * bisherigen fest verdrahteten Dunkelmodus-Hintergrund.
 */
export const DUNKEL_GRUNDFARBE_STANDARD = "#10131a";

export interface DunkelGrundfarbe {
  id: string;
  name: string;
  hex: string;
}

/**
 * Kuratierte Auswahl für den Grundfarben-Wähler -- kleiner als
 * PASTELL_PALETTEN, weil hier keine Markenidentität gesucht wird, sondern
 * ein ruhiger Grundton für Hintergrund und Flächen. Bewusst kein Rot, aus
 * demselben Grund wie bei PASTELL_PALETTEN: Kollision mit
 * --zv-status-danger und mit "DRK Rot" als Standardakzent.
 */
export const DUNKEL_GRUNDFARBEN: readonly DunkelGrundfarbe[] = [
  { id: "schiefer", name: "Schiefer", hex: "#10131a" },
  { id: "anthrazit", name: "Anthrazit", hex: "#16151a" },
  { id: "waldnacht", name: "Waldnacht", hex: "#0d1913" },
  { id: "amethyst", name: "Amethyst", hex: "#16121f" },
  { id: "kohle", name: "Kohle", hex: "#141414" },
] as const;

export interface PastellPalette {
  id: string;
  name: string;
  hex: string;
}

/**
 * Kuratierte Auswahl. Gespeichert wird jeweils der Pastellton selbst, damit
 * das Farbfeld im Wähler auch pastellig aussieht -- übernommen werden davon
 * nur Farbton und Buntheit, die Helligkeit gehört dem CSS (siehe
 * apps/web/src/theme/farbe.ts).
 *
 * "Tannengrün" steht an erster Stelle und ist der Standardwert neuer
 * Mandanten (siehe migrations/0063 und AKZENTFARBE_STANDARD oben): der
 * Akzent ist nur noch Handlungsfarbe und soll nicht neben der festen
 * Aufmerksamkeitsfarbe Koralle liegen. "DRK Rot" bleibt als Hausfarbe des
 * Trägers wählbar. Die übrigen Paletten bleiben bewusst nicht-rot: für Träger, die sich für eine
 * andere Farbe entscheiden, kollidierte ein zufälliges Rot visuell mit
 * --zv-status-danger (Storno, Ablehnung, negative Beträge). Über den freien
 * Farbwähler bleibt jede Farbe möglich; die Statusfarben sind davon
 * unberührt, weil sie feste Farbtöne haben und dem Akzent nicht folgen.
 */
export const PASTELL_PALETTEN: readonly PastellPalette[] = [
  { id: "tannengruen", name: "Tannengrün", hex: "#2d6a4f" },
  { id: "drk-rot", name: "DRK Rot", hex: "#e3000f" },
  { id: "salbei", name: "Salbei", hex: "#79c7a8" },
  { id: "petrol", name: "Petrol", hex: "#5ec4c0" },
  { id: "himmel", name: "Himmel", hex: "#7fbef0" },
  { id: "lavendel", name: "Lavendel", hex: "#a8a4f0" },
  { id: "flieder", name: "Flieder", hex: "#d89ce0" },
  { id: "rose", name: "Rosé", hex: "#f2a0b5" },
  { id: "apricot", name: "Apricot", hex: "#f5b183" },
  { id: "honig", name: "Honig", hex: "#efce72" },
  // Läuft in den achromatischen Pfad von akzentAbleiten() und ergibt damit
  // ein bewusst entfärbtes, sehr sachliches System -- für Träger, deren
  // Hausfarbe Graphit ist.
  { id: "graphit", name: "Graphit", hex: "#8e96a3" },
] as const;

export interface BenutzerListEintragDto {
  id: string;
  email: string;
  name: string;
  // Ersetzt die frühere feste "rolle" -- Rechte hängen seit der
  // Entwickler-Accounttyp-Umstellung ausschließlich an Organigramm-
  // Positionen. Leer = (noch) keine Position zugewiesen, also keine Rechte.
  positionen: { positionId: string; titel: string; accountTypName: string }[];
  aktiv: boolean;
  /**
   * 0-basierte Position in der Anlagereihenfolge aller Konten des Traegers
   * (serverseitig abgeleitet). Daraus folgt die Personenfarbe im Kalender
   * und in der Mitarbeitendenliste, siehe apps/web/src/personFarbe.ts.
   */
  farbIndex: number;
  // Leer = keine Standort-Einschraenkung (siehe common/standort-restriction.ts).
  standortIds: string[];
  // Einrichtungen, an denen die Person laut Rang arbeitet (Positionen und
  // Standorte ihrer Besetzung) -- nicht zu verwechseln mit standortIds, der
  // Sichtbarkeitsbeschraenkung.
  einheitIds: string[];
}

export interface StandortDto {
  id: string;
  name: string;
  /** Abgeleitet aus strasse, plz und ort (Migration 0079), nicht direkt aenderbar. */
  adresse: string;
  aktiv: boolean;
  angebotsform: StandortAngebotsform | null;
}

// --- Standort-Steckbrief (Migration 0079, Konzept standort-daten) ----------

/** Feste Auswahl (von Dennis bestaetigt): neue Werte kommen per Migration. */
export type StandortAngebotsform =
  | "besondere_wohnform"
  | "ambulant_wg"
  | "einzelwohnen"
  | "jugendhilfe_34"
  | "hilfe_67"
  | "sonstiges";

export const STANDORT_ANGEBOTSFORM_LABEL: Record<StandortAngebotsform, string> = {
  besondere_wohnform: "Besondere Wohnform",
  ambulant_wg: "Ambulant betreute Wohngemeinschaft",
  einzelwohnen: "Ambulant betreutes Einzelwohnen",
  jugendhilfe_34: "Jugendhilfe",
  hilfe_67: "Hilfe in besonderen Lebenslagen",
  sonstiges: "Sonstiges",
};

/** Rechtsgrundlage zur Angebotsform; "Sonstiges" hat keine. */
export const STANDORT_ANGEBOTSFORM_RECHTSGRUNDLAGE: Record<StandortAngebotsform, string | null> = {
  besondere_wohnform: "SGB IX",
  ambulant_wg: "SGB IX",
  einzelwohnen: "SGB IX",
  jugendhilfe_34: "§ 34 SGB VIII",
  hilfe_67: "§ 67 SGB XII",
  sonstiges: null,
};

export type StandortBetreuungsumfang = "rund_um_die_uhr" | "tagsueber" | "stundenweise";
export const STANDORT_BETREUUNGSUMFANG_LABEL: Record<StandortBetreuungsumfang, string> = {
  rund_um_die_uhr: "rund um die Uhr",
  tagsueber: "tagsüber mit Rufbereitschaft",
  stundenweise: "stundenweise (ambulant)",
};

export type StandortBarrierefreiheit = "barrierefrei" | "teilweise" | "nicht";
export const STANDORT_BARRIEREFREIHEIT_LABEL: Record<StandortBarrierefreiheit, string> = {
  barrierefrei: "barrierefrei",
  teilweise: "teilweise barrierefrei",
  nicht: "nicht barrierefrei",
};

/**
 * Die pflegbaren Angaben. Kostenstelle und IK-Nummer FEHLEN im JSON (nicht
 * null), wenn das Konto standorte.bearbeiten nicht hat -- durchgesetzt im
 * Service, nicht in der Oberflaeche.
 */
export interface StandortAngabenDto {
  name: string;
  angebotsform: StandortAngebotsform | null;
  zielgruppe: string | null;
  betreuungsumfang: StandortBetreuungsumfang | null;
  inBetriebSeit: string | null;
  strasse: string;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  fax: string | null;
  email: string | null;
  buerozeiten: string | null;
  bereitschaftTelefon: string | null;
  bereitschaftHinweis: string | null;
  barrierefreiheit: StandortBarrierefreiheit | null;
  barrierefreiheitHinweis: string | null;
  oepnv: string | null;
  zugang: string | null;
  kostenstelle?: string | null;
  ikNummer?: string | null;
  hinweise: string | null;
}

/** Fuer PATCH /standorte/:id: jedes Feld optional, "" bzw. null leert es. */
export type StandortAenderungDto = Partial<Omit<StandortAngabenDto, "strasse" | "name">> & {
  name?: string;
  strasse?: string;
  aktiv?: boolean;
};

export interface StandortLeitungDto {
  benutzerId: string;
  name: string;
  /** Titel der Position im Organigramm, z. B. "Einrichtungsleitung". */
  positionTitel: string;
}

/**
 * Eine Person im Abschnitt "Leitung & Team" des Steckbriefs (Rueckmeldung
 * "Standorte Mitarbeiter", Konzept standort-team). Alles abgeleitet aus
 * Organigramm, Profil, Abwesenheiten und Belegung -- nichts davon wird
 * fuer den Steckbrief eigens eingetragen.
 */
export interface StandortTeamPersonDto {
  benutzerId: string;
  name: string;
  /** Wie BenutzerListEintragDto.farbIndex: dieselbe Personenfarbe wie im Kalender. */
  farbIndex: number;
  /** Titel der heutigen Position, bevorzugt die an diesem Standort; null = keine Position. */
  positionTitel: string | null;
  istLeitung: boolean;
  /**
   * Heute laufende Abwesenheit, null = nicht abwesend. art ist null, wenn
   * die betrachtende Person den Grund nicht sehen darf (nur die Person
   * selbst und abwesenheiten.art-sehen, wie im Kalender).
   */
  abwesenheit: { bis: string; art: AbwesenheitArt | null } | null;
  /** Klient:innen mit laufender Belegung an DIESEM Standort, deren Bezugsbetreuung die Person ist. */
  bezugKlienten: number;
  /** Aus dem eigenen Profil (Mitarbeitende sehen Profile untereinander ohnehin, Migration 0058). */
  telefon: string | null;
  erreichbarkeit: string | null;
  bevorzugteKontaktart: KontaktArt | null;
  /** Andere aktive Standorte der Person, nur solche, die die betrachtende Person sehen darf. */
  weitereStandorte: { id: string; name: string }[];
}

export interface StandortTeamDto {
  /** Alle Personen (Leitung und Team); entspricht personen.length. */
  anzahl: number;
  /** Leitung zuerst (in Organigramm-Reihenfolge), dann alphabetisch. */
  personen: StandortTeamPersonDto[];
  /** Titel von Leitungspositionen am Standort ohne heutige Besetzung. */
  unbesetzteLeitung: string[];
}

/** Was fehlt, damit der Steckbrief im Alltag traegt (Konzept 4.1). */
export type StandortFehlendeAngabe = "angebotsform" | "telefon" | "bereitschaft" | "anschrift";
export const STANDORT_FEHLENDE_ANGABE_LABEL: Record<StandortFehlendeAngabe, string> = {
  angebotsform: "Angebotsform",
  telefon: "Telefon",
  bereitschaft: "Bereitschaftsnummer",
  anschrift: "PLZ und Ort",
};

/** Eine Zeile der Standortliste unter Organisatorisch, alles Abgeleitete schon gerechnet. */
export interface StandortListenEintragDto extends StandortDto {
  telefon: string | null;
  plaetzeEingerichtet: number;
  plaetzeBelegt: number;
  leitung: StandortLeitungDto[];
  fehlendeAngaben: StandortFehlendeAngabe[];
}

export interface StandortSteckbriefDto {
  id: string;
  aktiv: boolean;
  adresse: string;
  angaben: StandortAngabenDto;
  /** true = Konto hat standorte.bearbeiten (und der Standort ist erlaubt). */
  darfBearbeiten: boolean;
  /** Org-Einheit (Einrichtungsknoten) fuer den Sprung ins Organigramm. */
  orgUnitId: string | null;
  plaetze: { eingerichtet: number; belegt: number; frei: number; zimmer: number };
  leitung: StandortLeitungDto[];
  team: StandortTeamDto;
  fehlendeAngaben: StandortFehlendeAngabe[];
  /** Kontakte vor Ort -- fuer alle, die den Standort sehen (Phase 2). */
  kontakte: StandortKontaktDto[];
  /**
   * Genehmigte Plaetze: die kleinste Zahl unter den heute gueltigen
   * Vereinbarungen (die engste Grenze bindet). Fuer alle sichtbar -- die
   * Zahl allein verraet keine Verguetung. null = keine Vereinbarung mit Plaetzen.
   */
  genehmigtePlaetze: number | null;
  /** true = Konto hat standorte.vereinbarungen. */
  darfVereinbarungen: boolean;
  /** Nur mit standorte.vereinbarungen; ohne das Recht fehlt das Feld ganz. */
  vereinbarungen?: StandortVereinbarungDto[];
}

export type StandortKontaktRolle =
  | "vermieter"
  | "hausmeister"
  | "notdienst"
  | "krisendienst"
  | "hausarzt"
  | "apotheke"
  | "polizei"
  | "sonstiges";
/** Reihenfolge = Anzeigereihenfolge im Steckbrief. */
export const STANDORT_KONTAKT_ROLLE_LABEL: Record<StandortKontaktRolle, string> = {
  notdienst: "Notdienst",
  krisendienst: "Krisendienst",
  polizei: "Polizei",
  vermieter: "Vermieter / Hausverwaltung",
  hausmeister: "Hausmeister",
  hausarzt: "Hausarztpraxis",
  apotheke: "Apotheke",
  sonstiges: "Sonstiges",
};
/** Rollen, die in der mobilen Ansicht unter "Im Notfall" stehen. */
export const STANDORT_KONTAKT_NOTFALL_ROLLEN: readonly StandortKontaktRolle[] = ["notdienst", "krisendienst", "polizei"];

export interface StandortKontaktDto {
  id: string;
  rolle: StandortKontaktRolle;
  name: string;
  telefon: string | null;
  email: string | null;
  hinweis: string | null;
}

export interface StandortKontaktEingabe {
  rolle: StandortKontaktRolle;
  name: string;
  telefon?: string | null;
  email?: string | null;
  hinweis?: string | null;
}

export type StandortVereinbarungArt = "leistungsvereinbarung" | "verguetungsvereinbarung" | "betriebserlaubnis" | "sonstige";
export const STANDORT_VEREINBARUNG_ART_LABEL: Record<StandortVereinbarungArt, string> = {
  leistungsvereinbarung: "Leistungsvereinbarung",
  verguetungsvereinbarung: "Vergütungsvereinbarung",
  betriebserlaubnis: "Betriebserlaubnis / Heimaufsicht",
  sonstige: "Sonstige Vereinbarung",
};

/** Abgeleitet aus Laufzeit, Storno und Folgevereinbarung -- nie gespeichert. */
export type StandortVereinbarungStatus = "kuenftig" | "gueltig" | "endet_bald" | "verlaengert" | "abgelaufen" | "storniert";
export const STANDORT_VEREINBARUNG_STATUS_LABEL: Record<StandortVereinbarungStatus, string> = {
  kuenftig: "Künftig",
  gueltig: "Gültig",
  endet_bald: "Endet bald",
  verlaengert: "Verlängert",
  abgelaufen: "Abgelaufen",
  storniert: "Storniert",
};

export interface StandortVereinbarungDto {
  id: string;
  art: StandortVereinbarungArt;
  partner: string;
  kennung: string | null;
  gueltigVon: string;
  gueltigBis: string | null;
  plaetze: number | null;
  verguetungTagCent: number | null;
  bemerkung: string | null;
  erstelltAm: string;
  erstelltVonName: string | null;
  storniertAm: string | null;
  stornoGrund: string | null;
  status: StandortVereinbarungStatus;
  /** Tage bis zum Ende, nur bei status "endet_bald". */
  endetInTagen: number | null;
}

export interface StandortVereinbarungEingabe {
  art: StandortVereinbarungArt;
  partner: string;
  kennung?: string | null;
  gueltigVon: string;
  gueltigBis?: string | null;
  plaetze?: number | null;
  verguetungTagCent?: number | null;
  bemerkung?: string | null;
}

/** Nur diese drei Felder sind nachtraeglich korrigierbar (Migration 0081). */
export interface StandortVereinbarungAenderung {
  gueltigBis?: string | null;
  kennung?: string | null;
  bemerkung?: string | null;
}

export interface StandortUebersichtDto {
  standort: StandortDto;
  zimmer: {
    anzahl: number;
    plaetzeGesamt: number;
    plaetzeBelegt: number;
    plaetzeFrei: number;
    liste: {
      id: string;
      nummer: string;
      etage: string;
      kapazitaet: number;
      bewohner: { klientId: string; name: string }[];
    }[];
  };
  klienten: {
    id: string;
    name: string;
    aktenzeichen: string | null;
    amt: string | null;
    zimmerNummer: string;
    einzug: string;
    hzlWoechentlich: boolean;
  }[];
  kassenbuch: {
    hausSaldoCent: number;
    klientenSaldoCent: number;
    hzl: { bezahlt: number; gesamt: number; isoJahr: number; isoWoche: number };
    offeneStornoantraege: number;
    letzteBuchungen: {
      id: string;
      datum: string;
      betragCent: number;
      verwendungszweck: string;
      typBezeichnung: string;
      klientName: string | null;
    }[];
  };
}

export interface RaumplanPositionDto {
  x: number;
  y: number;
}

export interface RaumplanEtageDto {
  etage: string;
  hatGrundriss: boolean;
  zimmer: {
    id: string;
    nummer: string;
    kapazitaet: number;
    bewohner: { klientId: string; name: string; einzug: string; auszug: string | null }[];
    geplanteEinzuege: { klientId: string; name: string; einzug: string }[];
    warteliste: { name: string; eingetragenAm: string }[];
    offeneAufgaben: { id: string; titel: string; prioritaet: "niedrig" | "normal" | "hoch"; faelligAm: string | null }[];
    kapazitaetsantrag: { alteKapazitaet: number; neueKapazitaet: number; beantragtVonName: string | null } | null;
    position: RaumplanPositionDto | null;
  }[];
  raeume: { id: string; name: string; position: RaumplanPositionDto | null }[];
}

export interface RaumplanDto {
  standort: { id: string; name: string };
  darfBearbeiten: boolean;
  etagen: RaumplanEtageDto[];
}

export interface ZimmerBewohnerDto {
  id: string;
  name: string;
  einzug: string;
  // Gesetzt, wenn der Auszug schon geplant, aber noch nicht eingetreten ist
  // (sonst waere die Person gar kein aktueller Bewohner mehr, siehe
  // zimmer.service.ts: ladeBewohner()). Zeigt sich in der Oberflaeche als
  // "Auszug geplant am ..."-Hinweis.
  auszug: string | null;
  belegungId: string;
}

/**
 * Ein Kapazitaetsantrag wirkt NIE sofort (anders als Nummer/Etage) --
 * siehe zimmer.service.ts, kapazitaetAendern()/kapazitaetEntscheiden().
 * Vier-Augen: die entscheidende Person braucht das eigene Recht
 * zimmer.kapazitaet-entscheiden und darf nie die eigene Anfrage bestätigen
 * (beantragtVonId dient clientseitig nur fürs Erkennen der eigenen Anfrage).
 */
export interface OffenerKapazitaetsantragDto {
  id: string;
  alteKapazitaet: number;
  neueKapazitaet: number;
  beantragtVonName: string;
  beantragtVonId: string;
  beantragtAm: string;
}

/**
 * Warteliste je Zimmer (siehe migrations/0038_zimmer_warteliste.sql):
 * bewusst ohne Datum, nur Reihenfolge nach eingetragenAm -- druckt eine
 * Absicht/Reihenfolge aus ("sobald ein Platz frei wird"), kein festes
 * Versprechen. Das feste Datum entsteht erst beim tatsaechlichen Einzug.
 */
export interface ZimmerWartelisteEintragDto {
  id: string;
  klientId: string;
  klientName: string;
  eingetragenAm: string;
  eingetragenVonName: string | null;
}

export interface ZimmerListEintragDto {
  id: string;
  nummer: string;
  etage: string;
  standortId: string;
  standortName: string;
  /** Eigene Wohnanschrift (Einzelwohnen, Migration 0079); null = Anschrift des Standorts. */
  anschrift: string | null;
  kapazitaet: number;
  status: Zimmerstatus;
  bewohner: ZimmerBewohnerDto[];
  warteliste: ZimmerWartelisteEintragDto[];
  offenerKapazitaetsantrag: OffenerKapazitaetsantragDto | null;
}

export interface BelegungsverlaufEintragDto {
  id: string;
  klientId: string | null;
  name: string;
  einzug: string;
  auszug: string | null;
  istAktuell: boolean;
  // Einzug liegt noch in der Zukunft -- noch nicht begonnen, fuer die
  // "Geplant"-Kennzeichnung in der Oberflaeche.
  geplant: boolean;
}

export interface KlientListEintragDto {
  id: string;
  vorname: string;
  nachname: string;
  aktenzeichen: string;
  amt: string;
  hzlRhythmus: HzlRhythmus;
  aktuellesZimmer:
    | { id: string; nummer: string; standortName: string; belegungId: string; einzug: string; auszug: string | null }
    | null;
  anonymisiertAm: string | null;
  // Siehe migrations/0036_klient_archivierung.sql -- ein archivierter Klient
  // ist eingefroren (keine neuen Tagesberichte/Buchungen/... mehr moeglich,
  // siehe klientIstArchiviert()) und aus der Standardliste ausgeblendet,
  // aber reversibel (anders als anonymisiertAm).
  archiviertAm: string | null;
}

export interface KlientDetailDto extends KlientListEintragDto {
  geburtsdatum: string | null;
  aufnahmeAm: string | null;
  entlassenAm: string | null;
  stammdaten: KlientStammdatenDto | null;
  kontakte: KlientKontaktDto[];
  archiviertVonName: string | null;
  // Ein Eintrag pro Archivierungsvorgang (append-only, siehe
  // klient_archiv_pdf) -- auch nach dem Entarchivieren bleiben fruehere
  // Snapshots herunterladbar.
  archivPdfs: { id: string; erstelltAm: string; erstelltVonName: string | null }[];
  // Zimmer, fuer die dieser Klient auf der Warteliste steht (siehe
  // migrations/0038_zimmer_warteliste.sql) -- rein informativ, Hinzufuegen/
  // Entfernen laufen ueber die Zimmer-Route (ZimmerListEintragDto.warteliste).
  wartelisten: { eintragId: string; zimmerId: string; zimmerNummer: string; standortName: string; eingetragenAm: string }[];
}

/**
 * Erweitertes Klientenprofil aus dem Aufnahme-Datenblatt, 1:1 zu Klient
 * (siehe migrations/0034_klient_stammdaten.sql). "Zuständiges Jugendamt
 * (Name)" ist bewusst NICHT hier -- das ist KlientDetailDto.amt.
 * Aufnahme-/Entlassungsdatum ebenfalls bewusst nicht hier -- die werden aus
 * der Zimmer-Belegung abgeleitet (siehe KlientDetailDto.aufnahmeAm/-entlassenAm).
 */
export interface KlientStammdatenDto {
  geburtsort: string | null;
  nationalitaet: string | null;
  sorgeberechtigt: string | null;
  bezugsbetreuerId: string | null;
  bezugsbetreuerName: string | null;
  betreuungsstunden: string | null;
  telefon: string | null;
  sprachen: string | null;
  anmerkungen: string | null;
  personaldokumente: string | null;
  bankkonto: string | null;
  iban: string | null;
  jugendamtAdresse: string | null;
  jugendamtSachbearbeiter: string | null;
  jugendamtStellenzeichen: string | null;
  jugendamtTelefon: string | null;
  jugendamtEmail: string | null;
  wjhName: string | null;
  wjhTelefon: string | null;
  wjhEmail: string | null;
  personensorgeberechtigte: string | null;
  besuchskontakte: string | null;
  krankenkasse: string | null;
  versichertennummer: string | null;
  medikamente: string | null;
  diagnosen: string | null;
  allergien: string | null;
  besonderheitenGesundheitlich: string | null;
  besonderheitenPsychisch: string | null;
  schule: string | null;
  klassenstufe: string | null;
  schulabschluesse: string | null;
  foerderbedarfe: string | null;
  vorherigeEinrichtungTraeger: string | null;
  vorherigeEinrichtungKontakt: string | null;
  vorherigeEinrichtungAnfrageAm: string | null;
  vorherigeEinrichtungEinzugAm: string | null;
  vorherigeEinrichtungAuszugAm: string | null;
  aktualisiertAm: string;
}

export interface KlientKontaktDto {
  id: string;
  beziehung: string | null;
  name: string;
  adresse: string | null;
  email: string | null;
  telefon: string | null;
}

export const ZIMMERSTATUS_LABEL: Record<Zimmerstatus, string> = {
  vergeben: "Vergeben",
  teilweise: "Teilweise belegt",
  zugeordnet: "Zugeordnet",
};

export const HZL_RHYTHMUS_LABEL: Record<HzlRhythmus, string> = {
  monatlich: "Monatlich",
  woechentlich: "Wöchentlich",
};

/**
 * Frei durch die Leitung verwaltbar (siehe migrations/0035_kassenbuchung_typ.sql)
 * -- kein fester ENUM mehr. "kommentarPflicht" steuert zugleich, ob das
 * Feld an einer Buchung "Verwendungszweck" (Pflicht) oder "Kommentar"
 * (optional) heisst. "istHzl" markiert den einen Systemtyp je Mandant, an
 * dem die Wochenuebersicht und die Sperre gegen doppelte Auszahlung
 * haengen -- weder umbenennbar noch deaktivierbar.
 */
export interface KassenbuchungTypDto {
  id: string;
  bezeichnung: string;
  kommentarPflicht: boolean;
  istHzl: boolean;
  aktiv: boolean;
}

export interface KassenbuchungTeilnehmerDto {
  klientId: string | null;
  benutzerId: string | null;
  name: string;
}

export interface OffenerStornoantragDto {
  id: string;
  grund: string;
  beantragtVonName: string;
  beantragtAm: string;
}

/**
 * Genau eins von klientId/standortId ist gesetzt (siehe migrations/0030):
 * die meisten Buchungen gehören einem Klienten, eine Standort-Buchung
 * (Spaßgeld/Freizeitveranstaltung) gehört dem ganzen Haus. HZL ist
 * ausschließlich klientenbezogen.
 */
export interface KassenbuchungDto {
  id: string;
  /** Laufende Belegnummer je Mandant (Anzeige: KB-00042). */
  belegnummer: number;
  klientId: string | null;
  klientName: string | null;
  standortId: string | null;
  standortName: string | null;
  datum: string;
  betragCent: number;
  verwendungszweck: string;
  typId: string;
  typBezeichnung: string;
  istHzl: boolean;
  isoJahr: number | null;
  isoWoche: number | null;
  storniert: boolean;
  stornoGrund: string | null;
  hatUnterschrift: boolean;
  gebuchtVonName: string | null;
  teilnehmer: KassenbuchungTeilnehmerDto[];
  offenerStornoantrag: OffenerStornoantragDto | null;
}

export interface WochenuebersichtEintragDto {
  klientId: string;
  klientName: string;
  /** Einzeln, damit die Uebergabeansicht "Vorname + Initial" zeigen kann, ohne den Namen zu raten. */
  vorname: string;
  nachname: string;
  bezahlt: boolean;
  buchungId: string | null;
  betragCent: number | null;
  datum: string | null;
  /** Zuletzt ausgezahlter HZL-Betrag (positiv, ohne stornierte) -- Vorschlag fuer die naechste Auszahlung. */
  letzterHzlBetragCent: number | null;
  /** Saldo aller nicht stornierten Buchungen dieser Klient:in (Barbetrag). */
  saldoCent: number;
}

export interface KostenuebernahmeDto {
  id: string;
  klientId: string;
  amt: string;
  von: string;
  bis: string | null;
}

export interface HilfeplanVerlaufDto {
  id: string;
  fortschritt: number;
  notiz: string | null;
  erstelltAm: string;
  erstelltVonName: string | null;
  tagesbericht: { id: string; datum: string } | null;
}

export interface HilfeplanZielDto {
  id: string;
  hilfeplanId: string;
  titel: string;
  beschreibung: string | null;
  faelligAm: string | null;
  verworfen: boolean;
  /** Abgeleitet aus dem juengsten Verlaufseintrag (0 ohne Eintrag). */
  fortschritt: number;
  erreicht: boolean;
  ueberfaellig: boolean;
  /** Neueste zuerst. */
  verlauf: HilfeplanVerlaufDto[];
}

export interface HilfeplanDto {
  id: string;
  klientId: string;
  von: string;
  bis: string | null;
  naechstesGespraech: string | null;
  bemerkung: string | null;
  ziele: HilfeplanZielDto[];
}

export type RechnungStatus = "beantragt" | "genehmigt" | "ausgezahlt" | "abgelehnt";

export interface RechnungDto {
  id: string;
  klientId: string;
  klientName: string;
  betragCent: number;
  beschreibung: string;
  erstelltAm: string;
  status: RechnungStatus;
  statusGrund: string | null;
  hatDokument: boolean;
}

export interface RechnungDetailDto extends RechnungDto {
  statusVerlauf: { status: RechnungStatus; grund: string | null; geaendertAm: string }[];
}

export const RECHNUNG_STATUS_LABEL: Record<RechnungStatus, string> = {
  beantragt: "Beantragt",
  genehmigt: "Genehmigt",
  ausgezahlt: "Ausgezahlt",
  abgelehnt: "Abgelehnt",
};

export interface TagDto {
  id: string;
  name: string;
}

export interface TagesberichtDokumentDto {
  id: string;
  dateiname: string;
  mimeType: string;
  erstelltAm: string;
}

/**
 * Eine Antwort, dieselben Daten fuer jede Rolle -- welche Kacheln davon
 * angezeigt werden, entscheidet ausschliesslich das Frontend
 * (apps/web/src/dashboard/sichtbarkeit.ts).
 */
export interface DashboardDto {
  zimmer: { frei: number; gesamt: number; standorte: number };
  hzlWoche: { bezahlt: number; gesamt: number; isoJahr: number; isoWoche: number };
  offeneRechnungen: { anzahl: number; summeCent: number };
  offeneStornoantraege: { anzahl: number };
  mitarbeitende: { aktiv: number; gesamt: number; ausstehendeResets: number };
  kostenuebernahmenBaldEndend: {
    klientId: string;
    klientName: string;
    amt: string;
    bis: string;
    tageVerbleibend: number;
    /** Erinnerungsstufe: 30, 60 oder 90 Tage (kleinste Schwelle, die noch >= Restzeit ist). */
    stufeTage: 30 | 60 | 90;
  }[];
  klientenOhneTagesbericht: {
    klientId: string;
    klientName: string;
    standortName: string;
    zimmerNummer: string;
    tageSeitLetztem: number | null;
  }[];
  unzugewieseneZimmeraufgaben: {
    id: string;
    titel: string;
    standortName: string;
    zimmerNummer: string;
    prioritaet: AufgabePrioritaet;
    faelligAm: string | null;
  }[];
  freieZimmer: {
    zimmerId: string;
    nummer: string;
    etage: string | null;
    standortName: string;
    freiePlaetze: number;
  }[];
  meineOffenenAufgaben: {
    id: string;
    titel: string;
    standortName: string | null;
    zimmerNummer: string | null;
    prioritaet: AufgabePrioritaet;
    faelligAm: string | null;
  }[];
}

export interface TagesberichtDto {
  id: string;
  klientId: string;
  klientName: string;
  /** "Nachname, Vorname" -- Sortierschluessel fuer die Uebersicht. */
  klientSortierName: string;
  autorName: string | null;
  datum: string;
  text: string;
  tags: TagDto[];
  dokumente: TagesberichtDokumentDto[];
  anzahlAenderungen: number;
  bearbeitbar: boolean;
  /**
   * Mit dem Tagesbericht abgeschlossene, angeheftete Formulare. Die
   * Kurzfassung ("Schlaf: unruhig · Vorfall: Nein") wird beim Lesen aus den
   * Datenpunkten abgeleitet, nie gespeichert (CLAUDE.md Regel 4) -- sie
   * steht in der Liste dort, wo sonst der Freitext steht.
   */
  protokolle: { id: string; formularName: string; kurzfassung: string }[];
}

export interface TagesberichtAenderungDto {
  id: string;
  art: "bearbeitet" | "tag_hinzugefuegt" | "tag_entfernt" | "dokument_hinzugefuegt";
  geaendertAm: string;
  geaendertVonName: string | null;
  textAlt: string | null;
  textNeu: string | null;
  datumAlt: string | null;
  datumNeu: string | null;
  tagName: string | null;
  dokumentName: string | null;
}

export type AufgabePrioritaet = "niedrig" | "normal" | "hoch";

export const AUFGABE_PRIORITAET_LABEL: Record<AufgabePrioritaet, string> = {
  niedrig: "Niedrig",
  normal: "Normal",
  hoch: "Hoch",
};

/**
 * Ein einheitliches Modell fuer Zimmer-Aufgaben (zimmerId gesetzt) und
 * persoenliche Aufgaben (zimmerId null) -- siehe migrations/0033_aufgabe.sql.
 * zugewiesenAn ist davon unabhaengig nullable, alle vier Kombinationen sind
 * gueltig.
 */
export interface AufgabeDto {
  id: string;
  titel: string;
  beschreibung: string | null;
  prioritaet: AufgabePrioritaet;
  faelligAm: string | null;
  zimmerId: string | null;
  zimmerNummer: string | null;
  standortName: string | null;
  zugewiesenAn: string | null;
  zugewiesenAnName: string | null;
  erstelltVon: string;
  erstelltVonName: string;
  erledigtAm: string | null;
  erledigtVonName: string | null;
  erstelltAm: string;
}

export interface AufgabenAnzahlDto {
  /** offene Zimmer-Aufgaben je zimmerId, fuer die Badge in der Zimmeruebersicht. */
  jeZimmer: Record<string, number>;
  /** offene Aufgaben (Zimmer- oder persoenlich), die dem eigenen Benutzer zugewiesen sind. */
  eigene: number;
}

/**
 * Anwärter: eine abgespeckte Vorstufe des Klienten für Anfragen, bevor ein
 * Aktenzeichen existiert (siehe migrations/0039_anwaerter.sql). "Angenommen"
 * legt einen echten Klienten an (klientId zeigt darauf), "abgelehnt"
 * braucht einen Grund und bleibt zur Nachvollziehbarkeit erhalten.
 */
export type AnwaerterStatus = "offen" | "angenommen" | "abgelehnt";

export const ANWAERTER_STATUS_LABEL: Record<AnwaerterStatus, string> = {
  offen: "Offen",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
};

export interface AnwaerterDto {
  id: string;
  vorname: string;
  nachname: string;
  geburtsdatum: string | null;
  telefon: string | null;
  email: string | null;
  anfragendeStelle: string | null;
  notiz: string | null;
  status: AnwaerterStatus;
  ablehnungGrund: string | null;
  klientId: string | null;
  erstelltAm: string;
  erstelltVonName: string | null;
  entschiedenAm: string | null;
  entschiedenVonName: string | null;
}

/**
 * Organigramm-Modul (migrations/0040-0042): Organisationseinheiten,
 * Positionen und Account-Typen als einzige Quelle fuer Rechte. Gespiegelt
 * aus organigramm.service.ts -- siehe dort fuer die Herleitung jedes
 * Felds (z. B. "ebene" bewusst nicht gespeichert, siehe OrgUnitDto.typ).
 */
export type OrgUnitTyp = "traeger" | "einrichtung" | "bereich" | "team";
export type PositionTyp = "linie" | "stabsstelle";
export type AccountTypKategorie = "intern" | "extern";

export const ORG_UNIT_TYP_LABEL: Record<OrgUnitTyp, string> = {
  traeger: "Träger",
  einrichtung: "Einrichtung",
  bereich: "Bereich",
  team: "Team",
};

export const POSITION_TYP_LABEL: Record<PositionTyp, string> = {
  linie: "Linie",
  stabsstelle: "Stabsstelle",
};

export interface OrgUnitDto {
  id: string;
  parentId: string | null;
  typ: OrgUnitTyp;
  standortId: string | null;
  name: string;
  aktiv: boolean;
}

/**
 * Je Position eine Zeile pro aktuell aktiver Besetzung (Mehrfachbesetzung
 * moeglich, siehe org_position_besetzung). Ohne das Recht
 * "organigramm.personendaten-sehen" liefert der Server hier statt des
 * Namens ueberall null -- die Zeilenanzahl (also "besetzt mit wie vielen
 * Personen") bleibt sichtbar, nur die Identitaet nicht.
 */
export interface BesetzungDto {
  besetzungId: string;
  benutzerId: string | null;
  benutzerName: string | null;
  gueltigAb: string;
  /**
   * Standorte dieser einen Besetzung (Migration 0066). Leer = die Person
   * arbeitet an der Einheit der Position selbst. Keine Personendaten.
   */
  orgUnitIds: string[];
}

export interface PositionDto {
  id: string;
  orgUnitId: string;
  /** Zusätzliche Organisationseinheiten einer Linienposition (z.B. eine Einrichtungsleitung mit zwei Einrichtungen). */
  weitereOrgUnitIds: string[];
  parentPositionId: string | null;
  titel: string;
  typ: PositionTyp;
  accountTypId: string;
  istGeplant: boolean;
  aktiv: boolean;
  /** null = keine feste Sollzahl (Sammelrang, Migration 0067). */
  sollBesetzung: number | null;
  gueltigAb: string;
  gueltigBis: string | null;
  besetztMit: BesetzungDto[];
}

export interface AccountTypRechtDto {
  modul: string;
  aktion: string;
  scope: string;
  erlaubt: boolean;
}

/**
 * istVollzugriff=true heisst Wildcard (Geschaeftsfuehrung) -- rechte ist
 * dann immer leer, die Matrix zeigt dafuer "alles erlaubt, nicht
 * reduzierbar" als reinen Anzeigezustand (siehe Organigramm-Plan).
 */
export interface AccountTypDto {
  id: string;
  name: string;
  kategorie: AccountTypKategorie;
  istSystem: boolean;
  istVollzugriff: boolean;
  rechte: AccountTypRechtDto[];
}

/**
 * Gespiegelt aus apps/api/src/rechte/registry.ts (GET /rechte/registry) --
 * die Modul×Aktion-Registry ist Code, nicht die Datenbank. Grundlage fuer
 * die Rechte-Matrix in der Account-Typ-Verwaltung: eine Zeile ohne
 * zugehoerige account_typ_recht-Zeile ist einfach ein impliziter Deny.
 */
export interface RechtRegistryEintragDto {
  modul: string;
  aktion: string;
  sensibel?: boolean;
  nieDelegierbar?: boolean;
}

/**
 * Herkunft einer simulierten Rechte-Zelle ("Anzeigen als…", Organigramm-Plan
 * Schritt 7/UI, fünfter Teilschritt) -- erklärt, WOHER ein erlaubt/nicht
 * erlaubt kommt, nicht nur DASS es so ist: "vollzugriff" (Wildcard-
 * Kurzschluss), "account-typ-default" (aus account_typ_recht),
 * "override" (org_position_recht_override ersetzt den Default),
 * "delegation" (kommt ausschließlich über eine aktive Vertretung herein,
 * nie aus einer eigenen Position) und "kein-eintrag" (impliziter Deny,
 * weder Default noch Override vorhanden).
 */
export type RechtHerkunft = "vollzugriff" | "account-typ-default" | "override" | "delegation" | "kein-eintrag";

export const RECHT_HERKUNFT_LABEL: Record<RechtHerkunft, string> = {
  vollzugriff: "Vollzugriff",
  "account-typ-default": "Account-Typ",
  override: "Override",
  delegation: "Vertretung",
  "kein-eintrag": "Kein Zugriff",
};

export interface SimulationZelleDto {
  modul: string;
  aktion: string;
  erlaubt: boolean;
  herkunft: RechtHerkunft;
  scope?: string;
}

/** Antwort von GET /rechte/simulation -- genau eines von benutzerId/positionId war die Anfrage. */
export interface SimulationDto {
  ziel: { typ: "benutzer" | "position"; id: string };
  zellen: SimulationZelleDto[];
}

/**
 * Vertretung (migrations/0043-0046, delegation.service.ts). status speichert
 * nur beantragt/genehmigt/widerrufen -- effektiverStatus rechnet
 * aktiv/abgelaufen serverseitig aus status + von/bis vs. heute dazu
 * (CLAUDE.md Regel 4: Zustaende werden abgeleitet, nicht gespeichert). Das UI
 * zeigt deshalb ausschliesslich effektiverStatus, nie status direkt.
 */
export type DelegationStatus = "beantragt" | "genehmigt" | "widerrufen";
export type DelegationEffektiverStatus = "beantragt" | "genehmigt" | "aktiv" | "abgelaufen" | "widerrufen";

export const DELEGATION_EFFEKTIVER_STATUS_LABEL: Record<DelegationEffektiverStatus, string> = {
  beantragt: "Beantragt",
  genehmigt: "Genehmigt (wartet auf Beginn)",
  aktiv: "Aktiv",
  abgelaufen: "Abgelaufen",
  widerrufen: "Widerrufen",
};

/**
 * Gespiegelt aus DelegationDto in delegation.service.ts. vertretenerBenutzerId
 * ist immer die Person, deren Rechte verliehen werden (= wer den Antrag
 * gestellt hat, siehe anlegen() dort) -- vertreterBenutzerId ist, wer die
 * Rechte zeitweise ausueben darf.
 */
export interface DelegationDto {
  id: string;
  vertretenerBenutzerId: string;
  vertretenerName: string;
  vertreterBenutzerId: string;
  vertreterName: string;
  von: string;
  bis: string;
  umfang: "alle" | "auswahl";
  sensibleRechteEingeschlossen: boolean;
  status: DelegationStatus;
  effektiverStatus: DelegationEffektiverStatus;
}

/**
 * Kalender (migrations/0053, kalender.service.ts). Termine gehoeren ihren
 * Beteiligten, nicht dem Mandanten. Abgesagt ist, wer abgesagtAm hat -- es
 * gibt keinen Status und kein Loeschen.
 */
export type TerminAntwort = "offen" | "zugesagt" | "abgelehnt";

export const TERMIN_ANTWORT_LABEL: Record<TerminAntwort, string> = {
  offen: "Offen",
  zugesagt: "Zugesagt",
  abgelehnt: "Abgelehnt",
};

/**
 * Terminart (migrations/0074): feste Liste, steuert Filter und Statusfarbe
 * im Kalender. "klient" = Termin mit oder fuer Klient:innen.
 */
export type TerminArt = "termin" | "besprechung" | "klient";

export const TERMIN_ART_LABEL: Record<TerminArt, string> = {
  termin: "Termin",
  besprechung: "Besprechung",
  klient: "Klient:innentermin",
};

export interface TerminPersonDto {
  art: "benutzer" | "klient";
  id: string;
  /** Klient:innen: Mitarbeitende je nach Sichtbarkeit voll oder als Initialen, andere Klient:innen nur Vorname. */
  name: string;
}

export interface TerminTeilnehmerDto extends TerminPersonDto {
  antwort: TerminAntwort;
  geantwortetAm: string | null;
}

/**
 * ganztaegig=true: beginn/ende sind reine Datumsangaben "YYYY-MM-DD", ende ist
 * der letzte Tag (inklusive). Sonst ISO-8601-Zeitpunkte (UTC, "...Z").
 */
export interface TerminDto {
  id: string;
  titel: string;
  beschreibung: string | null;
  ort: string | null;
  beginn: string;
  ende: string;
  ganztaegig: boolean;
  art: TerminArt;
  erstelltVon: TerminPersonDto;
  erstelltAm: string;
  abgesagtAm: string | null;
  binErsteller: boolean;
  /** null = ich bin nicht eingetragen (z. B. nur ueber einen Chat sichtbar) -- dann hilft "uebernehmen". */
  meineAntwort: TerminAntwort | null;
  teilnehmer: TerminTeilnehmerDto[];
  /** Leistungsart fuer Kalenderbuchungen; null = automatisch (siehe terminStundenLeistungsart). */
  stundenLeistungsart: Leistungsart | null;
  /** Nur fuer die eigene Teilnahme als Mitarbeiter:in; null fuer Klient:innen und Nicht-Eingetragene. */
  stunden: TerminStundenDto | null;
}

/** Stunden aus dem Kalender (migrations/0080), aus Sicht der angemeldeten Person. */
export interface TerminStundenDto {
  /** Eigener Haken "Als Betreuungszeit erfassen". */
  vorgemerkt: boolean;
  /** Warum der Termin so nicht buchbar ist (ganztaegig, keine Klient:in, ...); null = buchbar. */
  hindernis: string | null;
  /** Dauer, die gebucht wird bzw. wurde. */
  minuten: number | null;
  /** Eigene Buchungen aus diesem Termin, auch stornierte (neueste zuerst). */
  buchungen: TerminStundenBuchungDto[];
}

export interface TerminStundenBuchungDto {
  id: string;
  klientName: string;
  datum: string;
  minuten: number;
  leistungsart: Leistungsart;
  erstelltAm: string;
  storniert: boolean;
  stornoGrund: string | null;
  stornoAutomatisch: boolean;
}

export type TerminTeilnehmerEingabe = { benutzerId: string } | { klientId: string };

export interface TerminAnlegenEingabe {
  titel: string;
  beschreibung?: string | null;
  ort?: string | null;
  beginn: string;
  ende: string;
  ganztaegig?: boolean;
  art?: TerminArt;
  teilnehmer?: TerminTeilnehmerEingabe[];
  /** Eigene Vormerkung "Als Betreuungszeit erfassen" (migrations/0080). */
  stundenErfassen?: boolean;
  stundenLeistungsart?: Leistungsart | null;
}

/**
 * Abwesenheiten (migrations/0074): alle Mitarbeitenden sehen, DASS und WANN
 * jemand fehlt; den Grund nur die Person selbst und wer
 * abwesenheiten.art-sehen hat. Fuer alle anderen ist art = null ("abwesend").
 */
export type AbwesenheitArt = "urlaub" | "krank" | "frei" | "fortbildung";

export const ABWESENHEIT_ART_LABEL: Record<AbwesenheitArt, string> = {
  urlaub: "Urlaub",
  krank: "krank",
  frei: "frei / Überstunden",
  fortbildung: "Fortbildung",
};

export interface AbwesenheitDto {
  id: string;
  benutzer: { id: string; name: string };
  /** null = Grund fuer die anfragende Person nicht sichtbar. */
  art: AbwesenheitArt | null;
  /** Erster und letzter Tag, beide inklusive ("YYYY-MM-DD"). */
  von: string;
  bis: string;
  notiz: string | null;
  stornierbar: boolean;
}

export interface AbwesenheitAnlegenEingabe {
  /** Fehlt = fuer mich selbst. */
  benutzerId?: string;
  art: AbwesenheitArt;
  von: string;
  bis: string;
  notiz?: string | null;
}

export interface AbwesenheitRechteDto {
  /** Grund fremder Abwesenheiten sehen. */
  artSehen: boolean;
  /** Fuer andere eintragen und fremde stornieren. */
  verwalten: boolean;
}

// --- Klient-Zugang: E-Mail aendern (Chat-Plan 1b) ---

export interface KlientZugangDto {
  status: "keiner" | "eingeladen" | "aktiv" | "deaktiviert";
  email: string | null;
  einladungLaeuftAbAm: string | null;
  einladungAbgelaufen: boolean;
  /** Ablauf eines offenen Links zum Aendern der E-Mail, sonst null. */
  emailAenderungOffenBis: string | null;
}

export interface KlientEmailAenderungLinkDto {
  link: string;
  laeuftAbAm: string;
}

export interface KlientEmailAendernPruefungDto {
  emailMaskiert: string;
}

// --- Chat (migrations/0055, apps/api/src/chat) ---

export type ChatArt = "direkt" | "gruppe";
export type ChatNachrichtArt = "text" | "bild" | "termin" | "standort" | "system";

export interface ChatPersonDto {
  art: "benutzer" | "klient";
  id: string;
  /** Klient:innen: Mitarbeitende je nach Sichtbarkeit voll oder als Initialen, andere Klient:innen nur Vorname. */
  name: string;
}

export interface ChatTeilnehmerDto extends ChatPersonDto {
  /** ID der Teilnahme (fuer DELETE /chat/:id/teilnehmer/:teilnehmerId), nicht der Person. */
  teilnehmerId: string;
  istAdmin: boolean;
  beigetretenAm: string;
}

export interface ChatVorschauDto {
  nachrichtId: string;
  art: ChatNachrichtArt;
  /** Kurztext; bei Bild/Standort/Termin ein Platzhalter, bei geloeschten Nachrichten "Nachricht gelöscht". */
  vorschau: string;
  absender: ChatPersonDto | null;
  eigene: boolean;
  geloescht: boolean;
  erstelltAm: string;
}

export interface ChatDto {
  id: string;
  art: ChatArt;
  /** Gruppenname; null bei Direktchats. */
  name: string | null;
  /** Direktchat: Name des Gegenuebers; Gruppe: name. */
  anzeigename: string;
  erstelltAm: string;
  binAdmin: boolean;
  /** Nachrichten anderer nach dem eigenen Lesestand (ohne geloeschte). */
  ungelesen: number;
  /** Aktive Teilnehmende inkl. der eigenen Person. */
  teilnehmer: ChatTeilnehmerDto[];
  letzteNachricht: ChatVorschauDto | null;
  letzteAktivitaetAm: string;
}

export interface ChatKontaktDto extends ChatPersonDto {
  /** Bestehender Direktchat mit dieser Person, falls vorhanden. */
  direktChatId: string | null;
}

/**
 * Waehlbare Teilnehmende im Termin-Dialog der Mitarbeitenden. Klient:innen
 * stehen hier auch OHNE Zugang (anders als bei den Chat-Kontakten): Sie sehen
 * die Einladung dann nicht selbst, der Termin zaehlt aber als Termin mit ihnen.
 */
export interface TerminKontaktDto extends ChatKontaktDto {
  /** Mitarbeitende immer true; Klient:innen nur mit aktivem Zugang. */
  hatZugang: boolean;
}

export interface ChatTerminKurzDto {
  id: string;
  titel: string;
  ort: string | null;
  /** Format wie TerminDto: bei ganztaegig reine Datumsangaben, sonst ISO-Zeitpunkte. */
  beginn: string;
  ende: string;
  ganztaegig: boolean;
  abgesagtAm: string | null;
  meineAntwort: TerminAntwort | null;
  /** true = ich bin eingetragen und habe zugesagt; false = Button "In meinen Kalender uebernehmen" anbieten. */
  uebernommen: boolean;
}

export interface ChatStandortDto {
  lat: number;
  lng: number;
  genauigkeitM: number | null;
  bezeichnung: string | null;
}

export interface ChatAnhangDto {
  id: string;
  dateiname: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  groesse: number;
}

export interface ChatNachrichtDto {
  id: string;
  chatId: string;
  art: ChatNachrichtArt;
  erstelltAm: string;
  absender: ChatPersonDto | null;
  eigene: boolean;
  geloescht: boolean;
  /** Text bzw. Bildunterschrift; null bei geloeschten Nachrichten. */
  text: string | null;
  standort: ChatStandortDto | null;
  termin: ChatTerminKurzDto | null;
  anhaenge: ChatAnhangDto[];
}

export interface ChatNachrichtenSeiteDto {
  /** Neueste zuerst. Naechste Seite: GET ...?vor=<id der letzten Nachricht dieser Seite>. */
  nachrichten: ChatNachrichtDto[];
  weitere: boolean;
  /** Nach so vielen Tagen werden Nachrichten endgültig gelöscht (migrations/0061). */
  loeschfristTage: number | null;
}

export type ChatKontaktEingabe = { benutzerId: string } | { klientId: string };

export interface ChatGruppeAnlegenEingabe {
  name: string;
  teilnehmer: ChatKontaktEingabe[];
}

export type ChatNachrichtEingabe =
  | { art: "text"; text: string }
  | { art: "standort"; lat: number; lng: number; genauigkeitM?: number; bezeichnung?: string | null }
  | { art: "termin"; terminId: string }
  | { art: "termin"; termin: TerminAnlegenEingabe };

/** Server-Sent-Event "chat" von GET /chat/ereignisse (Daten: JSON). */
export interface ChatEreignisDto {
  /** null bei art "resync". */
  chatId: string | null;
  /**
   * nachricht: neue/geloeschte Nachricht; teilnehmer: Mitgliedschaft oder Adminrechte geaendert
   * (auch fuer gerade Entfernte); chat: Gruppe umbenannt; resync: Verbindung zur Datenbank
   * war unterbrochen -- alles neu laden.
   */
  art: "nachricht" | "teilnehmer" | "chat" | "anfrage" | "resync";
  /**
   * Nur bei art "anfrage": welche Chat-Anfrage sich geaendert hat (neu, beantwortet, zurueckgezogen).
   * Ohne Inhalt -- die Anfragen laedt der Client per GET /chat/anfragen.
   */
  anfrageId?: string;
}

// --- Chat-Anfragen durch Klient:innen (migrations/0056) ---

/** Abgeleitet (offen = unbeantwortet), nicht gespeichert. "zurueckgezogen": von der Klient:in selbst beendet. */
export type ChatAnfrageZustand = "offen" | "angenommen" | "abgelehnt" | "zurueckgezogen";

/** GET /chat/anfragen/ziele (nur Klient:innen): wen man anfragen darf. */
export type ChatAnfrageZielDto =
  | {
      art: "benutzer";
      benutzerId: string;
      name: string;
      istBezugsbetreuer: boolean;
      /** Schon bestehender Direktchat mit dieser Person -- dann braucht es keine Anfrage. */
      direktChatId: string | null;
    }
  | { art: "team"; standortId: string; /** "Team <Standortname>" */ name: string };

/** POST /chat/anfragen (nur Klient:innen). */
export type ChatAnfrageEingabe = ({ benutzerId: string } | { standortId: string }) & { nachricht?: string | null };

export interface ChatAnfrageDto {
  id: string;
  zustand: ChatAnfrageZustand;
  erstelltAm: string;
  /** Anfragende:r; fuer Mitarbeitende nach den Anonymisierungsregeln (volle Namen nur bei Sichtrecht), fuer die Klient:in selbst nur der Vorname. */
  klient: ChatPersonDto;
  ziel: { art: "benutzer"; id: string; name: string } | { art: "team"; id: string; name: string };
  nachricht: string | null;
  beantwortetAm: string | null;
  /** Wer angenommen/abgelehnt hat (nicht bei "offen" und "zurueckgezogen"). */
  beantwortetVon: { id: string; name: string } | null;
  ablehnungsgrund: string | null;
  /** Nur bei "angenommen": der Direktchat. */
  chatId: string | null;
}

/** GET /chat/ungelesen: Menue-Badge = ungelesen + offeneAnfragen. */
export interface ChatUngelesenDto {
  ungelesen: number;
  /** Mitarbeitende: offene Anfragen an mich oder mein Team (nur solche, deren Klient:in ich sehen darf). Klient:innen: immer 0. */
  offeneAnfragen: number;
}

export interface ChatAnfrageAnnahmeDto {
  chatId: string;
  anfrage: ChatAnfrageDto;
}

// ---------------------------------------------------------------------------
// Mitarbeiter-Profil (migrations/0058_mitarbeiter_profil.sql)
// ---------------------------------------------------------------------------

export type KontaktArt = "telefon" | "chat" | "email";

export const KONTAKTART_LABEL: Record<KontaktArt, string> = {
  telefon: "Anruf",
  chat: "Chat-Nachricht",
  email: "E-Mail",
};

/** Die Angaben selbst -- bei Klient:innen sind nicht freigegebene Felder null. */
export interface MitarbeiterProfilInhaltDto {
  telefon: string | null;
  bevorzugteKontaktart: KontaktArt | null;
  erreichbarkeit: string | null;
  emailDienstlich: string | null;
  ueberMich: string | null;
}

/** Wer ein Feld sehen darf: Klient:innen der Bezugsbetreuung ("zugeordnet") bzw. alle anderen, die die Person sehen koennen. */
export interface ProfilFreigabeDto {
  zugeordnet: boolean;
  andere: boolean;
}

/** Kontaktart und Erreichbarkeit gehoeren zusammen und teilen eine Freigabe ("kontakt"). */
export interface ProfilSichtbarkeitDto {
  telefon: ProfilFreigabeDto;
  kontakt: ProfilFreigabeDto;
  email: ProfilFreigabeDto;
  ueberMich: ProfilFreigabeDto;
}

/** Das eigene Profil inklusive der Freigaben -- nur die Person selbst bekommt diese Sicht. */
export interface MitarbeiterProfilEigenDto extends MitarbeiterProfilInhaltDto {
  sichtbarkeit: ProfilSichtbarkeitDto;
}

/** Kolleg:innen sehen untereinander alle Angaben (ohne die Freigabe-Einstellungen). */
export interface MitarbeiterProfilKollegeDto extends MitarbeiterProfilInhaltDto {
  benutzerId: string;
  name: string;
}

/** Was eine Klient-Sitzung sieht: nur freigegebene Felder, ausserdem ob es die eigene Bezugsbetreuung ist. */
export interface MitarbeiterProfilFuerKlientDto extends MitarbeiterProfilInhaltDto {
  benutzerId: string;
  name: string;
  zugeordnet: boolean;
}



/** Anzeige einer Belegnummer: KB-00042. */
export function formatBelegnummer(nummer: number): string {
  return `KB-${String(nummer).padStart(5, "0")}`;
}

export type SucheGruppe = "klienten" | "zimmer" | "mitarbeitende" | "belege";

export interface SucheTrefferDto {
  gruppe: SucheGruppe;
  id: string;
  titel: string;
  untertitel: string | null;
  /** Fuer Navigation: Standort des Zimmers bzw. der Buchung, falls bekannt. */
  standortId: string | null;
  /** Nur Belege: fuer die Anzeige in Mono. */
  betragCent: number | null;
}

export type SucheErgebnisDto = Record<SucheGruppe, SucheTrefferDto[]>;


export type Dienst = "frueh" | "spaet" | "nacht";

export const DIENST_LABEL: Record<Dienst, string> = {
  frueh: "Frühdienst",
  spaet: "Spätdienst",
  nacht: "Nachtdienst",
};

/**
 * Welcher Dienst gerade laeuft, aus der Uhrzeit abgeleitet (Fruehdienst
 * 05-13, Spaetdienst 13-21, sonst Nacht) -- fuer die Kontextzeile ueber den
 * Seitentiteln. Nur ein Vorschlag: der Dienstplan kennt die Wahrheit.
 */
export function dienstNachUhrzeit(uhr: Date = new Date()): Dienst {
  const h = uhr.getHours();
  if (h >= 5 && h < 13) return "frueh";
  if (h >= 13 && h < 21) return "spaet";
  return "nacht";
}

// --- Stundenbuchung (Migration 0072) ---

export type Leistungsart = "einzelbetreuung" | "gruppenangebot" | "begleitung" | "beratung" | "sonstiges";

export const LEISTUNGSARTEN: readonly Leistungsart[] = ["einzelbetreuung", "gruppenangebot", "begleitung", "beratung", "sonstiges"];

export const LEISTUNGSART_LABEL: Record<Leistungsart, string> = {
  einzelbetreuung: "Einzelbetreuung",
  gruppenangebot: "Gruppenangebot",
  begleitung: "Begleitung",
  beratung: "Beratung",
  sonstiges: "Sonstiges",
};

/** Grenzen der Spalte stundenbuchung.minuten (CHECK in Migration 0072). */
export const STUNDENBUCHUNG_MINUTEN_MAX = 1440;

export interface StundenbuchungDto {
  id: string;
  klientId: string;
  klientName: string;
  /** Wer die Leistung erbracht hat. */
  mitarbeiterId: string;
  mitarbeiterName: string | null;
  datum: string;
  minuten: number;
  leistungsart: Leistungsart;
  notiz: string | null;
  gebuchtVonName: string | null;
  erstelltAm: string;
  storniert: boolean;
  stornoGrund: string | null;
  stornoVonName: string | null;
  stornoAm: string | null;
  /** Darf die angemeldete Person diese Buchung stornieren? */
  stornierbar: boolean;
  /** Herkunft: Kalendertermin (migrations/0080); null = von Hand gebucht. */
  terminId: string | null;
  /** Titel des Termins -- nur, wenn die angemeldete Person den Termin sehen darf. */
  terminTitel: string | null;
  /** Von der Anwendung storniert, weil sich der Termin geaendert hat oder abgesagt wurde. */
  stornoAutomatisch: boolean;
  /** Ersetzt eine automatisch stornierte Buchung desselben Termins. */
  automatischNeuGebucht: boolean;
  /** Gleiche Person, Klient:in und Tag einmal aus dem Kalender und einmal von Hand. */
  moeglicherweiseDoppelt: boolean;
}

export type StundenHerkunft = "manuell" | "kalender";

export interface StundenSummeDto {
  klientId: string;
  klientName: string;
  /** "JJJJ-MM" */
  monat: string;
  minuten: number;
  /** davon aus Kalenderterminen */
  minutenKalender: number;
  anzahl: number;
}

/** Eigene Vormerkung, die (noch) nicht gebucht ist. */
export interface StundenVormerkungDto {
  terminId: string;
  titel: string;
  beginn: string;
  ende: string;
  minuten: number;
  klientNamen: string[];
  /** "geplant": Termin noch nicht vorbei. "nicht-gebucht": vorbei, aber aus einem Grund nicht buchbar. */
  status: "geplant" | "nicht-gebucht";
  grund: string | null;
}

export interface KalenderStundenEinstellungenDto {
  /** Traeger-Schalter */
  funktionAn: boolean;
  /** Recht stunden.buchen */
  darfBuchen: boolean;
  /** Recht stunden.einstellungen-verwalten */
  darfTraegerAendern: boolean;
  traegerVorauswahl: boolean;
  /** null = folgt dem Traeger */
  eigeneVorauswahl: boolean | null;
  eigeneVorauswahlZusage: boolean | null;
  /** Wirksam (eigene Wahl oder Traeger) */
  vorauswahl: boolean;
  vorauswahlZusage: boolean;
}

/** Tag in Europe/Berlin -- wie heuteBerlin() in der API. */
export function berlinTag(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

/**
 * Warum ein Termin nicht als Betreuungszeit gebucht werden kann; null = buchbar.
 * Gemeinsam fuer API (Pruefung, Buchung) und Oberflaeche (Kasten im Dialog),
 * damit beide dieselbe Regel kennen.
 */
export function terminStundenHindernis(t: { ganztaegig: boolean; beginn: string | Date; ende: string | Date; klientAnzahl: number }): string | null {
  if (t.klientAnzahl === 0) {
    return "Nur Termine mit einer Klient:in zählen als Betreuungszeit. Trage unter Teilnehmende eine Klient:in ein.";
  }
  if (t.ganztaegig) return "Ganztägige Termine haben keine Dauer. Stunden bitte unter „Stunden“ buchen.";
  const beginn = new Date(t.beginn);
  const ende = new Date(t.ende);
  const minuten = terminMinuten(beginn, ende);
  if (!(minuten >= 1)) return "Der Termin hat keine Dauer. Trage Von und Bis ein.";
  // Eine Buchung hat genau einen Tag (0072). Ende um 24:00 gehoert noch zum Tag.
  if (minuten > STUNDENBUCHUNG_MINUTEN_MAX || berlinTag(beginn) !== berlinTag(new Date(ende.getTime() - 1))) {
    return "Termine über Mitternacht lassen sich nicht als Betreuungszeit erfassen. Stunden bitte unter „Stunden“ buchen.";
  }
  return null;
}

/** Ganze Minuten, abgerundet -- Sekunden kommen aus dem Formular nie, aus der API vielleicht. */
export function terminMinuten(beginn: Date, ende: Date): number {
  return Math.floor((ende.getTime() - beginn.getTime()) / 60_000);
}

/** Gesetzte Leistungsart oder automatisch: eine Klient:in Einzelbetreuung, mehrere Gruppenangebot. */
export function terminStundenLeistungsart(gesetzt: Leistungsart | null | undefined, klientAnzahl: number): Leistungsart {
  return gesetzt ?? (klientAnzahl > 1 ? "gruppenangebot" : "einzelbetreuung");
}

/** 90 -> "1:30 h" -- Minuten als Stunden:Minuten, wie auf einem Leistungsnachweis. */
export function formatMinutenAlsStunden(minuten: number): string {
  const vorzeichen = minuten < 0 ? "-" : "";
  const m = Math.abs(minuten);
  return `${vorzeichen}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
}

// ===========================================================================
// Formular-Baukasten (Protokolle, migrations/0075)
// ===========================================================================
//
// Bewusst in DIESER Datei statt in einer eigenen formular.ts: im Entwicklungs-
// betrieb laedt Node das Paket direkt als TypeScript (Typen werden nur
// entfernt), und ein relativer Import ohne Dateiendung ("./formular") ist dort
// nicht aufloesbar -- mit Endung (".ts") wiederum nicht im CommonJS-Build fuer
// den Container (Dockerfile). Ein Modul, eine Datei vermeidet beides.

/**
 * Formular-Baukasten: Aufbau einer Formulardefinition und der Auswerter fuer
 * ihre Logik (Sichtbarkeit, Pflicht, Pruefung, Berechnung).
 *
 * Warum hier in packages/shared und nicht je einmal in API und Web: dieselbe
 * Regel muss im Browser (sofortiges Ein-/Ausblenden) und auf dem Server
 * (Pruefung beim Abschliessen) GLEICH ausgewertet werden. Zwei Implementierungen
 * laufen irgendwann auseinander -- und dann akzeptiert der Server ein Feld, das
 * die Oberflaeche verborgen hat, oder umgekehrt. Siehe Konzept
 * /mnt/project-files/protokolle/konzept-protokolle.md, Abschnitt 5.1.
 *
 * Logik ist bewusst DEKLARATIV (JSON) und nie ausfuehrbarer Code: ein Traeger
 * baut seine Formulare selbst, und eine Formel darf im Browser anderer
 * Mitarbeitender nichts anderes tun koennen als rechnen.
 */

// ---------------------------------------------------------------------------
// Datenquellen fuer die Vorausfuellung
// ---------------------------------------------------------------------------

/**
 * Katalog der Datenquellen. Eine Code-Registry wie rechte/registry.ts: ein
 * Formular kann nur anzapfen, was hier steht -- keine beliebige Tabelle.
 * Sensible Stammdaten (Diagnosen, Medikamente, IBAN) stehen bewusst nicht drin.
 */
export const DATENQUELLEN = {
  "klient.name": { label: "Klient:in › Name", identitaet: true },
  "klient.vorname": { label: "Klient:in › Vorname", identitaet: true },
  "klient.nachname": { label: "Klient:in › Nachname", identitaet: true },
  "klient.initialen": { label: "Klient:in › Initialen", identitaet: true },
  "klient.geburtsdatum": { label: "Klient:in › Geburtsdatum", identitaet: true },
  "klient.alter": { label: "Klient:in › Alter", identitaet: true },
  "klient.aktenzeichen": { label: "Klient:in › Aktenzeichen", identitaet: true },
  "klient.amt": { label: "Klient:in › Amt", identitaet: false },
  "klient.bezugsbetreuung": { label: "Klient:in › Bezugsbetreuung", identitaet: false },
  "belegung.standort": { label: "Belegung › Standort", identitaet: false },
  "belegung.zimmer": { label: "Belegung › Zimmer", identitaet: false },
  "belegung.wohnung": { label: "Belegung › Standort und Zimmer", identitaet: false },
  "ausfuellende.name": { label: "Ausfüllende Person › Name", identitaet: false },
  "zeit.heute": { label: "Zeit › Heute", identitaet: false },
  "zeit.jetzt": { label: "Zeit › Jetzt (Uhrzeit)", identitaet: false },
} as const satisfies Record<string, { label: string; identitaet: boolean }>;

export type Datenquelle = keyof typeof DATENQUELLEN;

/** Quellen, die eine Klient:in voraussetzen (Klientendaten und ihre Belegung). */
export function quelleBrauchtKlient(q: string): boolean {
  return q.startsWith("klient.") || q.startsWith("belegung.");
}

/**
 * Wozu ein ausgefuelltes Formular gehoert (Rueckmeldung „Dokumentation“,
 * Konzept dokumentation-formulare, Bild 3A). Steht in der Definition und ist
 * damit Teil der Version: sie aendert, was beim Ausfuellen gefragt wird, und
 * ein bereits ausgefuelltes Dokument behaelt seine Zuordnung. Ohne Angabe
 * "klient" -- so verhalten sich alle Formulare von vor Migration 0083.
 */
export type FormularZuordnung = "klient" | "klient_wahlweise" | "standort" | "ohne";

export const ZUORDNUNG_LABEL: Record<FormularZuordnung, string> = {
  klient: "Zu einer Klient:in",
  klient_wahlweise: "Klient:in wahlweise",
  standort: "Zu einem Standort",
  ohne: "Ohne Zuordnung",
};

export const ZUORDNUNG_ERKLAERUNG: Record<FormularZuordnung, string> = {
  klient: "Pflicht. Erscheint in der Akte unter Dokumentation.",
  klient_wahlweise: "Beim Ausfüllen wählbar, mit oder ohne Klient:in.",
  standort: "Teambesprechung, Brandschutz, Hausbegehung. Gehört zu einem Standort.",
  ohne: "Fahrzeugcheck, Schulungsnachweis. Nur auf der Seite Dokumentation.",
};

export function zuordnungVon(def: Pick<FormularDefinition, "zuordnung"> | null | undefined): FormularZuordnung {
  return def?.zuordnung ?? "klient";
}

/** Darf ein Dokument dieser Zuordnung Klientendaten anzeigen oder vorausfuellen? */
export function zuordnungKenntKlient(z: FormularZuordnung): boolean {
  return z === "klient" || z === "klient_wahlweise";
}

/**
 * "festgehalten": nur lesend, der Stand beim Abschliessen wird gespeichert.
 * "vorschlag": vorausgefuellt, darf geaendert werden.
 * Die dritte Art aus dem Konzept ("Anzeige") ist kein Eingabefeld, sondern der
 * eigene Baustein "anzeige" -- er erzeugt nie einen Datenpunkt.
 *
 * Identitaetsquellen (Name, Geburtsdatum, ...) duerfen NIE festgehalten oder
 * vorgeschlagen werden, nur angezeigt: eine Kopie in jedem Protokoll wuerde
 * die Anonymisierung (Migration 0070) unterlaufen. pruefeDefinition() lehnt das ab.
 */
export type VorausfuellArt = "festgehalten" | "vorschlag";

export interface Vorausfuellung {
  quelle: Datenquelle;
  art: VorausfuellArt;
}

// ---------------------------------------------------------------------------
// Bedingungen und Ausdruecke
// ---------------------------------------------------------------------------

export type BedingungOperator =
  | "ist"
  | "ist_nicht"
  | "eine_von"
  | "enthaelt"
  | "leer"
  | "nicht_leer"
  | "groesser"
  | "kleiner"
  | "mindestens"
  | "hoechstens";

export type Bedingung =
  | { alle: Bedingung[] }
  | { eine: Bedingung[] }
  | { feld: string; op: BedingungOperator; wert?: string | number | boolean | string[] };

export type Ausdruck =
  | number
  | { feld: string }
  | { op: "+" | "-" | "*" | "/"; a: Ausdruck; b: Ausdruck }
  | { fn: "summe" | "anzahl" | "mittelwert" | "min" | "max"; args: Ausdruck[] }
  /** Minuten zwischen zwei Uhrzeiten; ueber Mitternacht wird gerechnet ("23:10" -> "00:35" = 85). */
  | { fn: "dauer_minuten"; von: string; bis: string }
  | { fn: "tage_zwischen"; von: string; bis: string }
  | { wenn: Bedingung; dann: Ausdruck; sonst: Ausdruck };

/** Pruefung gegen ein anderes Feld, z. B. "Ende nach Beginn". */
export interface Vergleichspruefung {
  op: "groesser" | "kleiner" | "mindestens" | "hoechstens";
  feld: string;
  meldung: string;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

export interface Option {
  /** Fester Schluessel (wird gespeichert). Einmal benutzt, nie loeschen -- nur ausblenden. */
  wert: string;
  label: string;
  /** Fuer neue Eingaben nicht mehr waehlbar; alte Protokolle behalten die Beschriftung. */
  ausgeblendet?: boolean;
}

interface BausteinBasis {
  /**
   * Fester technischer Name. Bruecke zwischen Formular, Datenpunkt, PDF-Layout
   * und Auswertung -- bleibt ueber alle Versionen gleich.
   */
  schluessel: string;
  beschriftung: string;
  hilfetext?: string;
  sichtbarWenn?: Bedingung;
}

interface EingabeBasis extends BausteinBasis {
  /** true = immer, Bedingung = nur wenn sie zutrifft. */
  pflicht?: boolean | Bedingung;
  /** Nie in externe PDF-Layouts (Datenminimierung gegenueber dem Amt). */
  intern?: boolean;
  vorausfuellen?: Vorausfuellung;
  pruefungen?: Vergleichspruefung[];
  /** In der Tagesbericht-Liste als Kurzfassung zeigen (ohne Markierung: die ersten drei Antworten). */
  inTagesberichtListe?: boolean;
}

export interface AbschnittBaustein extends BausteinBasis {
  typ: "abschnitt";
  kinder: Baustein[];
}
export interface HinweisBaustein extends BausteinBasis {
  typ: "hinweis";
  ton?: "info" | "warnung";
}
/** Nur lesend, frisch aus der Quelle gelesen, nie gespeichert. */
export interface AnzeigeBaustein extends BausteinBasis {
  typ: "anzeige";
  quelle: Datenquelle;
}
export interface TextBaustein extends EingabeBasis {
  typ: "kurztext" | "langtext";
  maxLaenge?: number;
}
export interface ZahlBaustein extends EingabeBasis {
  typ: "zahl";
  min?: number;
  max?: number;
  nachkommastellen?: number;
  einheit?: string;
}
export interface DatumBaustein extends EingabeBasis {
  typ: "datum";
  nichtInZukunft?: boolean;
}
export interface UhrzeitBaustein extends EingabeBasis {
  typ: "uhrzeit";
}
export interface JaNeinBaustein extends EingabeBasis {
  typ: "ja_nein";
}
export interface AuswahlBaustein extends EingabeBasis {
  typ: "auswahl" | "mehrfachauswahl";
  optionen: Option[];
}
export interface SkalaBaustein extends EingabeBasis {
  typ: "skala";
  min: number;
  max: number;
  labelMin?: string;
  labelMax?: string;
}
/** Auswahl von Mitarbeitenden (gespeichert: Benutzer-IDs). */
export interface MitarbeitendeBaustein extends EingabeBasis {
  typ: "mitarbeitende";
}
/** Nur lesend; wird beim Abschliessen mitgespeichert, damit eine spaetere Formelaenderung nichts rueckwirkend aendert. */
export interface BerechnungBaustein extends BausteinBasis {
  typ: "berechnung";
  ausdruck: Ausdruck;
  einheit?: string;
  nachkommastellen?: number;
  inTagesberichtListe?: boolean;
}

export type EingabeBaustein =
  | TextBaustein
  | ZahlBaustein
  | DatumBaustein
  | UhrzeitBaustein
  | JaNeinBaustein
  | AuswahlBaustein
  | SkalaBaustein
  | MitarbeitendeBaustein;

export type Baustein = AbschnittBaustein | HinweisBaustein | AnzeigeBaustein | BerechnungBaustein | EingabeBaustein;
export type BausteinTyp = Baustein["typ"];

export interface FormularDefinition {
  bausteine: Baustein[];
  /**
   * Datumsfeld, nach dem das Protokoll in der Akte einsortiert wird ("Nacht
   * vom", "Datum des Besuchs"). Ohne Angabe gilt der Tag des Anlegens.
   */
  bezugsdatumFeld?: string;
  /** Ohne Angabe "klient". Siehe FormularZuordnung. */
  zuordnung?: FormularZuordnung;
}

/** Ein gespeicherter Wert. Datum "JJJJ-MM-TT", Uhrzeit "HH:MM", Mehrfach/Mitarbeitende als Liste. */
export type FeldWert = string | number | boolean | string[];
export type FeldWerte = Record<string, FeldWert | null | undefined>;

/** Speicherform je Bausteintyp -- entspricht den typisierten Spalten von protokoll_wert. */
export type Datentyp = "text" | "zahl" | "datum" | "zeit" | "bool" | "liste";

export function datentypVon(typ: BausteinTyp): Datentyp | null {
  switch (typ) {
    case "kurztext":
    case "langtext":
    case "auswahl":
      return "text";
    case "zahl":
    case "skala":
    case "berechnung":
      return "zahl";
    case "datum":
      return "datum";
    case "uhrzeit":
      return "zeit";
    case "ja_nein":
      return "bool";
    case "mehrfachauswahl":
    case "mitarbeitende":
      return "liste";
    default:
      return null;
  }
}

export const BAUSTEIN_LABEL: Record<BausteinTyp, string> = {
  abschnitt: "Abschnitt",
  hinweis: "Hinweistext",
  anzeige: "Vorausgefüllte Anzeige",
  kurztext: "Kurztext",
  langtext: "Langtext",
  zahl: "Zahl",
  datum: "Datum",
  uhrzeit: "Uhrzeit",
  ja_nein: "Ja/Nein",
  auswahl: "Einfachauswahl",
  mehrfachauswahl: "Mehrfachauswahl",
  skala: "Skala",
  mitarbeitende: "Mitarbeitende",
  berechnung: "Berechnung",
};

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** Alle Bausteine in Formularreihenfolge, Abschnitte vor ihren Kindern. */
export function alleBausteine(def: FormularDefinition): Baustein[] {
  const out: Baustein[] = [];
  const lauf = (liste: Baustein[]) => {
    for (const b of liste) {
      out.push(b);
      if (b.typ === "abschnitt") lauf(b.kinder);
    }
  };
  lauf(def.bausteine);
  return out;
}

export function istEingabe(b: Baustein): b is EingabeBaustein {
  return datentypVon(b.typ) !== null && b.typ !== "berechnung";
}

/** Bausteine, die einen Datenpunkt erzeugen (Eingaben und Berechnungen). */
export function speichernderBaustein(b: Baustein): b is EingabeBaustein | BerechnungBaustein {
  return datentypVon(b.typ) !== null;
}

function istLeer(w: FeldWert | null | undefined): boolean {
  return w === null || w === undefined || w === "" || (Array.isArray(w) && w.length === 0);
}

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const UHRZEIT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gueltigesDatum(s: string): boolean {
  if (!DATUM_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function minutenVon(uhrzeit: string): number {
  const [h, m] = uhrzeit.split(":").map(Number);
  return h * 60 + m;
}

function tageVon(datum: string): number {
  return Math.round(new Date(`${datum}T00:00:00Z`).getTime() / 86_400_000);
}

/** Vergleichbarer Zahlwert fuer groesser/kleiner: Zahl, Datum (Tage) oder Uhrzeit (Minuten). */
function vergleichswert(w: FeldWert | null | undefined): number | null {
  if (typeof w === "number") return w;
  if (typeof w === "string") {
    if (DATUM_RE.test(w)) return tageVon(w);
    if (UHRZEIT_RE.test(w)) return minutenVon(w);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

export function bedingungErfuellt(b: Bedingung, werte: FeldWerte): boolean {
  if ("alle" in b) return b.alle.every((x) => bedingungErfuellt(x, werte));
  if ("eine" in b) return b.eine.some((x) => bedingungErfuellt(x, werte));
  const w = werte[b.feld];
  switch (b.op) {
    case "leer":
      return istLeer(w);
    case "nicht_leer":
      return !istLeer(w);
    case "ist":
      return !istLeer(w) && w === b.wert;
    case "ist_nicht":
      return istLeer(w) || w !== b.wert;
    case "eine_von":
      return Array.isArray(b.wert) && typeof w === "string" && b.wert.includes(w);
    case "enthaelt":
      return Array.isArray(w) && typeof b.wert === "string" && w.includes(b.wert);
    case "groesser":
    case "kleiner":
    case "mindestens":
    case "hoechstens": {
      const links = vergleichswert(w);
      const rechts = vergleichswert(b.wert as FeldWert);
      if (links === null || rechts === null) return false;
      return vergleiche(links, b.op, rechts);
    }
  }
}

function vergleiche(a: number, op: "groesser" | "kleiner" | "mindestens" | "hoechstens", b: number): boolean {
  switch (op) {
    case "groesser":
      return a > b;
    case "kleiner":
      return a < b;
    case "mindestens":
      return a >= b;
    case "hoechstens":
      return a <= b;
  }
}

/** null, wenn ein benoetigtes Feld leer ist -- ein halb ausgefuelltes Formular rechnet nicht mit 0 weiter. */
export function berechneAusdruck(a: Ausdruck, werte: FeldWerte): number | null {
  if (typeof a === "number") return a;
  if ("feld" in a) {
    const w = werte[a.feld];
    if (typeof w === "number") return w;
    if (typeof w === "boolean") return w ? 1 : 0;
    if (Array.isArray(w)) return w.length;
    return null;
  }
  if ("op" in a) {
    const x = berechneAusdruck(a.a, werte);
    const y = berechneAusdruck(a.b, werte);
    if (x === null || y === null) return null;
    switch (a.op) {
      case "+":
        return x + y;
      case "-":
        return x - y;
      case "*":
        return x * y;
      case "/":
        return y === 0 ? null : x / y;
    }
  }
  if ("wenn" in a) return bedingungErfuellt(a.wenn, werte) ? berechneAusdruck(a.dann, werte) : berechneAusdruck(a.sonst, werte);
  switch (a.fn) {
    case "dauer_minuten": {
      const von = werte[a.von];
      const bis = werte[a.bis];
      if (typeof von !== "string" || typeof bis !== "string" || !UHRZEIT_RE.test(von) || !UHRZEIT_RE.test(bis)) return null;
      return (minutenVon(bis) - minutenVon(von) + 1440) % 1440;
    }
    case "tage_zwischen": {
      const von = werte[a.von];
      const bis = werte[a.bis];
      if (typeof von !== "string" || typeof bis !== "string" || !gueltigesDatum(von) || !gueltigesDatum(bis)) return null;
      return tageVon(bis) - tageVon(von);
    }
    case "anzahl":
      return a.args.map((x) => berechneAusdruck(x, werte)).filter((x) => x !== null).length;
    default: {
      // summe/mittelwert/min/max ueberspringen leere Felder: "Summe der
      // eingetragenen Betraege" soll schon rechnen, bevor alle Zeilen gefuellt sind.
      const zahlen = a.args.map((x) => berechneAusdruck(x, werte)).filter((x): x is number => x !== null);
      if (zahlen.length === 0) return null;
      if (a.fn === "summe") return zahlen.reduce((s, z) => s + z, 0);
      if (a.fn === "mittelwert") return zahlen.reduce((s, z) => s + z, 0) / zahlen.length;
      if (a.fn === "min") return Math.min(...zahlen);
      return Math.max(...zahlen);
    }
  }
}

function runde(z: number, stellen = 2): number {
  const f = 10 ** stellen;
  return Math.round(z * f) / f;
}

export interface Auswertung {
  /** Schluessel aller sichtbaren Bausteine. */
  sichtbar: Set<string>;
  /** Pflicht nach aktuellem Stand (nur sichtbare Eingaben). */
  pflicht: Set<string>;
  /** Eingaben (sichtbar) plus berechnete Werte -- genau das, was gespeichert wird. */
  werte: Record<string, FeldWert>;
}

/**
 * Wertet Sichtbarkeit, Berechnungen und Pflicht in Formularreihenfolge aus.
 *
 * Ein verborgenes Feld zaehlt fuer nachfolgende Bedingungen als LEER -- sonst
 * koennte ein verworfener Wert noch einen anderen Abschnitt einblenden.
 * Ein verborgener Abschnitt verbirgt alle seine Kinder.
 */
export function werteAus(def: FormularDefinition, eingabe: FeldWerte): Auswertung {
  const sichtbar = new Set<string>();
  const pflicht = new Set<string>();
  const werte: Record<string, FeldWert> = {};

  const lauf = (liste: Baustein[], elternSichtbar: boolean) => {
    for (const b of liste) {
      const ist = elternSichtbar && (!b.sichtbarWenn || bedingungErfuellt(b.sichtbarWenn, werte));
      if (ist) sichtbar.add(b.schluessel);
      if (b.typ === "abschnitt") {
        lauf(b.kinder, ist);
        continue;
      }
      if (!ist) continue;
      if (b.typ === "berechnung") {
        const z = berechneAusdruck(b.ausdruck, werte);
        if (z !== null && Number.isFinite(z)) werte[b.schluessel] = runde(z, b.nachkommastellen ?? 2);
        continue;
      }
      if (!istEingabe(b)) continue;
      const w = eingabe[b.schluessel];
      if (!istLeer(w)) werte[b.schluessel] = w as FeldWert;
    }
  };
  lauf(def.bausteine, true);
  // Pflicht erst mit ALLEN Werten: eine Pflicht-Bedingung darf sich auch auf ein
  // weiter unten stehendes Feld beziehen ("Grund" wird Pflicht, wenn unten
  // "nicht angetroffen" angekreuzt ist).
  for (const b of alleBausteine(def)) {
    if (!istEingabe(b) || !sichtbar.has(b.schluessel)) continue;
    const p = b.pflicht;
    if (p === true || (p && typeof p === "object" && bedingungErfuellt(p, werte))) pflicht.add(b.schluessel);
  }
  return { sichtbar, pflicht, werte };
}

/**
 * Ein Wert als kurzer Text fuer Listen. Ohne Personenliste: Mitarbeitende
 * erscheinen nur als Anzahl -- Namen gehoeren in die Protokollansicht.
 */
export function wertAlsKurztext(b: Baustein, w: FeldWert): string {
  switch (b.typ) {
    case "ja_nein":
      return w ? "Ja" : "Nein";
    case "datum": {
      const [j, m, t] = String(w).split("-");
      return t ? `${t}.${m}.${j}` : String(w);
    }
    case "auswahl":
      return b.optionen.find((o) => o.wert === w)?.label ?? String(w);
    case "mehrfachauswahl":
      return (w as string[]).map((x) => b.optionen.find((o) => o.wert === x)?.label ?? x).join(", ");
    case "mitarbeitende": {
      const n = (w as string[]).length;
      return n === 1 ? "1 Person" : `${n} Personen`;
    }
    case "zahl":
    case "berechnung":
      return `${String(w).replace(".", ",")}${b.einheit ? ` ${b.einheit}` : ""}`;
    case "skala":
      return `${w} von ${b.max}`;
    case "langtext": {
      const t = String(w).replace(/\s+/g, " ").trim();
      return t.length > 80 ? `${t.slice(0, 79)}…` : t;
    }
    default:
      return String(w);
  }
}

/**
 * Kurzfassung eines Protokolls fuer die Tagesbericht-Liste: die im Editor
 * markierten Felder, ohne Markierung die ersten drei beantworteten. Nur
 * sichtbare Felder -- ein verborgener Wert gehoert nicht in die Liste.
 * Mitarbeitende zaehlen ohne Markierung nicht mit (nur eine Anzahl waere
 * keine Aussage).
 */
export function protokollKurzfassung(def: FormularDefinition, werte: FeldWerte): string {
  const { sichtbar, werte: gueltig } = werteAus(def, werte);
  const kandidaten = alleBausteine(def).filter(
    (b): b is EingabeBaustein | BerechnungBaustein =>
      speichernderBaustein(b) && sichtbar.has(b.schluessel) && !istLeer(gueltig[b.schluessel] ?? werte[b.schluessel])
  );
  const markiert = kandidaten.filter((b) => b.inTagesberichtListe);
  const gewaehlt = markiert.length > 0 ? markiert : kandidaten.filter((b) => b.typ !== "mitarbeitende").slice(0, 3);
  return gewaehlt
    .map((b) => `${b.beschriftung}: ${wertAlsKurztext(b, (gueltig[b.schluessel] ?? werte[b.schluessel]) as FeldWert)}`)
    .join(" · ");
}

export interface FeldFehler {
  schluessel: string;
  meldung: string;
}

/**
 * Prueft, ob ein Wert ueberhaupt zum Feldtyp passt. Gilt fuer Entwurf UND
 * Abschluss -- ein Entwurf darf unvollstaendig sein, aber nie falsch getypt
 * (sonst landet in einer Zahlenspalte ein Text).
 */
export function typFehler(b: EingabeBaustein, w: FeldWert, optionen: { erlaubeAusgeblendet?: string[] } = {}): string | null {
  switch (b.typ) {
    case "kurztext":
    case "langtext":
      if (typeof w !== "string") return "Bitte einen Text eingeben.";
      if (b.maxLaenge && w.length > b.maxLaenge) return `Höchstens ${b.maxLaenge} Zeichen.`;
      if (b.typ === "kurztext" && w.includes("\n")) return "Bitte nur eine Zeile.";
      return null;
    case "zahl":
    case "skala": {
      if (typeof w !== "number" || !Number.isFinite(w)) return "Bitte eine Zahl eingeben.";
      const min = b.min;
      const max = b.max;
      if (min !== undefined && w < min) return `Mindestens ${min}.`;
      if (max !== undefined && w > max) return `Höchstens ${max}.`;
      if (b.typ === "skala" && !Number.isInteger(w)) return "Bitte einen Wert der Skala wählen.";
      if (b.typ === "zahl" && b.nachkommastellen !== undefined && runde(w, b.nachkommastellen) !== w) {
        return b.nachkommastellen === 0 ? "Bitte eine ganze Zahl." : `Höchstens ${b.nachkommastellen} Nachkommastellen.`;
      }
      return null;
    }
    case "datum":
      return typeof w === "string" && gueltigesDatum(w) ? null : "Bitte ein gültiges Datum eingeben.";
    case "uhrzeit":
      return typeof w === "string" && UHRZEIT_RE.test(w) ? null : "Bitte eine Uhrzeit (HH:MM) eingeben.";
    case "ja_nein":
      return typeof w === "boolean" ? null : "Bitte Ja oder Nein wählen.";
    case "auswahl": {
      if (typeof w !== "string") return "Bitte eine Option wählen.";
      const o = b.optionen.find((x) => x.wert === w);
      if (!o || (o.ausgeblendet && !optionen.erlaubeAusgeblendet?.includes(w))) return "Diese Option gibt es nicht.";
      return null;
    }
    case "mehrfachauswahl": {
      if (!Array.isArray(w) || w.some((x) => typeof x !== "string")) return "Bitte Optionen wählen.";
      if (new Set(w).size !== w.length) return "Eine Option ist doppelt gewählt.";
      for (const x of w) {
        const o = b.optionen.find((y) => y.wert === x);
        if (!o || (o.ausgeblendet && !optionen.erlaubeAusgeblendet?.includes(x))) return "Diese Option gibt es nicht.";
      }
      return null;
    }
    case "mitarbeitende":
      if (!Array.isArray(w) || w.some((x) => typeof x !== "string" || !UUID_RE.test(x))) return "Bitte Mitarbeitende auswählen.";
      return new Set(w).size === w.length ? null : "Eine Person ist doppelt gewählt.";
  }
}

/**
 * Vollstaendige Pruefung fuer das Abschliessen: Typ, Pflicht, Datum nicht in
 * der Zukunft, Vergleiche mit anderen Feldern. Nur sichtbare Felder zaehlen.
 */
export function pruefeWerte(
  def: FormularDefinition,
  eingabe: FeldWerte,
  kontext: { heute: string; erlaubeAusgeblendet?: Record<string, string[]> }
): FeldFehler[] {
  const { sichtbar, pflicht, werte } = werteAus(def, eingabe);
  const fehler: FeldFehler[] = [];
  for (const b of alleBausteine(def)) {
    if (!istEingabe(b) || !sichtbar.has(b.schluessel)) continue;
    const w = werte[b.schluessel];
    if (w === undefined) {
      if (pflicht.has(b.schluessel)) fehler.push({ schluessel: b.schluessel, meldung: "Bitte ausfüllen." });
      continue;
    }
    const tf = typFehler(b, w, { erlaubeAusgeblendet: kontext.erlaubeAusgeblendet?.[b.schluessel] });
    if (tf) {
      fehler.push({ schluessel: b.schluessel, meldung: tf });
      continue;
    }
    if (b.typ === "datum" && b.nichtInZukunft && typeof w === "string" && w > kontext.heute) {
      fehler.push({ schluessel: b.schluessel, meldung: "Das Datum darf nicht in der Zukunft liegen." });
      continue;
    }
    for (const p of b.pruefungen ?? []) {
      const links = vergleichswert(w);
      const rechts = vergleichswert(werte[p.feld]);
      if (links === null || rechts === null) continue;
      if (!vergleiche(links, p.op, rechts)) {
        fehler.push({ schluessel: b.schluessel, meldung: p.meldung });
        break;
      }
    }
  }
  return fehler;
}

// ---------------------------------------------------------------------------
// Pruefung der Definition selbst
// ---------------------------------------------------------------------------

const SCHLUESSEL_RE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Prueft eine Formulardefinition auf Widersprueche, bevor sie gespeichert
 * wird: doppelte Schluessel, Verweise auf unbekannte Felder, Identitaetsquellen
 * als "festgehalten". Liefert eine Liste lesbarer Fehler (leer = in Ordnung).
 */
export function pruefeDefinition(def: FormularDefinition): string[] {
  const fehler: string[] = [];
  if (!def || !Array.isArray(def.bausteine)) return ["Die Definition hat keine Bausteine."];
  const alle = alleBausteine(def);
  const typen = new Map<string, BausteinTyp>();
  for (const b of alle) {
    if (!SCHLUESSEL_RE.test(b.schluessel)) fehler.push(`Ungültiger Feldschlüssel „${b.schluessel}“.`);
    if (typen.has(b.schluessel)) fehler.push(`Feldschlüssel „${b.schluessel}“ kommt doppelt vor.`);
    typen.set(b.schluessel, b.typ);
    if (!b.beschriftung?.trim() && b.typ !== "hinweis") fehler.push(`„${b.schluessel}“ hat keine Beschriftung.`);
  }
  const position = new Map(alle.map((b, i) => [b.schluessel, i]));
  // Sichtbarkeit und Berechnung werden in Formularreihenfolge ausgewertet
  // (werteAus); ein Verweis nach UNTEN wuerde dort immer "leer" sehen. Darum
  // wird er hier abgelehnt, statt still falsch zu rechnen.
  let nurNachOben: number | null = null;
  const feldBekannt = (s: string, wo: string) => {
    const t = typen.get(s);
    if (!t || datentypVon(t) === null) fehler.push(`${wo} verweist auf „${s}“, das kein Datenfeld ist.`);
    else if (nurNachOben !== null && (position.get(s) ?? 0) >= nurNachOben) {
      fehler.push(`${wo} darf sich nur auf weiter oben stehende Felder beziehen („${s}“).`);
    }
  };
  const bedingungPruefen = (bd: Bedingung, wo: string) => {
    if ("alle" in bd) bd.alle.forEach((x) => bedingungPruefen(x, wo));
    else if ("eine" in bd) bd.eine.forEach((x) => bedingungPruefen(x, wo));
    else feldBekannt(bd.feld, wo);
  };
  const ausdruckPruefen = (a: Ausdruck, wo: string) => {
    if (typeof a === "number") return;
    if ("feld" in a) return feldBekannt(a.feld, wo);
    if ("op" in a) {
      ausdruckPruefen(a.a, wo);
      ausdruckPruefen(a.b, wo);
      return;
    }
    if ("wenn" in a) {
      bedingungPruefen(a.wenn, wo);
      ausdruckPruefen(a.dann, wo);
      ausdruckPruefen(a.sonst, wo);
      return;
    }
    if (a.fn === "dauer_minuten" || a.fn === "tage_zwischen") {
      feldBekannt(a.von, wo);
      feldBekannt(a.bis, wo);
      return;
    }
    a.args.forEach((x) => ausdruckPruefen(x, wo));
  };
  const zuordnung = def.zuordnung ?? "klient";
  if (!(zuordnung in ZUORDNUNG_LABEL)) fehler.push("Unbekannte Zuordnung.");
  const ohneKlient = !zuordnungKenntKlient(zuordnung);
  if (def.bezugsdatumFeld !== undefined && typen.get(def.bezugsdatumFeld) !== "datum") {
    fehler.push(`Das Bezugsdatum „${def.bezugsdatumFeld}“ ist kein Datumsfeld.`);
  }
  alle.forEach((b, i) => {
    const wo = `„${b.beschriftung || b.schluessel}“`;
    nurNachOben = i;
    if (b.sichtbarWenn) bedingungPruefen(b.sichtbarWenn, wo);
    if (b.typ === "berechnung") ausdruckPruefen(b.ausdruck, wo);
    nurNachOben = null;
    if (b.typ === "anzeige" && !(b.quelle in DATENQUELLEN)) fehler.push(`${wo}: unbekannte Datenquelle.`);
    // Ein Standort-Dokument oder eines ohne Zuordnung hat keine Klient:in --
    // ein Feld "Name der Klient:in" bliebe immer leer und taeuschte etwas vor.
    if (ohneKlient && b.typ === "anzeige" && quelleBrauchtKlient(b.quelle)) {
      fehler.push(`${wo}: zeigt Klientendaten, das Formular ist aber „${ZUORDNUNG_LABEL[zuordnung]}“.`);
    }
    if (ohneKlient && istEingabe(b) && b.vorausfuellen && quelleBrauchtKlient(b.vorausfuellen.quelle)) {
      fehler.push(`${wo}: wird aus Klientendaten vorausgefüllt, das Formular ist aber „${ZUORDNUNG_LABEL[zuordnung]}“.`);
    }
    if (istEingabe(b)) {
      if (b.pflicht && typeof b.pflicht === "object") bedingungPruefen(b.pflicht, wo);
      for (const p of b.pruefungen ?? []) feldBekannt(p.feld, wo);
      if (b.vorausfuellen) {
        const q = DATENQUELLEN[b.vorausfuellen.quelle as Datenquelle];
        if (!q) fehler.push(`${wo}: unbekannte Datenquelle.`);
        else if (q.identitaet) fehler.push(`${wo}: ${q.label} darf nur angezeigt, nicht gespeichert werden.`);
      }
      if ((b.typ === "auswahl" || b.typ === "mehrfachauswahl") && b.optionen.length === 0) fehler.push(`${wo} hat keine Optionen.`);
      if ((b.typ === "auswahl" || b.typ === "mehrfachauswahl") && new Set(b.optionen.map((o) => o.wert)).size !== b.optionen.length) {
        fehler.push(`${wo}: eine Option kommt doppelt vor.`);
      }
      if (b.typ === "skala" && !(Number.isInteger(b.min) && Number.isInteger(b.max) && b.min < b.max)) fehler.push(`${wo}: ungültige Skala.`);
    }
  });
  return fehler;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type ProtokollWertQuelle = "eingabe" | "vorschlag" | "vorschlag_geaendert" | "festgehalten" | "berechnet";

export const PROTOKOLL_QUELLE_LABEL: Record<ProtokollWertQuelle, string> = {
  eingabe: "eingegeben",
  vorschlag: "vorausgefüllt",
  vorschlag_geaendert: "Vorschlag geändert",
  festgehalten: "festgehalten",
  berechnet: "berechnet",
};

export interface ProtokollKurzDto {
  id: string;
  formularId: string;
  formularName: string;
  versionNummer: number;
  /** Zuordnung der Version, mit der das Protokoll ausgefuellt wurde. */
  zuordnung: FormularZuordnung;
  /** null bei Standort-Dokumenten und solchen ohne Zuordnung (Migration 0083). */
  klientId: string | null;
  klientName: string | null;
  standortId: string | null;
  standortName: string | null;
  autorName: string | null;
  bezugsdatum: string;
  abgeschlossen: boolean;
  abgeschlossenAm: string | null;
  anzahlAenderungen: number;
  /** Gehoert zu diesem Tagesbericht (angeheftetes Formular, Migration 0076). */
  tagesberichtId: string | null;
}

export interface ProtokollDto extends ProtokollKurzDto {
  autorId: string;
  definition: FormularDefinition;
  werte: Record<string, FeldWert>;
  quellen: Record<string, ProtokollWertQuelle>;
  /** Frisch aus dem Bezug gelesene Anzeigewerte (nie gespeichert). */
  anzeige: Record<string, string | null>;
  /** Namen zu Benutzer-IDs in Mitarbeitende-Feldern. */
  personen: Record<string, string>;
  /** Entwurf: nur Autor:in. Abgeschlossen: Autor:in oder Recht protokolle.korrigieren-fremde. */
  bearbeitbar: boolean;
  /** Gibt es inzwischen eine neuere veroeffentlichte Version dieses Formulars? */
  neuereVersion: boolean;
}

export interface ProtokollAenderungDto {
  id: string;
  feldSchluessel: string;
  feldBeschriftung: string;
  wertAlt: FeldWert | null;
  wertNeu: FeldWert | null;
  grund: string;
  geaendertAm: string;
  geaendertVonName: string | null;
}

export interface ProtokolleRechteDto {
  ansehen: boolean;
  ausfuellen: boolean;
  formulareVerwalten: boolean;
}

// ---------------------------------------------------------------------------
// Formulare verwalten: Status, Standorte, Anheftungen (Migration 0076)
// ---------------------------------------------------------------------------

/**
 * Stellen in der Zimmerakte, an denen Formulare dazugezogen werden. Die Liste
 * steht hier im Code und als CHECK in Migration 0076 -- ein Traeger waehlt
 * nur aus, welche Formulare wo haengen. "Klientenakte > Protokolle" ist kein
 * Anheftpunkt, dort ist jedes veroeffentlichte Formular immer dabei.
 */
export const ANHEFTPUNKTE = {
  tagesbericht: {
    label: "Tagesbericht anlegen",
    beschreibung: "Beim Schreiben eines Tagesberichts wird das Formular im selben Fenster dazugezogen.",
  },
} as const satisfies Record<string, { label: string; beschreibung: string }>;

export type Anheftpunkt = keyof typeof ANHEFTPUNKTE;
export type AnheftModus = "automatisch" | "dazunehmen";
/**
 * "ergaenzt": Freitext bleibt Pflicht, das Formular kommt darunter.
 * "ersetzt": das Formular IST der Tagesbericht, Freitext nur noch als
 * optionale Bemerkung. Nur bei automatisch + Pflicht (CHECK in 0077).
 */
export type AnheftDarstellung = "ergaenzt" | "ersetzt";

export const ANHEFT_DARSTELLUNG_LABEL: Record<AnheftDarstellung, string> = {
  ergaenzt: "Ergänzt den Bericht",
  ersetzt: "Ersetzt die Standardsicht",
};

export interface FormularAnheftung {
  anheftpunkt: Anheftpunkt;
  modus: AnheftModus;
  /** Nur bei "automatisch": der Tagesbericht laesst sich erst mit vollstaendigem Formular speichern. */
  pflicht: boolean;
  darstellung: AnheftDarstellung;
}

/** Abgeleitet (CLAUDE.md Regel 4), nie gespeichert. */
export type FormularStatus = "in_entwicklung" | "veroeffentlicht" | "stillgelegt";

export const FORMULAR_STATUS_LABEL: Record<FormularStatus, string> = {
  in_entwicklung: "In Entwicklung",
  veroeffentlicht: "Veröffentlicht",
  stillgelegt: "Stillgelegt",
};

export interface FormularVerwaltungDto {
  id: string;
  name: string;
  beschreibung: string | null;
  status: FormularStatus;
  /** Nummer der Version, mit der heute ausgefuellt wird (null = nie veroeffentlicht). */
  veroeffentlichteVersion: number | null;
  /** Nummer des Entwurfs der naechsten Version, falls es einen gibt. */
  entwurfVersion: number | null;
  /** Leer = alle Standorte, auch kuenftige. */
  standortIds: string[];
  anheftungen: FormularAnheftung[];
  anzahlProtokolle: number;
  /** Abgeschlossene Protokolle der letzten 30 Tage (alle Versionen). */
  anzahl30Tage: number;
  /** Auf der Seite Dokumentation zum Ausfuellen anbieten (Migration 0083). */
  aufDokumentation: boolean;
  /** Zuordnung der veroeffentlichten Version, sonst des Entwurfs. */
  zuordnung: FormularZuordnung;
}

export interface FormularVersionInfoDto {
  nummer: number;
  veroeffentlichtAm: string | null;
  veroeffentlichtVonName: string | null;
  anzahlProtokolle: number;
  /** Fuer „Aufbau“ mit Versionswahl und den Vergleich zur Vorversion. */
  definition: FormularDefinition;
}

/**
 * Zahlen fuer den Reiter „Übersicht“ eines Formulars (Rueckmeldung „Aufbau
 * Formular“). Alles abgeleitet, nichts gespeichert. Gezaehlt werden nur
 * abgeschlossene Protokolle; angefangene stehen getrennt in `offen`.
 */
export interface FormularKennzahlenDto {
  gesamt: number;
  /** Erstes abgeschlossenes Protokoll (ISO), null = noch nie ausgefuellt. */
  seit: string | null;
  letzte30Tage: number;
  vorige30Tage: number;
  offen: number;
  aeltesterOffenerSeit: string | null;
  zuletzt: { am: string; standortName: string | null } | null;
  /** Die letzten 12 Kalenderwochen (Montag als Start, Europe/Berlin), aelteste zuerst. */
  wochen: { wocheAb: string; kw: number; jeVersion: Record<string, number> }[];
  /** Standorte des Traegers mit Anzahl der letzten 30 Tage; zugelassen = Formular gilt dort. */
  standorte: { id: string; name: string; anzahl: number; zugelassen: boolean }[];
  /** Ohne Standort: Klient:in hatte am Bezugstag keine Belegung. */
  ohneStandort: number;
  /**
   * Die letzten abgeschlossenen Protokolle -- nur solche, deren Klient:in man
   * sehen darf, und nur mit Initialen (Konzept Frage 3).
   */
  letzte: { id: string; klientId: string | null; abgeschlossenAm: string; klientInitialen: string | null; standortName: string | null; versionNummer: number }[];
  /** Je Version und Feldschluessel: in wie vielen abgeschlossenen Protokollen ein Wert steht. */
  felder: Record<string, Record<string, number>>;
}

export interface FormularDetailDto extends FormularVerwaltungDto {
  entwurf: { nummer: number; definition: FormularDefinition } | null;
  veroeffentlicht: { nummer: number; definition: FormularDefinition } | null;
  versionen: FormularVersionInfoDto[];
  /** Definitionen aller frueher veroeffentlichten Versionen -- fuer gesperrte Schluessel und Optionen. */
  frueher: FormularDefinition[];
  /** Offene Protokoll-Entwuerfe auf der bisherigen Version (bleiben dort beim Veroeffentlichen). */
  offeneEntwuerfe: number;
}

/**
 * Ein Formular auf der Seite Dokumentation (Knopf „Formular ausfüllen“).
 * Ohne Vorbelegung: die haengt an der Klient:in, die erst danach gewaehlt wird.
 */
export interface DokumentationsAngebotDto {
  id: string;
  name: string;
  beschreibung: string | null;
  versionNummer: number;
  zuordnung: FormularZuordnung;
  /** Nur bei "standort": wo die Person dieses Formular ausfuellen darf. */
  standorte: { id: string; name: string }[];
  /** Letztes eigenes Protokoll mit diesem Formular, fuer „Zuletzt von dir“. */
  zuletztAm: string | null;
}

/** Ein Formular, das an einer Stelle zum Ausfuellen angeboten wird -- mit Vorbelegung fuer eine Klient:in. */
export interface FormularAngebotDto {
  id: string;
  name: string;
  beschreibung: string | null;
  versionNummer: number;
  definition: FormularDefinition;
  /** null = Klientenakte (kein Anheftpunkt). */
  modus: AnheftModus | null;
  pflicht: boolean;
  /** null = Klientenakte (kein Anheftpunkt). */
  darstellung: AnheftDarstellung | null;
  /** Vorausgefuellte Werte (Vorschlag und festgehalten) fuer diese Klient:in. */
  werte: Record<string, FeldWert>;
  anzeige: Record<string, string | null>;
}

/** Ein Formular, das zusammen mit einem Tagesbericht abgeschlossen wird. */
export interface AngeheftetesProtokollEingabe {
  formularId: string;
  werte: FeldWerte;
}

export function formularStatus(archiviert: boolean, veroeffentlichteVersion: number | null): FormularStatus {
  if (archiviert) return "stillgelegt";
  return veroeffentlichteVersion === null ? "in_entwicklung" : "veroeffentlicht";
}

/**
 * Feldschluessel aus einer Beschriftung: "Wie war die Nacht?" -> "wie_war_die_nacht".
 * Kollidiert er mit einem vorhandenen, wird hochgezaehlt.
 */
export function schluesselAusBeschriftung(beschriftung: string, vorhanden: Set<string>): string {
  const basis =
    beschriftung
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[0-9_]+/, "")
      .slice(0, 50) || "feld";
  let s = basis;
  for (let i = 2; vorhanden.has(s); i++) s = `${basis}_${i}`;
  return s;
}

/**
 * Was eine neue Version gegenueber allen frueher veroeffentlichten nicht darf
 * (Konzept Protokolle 7.3): Ein einmal veroeffentlichter Feldschluessel behaelt
 * seine Speicherform (sonst stuende in derselben Auswertungsspalte mal true,
 * mal "teilweise"), und eine benutzte Option wird nie geloescht, nur
 * ausgeblendet (sonst verlieren alte Protokolle ihre Beschriftung).
 * Gilt im Editor als Hinweis und auf dem Server als harte Pruefung.
 */
export function pruefeVeroeffentlichung(neu: FormularDefinition, frueher: FormularDefinition[]): string[] {
  const fehler = pruefeDefinition(neu);
  const bausteine = alleBausteine(neu);
  if (!bausteine.some(speichernderBaustein)) fehler.push("Das Formular hat noch kein Feld, das etwas speichert.");
  const neuNach = new Map(bausteine.map((b) => [b.schluessel, b]));
  const gemeldet = new Set<string>();
  for (const alt of frueher) {
    for (const a of alleBausteine(alt)) {
      const n = neuNach.get(a.schluessel);
      if (!n) continue;
      const dtAlt = datentypVon(a.typ);
      const dtNeu = datentypVon(n.typ);
      if (dtAlt !== null && dtAlt !== dtNeu && !gemeldet.has(a.schluessel)) {
        gemeldet.add(a.schluessel);
        fehler.push(
          `„${n.beschriftung || n.schluessel}“ war früher ein Feld vom Typ ${BAUSTEIN_LABEL[a.typ]}. Bitte ein neues Feld anlegen, statt den Typ zu ändern.`
        );
      }
      if ((a.typ === "auswahl" || a.typ === "mehrfachauswahl") && (n.typ === "auswahl" || n.typ === "mehrfachauswahl")) {
        for (const o of a.optionen) {
          if (!n.optionen.some((x) => x.wert === o.wert) && !gemeldet.has(`${a.schluessel}:${o.wert}`)) {
            gemeldet.add(`${a.schluessel}:${o.wert}`);
            fehler.push(`„${n.beschriftung}“: Die Option „${o.label}“ wurde schon benutzt. Bitte ausblenden statt löschen.`);
          }
        }
      }
    }
  }
  return fehler;
}

export interface FormularAenderung {
  art: "neu" | "geaendert" | "ausgeblendet" | "entfernt";
  text: string;
}

/** "Was ist neu gegenueber Version n" -- Pflichtblick vor dem Veroeffentlichen. */
export function formularVergleich(alt: FormularDefinition | null, neu: FormularDefinition): FormularAenderung[] {
  const altNach = new Map(alt ? alleBausteine(alt).map((b) => [b.schluessel, b]) : []);
  const neuNach = new Map(alleBausteine(neu).map((b) => [b.schluessel, b]));
  const out: FormularAenderung[] = [];
  const name = (b: Baustein) => b.beschriftung || BAUSTEIN_LABEL[b.typ];
  for (const n of neuNach.values()) {
    const a = altNach.get(n.schluessel);
    if (!a) {
      out.push({ art: "neu", text: `${BAUSTEIN_LABEL[n.typ]} „${name(n)}“` });
      continue;
    }
    if (a.beschriftung !== n.beschriftung) out.push({ art: "geaendert", text: `Beschriftung „${a.beschriftung}“ → „${n.beschriftung}“` });
    if (a.typ !== n.typ) out.push({ art: "geaendert", text: `„${name(n)}“: ${BAUSTEIN_LABEL[a.typ]} → ${BAUSTEIN_LABEL[n.typ]}` });
    const pa = "pflicht" in a ? a.pflicht : undefined;
    const pn = "pflicht" in n ? n.pflicht : undefined;
    if (JSON.stringify(pa ?? false) !== JSON.stringify(pn ?? false)) out.push({ art: "geaendert", text: `„${name(n)}“: Pflicht geändert` });
    if (JSON.stringify(a.sichtbarWenn ?? null) !== JSON.stringify(n.sichtbarWenn ?? null)) {
      out.push({ art: "geaendert", text: `„${name(n)}“: Sichtbarkeit geändert` });
    }
    if ((a.typ === "auswahl" || a.typ === "mehrfachauswahl") && (n.typ === "auswahl" || n.typ === "mehrfachauswahl")) {
      for (const o of n.optionen) {
        const ao = a.optionen.find((x) => x.wert === o.wert);
        if (!ao) out.push({ art: "neu", text: `„${name(n)}“: Option „${o.label}“` });
        else if (o.ausgeblendet && !ao.ausgeblendet) out.push({ art: "ausgeblendet", text: `„${name(n)}“: Option „${o.label}“ (alte Protokolle behalten sie)` });
        else if (ao.label !== o.label) out.push({ art: "geaendert", text: `„${name(n)}“: Option „${ao.label}“ → „${o.label}“` });
      }
    }
    const rest = (b: Baustein) => {
      const { beschriftung: _b, sichtbarWenn: _s, kinder: _k, optionen: _o, pflicht: _p, ...r } = b as unknown as Record<string, unknown>;
      return JSON.stringify(r);
    };
    if (a.typ === n.typ && rest(a) !== rest(n)) out.push({ art: "geaendert", text: `„${name(n)}“: Einstellungen geändert` });
  }
  for (const a of altNach.values()) {
    if (!neuNach.has(a.schluessel)) out.push({ art: "entfernt", text: `${BAUSTEIN_LABEL[a.typ]} „${name(a)}“ (alte Protokolle behalten den Wert)` });
  }
  return out;
}

const OP_SATZ: Record<BedingungOperator, string> = {
  ist: "ist",
  ist_nicht: "ist nicht",
  eine_von: "ist eine von",
  enthaelt: "enthält",
  leer: "ist leer",
  nicht_leer: "ist ausgefüllt",
  groesser: "ist größer als",
  kleiner: "ist kleiner als",
  mindestens: "ist mindestens",
  hoechstens: "ist höchstens",
};

/** Eine Bedingung als lesbarer Satz: "Polizei gerufen ist Ja und Vorfall ist ausgefüllt". */
export function bedingungAlsSatz(def: FormularDefinition, b: Bedingung): string {
  if ("alle" in b) return b.alle.map((x) => bedingungAlsSatz(def, x)).join(" und ");
  if ("eine" in b) return b.eine.map((x) => bedingungAlsSatz(def, x)).join(" oder ");
  const feld = alleBausteine(def).find((x) => x.schluessel === b.feld);
  const name = feld?.beschriftung || b.feld;
  if (b.op === "leer" || b.op === "nicht_leer") return `${name} ${OP_SATZ[b.op]}`;
  const wertText = (w: unknown): string => {
    if (typeof w === "boolean") return w ? "Ja" : "Nein";
    if (feld && (feld.typ === "auswahl" || feld.typ === "mehrfachauswahl")) {
      return feld.optionen.find((o) => o.wert === w)?.label ?? String(w);
    }
    return String(w);
  };
  const w = Array.isArray(b.wert) ? b.wert.map(wertText).join(", ") : wertText(b.wert);
  return `${name} ${OP_SATZ[b.op]} ${w}`;
}

// ---------------------------------------------------------------------------
// Verlauf der Klientenakte (Migration 0078, Konzept chronik/konzept-chronik.md)
// ---------------------------------------------------------------------------

/** Von Hand erfasste Eintraege. Alles mit Formular ist Dokumentation, nicht Verlauf. */
export type KlientEintragArt = "notiz" | "telefonat" | "gespraech" | "entscheidung";

export const KLIENT_EINTRAG_ART_LABEL: Record<KlientEintragArt, string> = {
  notiz: "Notiz",
  telefonat: "Telefonat",
  gespraech: "Gespräch",
  entscheidung: "Entscheidung",
};

export type GespraechArt = "team" | "hilfeplan" | "klient" | "angehoerige" | "schule" | "amt" | "sonstiges";

export const GESPRAECH_ART_LABEL: Record<GespraechArt, string> = {
  team: "Teamgespräch",
  hilfeplan: "Hilfeplangespräch",
  klient: "Gespräch mit Klient:in",
  angehoerige: "Gespräch mit Angehörigen",
  schule: "Gespräch mit Schule/Ausbildung",
  amt: "Gespräch mit dem Amt",
  sonstiges: "Sonstiges Gespräch",
};

export type TelefonatRichtung = "eingehend" | "ausgehend";

export interface KlientEintragDto {
  id: string;
  klientId: string;
  art: KlientEintragArt;
  zeitpunkt: string;
  text: string;
  gegenueber: string | null;
  richtung: TelefonatRichtung | null;
  dauerMinuten: number | null;
  gespraechArt: GespraechArt | null;
  ergebnis: string | null;
  entschiedenVonId: string | null;
  entschiedenVonName: string | null;
  wiedervorlageAm: string | null;
  naechsterSchritt: string | null;
  teilnehmende: { id: string; name: string }[];
  autorName: string | null;
  erstelltAm: string;
  anzahlKorrekturen: number;
  /** Darf die angemeldete Person den Text jetzt korrigieren? */
  korrigierbar: boolean;
  /** Muss sie dabei einen Grund nennen (nach 24 Stunden oder fremder Eintrag)? */
  korrekturBrauchtGrund: boolean;
  aufgabe: { id: string; faelligAm: string | null; erledigt: boolean } | null;
}

export interface KlientEintragAnlegenDto {
  art: KlientEintragArt;
  /** ISO-Zeitpunkt; ohne Angabe: jetzt. */
  zeitpunkt?: string;
  text: string;
  gegenueber?: string;
  richtung?: TelefonatRichtung;
  dauerMinuten?: number;
  gespraechArt?: GespraechArt;
  teilnehmendeIds?: string[];
  ergebnis?: string;
  entschiedenVonId?: string;
  wiedervorlageAm?: string;
  naechsterSchritt?: string;
  /** Legt aus dem naechsten Schritt eine Aufgabe fuer die anlegende Person an. */
  aufgabeFaelligAm?: string;
}

export interface KlientEintragAenderungDto {
  id: string;
  geaendertAm: string;
  geaendertVonName: string | null;
  textAlt: string;
  textNeu: string;
  grund: string | null;
}

/**
 * Herkunft einer Zeile im Verlauf. Die vier Eintragsarten sind gespeichert,
 * alle anderen werden beim Lesen aus ihren Quelltabellen abgeleitet.
 */
export type VerlaufQuelle = KlientEintragArt | "tagesbericht" | "protokoll" | "belegung" | "kostenuebernahme" | "hilfeplan" | "akte";

/** Die Filter-Chips im Verlauf. */
export type VerlaufFilter = KlientEintragArt | "dokumentation" | "automatisch";

export const VERLAUF_FILTER_LABEL: Record<VerlaufFilter, string> = {
  notiz: "Notizen",
  telefonat: "Telefonate",
  gespraech: "Gespräche",
  entscheidung: "Entscheidungen",
  dokumentation: "Dokumentation",
  automatisch: "Automatisch",
};

export function verlaufFilterVon(quelle: VerlaufQuelle): VerlaufFilter {
  if (quelle === "tagesbericht" || quelle === "protokoll") return "dokumentation";
  if (quelle === "notiz" || quelle === "telefonat" || quelle === "gespraech" || quelle === "entscheidung") return quelle;
  return "automatisch";
}

export interface VerlaufZeileDto {
  /** Stabil je Zeile: "<quelle>:<id>[:<teil>]". */
  schluessel: string;
  quelle: VerlaufQuelle;
  /** ISO-Zeitpunkt; bei ganztaegig nur das Datum relevant. */
  zeitpunkt: string;
  ganztaegig: boolean;
  titel: string;
  text: string | null;
  autorName: string | null;
  /** Zeigt auf den Tagesbericht bzw. das Protokoll, wenn quelle eine Dokumentation ist. */
  bezugId: string | null;
  eintrag: KlientEintragDto | null;
}

export interface VerlaufWiedervorlageDto {
  schluessel: string;
  datum: string | null;
  titel: string;
  herkunft: "entscheidung" | "aufgabe";
  eintragId: string;
}

export interface VerlaufRechteDto {
  ansehen: boolean;
  anlegen: boolean;
  entscheidungenAnlegen: boolean;
  korrigierenFremde: boolean;
}

export interface VerlaufDto {
  zeilen: VerlaufZeileDto[];
  wiedervorlagen: VerlaufWiedervorlageDto[];
  /** true, wenn mehr Zeilen existieren als geliefert (Obergrenze). */
  gekuerzt: boolean;
}

// ---------------------------------------------------------------------------
// PDF-Exporte je Formular (Migration 0082, Konzept formular-pdf Fassung 2)
// ---------------------------------------------------------------------------

/**
 * Grundform der Seite. "akte": kompakter Kopf, Titel, Felder -- fuer die
 * Ablage. "brief": DIN 5008 Form B mit Ruecksendezeile, Anschriftfeld fuer
 * den Fensterumschlag und Infospalte rechts (wie der "Briefkopf fuer BEW").
 * Die Geometrie der Bereiche ist fest in mm; einstellbar ist, was darin
 * steht. Freies Verschieben mit der Maus gibt es bewusst nicht: sonst
 * passen Fensterumschlag und Seitenumbruch nicht mehr zusammen.
 */
export type PdfVorlage = "akte" | "brief";
export type PdfZielgruppe = "intern" | "extern";
export type PdfSchrift = "nunito" | "liberation-sans" | "liberation-serif";
export type PdfFeldstil = "liste" | "kaesten" | "kompakt";
export type PdfLeereFelder = "ausblenden" | "strich" | "platz";
export type PdfUeberschriften = "farbig" | "schwarz" | "balken";
export type PdfLogoPosition = "links" | "mitte" | "rechts";

export const PDF_VORLAGE_LABEL: Record<PdfVorlage, string> = {
  akte: "Akte (kompakter Kopf)",
  brief: "Brief nach DIN 5008 (Anschriftfeld, Infospalte)",
};
export const PDF_ZIELGRUPPE_LABEL: Record<PdfZielgruppe, string> = { intern: "intern", extern: "extern" };
export const PDF_SCHRIFT_LABEL: Record<PdfSchrift, { name: string; hinweis: string }> = {
  nunito: { name: "Nunito Sans", hinweis: "wie Zimmerakte" },
  "liberation-sans": { name: "Liberation Sans", hinweis: "gleiche Maße wie Arial" },
  "liberation-serif": { name: "Liberation Serif", hinweis: "gleiche Maße wie Times New Roman" },
};
export const PDF_FELDSTIL_LABEL: Record<PdfFeldstil, { name: string; hinweis: string }> = {
  liste: { name: "Liste mit Linien", hinweis: "Beschriftung links, Wert rechts. Gut für Berichte und Akte." },
  kaesten: { name: "Kästchen wie ein Papierformular", hinweis: "Jedes Feld in einem Rahmen, kurze Felder nebeneinander." },
  kompakt: { name: "Kompakt in zwei Spalten", hinweis: "Kurze Felder nebeneinander, lange über die ganze Breite. Spart Seiten." },
};
export const PDF_LEERE_FELDER_LABEL: Record<PdfLeereFelder, string> = {
  ausblenden: "ausblenden",
  strich: "mit „–“ zeigen",
  platz: "Platz zum Ausfüllen",
};
export const PDF_UEBERSCHRIFTEN_LABEL: Record<PdfUeberschriften, string> = {
  farbig: "Großbuchstaben farbig",
  schwarz: "fett schwarz",
  balken: "mit Farbbalken",
};

/** Kleinste Schrift im PDF (Fußzeile). Darunter wird es auf Papier und in Kopien unlesbar. */
export const PDF_MIN_SCHRIFTGROESSE = 7;

export interface PdfGestaltung {
  vorlage: PdfVorlage;
  /** "alle" = alle sichtbaren Felder; sonst Auswahl per Feldschluessel (Reihenfolge wie im Formular). */
  felder: "alle" | string[];
  /** Akte: Ueberschrift. Brief: Betreff. Platzhalter erlaubt. */
  titel: string;
  unterTitel: string;
  /** Nur Brief; "" = keine. */
  anrede: string;
  einleitung: string;
  gruss: string;
  unterschrift: "linie" | "name" | "keine";
  logoPosition: PdfLogoPosition;
  /** mm */
  logoHoehe: number;
  /** Text neben dem Logo, z. B. "**{traeger.name}**". */
  textNebenLogo: string;
  trennstrich: boolean;
  /** Akte: Block rechts oben (Standort). */
  textRechts: string;
  /** Brief: Zeile ueber dem Anschriftfeld; "" = aus. */
  ruecksendezeile: string;
  anschriftfeld: boolean;
  /** Brief: rechtsbuendig ueber dem Betreff; "" = aus. */
  datumszeile: string;
  /** Brief: Spalte rechts auf der ersten Seite; "" = aus. Leerzeile = Absatz, **Zeile** = fett. */
  infospalte: string;
  fusszeileLinks: string;
  fusszeileRechts: string;
  /** mm; Logo auf Folgeseiten. */
  folgeseitenLogoHoehe: number;
  schrift: PdfSchrift;
  groesseText: number;
  groesseUeberschrift: number;
  groesseFuss: number;
  /** "#rrggbb" oder null = Traegerfarbe. Linien exakt, Ueberschriften druckfest abgedunkelt. */
  farbe: string | null;
  feldstil: PdfFeldstil;
  leereFelder: PdfLeereFelder;
  ueberschriften: PdfUeberschriften;
  jaNein: "wort" | "kreuz";
}

const PDF_GEMEINSAM = {
  felder: "alle" as const,
  folgeseitenLogoHoehe: 9,
  groesseFuss: 7,
  farbe: null,
  feldstil: "liste" as const,
  ueberschriften: "farbig" as const,
  jaNein: "wort" as const,
};

/** Zimmerakte-Vorgaben je Grundform. Ein neuer Export und '{}' in der Datenbank bekommen diese Werte. */
export function pdfGestaltungVorgabe(vorlage: PdfVorlage): PdfGestaltung {
  if (vorlage === "brief") {
    return {
      ...PDF_GEMEINSAM,
      vorlage,
      titel: "{formular.name} vom {protokoll.datum}",
      unterTitel: "Klient:in: {klient.name}, geb. {klient.geburtsdatum}",
      anrede: "Sehr geehrte Damen und Herren,",
      einleitung: "",
      gruss: "Mit freundlichen Grüßen",
      unterschrift: "name",
      logoPosition: "rechts",
      logoHoehe: 13,
      textNebenLogo: "**{traeger.name}**",
      trennstrich: true,
      textRechts: "",
      ruecksendezeile: "{traeger.name} · {traeger.hauptsitz}",
      anschriftfeld: true,
      datumszeile: "{ort}, den {datum}",
      infospalte: [
        "**{traeger.name}**",
        "",
        "{standort.name}",
        "{standort.angebotsform}",
        "{standort.strasse}",
        "{standort.plz_ort}",
        "Tel. {standort.telefon}",
        "{standort.email}",
        "{traeger.website}",
        "",
        "**Bearbeitet von**",
        "{benutzer.name}",
        "",
        "**Geschäftsführung**",
        "{traeger.geschaeftsfuehrung}",
        "",
        "**Handelsregister**",
        "{traeger.registergericht}",
        "{traeger.registernummer}",
        "",
        "**Steuernummer**",
        "{traeger.steuernummer}",
        "",
        "**Bankverbindung**",
        "{traeger.bank}",
        "{traeger.iban}",
        "{traeger.bic}",
      ].join("\n"),
      fusszeileLinks: "",
      fusszeileRechts: "Seite {seite}/{seiten}",
      schrift: "liberation-sans",
      groesseText: 10,
      groesseUeberschrift: 11,
      leereFelder: "ausblenden",
    };
  }
  return {
    ...PDF_GEMEINSAM,
    vorlage,
    titel: "{formular.name}",
    unterTitel: "{klient.name} · {protokoll.datum} · Version {formular.version}",
    anrede: "",
    einleitung: "",
    gruss: "",
    unterschrift: "keine",
    logoPosition: "links",
    logoHoehe: 9,
    textNebenLogo: "",
    trennstrich: false,
    textRechts: "**{standort.name}**\n{standort.anschrift}",
    ruecksendezeile: "",
    anschriftfeld: false,
    datumszeile: "",
    infospalte: "",
    fusszeileLinks: "Intern – nicht zur Weitergabe · {formular.name} V{formular.version} · erstellt {datum} von {benutzer.name} · Prüfnr. {pruefnummer}",
    fusszeileRechts: "Seite {seite} von {seiten}",
    schrift: "nunito",
    groesseText: 9.5,
    groesseUeberschrift: 12,
    leereFelder: "strich",
  };
}

/**
 * Gespeicherte Gestaltung (evtl. aelter oder '{}') auf die volle Form
 * bringen: was fehlt oder nicht passt, kommt aus der Vorgabe der Grundform.
 * Geprueft wird die Form ausfuehrlich beim Speichern (zod im Controller);
 * hier reicht die Typpruefung je Feld, damit eine alte Version immer rendert.
 */
export function pdfGestaltungMitVorgaben(roh: unknown): PdfGestaltung {
  const r = (roh && typeof roh === "object" ? roh : {}) as Record<string, unknown>;
  const vorlage: PdfVorlage = r.vorlage === "brief" ? "brief" : "akte";
  const v = pdfGestaltungVorgabe(vorlage);
  const out = { ...v } as Record<string, unknown>;
  for (const [k, vorgabe] of Object.entries(v)) {
    const w = r[k];
    if (w === undefined) continue;
    if (k === "felder") {
      if (w === "alle" || (Array.isArray(w) && w.every((x) => typeof x === "string"))) out[k] = w;
    } else if (k === "farbe") {
      if (w === null || (typeof w === "string" && /^#[0-9a-f]{6}$/i.test(w))) out[k] = w;
    } else if (typeof w === typeof vorgabe) {
      out[k] = w;
    }
  }
  const g = out as unknown as PdfGestaltung;
  if (!(g.schrift in PDF_SCHRIFT_LABEL)) g.schrift = v.schrift;
  if (!(g.feldstil in PDF_FELDSTIL_LABEL)) g.feldstil = v.feldstil;
  if (!(g.leereFelder in PDF_LEERE_FELDER_LABEL)) g.leereFelder = v.leereFelder;
  if (!(g.ueberschriften in PDF_UEBERSCHRIFTEN_LABEL)) g.ueberschriften = v.ueberschriften;
  g.groesseFuss = Math.max(PDF_MIN_SCHRIFTGROESSE, g.groesseFuss);
  g.groesseText = Math.max(PDF_MIN_SCHRIFTGROESSE, g.groesseText);
  return g;
}

/** Platzhalter fuer Kopf, Infospalte, Fusszeile und Texte. Formularfelder kommen als {feld.<schluessel>} dazu. */
export const PDF_PLATZHALTER: { gruppe: string; schluessel: string; beispiel: string }[] = [
  { gruppe: "Träger", schluessel: "traeger.name", beispiel: "DRK Schöneberg-Wilmersdorf hilft gGmbH" },
  { gruppe: "Träger", schluessel: "traeger.hauptsitz", beispiel: "Kranzer Str. 6/7, 14199 Berlin" },
  { gruppe: "Träger", schluessel: "traeger.telefon", beispiel: "030 1234 567" },
  { gruppe: "Träger", schluessel: "traeger.email", beispiel: "info@beispiel.de" },
  { gruppe: "Träger", schluessel: "traeger.website", beispiel: "www.beispiel.de" },
  { gruppe: "Träger", schluessel: "traeger.geschaeftsfuehrung", beispiel: "Clemens Trautermann" },
  { gruppe: "Träger", schluessel: "traeger.registergericht", beispiel: "Amtsgericht Charlottenburg" },
  { gruppe: "Träger", schluessel: "traeger.registernummer", beispiel: "HRB 204212 B" },
  { gruppe: "Träger", schluessel: "traeger.steuernummer", beispiel: "27 / 027 / 30480" },
  { gruppe: "Träger", schluessel: "traeger.bank", beispiel: "Berliner Sparkasse" },
  { gruppe: "Träger", schluessel: "traeger.iban", beispiel: "DE97 1005 0000 0190 8076 87" },
  { gruppe: "Träger", schluessel: "traeger.bic", beispiel: "BELADEBEXXX" },
  { gruppe: "Standort", schluessel: "standort.name", beispiel: "Manfred-Klein-Haus" },
  { gruppe: "Standort", schluessel: "standort.angebotsform", beispiel: "Betreutes Einzelwohnen" },
  { gruppe: "Standort", schluessel: "standort.strasse", beispiel: "Dickensweg 25–39" },
  { gruppe: "Standort", schluessel: "standort.plz_ort", beispiel: "14055 Berlin" },
  { gruppe: "Standort", schluessel: "standort.anschrift", beispiel: "Dickensweg 25–39, 14055 Berlin" },
  { gruppe: "Standort", schluessel: "standort.telefon", beispiel: "030 2332 1961 150" },
  { gruppe: "Standort", schluessel: "standort.email", beispiel: "bew@beispiel.de" },
  { gruppe: "Standort", schluessel: "standort.ik", beispiel: "260123456" },
  { gruppe: "Standort", schluessel: "standort.kostenstelle", beispiel: "4711" },
  { gruppe: "Klient:in", schluessel: "klient.name", beispiel: "Klaus Muster" },
  { gruppe: "Klient:in", schluessel: "klient.geburtsdatum", beispiel: "12.03.1978" },
  { gruppe: "Klient:in", schluessel: "klient.aktenzeichen", beispiel: "BEW-2026-014" },
  { gruppe: "Dokument", schluessel: "formular.name", beispiel: "Hausbesuch" },
  { gruppe: "Dokument", schluessel: "formular.version", beispiel: "2" },
  { gruppe: "Dokument", schluessel: "protokoll.datum", beispiel: "18.11.2026" },
  { gruppe: "Dokument", schluessel: "protokoll.abgeschlossen_von", beispiel: "Anna Berger" },
  { gruppe: "Dokument", schluessel: "datum", beispiel: "20.11.2026" },
  { gruppe: "Dokument", schluessel: "ort", beispiel: "Berlin" },
  { gruppe: "Dokument", schluessel: "benutzer.name", beispiel: "Anna Berger" },
  { gruppe: "Dokument", schluessel: "seite", beispiel: "1" },
  { gruppe: "Dokument", schluessel: "seiten", beispiel: "2" },
  { gruppe: "Dokument", schluessel: "pruefnummer", beispiel: "7F3A-91C2" },
];

const PLATZHALTER_RE = /\{([a-z][a-z0-9_.]*)\}/g;

/**
 * Text mit Platzhaltern zeilenweise fuellen. Eine Zeile, in der ein
 * Platzhalter leer bleibt, entfaellt ganz -- sonst stuende "Tel. " ohne
 * Nummer in der Infospalte. Leerzeilen bleiben (Absatz), doppelte
 * Leerzeilen und Leerzeilen am Rand werden zusammengezogen.
 * "**Zeile**" = fett.
 */
export function pdfTextZeilen(
  text: string,
  werte: Record<string, string | null | undefined>
): { text: string; fett: boolean }[] {
  const out: { text: string; fett: boolean }[] = [];
  for (const roh of text.split("\n")) {
    let leer = false;
    const zeile = roh.replace(PLATZHALTER_RE, (_, k: string) => {
      const w = werte[k];
      if (w === null || w === undefined || String(w).trim() === "") {
        leer = true;
        return "";
      }
      return String(w);
    });
    if (leer) continue;
    const t = zeile.trim();
    if (t === "") {
      if (out.length > 0 && out[out.length - 1].text !== "") out.push({ text: "", fett: false });
      continue;
    }
    const fett = /^\*\*.*\*\*$/.test(t);
    out.push({ text: fett ? t.slice(2, -2).trim() : t, fett });
  }
  // Eine Zwischenueberschrift ("**Bankverbindung**") ohne Inhalt darunter entfaellt.
  const ohne = out.filter(
    (z, i) => !(z.fett && i > 0 && out[i - 1].text === "" && (out[i + 1] === undefined || out[i + 1].text === ""))
  );
  const fertig: { text: string; fett: boolean }[] = [];
  for (const z of ohne) {
    if (z.text === "" && (fertig.length === 0 || fertig[fertig.length - 1].text === "")) continue;
    fertig.push(z);
  }
  while (fertig.length > 0 && fertig[fertig.length - 1].text === "") fertig.pop();
  return fertig;
}

/** Text in einer Zeile (Titel, Betreff): Platzhalter fuellen, leere einfach weglassen. */
export function pdfTextEinzeilig(text: string, werte: Record<string, string | null | undefined>): string {
  return text
    .replace(PLATZHALTER_RE, (_, k: string) => {
      const w = werte[k];
      return w === null || w === undefined ? "" : String(w);
    })
    .replace(/\s+·\s+(·\s+)+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

// --- Druckfarbe -----------------------------------------------------------

function kanalLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function kanalSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function hexZuRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Kein gültiger Hex-Farbwert: ${hex}`);
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Relative Leuchtdichte nach WCAG 2.x. */
export function relativeLeuchtdichte(hex: string): number {
  const [r, g, b] = hexZuRgb(hex).map(kanalLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrast einer Farbe auf weissem Papier (WCAG-Formel). */
export function kontrastAufWeiss(hex: string): number {
  return 1.05 / (relativeLeuchtdichte(hex) + 0.05);
}

/**
 * Helligkeit fuer farbige Ueberschriften auf Papier. Fest, nicht vom Traeger
 * waehlbar -- dasselbe Prinzip wie CLAUDE.md Regel 7: Kontrast haengt nur an
 * der Helligkeit, und die gehoert nicht der Farbwahl. Bei L = 0.45 liegt
 * jeder Farbton auf Weiss bei rund 7 : 1, auch Knallgelb.
 */
export const PDF_UEBERSCHRIFT_HELLIGKEIT = 0.45;

/**
 * Farbton und (soweit druckbar) Buntheit der gewaehlten Farbe, Helligkeit
 * fest. Liegt die Farbe bei dieser Helligkeit ausserhalb von sRGB, wird die
 * Buntheit schrittweise verringert statt Kanaele abzuschneiden -- Abschneiden
 * veraendert die Helligkeit und damit genau den Kontrast, um den es geht.
 */
export function druckUeberschriftFarbe(hex: string): string {
  const [r0, g0, b0] = hexZuRgb(hex).map(kanalLinear);
  const l_ = Math.cbrt(0.4122214708 * r0 + 0.5363325363 * g0 + 0.0514459929 * b0);
  const m_ = Math.cbrt(0.2119034982 * r0 + 0.6806995451 * g0 + 0.1073969566 * b0);
  const s_ = Math.cbrt(0.0883024619 * r0 + 0.2817188376 * g0 + 0.6299787005 * b0);
  const a0 = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b0_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = Math.atan2(b0_, a0);
  const L = PDF_UEBERSCHRIFT_HELLIGKEIT;
  for (let c = Math.hypot(a0, b0_); c >= 0; c -= 0.005) {
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const l3 = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m3 = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s3 = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    const rgb = [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ];
    if (rgb.every((x) => x >= -0.0005 && x <= 1.0005)) {
      return (
        "#" +
        rgb
          .map((x) => Math.round(Math.min(1, Math.max(0, kanalSrgb(Math.min(1, Math.max(0, x))))) * 255).toString(16).padStart(2, "0"))
          .join("")
      );
    }
  }
  return "#4a4a4a";
}

// --- DTOs -----------------------------------------------------------------

export interface PdfExportDto {
  id: string;
  formularId: string;
  name: string;
  zielgruppe: PdfZielgruppe;
  istStandard: boolean;
  stillgelegt: boolean;
  kopiertAus: string | null;
  versionNummer: number;
  logoId: string | null;
  gestaltung: PdfGestaltung;
  gespeichertAm: string;
  gespeichertVonName: string | null;
  anzahlErzeugt: number;
  zuletztErzeugtAm: string | null;
}

/** Was "Als PDF" in der Akte anbietet: nur Exporte, die die Person nutzen darf. */
export interface PdfExportAngebotDto {
  id: string;
  name: string;
  zielgruppe: PdfZielgruppe;
  istStandard: boolean;
  /** Brief mit Anschriftfeld: Empfaenger wird beim Erzeugen abgefragt. */
  mitAnschriftfeld: boolean;
  /** Vorschlag fuer den Empfaenger aus der Kostenuebernahme (nur der Amtsname). */
  empfaengerVorschlag: string | null;
}

export interface TraegerAngabenDto {
  name: string | null;
  hauptsitz: string | null;
  telefon: string | null;
  email: string | null;
  website: string | null;
  geschaeftsfuehrung: string | null;
  registergericht: string | null;
  registernummer: string | null;
  steuernummer: string | null;
  bank: string | null;
  iban: string | null;
  bic: string | null;
}

export interface TraegerDateiDto {
  id: string;
  art: "logo";
  name: string;
  mime: string;
  groesse: number;
  hochgeladenAm: string;
  /** In wie vielen Exportversionen benutzt (dann nicht loeschbar). */
  benutzt: number;
}

export interface DokumentAngabenRechteDto {
  /** Traegerangaben und Logos aendern (mandanten.branding-bearbeiten). */
  bearbeiten: boolean;
}

// ---------------------------------------------------------------------------
// Beispieldaten fuer Vorschauen (Reiter „Ansichten“, PDF-Exporte)
// ---------------------------------------------------------------------------

export const BEISPIEL_PERSON = { id: "00000000-0000-4000-8000-00000000beef", name: "A. Beispiel" };

const BEISPIEL_ANZEIGE: Record<keyof typeof DATENQUELLEN, string> = {
  "klient.name": "Mira Beispiel",
  "klient.vorname": "Mira",
  "klient.nachname": "Beispiel",
  "klient.initialen": "M. B.",
  "klient.geburtsdatum": "2004-05-06",
  "klient.alter": "22",
  "klient.aktenzeichen": "AZ-0000",
  "klient.amt": "Jugendamt",
  "klient.bezugsbetreuung": "A. Beispiel",
  "belegung.standort": "Haus Beispiel",
  "belegung.zimmer": "4",
  "belegung.wohnung": "Haus Beispiel, Zimmer 4",
  "ausfuellende.name": "A. Beispiel",
  "zeit.heute": "",
  "zeit.jetzt": "",
};

function beispielHeute(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Beispieldaten aus den Feldtypen, fuer die Vorschau in „Ansichten“. Ja/Nein
 * steht auf Ja, damit bedingte Abschnitte (meist „wenn Vorfall = Ja“) sichtbar
 * werden -- die Vorschau soll moeglichst viel vom Formular zeigen. Gespeichert
 * wird nichts davon.
 */
export function beispielDaten(def: FormularDefinition): {
  werte: FeldWerte;
  anzeige: Record<string, string | null>;
  personen: Record<string, string>;
} {
  const werte: FeldWerte = {};
  const anzeige: Record<string, string | null> = {};
  for (const b of alleBausteine(def)) {
    if (b.typ === "anzeige") {
      anzeige[b.schluessel] = b.quelle === "zeit.heute" ? beispielHeute() : b.quelle === "zeit.jetzt" ? "06:00" : BEISPIEL_ANZEIGE[b.quelle];
      continue;
    }
    if (!istEingabe(b)) continue;
    let w: FeldWert | null = null;
    switch (b.typ) {
      case "kurztext":
        w = "Beispiel";
        break;
      case "langtext":
        w = "Beispieltext: so sieht eine längere Angabe aus.";
        break;
      case "zahl": {
        const min = b.min ?? 0;
        const max = b.max ?? Math.max(min + 10, 10);
        w = Math.round((min + max) / 2);
        break;
      }
      case "datum":
        w = beispielHeute();
        break;
      case "uhrzeit":
        w = "06:00";
        break;
      case "ja_nein":
        w = true;
        break;
      case "auswahl": {
        const o = b.optionen.find((x) => !x.ausgeblendet);
        w = o ? o.wert : null;
        break;
      }
      case "mehrfachauswahl":
        w = b.optionen.filter((x) => !x.ausgeblendet).slice(0, 2).map((x) => x.wert);
        break;
      case "skala":
        w = Math.round((b.min + b.max) / 2);
        break;
      case "mitarbeitende":
        w = [BEISPIEL_PERSON.id];
        break;
    }
    if (w !== null) werte[b.schluessel] = w;
  }
  return { werte, anzeige, personen: { [BEISPIEL_PERSON.id]: BEISPIEL_PERSON.name } };
}
