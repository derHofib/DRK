import { AsyncLocalStorage } from "node:async_hooks";

export type BenutzerRolle = "bereichsleitung" | "einrichtungsleitung" | "betreuer";

export interface TenantContext {
  mandantId: string;
  benutzerId: string;
  rolle: BenutzerRolle;
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
