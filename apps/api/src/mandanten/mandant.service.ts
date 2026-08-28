import { ForbiddenException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";

interface MandantZeile {
  id: string;
  name: string;
  slug: string;
  akzentfarbe: string;
  dunkelGrundfarbe: string;
}

/** Partielles Update -- mindestens ein Feld ist gesetzt, siehe Controller. */
interface ErscheinungsbildPatch {
  akzentfarbe?: string;
  dunkelGrundfarbe?: string;
}

/**
 * Das Erscheinungsbild des Trägers ist eine trägerweite Entscheidung, keine
 * Nutzereinstellung und auch keine einzelner Einrichtung -- sie gilt für
 * alle Mitarbeitenden und alle Einrichtungen gleichzeitig. Deshalb nur die
 * Bereichsleitung, nicht die Einrichtungsleitung (anders als z.B. beim
 * Mitarbeiter-Anlegen in benutzer.service.ts).
 *
 * Die persönliche Anzeigepräferenz hell/dunkel ist bewusst NICHT hier --
 * die liegt im localStorage des Browsers und geht die Datenbank nichts an.
 */
const ROLLEN_MIT_BRANDING = new Set<BenutzerRolle>(["bereichsleitung"]);

@Injectable()
export class MandantService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Kein WHERE id = ... im Code -- mandant_isolation (RLS) laesst fuer die
   * App-Rolle ohnehin nur die eigene Zeile durch. Wuerde hier jemand
   * versehentlich "SELECT * FROM mandant" ohne Bedingung schreiben, kaeme
   * trotzdem nur der eigene Mandant zurueck. Genau das ist der Punkt.
   */
  async findEigenenMandanten() {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<MandantZeile>(
        'SELECT id, name, slug, akzentfarbe, dunkel_grundfarbe AS "dunkelGrundfarbe" FROM mandant'
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Setzt Akzentfarbe und/oder dunkle Grundfarbe -- beide sind dieselbe
   * traegerweite Branding-Entscheidung, nur zwei unabhaengige Werte davon
   * (siehe migrations/0019 und 0029: die dunkle Grundfarbe folgte bis dahin
   * ungewollt dem Farbton des Akzents).
   *
   * Die SET-Liste besteht ausschliesslich aus zwei fest verdrahteten
   * Spaltennamen, nie aus Nutzereingaben -- kein SQL-Injection-Risiko, nur
   * ein optionales Feld je Aufruf.
   */
  async aktualisiereErscheinungsbild(patch: ErscheinungsbildPatch) {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_BRANDING.has(ctx.rolle)) {
      throw new ForbiddenException("Nur die Bereichsleitung darf das Erscheinungsbild des Trägers ändern.");
    }

    const setzt: string[] = [];
    const werte: string[] = [];
    if (patch.akzentfarbe !== undefined) {
      werte.push(patch.akzentfarbe);
      setzt.push(`akzentfarbe = $${werte.length}`);
    }
    if (patch.dunkelGrundfarbe !== undefined) {
      werte.push(patch.dunkelGrundfarbe);
      setzt.push(`dunkel_grundfarbe = $${werte.length}`);
    }

    return this.db.withTenant(async (client) => {
      // Weiterhin bewusst kein WHERE id = ... -- RLS laesst genau eine Zeile
      // durch. Dass hier ausserdem nur die BEIDEN Branding-Spalten
      // betroffen sein KOENNEN, erzwingt nicht dieser SQL-Text, sondern die
      // spaltenscharfen GRANTs aus Migration 0019/0029: ein UPDATE auf slug
      // oder name scheitert dort an "permission denied", egal was hier
      // steht.
      const { rows } = await client.query<MandantZeile>(
        `UPDATE mandant SET ${setzt.join(", ")}
         RETURNING id, name, slug, akzentfarbe, dunkel_grundfarbe AS "dunkelGrundfarbe"`,
        werte
      );
      return rows[0] ?? null;
    });
  }
}
