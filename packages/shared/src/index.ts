/**
 * Typen, die API und Web-App gemeinsam brauchen. Bewusst schlank gehalten
 * und nur das, was in Phase 0 tatsaechlich existiert -- kein Vorgriff auf
 * Zimmer/Klient/Belegung, die kommen mit Phase 1 in dieses Paket dazu.
 */

export type BenutzerRolle = "leitung" | "verwaltung" | "bezugsbetreuung" | "springer";

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
