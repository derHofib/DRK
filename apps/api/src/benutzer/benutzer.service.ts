import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface BenutzerListEintrag {
  id: string;
  email: string;
  name: string;
  rolle: string;
  aktiv: boolean;
}

@Injectable()
export class BenutzerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Absichtlich ohne "WHERE mandant_id = ..." -- das ist der ganze Punkt
   * von RLS. Der Mandanten-Trennungstest (test/mandanten-trennung.e2e-spec.ts)
   * prueft genau das: ruft diese Methode unter zwei verschiedenen
   * Tenant-Kontexten auf und erwartet zwei disjunkte Ergebnismengen.
   */
  async findeAlleImEigenenMandanten(): Promise<BenutzerListEintrag[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<BenutzerListEintrag>(
        "SELECT id, email, name, rolle, aktiv FROM benutzer ORDER BY name"
      );
      return rows;
    });
  }
}
