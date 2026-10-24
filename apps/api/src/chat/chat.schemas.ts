import { z } from "zod";
import { terminAnlegenSchema } from "../kalender/termin.schemas";

export const kontaktSchema = z.union([
  z.object({ benutzerId: z.string().uuid() }).strict(),
  z.object({ klientId: z.string().uuid() }).strict(),
]);

export const gruppeAnlegenSchema = z
  .object({
    name: z.string().trim().min(1, "Der Gruppenname darf nicht leer sein.").max(100, "Der Gruppenname ist zu lang (höchstens 100 Zeichen)."),
    teilnehmer: z.array(kontaktSchema).min(1, "Eine Gruppe braucht mindestens eine weitere Person.").max(49, "Höchstens 50 Personen pro Gruppe."),
  })
  .strict();

export const umbenennenSchema = z
  .object({ name: z.string().trim().min(1, "Der Gruppenname darf nicht leer sein.").max(100, "Der Gruppenname ist zu lang (höchstens 100 Zeichen).") })
  .strict();

// terminId/termin sind beide optional und werden im Service auf "genau eins"
// geprueft: eine discriminatedUnion verlangt reine Objekt-Schemas, ein
// .refine() darauf waere kein ZodObject mehr.
export const nachrichtSchema = z.discriminatedUnion("art", [
  z.object({ art: z.literal("text"), text: z.string().trim().min(1, "Die Nachricht darf nicht leer sein.").max(4000, "Die Nachricht ist zu lang (höchstens 4000 Zeichen).") }).strict(),
  z
    .object({
      art: z.literal("standort"),
      lat: z.number({ invalid_type_error: "Breitengrad fehlt oder ist keine Zahl." }).min(-90, "Breitengrad muss zwischen -90 und 90 liegen.").max(90, "Breitengrad muss zwischen -90 und 90 liegen."),
      lng: z.number({ invalid_type_error: "Längengrad fehlt oder ist keine Zahl." }).min(-180, "Längengrad muss zwischen -180 und 180 liegen.").max(180, "Längengrad muss zwischen -180 und 180 liegen."),
      genauigkeitM: z.number().min(0).max(1_000_000).optional(),
      bezeichnung: z.string().trim().max(200, "Die Bezeichnung ist zu lang (höchstens 200 Zeichen).").nullable().optional(),
    })
    .strict(),
  z.object({ art: z.literal("termin"), terminId: z.string().uuid().optional(), termin: terminAnlegenSchema.optional() }).strict(),
]);

export const bildQuerySchema = z.object({
  dateiname: z.string().trim().max(200).optional(),
  text: z.string().trim().max(1000, "Die Bildunterschrift ist zu lang (höchstens 1000 Zeichen).").optional(),
});

export const seiteQuerySchema = z.object({
  vor: z.string().uuid("„vor“ muss die ID einer Nachricht sein.").optional(),
  limit: z.coerce.number().int("„limit“ muss eine ganze Zahl sein.").min(1).max(100, "„limit“ darf höchstens 100 sein.").optional(),
});

const anfrageNachricht = z.string().trim().max(1000, "Der Text ist zu lang (höchstens 1000 Zeichen).").nullable().optional();

export const anfrageSchema = z.union([
  z.object({ benutzerId: z.string().uuid(), nachricht: anfrageNachricht }).strict(),
  z.object({ standortId: z.string().uuid(), nachricht: anfrageNachricht }).strict(),
]);

export const ablehnenSchema = z
  .object({ begruendung: z.string().trim().max(500, "Die Begründung ist zu lang (höchstens 500 Zeichen).").nullable().optional() })
  .strict();
