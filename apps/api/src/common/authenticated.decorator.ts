import { applyDecorators, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard, TeilnehmerGuard } from "../auth/auth.guard";
import { TeilnehmerContextInterceptor } from "./teilnehmer-context.interceptor";
import { TenantContextInterceptor } from "./tenant-context.interceptor";

/** Bündelt die beiden Decorators, die jeder Endpunkt außer /auth/login braucht. */
export function Authenticated() {
  return applyDecorators(UseGuards(AuthGuard), UseInterceptors(TenantContextInterceptor));
}

/**
 * Fuer Endpunkte, die Mitarbeitende UND Klient:innen aufrufen duerfen (Chat,
 * Kalender). Alle uebrigen Endpunkte bleiben bei @Authenticated() und weisen
 * Klient-Tokens ab.
 */
export function TeilnehmerAuthenticated() {
  return applyDecorators(UseGuards(TeilnehmerGuard), UseInterceptors(TeilnehmerContextInterceptor));
}
