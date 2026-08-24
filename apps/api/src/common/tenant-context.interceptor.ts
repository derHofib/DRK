import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Request } from "express";
import { Observable } from "rxjs";
import { tenantContextStorage } from "./tenant-context";

/**
 * Muss NACH AuthGuard laufen (Nest fuehrt Guards vor Interceptors aus, das
 * ist hier keine Konfiguration, sondern Reihenfolge durch das Framework).
 * Liest die vom Guard gesetzte request.benutzer-Nutzlast und spannt den
 * kompletten weiteren Request -- Handler, alles was er awaited -- in den
 * AsyncLocalStorage-Kontext, den DatabaseService.withTenant() danach liest.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const benutzer = request.benutzer;

    if (!benutzer) {
      // AuthGuard haette hier schon geworfen; das ist ein Programmierfehler
      // (Interceptor ohne Guard registriert), kein Nutzerfehler.
      throw new Error("TenantContextInterceptor ohne vorherigen AuthGuard verwendet.");
    }

    return new Observable((subscriber) => {
      tenantContextStorage.run(
        { mandantId: benutzer.mandantId, benutzerId: benutzer.sub, rolle: benutzer.rolle },
        () => {
          next.handle().subscribe(subscriber);
        }
      );
    });
  }
}
