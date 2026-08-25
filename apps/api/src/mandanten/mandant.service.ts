import { ForbiddenException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";

interface MandantZeile {
  id: string;
  name: string;
  slug: string;
  akzentfarbe: string;
}

/**
 * Das Erscheinungsbild des Trägers ist eine Trägerentscheidung, keine
 * Nutzereinstellung -- sie gilt für alle Mitarbeitenden gleichzeitig.
 * Deshalb nur die Leitung, nach demselben Muster wie
 * ROLLEN_MIT_VOLLEM_VERLAUF in zimmer.service.ts.
 *
 * Die persönliche Anzeigepräferenz hell/dunkel ist bewusst NICHT hier --
 * die liegt im localStorage des Browsers und geht die Datenbank nichts an.
 */
const ROLLEN_MIT_BRANDING = new Set<BenutzerRolle>(["leitung"]);

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
        "SELECT id, name, slug, akzentfarbe FROM mandant"
      );
      return rows[0] ?? null;
    });
  }

  async setzeAkzentfarbe(akzentfarbe: string) {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_BRANDING.has(ctx.rolle)) {
      throw new ForbiddenException("Nur die Leitung darf das Erscheinungsbild des Trägers ändern.");
    }

    return this.db.withTenant(async (client) => {
      // Weiterhin bewusst kein WHERE id = ... -- RLS laesst genau eine Zeile
      // durch. Dass hier ausserdem nur EINE Spalte betroffen sein KANN,
      // erzwingt nicht dieser SQL-Text, sondern das spaltenscharfe
      // GRANT UPDATE (akzentfarbe) aus Migration 0019: ein UPDATE auf slug
      // oder name scheitert dort an "permission denied", egal was hier
      // steht.
      const { rows } = await client.query<MandantZeile>(
        "UPDATE mandant SET akzentfarbe = $1 RETURNING id, name, slug, akzentfarbe",
        [akzentfarbe]
      );
      return rows[0] ?? null;
    });
  }
}
