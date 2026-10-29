import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { neuerResetToken, resetTokenHash } from "../common/reset-token";
import { isPgError } from "../common/pg-error";
import { ermittleErlaubteStandortIds } from "../common/standort-restriction";
import { RechteService } from "../rechte/rechte.service";
import { AuditService } from "../audit/audit.service";

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
  positionen: { positionId: string; titel: string; accountTypName: string }[];
  aktiv: boolean;
  standortIds: string[];
  einheitIds: string[];
}

// SQLSTATE fuer eine verletzte UNIQUE-Constraint (benutzer_mandant_id_email_key,
// siehe migrations/0004_benutzer.sql) -- kein geratener String, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = "23505";
// RAISE EXCEPTION ohne eigenen SQLSTATE (benutzer_vollzugriff_schutz, 0050).
const RAISE_EXCEPTION = "P0001";

// Dieselbe Position (z. B. "Mitarbeiter") gibt es je Organisationseinheit,
// und wer in mehreren Einheiten sitzt, hat mehrere Besetzungen davon. Fuer
// die Anzeige zaehlt der Rang, nicht die Einheit -- die Rechte haengen am
// Accounttyp, die Einheiten-/Standortzuordnung steht in der Standortspalte.
function eindeutigePositionen<T extends { titel: string; accountTypName: string }>(liste: T[]): T[] {
  const gesehen = new Set<string>();
  return liste.filter((p) => {
    const schluessel = `${p.accountTypName}\u0000${p.titel}`;
    if (gesehen.has(schluessel)) return false;
    gesehen.add(schluessel);
    return true;
  });
}

