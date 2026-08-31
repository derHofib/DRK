import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { neuerResetToken, resetTokenHash } from "../common/reset-token";
import { isPgError } from "../common/pg-error";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";

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
  standortIds: string[];
}

// SQLSTATE fuer eine verletzte UNIQUE-Constraint (benutzer_mandant_id_email_key,
// siehe migrations/0004_benutzer.sql) -- kein geratener String, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";

// Bereichsleitung darf traegerweit Mitarbeiter anlegen, Einrichtungsleitung
// fuer die eigene Einrichtung (siehe Standort-Einschraenkung ueber
// benutzer_standort -- diese Methode selbst kennt "eigene Einrichtung"
// nicht extra, RLS plus die optionale Standort-Zuordnung reichen). Betreuer
// bewusst aussen vor, sonst koennte sich jede Mitarbeiterin selbst oder
// andere hochstufen.
const ROLLEN_MIT_BENUTZER_ANLEGEN = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

// Wer einem Betreuer Standorte zuweisen darf: dasselbe Rollenpaar wie beim
// Anlegen. Die Einrichtungsleitung ist dabei zusaetzlich (siehe
// standorteSetzen()) auf ihre EIGENEN erlaubten Standorte begrenzt --
// anders als beim Anlegen, wo sie traegerweit keine Grenze hat, weil dort
// jede neue Person ohnehin zunaechst unbeschraenkt ist.
const ROLLEN_MIT_STANDORT_ZUWEISEN = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

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
      const { rows } = await client.query<{
        id: string;
        email: string;
        name: string;
        rolle: string;
        aktiv: boolean;
        standort_ids: string[];
      }>(
        `SELECT b.id, b.email, b.name, b.rolle, b.aktiv,
                COALESCE(array_agg(bs.standort_id) FILTER (WHERE bs.standort_id IS NOT NULL), '{}') AS standort_ids
         FROM benutzer b
         LEFT JOIN benutzer_standort bs ON bs.benutzer_id = b.id
         GROUP BY b.id, b.email, b.name, b.rolle, b.aktiv
         ORDER BY b.name`
      );
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        rolle: r.rolle,
        aktiv: r.aktiv,
        standortIds: r.standort_ids,
      }));
    });
  }

  async anlegen(input: { name: string; email: string; rolle: BenutzerRolle; passwort: string }) {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_BENUTZER_ANLEGEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen neue Mitarbeitende anlegen.");
    }
    // Sonst koennte eine Einrichtungsleitung ueber diesen Weg jemanden (oder
    // sich selbst mit einem Zweitaccount) zur Bereichsleitung befoerdern --
    // genau die Eskalation, vor der die Rollenpruefung oben schuetzen soll.
    if (ctx.rolle === "einrichtungsleitung" && input.rolle === "bereichsleitung") {
      throw new ForbiddenException("Einrichtungsleitung darf niemanden zur Bereichsleitung machen.");
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
   * "Passwort vergessen" ohne E-Mail-Versand: Bereichs- oder
   * Einrichtungsleitung stoesst das hier an, bekommt aber nur den ROHEN,
   * einmaligen Link zurueck -- der wird nirgends gespeichert oder geloggt,
   * nur dieser eine Rueckgabewert traegt ihn. Die betroffene Person oeffnet
   * den Link und vergibt ihr Passwort SELBST (siehe
   * auth.service.ts::passwortZuruecksetzenEinloesen); die Leitung erfaehrt
   * es zu keinem Zeitpunkt.
   */
  async passwortResetErstellen(zielBenutzerId: string): Promise<{ token: string; laeuftAbAm: string }> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_BENUTZER_ANLEGEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Passwort-Reset-Links erzeugen.");
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
   * Eine leere Liste ist ausdruecklich erlaubt: sie hebt jede Einschraenkung
   * wieder auf (siehe common/standort-restriction.ts, "keine Zeile = keine
   * Einschraenkung").
   */
  async standorteSetzen(zielBenutzerId: string, standortIds: string[]): Promise<string[]> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_STANDORT_ZUWEISEN.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen Standorte zuweisen.");
    }
    const eindeutigeIds = [...new Set(standortIds)];

    return this.db.withTenant(async (client) => {
      const { rows: zielRows } = await client.query<{ rolle: BenutzerRolle }>(
        "SELECT rolle FROM benutzer WHERE id = $1",
        [zielBenutzerId]
      );
      if (zielRows.length === 0) {
        throw new NotFoundException("Mitarbeiter:in nicht gefunden.");
      }

      // Eine Einrichtungsleitung verwaltet ausschliesslich Betreuer:innen
      // (nie andere Leitung -- sonst koennte sie sich selbst oder eine
      // Kollegin standortmaessig einschraenken oder befreien) und nur
      // innerhalb ihrer eigenen Standorte, nie darueber hinaus.
      if (ctx.rolle === "einrichtungsleitung") {
        if (zielRows[0].rolle !== "betreuer") {
          throw new ForbiddenException("Einrichtungsleitung darf nur Betreuer:innen Standorte zuweisen.");
        }
        const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
        if (erlaubteStandorte && eindeutigeIds.some((id) => !erlaubteStandorte.includes(id))) {
          throw new ForbiddenException("Einrichtungsleitung darf nur die eigenen Standorte zuweisen.");
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
