/**
 * Typen, die API und Web-App gemeinsam brauchen. Wächst mit jeder Phase --
 * hier steht nur, was in der jeweiligen Migration auch tatsächlich existiert.
 */

export type BenutzerRolle = "bereichsleitung" | "einrichtungsleitung" | "betreuer";
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
}

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

export const AKZENTFARBE_STANDARD = "#e3000f";

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
 * "DRK Rot" steht bewusst an erster Stelle und ist der Standardwert neuer
 * Mandanten (siehe migrations/0021 und AKZENTFARBE_STANDARD oben) -- das ist
 * die tatsächliche Hausfarbe des Trägers, keine beliebige Wahl. Die übrigen
 * acht Paletten bleiben bewusst nicht-rot: für Träger, die sich für eine
 * andere Farbe entscheiden, kollidierte ein zufälliges Rot visuell mit
 * --zv-status-danger (Storno, Ablehnung, negative Beträge). Über den freien
 * Farbwähler bleibt jede Farbe möglich; die Statusfarben sind davon
 * unberührt, weil sie feste Farbtöne haben und dem Akzent nicht folgen.
 */
export const PASTELL_PALETTEN: readonly PastellPalette[] = [
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
  rolle: BenutzerRolle;
  aktiv: boolean;
  // Leer = keine Standort-Einschraenkung (siehe common/standort-restriction.ts).
  standortIds: string[];
}

export const BENUTZER_ROLLE_LABEL: Record<BenutzerRolle, string> = {
  bereichsleitung: "Bereichsleitung",
  einrichtungsleitung: "Einrichtungsleitung",
  betreuer: "Betreuer",
};

export interface StandortDto {
  id: string;
  name: string;
  adresse: string;
  aktiv: boolean;
}

export interface ZimmerBewohnerDto {
  id: string;
  name: string;
  einzug: string;
  belegungId: string;
}

/**
 * Ein Kapazitaetsantrag wirkt NIE sofort (anders als Nummer/Etage) --
 * siehe zimmer.service.ts, kapazitaetAendern()/kapazitaetEntscheiden().
 * Vier-Augen: die entscheidende Person muss die jeweils ANDERE
 * Leitungsrolle als beantragtVonRolle haben.
 */
export interface OffenerKapazitaetsantragDto {
  id: string;
  alteKapazitaet: number;
  neueKapazitaet: number;
  beantragtVonName: string;
  beantragtVonRolle: BenutzerRolle;
  beantragtAm: string;
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
  offenerKapazitaetsantrag: OffenerKapazitaetsantragDto | null;
}

export interface BelegungsverlaufEintragDto {
  id: string;
  klientId: string | null;
  name: string;
  einzug: string;
  auszug: string | null;
  istAktuell: boolean;
}

export interface KlientListEintragDto {
  id: string;
  vorname: string;
  nachname: string;
  aktenzeichen: string;
  amt: string;
  hzlRhythmus: HzlRhythmus;
  aktuellesZimmer: { id: string; nummer: string; standortName: string; belegungId: string } | null;
  anonymisiertAm: string | null;
}

export interface KlientDetailDto extends KlientListEintragDto {
  geburtsdatum: string | null;
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

export type KassenbuchungTyp = "hzl" | "einzahlung" | "sonstiges";

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
  klientId: string | null;
  klientName: string | null;
  standortId: string | null;
  standortName: string | null;
  datum: string;
  betragCent: number;
  verwendungszweck: string;
  typ: KassenbuchungTyp;
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
  bezahlt: boolean;
  buchungId: string | null;
  betragCent: number | null;
  datum: string | null;
}

export const KASSENBUCHUNG_TYP_LABEL: Record<KassenbuchungTyp, string> = {
  hzl: "HZL",
  einzahlung: "Einzahlung",
  sonstiges: "Sonstiges",
};

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
