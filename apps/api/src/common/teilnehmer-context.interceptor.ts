import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Request } from "express";
import { Observable } from "rxjs";
import { tenantContextStorage } from "./tenant-context";

/**
 * Gegenstueck zu TenantContextInterceptor fuer @TeilnehmerAuthenticated():
 * liest request.teilnehmer (vom TeilnehmerGuard) und setzt den
 * AsyncLocalStorage-Kontext -- bei Klient:innen mit benutzerId = "" und
 * klientId, siehe aktuellerTeilnehmer().
 */
@Injectable()
export class TeilnehmerContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const teilnehmer = context.switchToHttp().getRequest<Request>().teilnehmer;
    if (!teilnehmer) {
      throw new Error("TeilnehmerContextInterceptor ohne vorherigen TeilnehmerGuard verwendet.");
    }
    const ctx =
      teilnehmer.art === "klient"
        ? { mandantId: teilnehmer.mandantId, benutzerId: "", klientId: teilnehmer.id }
        : { mandantId: teilnehmer.mandantId, benutzerId: teilnehmer.id };

    return new Observable((subscriber) => {
      tenantContextStorage.run(ctx, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
