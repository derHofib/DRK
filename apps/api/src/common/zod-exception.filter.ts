import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/**
 * Ohne diesen Filter ist ein durchgereichter ZodError fuer Nest keine
 * HttpException und kommt als 500 heraus -- ein Eingabefehler (fehlendes
 * Feld, falsches Format) ist aber kein Serverfehler. Nests eigener
 * BaseExceptionFilter loggt bei einem 500 den vollen Fehler serverseitig,
 * schickt dem Client aber nur "Internal server error" -- es leckt also
 * nichts, der Statuscode ist nur falsch (geprueft anhand des installierten
 * Nest-Quelltexts, nicht angenommen).
 *
 * Bislang war das nur lokal in mandant.controller.ts geloest
 * (safeParse + BadRequestException); dieser Filter macht es global fuer
 * jeden Controller, der weiterhin schlicht schema.parse(body) aufruft.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const meldung = exception.issues[0]?.message ?? "Ungültige Eingabe.";
    res.status(400).json({ statusCode: 400, message: meldung, error: "Bad Request" });
  }
}
