import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { neuerResetToken, resetTokenHash } from "../common/reset-token";

// 30 Minuten: lang genug, um den Link auf einem beliebigen Weg (Teams,
// muendlich, ...) weiterzugeben, kurz genug, dass ein liegengelassener,
// nicht eingeloester Link kein dauerhaftes Risiko bleibt.
const RESET_GUELTIGKEIT_MINUTEN = 30;

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

  /**
   * "Passwort vergessen" ohne E-Mail-Versand: die Leitung stoesst das hier
   * an, bekommt aber nur den ROHEN, einmaligen Link zurueck -- der wird
   * nirgends gespeichert oder geloggt, nur dieser eine Rueckgabewert traegt
   * ihn. Die betroffene Person oeffnet den Link und vergibt ihr Passwort
   * SELBST (siehe auth.service.ts::passwortZuruecksetzenEinloesen); die
   * Leitung erfaehrt es zu keinem Zeitpunkt.
   */
  async passwortResetErstellen(zielBenutzerId: string): Promise<{ token: string; laeuftAbAm: string }> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_BENUTZER_ANLEGEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur die Leitung darf Passwort-Reset-Links erzeugen.");
    }

    const token = neuerResetToken();
    return this.db.withTenant(async (client) => {
      const { rows: zielRows } = await client.query("SELECT id FROM benutzer WHERE id = $1", [zielBenutzerId]);
      if (zielRows.length === 0) {
        // RLS liefert hier bereits null Zeilen fuer einen fremden Mandanten
        // -- "nicht gefunden" ist in beiden Faellen (existiert nicht /
        // gehoert zu einem anderen Mandanten) die richtige, nichts
        // preisgebende Antwort.
        throw new NotFoundException("Mitarbeiter:in nicht gefunden.");
      }

      // Ein vorheriger, noch offener Link fuer dieselbe Person wird
      // entwertet -- sonst koennten mehrere gleichzeitig gueltige Links im
      // Umlauf sein, und niemand wüsste mehr, welcher der aktuelle ist.
      await client.query(
        "UPDATE benutzer_reset_token SET eingeloest_am = now() WHERE benutzer_id = $1 AND eingeloest_am IS NULL",
        [zielBenutzerId]
      );

      const { rows } = await client.query<{ laeuft_ab_am: string }>(
        `INSERT INTO benutzer_reset_token (mandant_id, benutzer_id, token_hash, erstellt_von, laeuft_ab_am)
         VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
         RETURNING laeuft_ab_am`,
        [ctx.mandantId, zielBenutzerId, resetTokenHash(token), ctx.benutzerId, RESET_GUELTIGKEIT_MINUTEN]
      );

      return { token, laeuftAbAm: rows[0].laeuft_ab_am };
    });
  }
}
