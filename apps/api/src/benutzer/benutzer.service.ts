import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { neuerResetToken, resetTokenHash } from "../common/reset-token";
import { isPgError } from "../common/pg-error";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";
import { RechteService } from "../rechte/rechte.service";

// 30 Minuten: lang genug, um den Link auf einem beliebigen Weg (Teams,
// muendlich, ...) weiterzugeben, kurz genug, dass ein liegengelassener,
// nicht eingeloester Link kein dauerhaftes Risiko bleibt.
const RESET_GUELTIGKEIT_MINUTEN = 30;

export interface BenutzerListEintrag {
  id: string;
  email: string;
  name: string;
  // Ersetzt die frueher feste "rolle" -- Rechte haengen seit der
  // Entwickler-Accounttyp-Umstellung ausschliesslich an Organigramm-
  // Positionen. Leer = (noch) keine Position zugewiesen, also keine Rechte.
  positionen: { titel: string; accountTypName: string }[];
  aktiv: boolean;
  standortIds: string[];
}

// SQLSTATE fuer eine verletzte UNIQUE-Constraint (benutzer_mandant_id_email_key,
// siehe migrations/0004_benutzer.sql) -- kein geratener String, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

@Injectable()
export class BenutzerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  /**
   * Absichtlich ohne "WHERE mandant_id = ..." -- das ist der ganze Punkt
   * von RLS. Der Mandanten-Trennungstest (test/mandanten-trennung.e2e-spec.ts)
   * prueft genau das: ruft diese Methode unter zwei verschiedenen
   * Tenant-Kontexten auf und erwartet zwei disjunkte Ergebnismengen.
   */
  async findeAlleImEigenenMandanten(): Promise<BenutzerListEintrag[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{
        id: string;
        email: string;
        name: string;
        aktiv: boolean;
        standort_ids: string[];
        positionen: { titel: string; accountTypName: string }[];
      }>(
        `SELECT b.id, b.email, b.name, b.aktiv,
                COALESCE(array_agg(bs.standort_id) FILTER (WHERE bs.standort_id IS NOT NULL), '{}') AS standort_ids,
                COALESCE(
                  json_agg(DISTINCT jsonb_build_object('titel', p.titel, 'accountTypName', a.name))
                    FILTER (WHERE p.id IS NOT NULL),
                  '[]'
                ) AS positionen
         FROM benutzer b
         LEFT JOIN benutzer_standort bs ON bs.benutzer_id = b.id
         LEFT JOIN org_position_besetzung pb ON pb.benutzer_id = b.id
                AND pb.gueltig_ab <= CURRENT_DATE
                AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
         LEFT JOIN org_position p ON p.id = pb.position_id AND p.aktiv
         LEFT JOIN account_typ a ON a.id = p.account_typ_id
         GROUP BY b.id, b.email, b.name, b.aktiv
         ORDER BY b.name`
      );
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        aktiv: r.aktiv,
        standortIds: r.standort_ids,
        positionen: r.positionen,
      }));
    });
  }

  // Das Anlegen selbst vergibt keine Rechte mehr (siehe Entwickler-
  // Accounttyp-Umstellung) -- ein frischer Benutzer hat null Rechte, bis
  // jemand mit organigramm.manage-permissions ihn auf eine Position setzt
  // (siehe organigramm.service.ts::besetzen(), dort sitzt der eigentliche
  // Eskalationsschutz). Hier reicht deshalb das breite mitarbeitende.anlegen.
  async anlegen(input: { name: string; email: string; passwort: string }) {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("mitarbeitende", "anlegen"))) {
      throw new ForbiddenException("Keine Berechtigung, neue Mitarbeitende anzulegen.");
    }

    const passwortHash = await bcrypt.hash(input.passwort, 10);
    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO benutzer (mandant_id, email, name, passwort_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, name, aktiv`,
          [ctx.mandantId, input.email, input.name, passwortHash]
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
   * "Passwort vergessen" ohne E-Mail-Versand: eine berechtigte Person stoesst
   * das hier an, bekommt aber nur den ROHEN, einmaligen Link zurueck -- der
   * wird nirgends gespeichert oder geloggt, nur dieser eine Rueckgabewert
   * traegt ihn. Die betroffene Person oeffnet den Link und vergibt ihr
   * Passwort SELBST (siehe auth.service.ts::passwortZuruecksetzenEinloesen);
   * die Leitung erfaehrt es zu keinem Zeitpunkt.
   */
  async passwortResetErstellen(zielBenutzerId: string): Promise<{ token: string; laeuftAbAm: string }> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("mitarbeitende", "anlegen"))) {
      throw new ForbiddenException("Keine Berechtigung, Passwort-Reset-Links zu erzeugen.");
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

  /**
   * Ersetzt die komplette Standort-Zuordnung einer Person (siehe
   * benutzer_standort, migrations/0007). Bewusst als "setzen", nicht
   * "hinzufuegen/entfernen" -- das Frontend zeigt eine Checkbox-Liste, ein
   * voller Ersatz ist da einfacher richtig zu bekommen als ein Diff.
   *
   * Eine leere Liste ist grundsaetzlich erlaubt: sie hebt jede Einschraenkung
   * wieder auf (siehe common/standort-restriction.ts, "keine Zeile = keine
   * Einschraenkung"). Fuer eine selbst UNbeschraenkte Person ist das gewollt
   * (traegerweite Sicht ist ihr Normalfall). Fuer eine selbst
   * standortbeschraenkte Person waere es dagegen eine stille Eskalation --
   * sie duerfte jemanden damit ausserhalb ihrer eigenen Standorte
   * befoerdern, siehe die eigene Pruefung weiter unten. Seit der Entwickler-
   * Accounttyp-Umstellung gibt es keine feste "Einrichtungsleitung" mehr,
   * die das abgrenzt -- stattdessen entscheidet, ob die AGIERENDE Person
   * selbst ueber benutzer_standort eingeschraenkt ist.
   */
  async standorteSetzen(zielBenutzerId: string, standortIds: string[]): Promise<string[]> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("mitarbeitende", "standort-zuweisen"))) {
      throw new ForbiddenException("Keine Berechtigung, Standorte zuzuweisen.");
    }
    const eindeutigeIds = [...new Set(standortIds)];

    return this.db.withTenant(async (client) => {
      const { rows: zielRows } = await client.query("SELECT id FROM benutzer WHERE id = $1", [zielBenutzerId]);
      if (zielRows.length === 0) {
        throw new NotFoundException("Mitarbeiter:in nicht gefunden.");
      }

      // Eine standortbeschraenkte Person verwaltet nie einen Vollzugriff-
      // Account (sonst koennte sie sich selbst oder eine Vollzugriff-Person
      // standortmaessig einschraenken oder befreien) und nur innerhalb ihrer
      // eigenen Standorte, nie darueber hinaus -- direkte Entsprechung zum
      // Vollzugriff-Schutz in organigramm.service.ts::besetzen().
      const eigeneBeschraenkung = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      if (eigeneBeschraenkung) {
        if (await this.rechte.istVollzugriff(client, zielBenutzerId)) {
          throw new ForbiddenException("Eine standortbeschränkte Person darf keinem Vollzugriff-Account Standorte zuweisen.");
        }
        // Eine leere Liste hebt laut Klassenkommentar oben JEDE Einschraenkung
        // auf ("keine Zeile = keine Einschraenkung") -- fuer eine selbst
        // unbeschraenkte Person ist das gewollt, fuer eine standortbeschraenkte
        // Person waere es eine stille Eskalation: sie koennte jemanden, den
        // sie nur innerhalb der eigenen Standorte verwalten darf, zum
        // traegerweiten Springer machen. Die Pruefung unten
        // (eindeutigeIds.some(...)) greift bei einem LEEREN Array nicht --
        // deshalb ein eigener, vorgezogener Check.
        if (eindeutigeIds.length === 0) {
          throw new ForbiddenException(
            "Eine standortbeschränkte Person darf die Standort-Einschränkung nicht vollständig aufheben."
          );
        }
        if (eindeutigeIds.some((id) => !eigeneBeschraenkung.includes(id))) {
          throw new ForbiddenException("Eine standortbeschränkte Person darf nur die eigenen Standorte zuweisen.");
        }
      }

      if (eindeutigeIds.length > 0) {
        const { rows: standortRows } = await client.query("SELECT id FROM standort WHERE id = ANY($1)", [
          eindeutigeIds,
        ]);
        if (standortRows.length !== eindeutigeIds.length) {
          throw new NotFoundException("Mindestens ein Standort wurde nicht gefunden.");
        }
      }

      await client.query("DELETE FROM benutzer_standort WHERE benutzer_id = $1", [zielBenutzerId]);
      for (const standortId of eindeutigeIds) {
        await client.query(
          "INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)",
          [ctx.mandantId, zielBenutzerId, standortId]
        );
      }
      return eindeutigeIds;
    });
  }
}
