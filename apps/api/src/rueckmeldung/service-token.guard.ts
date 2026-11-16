import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

const MAX_FEHLVERSUCHE = 10;
const FENSTER_MS = 15 * 60 * 1000;

/**
 * Schuetzt die Hersteller-Schnittstelle (/service/rueckmeldungen). Der Token
 * liegt nur als SHA-256 in RUECKMELDUNG_SERVICE_TOKEN_HASH; das Klartext-Token
 * steht in den Secrets der Claude-Umgebung, nie im Repo. Ein SHA-256 genuegt,
 * weil das Token 32 Zufallsbytes sind (scripts/rueckmeldung-token.ts) -- ein
 * langsamer Passwort-Hash waere hier nur Rechenaufwand.
 *
 * Ohne gesetzten Hash antwortet die Schnittstelle mit 404: eine nicht
 * eingerichtete Schnittstelle soll nicht einmal als vorhanden auffallen.
 *
 * Sperre: 10 Fehlversuche je IP in 15 Minuten fuehren zu 429 -- in dieser Zeit
 * wird auch das richtige Token abgewiesen. Im Speicher, nicht in der
 * Datenbank: bei einem Neustart faengt das Zaehlen neu an, was fuer eine
 * Bremse gegen Raten ausreicht.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly fehlversuche = new Map<string, { anzahl: number; seit: number }>();

  /** Fuer Tests: ersetzt das Ablaufen des 15-Minuten-Fensters. */
  fehlversucheVergessen(): void {
    this.fehlversuche.clear();
  }

  canActivate(context: ExecutionContext): boolean {
    const sollHash = process.env.RUECKMELDUNG_SERVICE_TOKEN_HASH;
    if (!sollHash || !/^[0-9a-f]{64}$/i.test(sollHash)) throw new NotFoundException();

    const req = context.switchToHttp().getRequest<Request>();
    const schluessel = req.ip ?? "unbekannt";
    const jetzt = Date.now();
    const stand = this.fehlversuche.get(schluessel);
    if (stand && jetzt - stand.seit > FENSTER_MS) this.fehlversuche.delete(schluessel);
    const aktuell = this.fehlversuche.get(schluessel);
    if (aktuell && aktuell.anzahl >= MAX_FEHLVERSUCHE) {
      throw new HttpException("Zu viele Fehlversuche.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const kopf = req.headers.authorization ?? "";
    const token = kopf.startsWith("Bearer ") ? kopf.slice(7).trim() : "";
    const istHash = createHash("sha256").update(token).digest();
    const sollBytes = Buffer.from(sollHash, "hex");
    if (token === "" || !timingSafeEqual(istHash, sollBytes)) {
      this.fehlversuche.set(schluessel, { anzahl: (aktuell?.anzahl ?? 0) + 1, seit: aktuell?.seit ?? jetzt });
      throw new UnauthorizedException();
    }
    return true;
  }
}