@Injectable()
export class BenutzerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly audit: AuditService
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
        positionen: { positionId: string; titel: string; accountTypName: string }[];
      }>(
        `SELECT b.id, b.email, b.name, b.aktiv,
                COALESCE(array_agg(DISTINCT bs.standort_id) FILTER (WHERE bs.standort_id IS NOT NULL), '{}') AS standort_ids,
                COALESCE(
                  json_agg(DISTINCT jsonb_build_object('positionId', p.id, 'titel', p.titel, 'accountTypName', a.name))
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
      // Wo die Person laut Rang arbeitet: Heimat-Einheit, weitere Einheiten und
      // Einheiten der Besetzung ihrer aktuellen Linienpositionen (ein
      // Sammelrang zaehlt seine Heimat-Einheit nicht, Migration 0067).
      const { rows: einheiten } = await client.query<{ benutzer_id: string; einheit_ids: string[] }>(
        `SELECT pb.benutzer_id, array_agg(DISTINCT u.id) AS einheit_ids
         FROM org_position_besetzung pb
         JOIN org_position p ON p.id = pb.position_id AND p.aktiv AND p.typ = 'linie'
         CROSS JOIN LATERAL (
           SELECT p.org_unit_id AS id WHERE NOT p.ist_sammelrang
           UNION
           SELECT w.org_unit_id FROM org_position_weitere_einheit w WHERE w.position_id = p.id
           UNION
           SELECT e.org_unit_id FROM org_position_besetzung_einheit e WHERE e.besetzung_id = pb.id
         ) x
         JOIN org_unit u ON u.id = x.id AND u.typ = 'einrichtung'
         WHERE pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
         GROUP BY pb.benutzer_id`
      );
      const einheitenJeBenutzer = new Map(einheiten.map((e) => [e.benutzer_id, e.einheit_ids]));
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        aktiv: r.aktiv,
        standortIds: r.standort_ids,
        einheitIds: einheitenJeBenutzer.get(r.id) ?? [],
        positionen: eindeutigePositionen(r.positionen),
      }));
    });
  }

  /**
   * Das eigene Konto, im Format der Liste. Filtert die Liste statt eine
   * zweite Abfrage zu pflegen: so koennen Name und Positionen hier nie
   * anders aussehen als in der Mitarbeitendenliste.
   */
  async findeEigenes(): Promise<BenutzerListEintrag> {
    const ctx = requireTenantContext();
    const eigenes = (await this.findeAlleImEigenenMandanten()).find((b) => b.id === ctx.benutzerId);
    if (!eigenes) throw new NotFoundException("Konto nicht gefunden.");
    return eigenes;
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

  /**
   * "Entfernen" einer Person = Deaktivieren (siehe
   * migrations/0050_benutzer_deaktivieren.sql), und genauso rueckgaengig
   * machbar. Drei Schutzregeln, alle serverseitig:
   *  - nicht sich selbst (sonst sperrt sich die einzige berechtigte Person
   *    versehentlich aus),
   *  - ein Vollzugriff-Account nur mit organigramm.manage-permissions -- das
   *    breite mitarbeitende.deaktivieren allein reicht nicht, sonst waere es
   *    ein Weg, die hoechsten Konten auszuschalten (Entsprechung zu
   *    organigramm.service.ts::besetzen()),
   *  - der letzte aktive Vollzugriff bleibt bestehen -- das erzwingt der
   *    Datenbank-Trigger benutzer_vollzugriff_schutz, nicht dieser Code.
   */
  async aktivSetzen(zielBenutzerId: string, aktiv: boolean): Promise<{ id: string; aktiv: boolean }> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("mitarbeitende", "deaktivieren"))) {
      throw new ForbiddenException("Keine Berechtigung, Mitarbeitende zu deaktivieren oder zu reaktivieren.");
    }
    if (zielBenutzerId === ctx.benutzerId) {
      throw new ForbiddenException("Das eigene Konto kann nicht selbst deaktiviert werden.");
    }

    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query<{ aktiv: boolean }>("SELECT aktiv FROM benutzer WHERE id = $1", [
          zielBenutzerId,
        ]);
        if (rows.length === 0) {
          throw new NotFoundException("Mitarbeiter:in nicht gefunden.");
        }
        const vorher = rows[0].aktiv;

        if (await this.rechte.istVollzugriff(client, zielBenutzerId)) {
          if (!(await this.rechte.hatRecht("organigramm", "manage-permissions"))) {
            throw new ForbiddenException(
              "Ein Vollzugriff-Account lässt sich nur mit dem Recht „Rechte verwalten“ deaktivieren oder reaktivieren."
            );
          }
        }

        if (vorher !== aktiv) {
          await client.query("UPDATE benutzer SET aktiv = $1 WHERE id = $2", [aktiv, zielBenutzerId]);
          await this.audit.protokollieren(client, {
            modul: "mitarbeitende",
            aktion: aktiv ? "reaktivieren" : "deaktivieren",
            objektTyp: "benutzer",
            objektId: zielBenutzerId,
            vorher: { aktiv: vorher },
            nachher: { aktiv },
          });
        }
        return { id: zielBenutzerId, aktiv };
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(
          "Mindestens ein aktiver Account mit Vollzugriff muss bestehen bleiben — dieser hier ist der letzte."
        );
      }
      throw err;
    }
  }

  /**
   * "Rang aendern": ersetzt alle laufenden und geplanten Besetzungen einer
   * Person durch genau eine Position (oder durch keine, positionId = null).
   * Rechte haengen ausschliesslich an Besetzungen, ein Rangwechsel ist also
   * Rechteverwaltung und braucht deshalb dasselbe enge
   * organigramm.manage-permissions wie das Setzen auf eine Vollzugriff-
   * Position in organigramm.service.ts::besetzen() -- das breite
   * organigramm.bearbeiten waere ein Weg, sich selbst Vollzugriff zu geben.
   * Praktisch hat es nur die Geschaeftsfuehrung (Vollzugriff-Wildcard).
   *
   * Schutzregeln:
   *  - nicht der eigene Rang: sonst stuft sich die Geschaeftsfuehrung
   *    versehentlich selbst herab und kommt nicht mehr zurueck,
   *  - die letzte aktive Geschaeftsfuehrung bleibt -- erzwingt der Trigger
   *    org_position_besetzung_vollzugriff_schutz (0042/0050), nicht dieser
   *    Code. Deshalb wird ERST die neue Besetzung angelegt und DANN die alte
   *    beendet: andersherum wuerde der Trigger schon einen Wechsel von einer
   *    Vollzugriff-Position auf eine andere als "letzter weg" ablehnen.
   *
   * Beendet wird mit gueltig_bis = gestern (bzw. dem Tag vor einem spaeteren
   * Beginn), damit der Wechsel sofort gilt -- siehe Migration 0065.
   */
  async positionWechseln(
    zielBenutzerId: string,
    positionIdEingabe: string | null,
    accountTypId?: string,
    einheitIdsEingabe?: string[]
  ): Promise<{ id: string; positionen: BenutzerListEintrag["positionen"] }> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("organigramm", "manage-permissions"))) {
      throw new ForbiddenException("Den Rang anderer Mitarbeitender darf nur die Geschäftsführung ändern.");
    }
    if (zielBenutzerId === ctx.benutzerId) {
      throw new ForbiddenException("Der eigene Rang kann nicht selbst geändert werden.");
    }

    try {
      return await this.db.withTenant(async (client) => {
        const { rows: zielRows } = await client.query("SELECT id FROM benutzer WHERE id = $1", [zielBenutzerId]);
        if (zielRows.length === 0) throw new NotFoundException("Mitarbeiter:in nicht gefunden.");

        // Ein Rang ist der Account-Typ, nicht eine schon vorhandene Position:
        // sonst waeren selbst angelegte Typen ohne Position nicht waehlbar.
        let positionId = positionIdEingabe;
        // Standorte nur mit gewaehltem Typ und nicht fuer Vollzugriff: dessen
        // Rechte gelten ohnehin fuer den ganzen Mandanten.
        let einheitIds = einheitIdsEingabe === undefined ? undefined : [...new Set(einheitIdsEingabe)];
        if (accountTypId !== undefined) {
          const ziel = await this.positionFuerAccountTyp(client, accountTypId, ctx.mandantId, ctx.benutzerId, einheitIds !== undefined);
          positionId = ziel.id;
          if (ziel.istVollzugriff) einheitIds = undefined;
        } else {
          einheitIds = undefined;
        }
        if (einheitIds !== undefined && einheitIds.length > 0) {
          const { rows: gueltig } = await client.query(
            "SELECT 1 FROM org_unit WHERE id = ANY($1) AND typ = 'einrichtung'",
            [einheitIds]
          );
          if (gueltig.length !== einheitIds.length) {
            throw new BadRequestException("Mindestens ein gewählter Standort ist keine Einrichtung dieses Mandanten.");
          }
        }

        if (positionId !== null) {
          const { rows: posRows } = await client.query<{ aktiv: boolean }>(
            "SELECT aktiv FROM org_position WHERE id = $1",
            [positionId]
          );
          if (posRows.length === 0) throw new NotFoundException("Position nicht gefunden.");
          if (!posRows[0].aktiv) throw new ConflictException("Diese Position ist deaktiviert.");
        }

        const vorher = await this.ladePositionen(client, zielBenutzerId);

        // Offen = laeuft heute oder beginnt spaeter. Eine schon in der
        // Zukunft geplante Besetzung zaehlt mit -- sonst kaeme der alte Rang
        // an ihrem Startdatum still zurueck.
        // "laeuft" kommt aus SQL statt aus einem JS-Datum: CURRENT_DATE der
        // Datenbank ist dieselbe Uhr, die auch die Rechte-Engine benutzt.
        const { rows: offen } = await client.query<{ id: string; position_id: string; laeuft: boolean; rang: string }>(
          `SELECT pb.id, pb.position_id, pb.gueltig_ab <= CURRENT_DATE AS laeuft,
                  p.account_typ_id::text || ':' || p.titel AS rang
           FROM org_position_besetzung pb JOIN org_position p ON p.id = pb.position_id
           WHERE pb.benutzer_id = $1 AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)`,
          [zielBenutzerId]
        );
        // Derselbe Rang in einer anderen Einheit ist kein Wechsel: das
        // Dropdown zeigt jeden Rang nur einmal, die gewaehlte ID ist nur der
        // Vertreter -- sonst wuerde eine Person mit "Mitarbeiter" in sechs
        // Einheiten beim Speichern auf eine einzige zusammenschrumpfen.
        const zielRang = positionId === null ? null : await this.rangVon(client, positionId);
        // Mit Standorten zaehlt nur die EXAKTE Position: ein gleichnamiger Rang
        // in einer Einrichtung wird dann durch die Sammelposition ersetzt.
        const mitStandorten = einheitIds !== undefined;
        const behalten = offen.find(
          (b) => b.laeuft && (b.position_id === positionId || (!mitStandorten && b.rang === zielRang))
        );

        const beenden = offen
          .filter((b) => b !== behalten && (mitStandorten || !(zielRang !== null && b.rang === zielRang && b.laeuft)))
          .map((b) => b.id);
        let besetzungId = behalten?.id ?? null;
        if (positionId !== null && !behalten) {
          const { rows: neu } = await client.query<{ id: string }>(
            `INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id, erstellt_von)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [ctx.mandantId, positionId, zielBenutzerId, ctx.benutzerId]
          );
          besetzungId = neu[0].id;
          // Die Standorte der Person ziehen mit um: ihre bisherigen Positionen
          // waren ihr Standortzugang (je Einheit eine Position). Ohne
          // Uebernahme haette sie nach dem Rangwechsel nur noch den Anker der
          // neuen Position und still fuenf Standorte verloren.
          if (beenden.length > 0 && !mitStandorten) {
            await client.query(
              `INSERT INTO org_position_besetzung_einheit (mandant_id, besetzung_id, org_unit_id)
               SELECT $1, $2, u.id
               FROM (
                 SELECT p.org_unit_id AS id
                   FROM org_position_besetzung b JOIN org_position p ON p.id = b.position_id
                  WHERE b.id = ANY($3) AND p.typ = 'linie'
                 UNION
                 SELECT w.org_unit_id
                   FROM org_position_besetzung b JOIN org_position_weitere_einheit w ON w.position_id = b.position_id
                  WHERE b.id = ANY($3)
                 UNION
                 SELECT e.org_unit_id FROM org_position_besetzung_einheit e WHERE e.besetzung_id = ANY($3)
               ) u
               WHERE u.id <> (SELECT org_unit_id FROM org_position WHERE id = $4)
                 AND (SELECT typ FROM org_position WHERE id = $4) = 'linie'`,
              [ctx.mandantId, neu[0].id, beenden, positionId]
            );
          }
        }
        if (beenden.length > 0) {
          await client.query(
            `UPDATE org_position_besetzung SET gueltig_bis = GREATEST(gueltig_ab, CURRENT_DATE) - 1
             WHERE id = ANY($1)`,
            [beenden]
          );
        }
        if (mitStandorten && besetzungId !== null) {
          // Ersetzen statt ergaenzen: der Dialog zeigt den vollen Stand, was
          // dort abgewaehlt wurde, soll auch wirklich weg sein.
          await client.query("DELETE FROM org_position_besetzung_einheit WHERE besetzung_id = $1", [besetzungId]);
          if (einheitIds!.length > 0) {
            await client.query(
              `INSERT INTO org_position_besetzung_einheit (mandant_id, besetzung_id, org_unit_id)
               SELECT $1, $2, unnest($3::uuid[])`,
              [ctx.mandantId, besetzungId, einheitIds]
            );
          }
        }

        const nachher = await this.ladePositionen(client, zielBenutzerId);
        if ((positionId !== null && !behalten) || beenden.length > 0 || mitStandorten) {
          await this.audit.protokollieren(client, {
            modul: "mitarbeitende",
            aktion: "rang-aendern",
            objektTyp: "benutzer",
            objektId: zielBenutzerId,
            vorher: { positionen: vorher },
            nachher: { positionen: nachher, ...(mitStandorten ? { standortIds: einheitIds } : {}) },
          });
        }
        return { id: zielBenutzerId, positionen: nachher };
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(
          "Mindestens eine aktive Geschäftsführung (Vollzugriff) muss bestehen bleiben — das ist die letzte."
        );
      }
      throw err;
    }
  }

  /**
   * Die Position fuer einen Rang (Account-Typ). Bevorzugt den Sammelrang
   * (Migration 0067: eine Position fuer alle, Standorte an der Besetzung),
   * dann eine vorhandene aktive Linienposition; mitStandorten verlangt
   * zwingend einen Sammelrang. Fehlt er, wird er an der Traeger-Wurzel
   * angelegt, ohne feste Sollzahl. Die Wurzel ist als Heimat-Einheit nur
   * Platzhalter und zaehlt bei einem Sammelrang nicht als Rechte-Anker
   * (fail closed: ohne Standort kein einheitsbezogener Zugriff).
   */
  private async positionFuerAccountTyp(
    client: PoolClient,
    accountTypId: string,
    mandantId: string,
    benutzerId: string,
    mitStandorten: boolean
  ): Promise<{ id: string; istVollzugriff: boolean }> {
    const { rows: typRows } = await client.query<{ name: string; ist_vollzugriff: boolean }>(
      "SELECT name, ist_vollzugriff FROM account_typ WHERE id = $1",
      [accountTypId]
    );
    if (typRows.length === 0) throw new NotFoundException("Account-Typ nicht gefunden.");
    const istVollzugriff = typRows[0].ist_vollzugriff;

    const { rows: vorhanden } = await client.query<{ id: string }>(
      `SELECT id FROM org_position
       WHERE account_typ_id = $1 AND aktiv AND typ = 'linie' AND NOT ist_geplant
         AND ($3::boolean = false OR ist_sammelrang)
       ORDER BY ist_sammelrang DESC, (titel = $2) DESC, erstellt_am
       LIMIT 1`,
      [accountTypId, typRows[0].name, mitStandorten && !istVollzugriff]
    );
    if (vorhanden.length > 0) return { id: vorhanden[0].id, istVollzugriff };

    const { rows: neu } = await client.query<{ id: string }>(
      `INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id, soll_besetzung, ist_sammelrang, erstellt_von)
       SELECT $1, ou.id, $2, $3, NULL, true, $4 FROM org_unit ou WHERE ou.typ = 'traeger'
       RETURNING id`,
      [mandantId, typRows[0].name, accountTypId, benutzerId]
    );
    if (neu.length === 0) throw new ConflictException("Keine Trägerwurzel im Organigramm gefunden.");
    await this.audit.protokollieren(client, {
      modul: "organigramm",
      aktion: "position.anlegen",
      objektTyp: "org_position",
      objektId: neu[0].id,
      vorher: null,
      nachher: { titel: typRows[0].name, accountTypId },
    });
    return { id: neu[0].id, istVollzugriff };
  }

  private async rangVon(client: PoolClient, positionId: string): Promise<string | null> {
    const { rows } = await client.query<{ rang: string }>(
      "SELECT account_typ_id::text || ':' || titel AS rang FROM org_position WHERE id = $1",
      [positionId]
    );
    return rows[0]?.rang ?? null;
  }

  private async ladePositionen(client: PoolClient, benutzerId: string): Promise<BenutzerListEintrag["positionen"]> {
    const { rows } = await client.query<{ position_id: string; titel: string; account_typ_name: string; einheit_name: string }>(
      `SELECT p.id AS position_id, p.titel, a.name AS account_typ_name
       FROM org_position_besetzung pb
       JOIN org_position p ON p.id = pb.position_id AND p.aktiv
       JOIN account_typ a ON a.id = p.account_typ_id
       WHERE pb.benutzer_id = $1
         AND pb.gueltig_ab <= CURRENT_DATE
         AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
       ORDER BY p.titel`,
      [benutzerId]
    );
    return eindeutigePositionen(
      rows.map((r) => ({ positionId: r.position_id, titel: r.titel, accountTypName: r.account_typ_name }))
    );
  }

}
