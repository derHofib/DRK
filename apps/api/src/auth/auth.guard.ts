import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { BenutzerRolle } from "../common/tenant-context";

export interface JwtPayload {
  sub: string;
  mandantId: string;
  rolle: BenutzerRolle;
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
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Kein Token uebermittelt.");
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(header.slice("Bearer ".length));
      request.benutzer = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Token ungueltig oder abgelaufen.");
    }
  }
}
