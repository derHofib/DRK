/**
 * Typen, die API und Web-App gemeinsam brauchen. Wächst mit jeder Phase --
 * hier steht nur, was in der jeweiligen Migration auch tatsächlich existiert.
 */

export type BenutzerRolle = "leitung" | "verwaltung" | "bezugsbetreuung" | "springer";
export type HzlRhythmus = "monatlich" | "woechentlich";
export type Zimmerstatus = "vergeben" | "zugeordnet";

export interface LoginRequest {
  mandantSlug: string;
  email: string;
  passwort: string;
}

export interface LoginResponse {
  accessToken: string;
}

export interface MandantDto {
  id: string;
  name: string;
  slug: string;
}

export interface BenutzerListEintragDto {
  id: string;
  email: string;
  name: string;
  rolle: BenutzerRolle;
  aktiv: boolean;
}

export const BENUTZER_ROLLE_LABEL: Record<BenutzerRolle, string> = {
  leitung: "Leitung",
  verwaltung: "Verwaltung",
  bezugsbetreuung: "Bezugsbetreuung",
  springer: "Springer",
};

export interface StandortDto {
  id: string;
  name: string;
  adresse: string;
  aktiv: boolean;
}

export interface ZimmerListEintragDto {
  id: string;
  nummer: string;
  standortId: string;
  standortName: string;
  status: Zimmerstatus;
  aktuellerKlient: { id: string; name: string; einzug: string } | null;
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
  aktuellesZimmer: { id: string; nummer: string; standortName: string } | null;
}

export interface KlientDetailDto extends KlientListEintragDto {
  geburtsdatum: string;
}

export const ZIMMERSTATUS_LABEL: Record<Zimmerstatus, string> = {
  vergeben: "Vergeben",
  zugeordnet: "Zugeordnet",
};

export const HZL_RHYTHMUS_LABEL: Record<HzlRhythmus, string> = {
  monatlich: "Monatlich",
  woechentlich: "Wöchentlich",
};

export type KassenbuchungTyp = "hzl" | "einzahlung" | "sonstiges";

export interface KassenbuchungDto {
  id: string;
  klientId: string;
  klientName: string;
  datum: string;
  betragCent: number;
  verwendungszweck: string;
  typ: KassenbuchungTyp;
  isoJahr: number | null;
  isoWoche: number | null;
  storniert: boolean;
  stornoGrund: string | null;
  hatUnterschrift: boolean;
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
