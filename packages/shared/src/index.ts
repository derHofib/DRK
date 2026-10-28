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
}

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
  // Leer = keine Standort-Einschraenkung (siehe common/standort-restriction.ts).
  standortIds: string[];
}

export interface StandortDto {
  id: string;
  name: string;
  adresse: string;
  aktiv: boolean;
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
  autorName: string | null;
  datum: string;
  text: string;
  tags: TagDto[];
  dokumente: TagesberichtDokumentDto[];
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
  /** Aus einer Schichtuebergabe uebernommen: betroffene Klient:in und Herkunft. */
  klientId: string | null;
  klientName: string | null;
  uebergabePunktId: string | null;
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
  sollBesetzung: number;
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
  erstelltVon: TerminPersonDto;
  erstelltAm: string;
  abgesagtAm: string | null;
  binErsteller: boolean;
  /** null = ich bin nicht eingetragen (z. B. nur ueber einen Chat sichtbar) -- dann hilft "uebernehmen". */
  meineAntwort: TerminAntwort | null;
  teilnehmer: TerminTeilnehmerDto[];
}

export type TerminTeilnehmerEingabe = { benutzerId: string } | { klientId: string };

export interface TerminAnlegenEingabe {
  titel: string;
  beschreibung?: string | null;
  ort?: string | null;
  beginn: string;
  ende: string;
  ganztaegig?: boolean;
  teilnehmer?: TerminTeilnehmerEingabe[];
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
 * 05-13, Spaetdienst 13-21, sonst Nacht). Eine Quelle fuer Schichtuebergabe
 * UND die Kontextzeile ueber den Seitentiteln -- zwei eigene Grenzen liessen
 * die Seite "Fruehdienst" sagen, waehrend die Uebergabe schon "Spaet"
 * vorschlaegt. Nur ein Vorschlag: der Dienstplan kennt die Wahrheit.
 */
export function dienstNachUhrzeit(uhr: Date = new Date()): Dienst {
  const h = uhr.getHours();
  if (h >= 5 && h < 13) return "frueh";
  if (h >= 13 && h < 21) return "spaet";
  return "nacht";
}

export interface SchichtuebergabePunktDto {
  id: string;
  position: number;
  text: string;
  klientId: string | null;
  klientName: string | null;
  zimmerId: string | null;
  zimmerNummer: string | null;
  /** Nach dem Senden ergaenzt -- die urspruenglichen Punkte bleiben unveraendert. */
  nachtrag: boolean;
  erstelltVonName: string;
  erstelltAm: string;
  aufgaben: { id: string; titel: string; erledigt: boolean }[];
}

export interface SchichtuebergabeDto {
  id: string;
  standortId: string;
  standortName: string;
  dienst: Dienst;
  verfasstVonName: string;
  gesendetAm: string;
  gelesen: boolean;
  gelesenAnzahl: number;
  /** Selbst verfasst -- die eigene Uebergabe muss nicht bestaetigt werden. */
  eigene: boolean;
  punkte: SchichtuebergabePunktDto[];
}
