import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { DatabaseService } from "../database/database.service";
import { tenantContextStorage } from "../common/tenant-context";

export interface JwtPayload {
  typ: "access";
  sub: string;
  mandantId: string;
}

declare module "express" {
  interface Request {
    benutzer?: JwtPayload;
  }
}

/**
 * Prueft nur das Token und haengt die Nutzlast an request.benutzer.
 * Den eigentlichen Tenant-Kontext fuer die Datenbank setzt danach
 * TenantContextInterceptor -- getrennt, weil ein Guard den nachgelagerten
 * Handler-Aufruf nicht selbst umschliessen kann (das kann nur ein
 * Interceptor via next.handle()).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Kein Token übermittelt.");
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(header.slice("Bearer ".length));
      // Ein waehrend des 2FA-Logins ausgestelltes "pending"-Token (siehe
      // auth.service.ts, login()) darf niemals als vollwertiges Zugriffs-
      // token durchgehen -- explizite Allowlist statt Denylist, damit ein
      // neuer Token-Typ in Zukunft nicht versehentlich durchrutscht.
      if (payload.typ !== "access") {
        throw new UnauthorizedException("Token ungültig oder abgelaufen.");
      }
    } catch {
      throw new UnauthorizedException("Token ungültig oder abgelaufen.");
    }

    // Das Token gilt 8 Stunden -- ohne diese Abfrage bliebe eine
    // deaktivierte Person (siehe benutzer.service.ts::aktivSetzen) bis dahin
    // voll zugriffsberechtigt. Bewusst ausserhalb des try: ein Datenbank-
    // fehler soll ein 500 sein, kein irrefuehrendes "Token ungueltig".
    const { rows } = await tenantContextStorage.run(
      { mandantId: payload.mandantId, benutzerId: payload.sub },
      () =>
        this.db.withTenant((client) =>
          client.query<{ aktiv: boolean }>("SELECT aktiv FROM benutzer WHERE id = $1", [payload.sub])
        )
    );
    if (rows.length === 0 || !rows[0].aktiv) {
      throw new UnauthorizedException("Konto ist deaktiviert.");
    }

    request.benutzer = payload;
    return true;
  }
}

export interface KlientJwtPayload {
  typ: "klient_access";
  sub: string; // klient_id
  zugangId: string;
  mandantId: string;
}

export type TeilnehmerAnfrage =
  | { art: "benutzer"; id: string; mandantId: string }
  | { art: "klient"; id: string; mandantId: string; zugangId: string };

declare module "express" {
  interface Request {
    teilnehmer?: TeilnehmerAnfrage;
  }
}

/**
 * Wie AuthGuard, aber fuer Endpunkte, die Mitarbeitende UND Klient:innen
 * nutzen (Chat, Kalender). Explizite Allowlist der zwei Token-Typen -- das
 * 2FA-"pending"-Token kommt hier genauso wenig durch wie bei AuthGuard.
 * AuthGuard selbst bleibt unveraendert streng (nur "access"): jeder
 * Endpunkt ohne @TeilnehmerAuthenticated() ist fuer Klient-Tokens 401.
 *
 * Die Aktiv-Pruefung laeuft mit dem Tenant-Kontext des Tokens (RLS greift),
 * fuer Klient:innen: Zugang aktiv UND Klient weder archiviert noch
 * anonymisiert -- der Trigger klient_zugang_bei_sperre (0052) deaktiviert
 * den Zugang zwar schon, diese Abfrage ist der zweite Riegel, falls ein
 * Zugang spaeter von Hand reaktiviert wird.
 */
@Injectable()
export class TeilnehmerGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Kein Token übermittelt.");
    }

    let payload: JwtPayload | KlientJwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload | KlientJwtPayload>(header.slice("Bearer ".length));
    } catch {
      throw new UnauthorizedException("Token ungültig oder abgelaufen.");
    }

    if (payload.typ === "access") {
      const { rows } = await tenantContextStorage.run(
        { mandantId: payload.mandantId, benutzerId: payload.sub },
        () =>
          this.db.withTenant((client) =>
            client.query<{ aktiv: boolean }>("SELECT aktiv FROM benutzer WHERE id = $1", [payload.sub])
          )
      );
      if (rows.length === 0 || !rows[0].aktiv) {
        throw new UnauthorizedException("Konto ist deaktiviert.");
      }
      request.teilnehmer = { art: "benutzer", id: payload.sub, mandantId: payload.mandantId };
      request.benutzer = payload;
      return true;
    }

    if (payload.typ === "klient_access") {
      const { rows } = await tenantContextStorage.run(
        { mandantId: payload.mandantId, benutzerId: "", klientId: payload.sub },
        () =>
          this.db.withTenant((client) =>
            client.query<{ ok: boolean }>(
              `SELECT true AS ok
               FROM klient_zugang z
               JOIN klient k ON k.id = z.klient_id
               WHERE z.id = $1 AND z.klient_id = $2
                 AND z.aktiv AND z.passwort_hash IS NOT NULL
                 AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL`,
              [payload.zugangId, payload.sub]
            )
          )
      );
      if (rows.length === 0) {
        throw new UnauthorizedException("Zugang ist deaktiviert.");
      }
      request.teilnehmer = { art: "klient", id: payload.sub, mandantId: payload.mandantId, zugangId: payload.zugangId };
      return true;
    }

    throw new UnauthorizedException("Token ungültig oder abgelaufen.");
  }
}
