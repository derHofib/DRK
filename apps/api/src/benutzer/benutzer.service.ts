import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";

export interface BenutzerListEintrag {
  id: string;
  email: string;
  name: string;
  rolle: string;
  aktiv: boolean;
}

// SQLSTATE fuer eine verletzte UNIQUE-Constraint (benutzer_mandant_id_email_key,
// siehe migrations/0004_benutzer.sql) -- kein geratener String, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

// Mitarbeiter anlegen ist bislang ausschliesslich der Leitung vorbehalten --
// dieselbe Rolle, die auch das Traegerbranding aendern darf (siehe
// ROLLEN_MIT_BRANDING in mandant.service.ts). Sobald die geplante
// Fuehrungshierarchie (Mitarbeiter/Leiter/Bereichsleiter) steht, wird das
// hier um Leiter/Bereichsleiter erweitert -- bis dahin bewusst die engste
// Fassung, damit niemand ueber diesen Weg sich selbst oder andere zur
// Leitung machen kann.
const ROLLEN_MIT_BENUTZER_ANLEGEN = new Set<BenutzerRolle>(["leitung"]);

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

  async anlegen(input: { name: string; email: string; rolle: BenutzerRolle; passwort: string }) {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_BENUTZER_ANLEGEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur die Leitung darf neue Mitarbeitende anlegen.");
    }

    const passwortHash = await bcrypt.hash(input.passwort, 10);
    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, name, rolle, aktiv`,
          [ctx.mandantId, input.email, input.name, passwortHash, input.rolle]
        );
        return rows[0];
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Diese E-Mail-Adresse ist in diesem Mandanten bereits vergeben.");
      }
      throw err;
    }
  }
}
