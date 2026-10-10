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
