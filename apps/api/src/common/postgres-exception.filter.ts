import { ArgumentsHost, Catch } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Response } from "express";
import { isPgError } from "./pg-error";

// SQLSTATE 22P02 ("invalid_text_representation"): Postgres wirft das, wenn
// ein Wert nicht ins Zielformat einer Spalte oder eines Casts passt -- allen
// voran eine syntaktisch ungueltige UUID in einem Pfad- oder
// Query-Parameter (z.B. GET /klienten/keine-uuid). Kein Controller in
// diesem Projekt validiert seine :id-Parameter einzeln (kein
// ParseUUIDPipe an jedem @Param()) -- das waere an >15 Stellen zu
// wiederholen und beim naechsten neuen Endpunkt zu leicht vergessen.
// Stattdessen einmal hier zentral, nach demselben Prinzip wie
// ZodExceptionFilter.
const INVALID_TEXT_REPRESENTATION = "22P02";

/**
 * Faengt genau diesen einen SQLSTATE ab und macht daraus ein sauberes 400
 * -- eine syntaktisch falsche ID ist ein Eingabefehler des Aufrufers, kein
 * Serverfehler. Erbt von BaseExceptionFilter (Nests eigenem
 * Standard-Handler) statt von einem leeren @Catch()-Rumpf: dieser Filter
 * ist als @Catch() (ohne Typ) registriert und wird damit fuer JEDE nicht
 * spezifischer behandelte Exception aufgerufen -- auch fuer ganz normale
 * HttpExceptions (403, 404, 409, ...) und echte 500er. Alles ausser dem
 * einen bekannten SQLSTATE muss deshalb unveraendert an super.catch()
 * durchgereicht werden, sonst bricht das bestehende Verhalten fuer jede
 * andere Fehlerart in der ganzen Anwendung.
 *
 * Reihenfolge in app.module.ts wichtig: muss NACH ZodExceptionFilter
 * registriert sein, sonst faengt dieses @Catch() (matcht alles) auch
 * ZodError ab, bevor der spezifischere Filter drankommt.
 */
@Catch()
export class PostgresExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (isPgError(exception) && exception.code === INVALID_TEXT_REPRESENTATION) {
      const res = host.switchToHttp().getResponse<Response>();
      res.status(400).json({ statusCode: 400, message: "Ungültiges Format in der Anfrage.", error: "Bad Request" });
      return;
    }
    super.catch(exception, host);
  }
}
