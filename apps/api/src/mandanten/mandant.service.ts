import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

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
      const { rows } = await client.query<{ id: string; name: string; slug: string }>(
        "SELECT id, name, slug FROM mandant"
      );
      return rows[0] ?? null;
    });
  }
}
