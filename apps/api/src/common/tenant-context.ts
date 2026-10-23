import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  mandantId: string;
  /** Leer bei Klient-Sitzungen -- siehe aktuellerTeilnehmer(). */
  benutzerId: string;
  /** Nur bei Klient-Sitzungen gesetzt (Zugang aus klient_zugang). */
  klientId?: string;
}

/**
 * Traegt den Mandanten-/Benutzerkontext durch einen Request, ohne ihn durch
 * jede Funktionssignatur reichen zu muessen. Gesetzt wird er einmal im
 * AuthGuard (aus dem verifizierten JWT), gelesen wird er von
 * DatabaseService.withTenant(), die daraus die SET LOCAL-Werte fuer
 * PostgreSQL macht.
 *
 * Bewusst kein globales Objekt/Singleton-Feld: AsyncLocalStorage haelt den
 * Kontext pro Request-Kette getrennt, auch wenn Node mehrere Requests
 * ueberlappend verarbeitet.
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

export function requireTenantContext(): TenantContext {
  const ctx = tenantContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      "Kein Tenant-Kontext gesetzt. Jede Datenbankabfrage ausserhalb des Logins muss durch den AuthGuard gelaufen sein."
    );
  }
  return ctx;
}

export type Teilnehmer = { art: "benutzer"; id: string } | { art: "klient"; id: string };

/**
 * Ein Request gehoert entweder einem Benutzer oder einem Klient-Zugang. Die
 * Klient-Seite hat bewusst benutzerId = "": Code, der benutzerId als uuid in
 * SQL einsetzt, scheitert dann laut (22P02) statt etwas Falsches zu
 * liefern -- fail closed.
 */
export function aktuellerTeilnehmer(): Teilnehmer {
  const ctx = requireTenantContext();
  if (ctx.klientId) return { art: "klient", id: ctx.klientId };
  return { art: "benutzer", id: ctx.benutzerId };
}
