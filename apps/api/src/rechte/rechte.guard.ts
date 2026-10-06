import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { tenantContextStorage } from "../common/tenant-context";
import { RECHTE_METADATA_KEY, type RechteAnforderung } from "./rechte.decorator";
import { RechteService } from "./rechte.service";

/**
 * Ein Guard kann den nachgelagerten Handler-Aufruf nicht selbst umschliessen
 * (das kann nur ein Interceptor via next.handle(), siehe auth.guard.ts-
 * Kommentar) -- und Guards laufen in Nest grundsaetzlich VOR allen
 * Interceptoren, also bevor TenantContextInterceptor den
 * AsyncLocalStorage-Kontext fuer den Handler aufspannt. Dieser Guard
 * braucht den Kontext aber selbst, um RechteService (das intern
 * requireTenantContext() nutzt, wie jeder andere Service) aufzurufen.
 *
 * Deshalb spannt er den Kontext hier EIGENSTAENDIG auf (aus
 * request.benutzer, das AuthGuard bereits gesetzt hat -- Guards laufen in
 * Registrierungsreihenfolge, @Authenticated() davor garantiert das), nur
 * fuer die Dauer der eigenen Pruefung. TenantContextInterceptor spannt
 * unabhaengig davon gleich danach seinen EIGENEN, inhaltlich identischen
 * Kontext fuer den eigentlichen Handler auf -- keine Kollision, nur eine
 * zweite, redundante aber folgenlose Aufspannung derselben Werte.
 */
@Injectable()
export class RechteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rechte: RechteService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const anforderung = this.reflector.get<RechteAnforderung | undefined>(RECHTE_METADATA_KEY, context.getHandler());
    if (!anforderung) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const benutzer = request.benutzer;
    if (!benutzer) throw new ForbiddenException("Kein Zugriff.");

    const erlaubt = await tenantContextStorage.run(
      { mandantId: benutzer.mandantId, benutzerId: benutzer.sub, rolle: benutzer.rolle },
      () => this.rechte.hatRecht(anforderung.modul, anforderung.aktion)
    );
    if (!erlaubt) {
      throw new ForbiddenException(`Fehlendes Recht: ${anforderung.modul}.${anforderung.aktion}`);
    }
    return true;
  }
}
