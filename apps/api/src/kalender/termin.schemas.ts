import { z } from "zod";
import { LEISTUNGSARTEN, type Leistungsart } from "@zimmerakte/shared";

export const leistungsartSchema = z.enum(LEISTUNGSARTEN as unknown as [Leistungsart, ...Leistungsart[]]);

export const terminArtSchema = z.enum(["termin", "besprechung", "klient"]);

export const terminTeilnehmerSchema = z.union([
  z.object({ benutzerId: z.string().uuid() }).strict(),
  z.object({ klientId: z.string().uuid() }).strict(),
]);

// Zeitformat (Datum bei ganztaegig, sonst Zeitpunkt mit Zeitzone) haengt von
// ganztaegig ab und wird deshalb im Service geprueft, nicht hier.
export const terminAnlegenSchema = z.object({
  titel: z.string().trim().min(1, "Titel darf nicht leer sein.").max(200, "Titel ist zu lang (höchstens 200 Zeichen)."),
  beschreibung: z.string().max(5000, "Beschreibung ist zu lang.").nullable().optional(),
  ort: z.string().max(300, "Ort ist zu lang.").nullable().optional(),
  beginn: z.string(),
  ende: z.string(),
  ganztaegig: z.boolean().optional(),
  art: terminArtSchema.optional(),
  teilnehmer: z.array(terminTeilnehmerSchema).optional(),
  // Stunden aus dem Kalender (migrations/0080); ob der Termin dafuer taugt,
  // prueft der Service (haengt an ganztaegig, Dauer und Teilnehmenden).
  stundenErfassen: z.boolean().optional(),
  stundenLeistungsart: leistungsartSchema.nullable().optional(),
});
