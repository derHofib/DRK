import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { isPgError } from "../common/pg-error";
import { RechteService } from "../rechte/rechte.service";
import { AuditService } from "../audit/audit.service";
import { istGueltigesRecht } from "../rechte/registry";
import { erzeugeOrganigrammPdf } from "./organigramm-export-pdf";

export interface OrgUnitDto {
  id: string;
  parentId: string | null;
  typ: "traeger" | "einrichtung" | "bereich" | "team";
  standortId: string | null;
  name: string;
  aktiv: boolean;
}

export interface BesetzungDto {
  besetzungId: string;
  benutzerId: string | null;
  benutzerName: string | null;
  gueltigAb: string;
}

export interface PositionDto {
  id: string;
  orgUnitId: string;
  /**
   * Zusaetzliche Organisationseinheiten einer Linienposition (Migration
   * 0047 -- z.B. eine Einrichtungsleitung mit zwei Einrichtungen). Immer
   * leer bei typ="stabsstelle" (die nutzt weiterhin ausschliesslich
   * org_position_stabsstelle_scope). Keine Personendaten, deshalb ohne
   * Redaktion in zuPositionDto().
   */
  weitereOrgUnitIds: string[];
  parentPositionId: string | null;
  titel: string;
  typ: "linie" | "stabsstelle";
  accountTypId: string;
  istGeplant: boolean;
  aktiv: boolean;
  sollBesetzung: number;
  gueltigAb: string;
  gueltigBis: string | null;
  besetztMit: BesetzungDto[];
}

export interface AccountTypRechtDto {
  modul: string;
  aktion: string;
  scope: string;
  erlaubt: boolean;
}

export interface AccountTypDto {
  id: string;
  name: string;
  kategorie: "intern" | "extern";
  istSystem: boolean;
  istVollzugriff: boolean;
  rechte: AccountTypRechtDto[];
}

// SQLSTATE-Codes, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
// P0001: PL/pgSQL RAISE EXCEPTION ohne explizite SQLSTATE-Angabe -- fast
// jeder Invarianten-Trigger in 0040-0042 nutzt genau dieses generische
// Muster (Zyklenschutz, Stabsstelle-Scope, ist_geplant-Pruefung, letzter
// Vollzugriff-Inhaber), siehe rechnung.service.ts fuer das Vorbild.
const RAISE_EXCEPTION = "P0001";
// Fremdschluessel-Verletzung: bei RLS+FORCE ist das nicht nur "ungueltige
// ID", sondern auch das Ergebnis eines mandantenfremden Ziels (RLS
// versteckt die Zeile, die FK-Pruefung sieht sie dann ebenfalls nicht und
// meldet denselben Fehler wie "existiert nicht") -- deshalb hier als 404
// uebersetzt, nicht als 400/409.
const FOREIGN_KEY_VIOLATION = "23503";
// UNIQUE-Verletzung auf account_typ(mandant_id, name).
const UNIQUE_VIOLATION = "23505";
// CHECK-Verletzung (org_position_besetzung: gueltig_bis >= gueltig_ab).
const CHECK_VIOLATION = "23514";

const POSITIONEN_SELECT = `
  SELECT p.id, p.org_unit_id, p.parent_position_id, p.titel, p.typ, p.account_typ_id,
         p.ist_geplant, p.aktiv, p.soll_besetzung, p.gueltig_ab, p.gueltig_bis,
         COALESCE(
           (SELECT array_agg(w.org_unit_id) FROM org_position_weitere_einheit w WHERE w.position_id = p.id),
           '{}'
         ) AS weitere_org_unit_ids,
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'besetzungId', b.id, 'benutzerId', b.benutzer_id, 'benutzerName', bu.name,
               'gueltigAb', b.gueltig_ab
             )
             ORDER BY bu.name
           ) FILTER (WHERE b.id IS NOT NULL),
           '[]'::jsonb
         ) AS besetzt_mit
  FROM org_position p
  LEFT JOIN org_position_besetzung b
    ON b.position_id = p.id
   AND b.gueltig_ab <= CURRENT_DATE
   AND (b.gueltig_bis IS NULL OR b.gueltig_bis >= CURRENT_DATE)
  LEFT JOIN benutzer bu ON bu.id = b.benutzer_id
`;

function zuOrgUnitDto(r: any): OrgUnitDto {
  return {
    id: r.id,
    parentId: r.parent_id,
    typ: r.typ,
    standortId: r.standort_id,
    name: r.name,
    aktiv: r.aktiv,
  };
}

/**
 * Immer die VOLLEN Namen -- fuer das Audit-Log (vorher/nachher), nie fuer
 * eine HTTP-Antwort. CLAUDE.md Regel 6: gespeichert/protokolliert wird der
 * volle Stand, die Redaktion passiert erst beim Lesen -- siehe
 * zuPositionDto() unten fuer die Antwort an den Aufrufer.
 */
function zuPositionDtoVoll(r: any): PositionDto {
  return {
    id: r.id,
    orgUnitId: r.org_unit_id,
    weitereOrgUnitIds: r.weitere_org_unit_ids,
    parentPositionId: r.parent_position_id,
    titel: r.titel,
    typ: r.typ,
    accountTypId: r.account_typ_id,
    istGeplant: r.ist_geplant,
    aktiv: r.aktiv,
    sollBesetzung: r.soll_besetzung,
    gueltigAb: r.gueltig_ab,
    gueltigBis: r.gueltig_bis,
    besetztMit: r.besetzt_mit as BesetzungDto[],
  };
}

function zuPositionDto(r: any, zeigeNamen: boolean): PositionDto {
  const voll = zuPositionDtoVoll(r);
  if (zeigeNamen) return voll;
  // besetzungId/gueltigAb bleiben erhalten -- das sind keine personenbezogenen
  // Daten und werden gebraucht, um eine Besetzung auch ohne Namensanzeige
  // ueber die UI beenden zu koennen (siehe Organigramm.tsx-Seitenpanel).
  return {
    ...voll,
    besetztMit: voll.besetztMit.map((b) => ({ ...b, benutzerId: null, benutzerName: null })),
  };
}

function zuAccountTypDto(r: any): AccountTypDto {
  return {
    id: r.id,
    name: r.name,
    kategorie: r.kategorie,
    istSystem: r.ist_system,
    istVollzugriff: r.ist_vollzugriff,
    rechte: r.rechte,
  };
}

/**
 * Lesende UND schreibende Organigramm-Endpunkte (Organigramm-Plan,
 * Lieferreihenfolge Schritt 7). Reparenting, Besetzen/Beenden und die
 * Account-Typ-/Rechte-Matrix leben hier -- Delegation anlegen/genehmigen/
 * widerrufen bleibt ein eigenes Modul (delegation/).
 *
 * Kein org_unit_id/parent_id-Filter im SQL (CLAUDE.md Regel 2): RLS liefert
 * automatisch nur den eigenen Mandanten. Jede Invariante (Closure-Table-
 * Pflege, Zyklenschutz, "letzter Vollzugriff-Inhaber bleibt bestehen",
 * ist_geplant-Auto-Clear, Stabsstelle-Scope-Pruefung, Account-Typ-Matrix-
 * Regeln) steckt als DB-Trigger in den Migrationen 0040-0042 -- die
 * Methoden hier loesen NICHTS davon selbst, sie uebersetzen nur die
 * resultierenden Postgres-Fehler in verstaendliche HTTP-Antworten (Muster:
 * rechnung.service.ts, RAISE_EXCEPTION = "P0001").
 */
@Injectable()
export class OrganigrammService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly audit: AuditService
  ) {}

  /**
   * ORDER BY COALESCE(reihenfolge, ...): noch nie manuell sortierte
   * Einheiten (reihenfolge IS NULL, der Normalfall vor dem ersten Drag im
   * Baum) fallen stabil ans Ende, alphabetisch -- siehe setzeOrgUnitReihenfolge()
   * fuer das Schreiben dieser Spalte, Migration 0047 fuer die Begruendung.
   */
  async findeOrgUnits(): Promise<OrgUnitDto[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT id, parent_id, typ, standort_id, name, aktiv FROM org_unit
         ORDER BY COALESCE(reihenfolge, 2147483647), name`
      );
      return rows.map(zuOrgUnitDto);
    });
  }

  /**
   * "besetztMit" ist abgeleitet (CLAUDE.md Regel 4), nie gespeichert --
   * ein leeres Array heisst vakant. Die Namensredaktion darunter ist
   * CLAUDE.md Regel 6 (Anonymisierung beim Lesen): ohne
   * organigramm.personendaten-sehen bleiben benutzerId/benutzerName auch bei
   * einer besetzten Position null, nur die Existenz einer Besetzung bleibt
   * sichtbar (Array-Laenge). Diese Pruefung ist bewusst NICHT Teil des
   * @ErfordertRecht()-Guards auf dem Endpunkt (der gated nur
   * organigramm.ansehen insgesamt) -- es ist reine Feldredaktion, kein
   * Alles-oder-Nichts-Zugriff, exakt das Muster von
   * common/anonymisierung.ts bzw. zimmer.service.ts (zimmer.voller-verlauf).
   */
  async findePositionen(): Promise<PositionDto[]> {
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `${POSITIONEN_SELECT} GROUP BY p.id ORDER BY COALESCE(p.reihenfolge, 2147483647), p.titel`
      );
      return rows.map((r) => zuPositionDto(r, zeigeNamen));
    });
  }

  /**
   * Fuer ist_vollzugriff=true-Typen ist "rechte" laut Datenmodell immer
   * leer (siehe Kommentar in migrations/0041_account_typ.sql: solche Typen
   * bekommen nie account_typ_recht-Zeilen, ihr Zugriff wird in der
   * Rechte-Engine als Wildcard kurzgeschlossen) -- keine Sonderbehandlung
   * hier noetig, das JOIN liefert fuer sie einfach ein leeres Array.
   */
  async findeAccountTypen(): Promise<AccountTypDto[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT a.id, a.name, a.kategorie, a.ist_system, a.ist_vollzugriff,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object('modul', r.modul, 'aktion', r.aktion, 'scope', r.scope, 'erlaubt', r.erlaubt)
                    ORDER BY r.modul, r.aktion
                  ) FILTER (WHERE r.id IS NOT NULL),
                  '[]'::jsonb
                ) AS rechte
         FROM account_typ a
         LEFT JOIN account_typ_recht r ON r.account_typ_id = a.id
         GROUP BY a.id
         ORDER BY a.name`
      );
      return rows.map(zuAccountTypDto);
    });
  }

  /**
   * Ruft bewusst findeOrgUnits()/findePositionen()/findeAccountTypen() auf
   * statt die Daten ein zweites Mal direkt per SQL zu lesen (CLAUDE.md
   * Regel 6: Anonymisierung passiert beim Lesen) -- die
   * Namensredaktion in findePositionen() gilt dadurch automatisch auch
   * fuer den PDF-Export, ohne dass hier eine zweite, leicht auseinander-
   * laufende Pruefung auf organigramm.personendaten-sehen noetig waere.
   * Der Mandantenname kommt aus der traeger-Zeile von findeOrgUnits() --
   * sie traegt ihn seit der Mandanten-Anlage (Trigger
   * org_unit_traeger_anlegen, migrations/0040), eine eigene Abfrage auf
   * "mandant" waere dieselbe Information ueber einen zweiten Weg.
   */
  async exportPdf(): Promise<Buffer> {
    const [orgUnits, positionen, accountTypen] = await Promise.all([
      this.findeOrgUnits(),
      this.findePositionen(),
      this.findeAccountTypen(),
    ]);
    const mandantName = orgUnits.find((u) => u.typ === "traeger")?.name ?? "Zimmerakte";
    return erzeugeOrganigrammPdf({ mandantName, orgUnits, positionen, accountTypen });
  }

  // ---------------------------------------------------------------------
  // Organisationseinheiten
  // ---------------------------------------------------------------------

  /**
   * typ="traeger"/"einrichtung" ist ueber den Controller-Zod-Schema (nur
   * "bereich"|"team" als gueltige Werte) bereits ausgeschlossen -- ein
   * Versuch landet als ZodError/400, bevor dieser Service ueberhaupt
   * aufgerufen wird (Traeger entsteht automatisch pro Mandant, Einrichtung
   * automatisch 1:1 mit einem standort, beides per Trigger in Migration
   * 0040).
   */
  async legeOrgUnitAn(input: { typ: "bereich" | "team"; name: string; parentId: string }): Promise<OrgUnitDto> {
    const ctx = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO org_unit (mandant_id, parent_id, typ, name)
           VALUES ($1, $2, $3, $4)
           RETURNING id, parent_id, typ, standort_id, name, aktiv`,
          [ctx.mandantId, input.parentId, input.typ, input.name]
        );
        const nachher = zuOrgUnitDto(rows[0]);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "org-unit.anlegen",
          objektTyp: "org_unit",
          objektId: nachher.id,
          vorher: null,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException("Übergeordnete Organisationseinheit nicht gefunden.");
      }
      throw err;
    }
  }

  private async ladeOrgUnit(client: PoolClient, id: string): Promise<OrgUnitDto> {
    const { rows } = await client.query(
      `SELECT id, parent_id, typ, standort_id, name, aktiv FROM org_unit WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundException("Organisationseinheit nicht gefunden.");
    return zuOrgUnitDto(rows[0]);
  }

  /**
   * Ein Reparenting (parentId gesetzt) loest den Zyklenschutz-Trigger
   * org_unit_closure_update aus (migrations/0040) -- ein generisches
   * RAISE EXCEPTION (P0001), hier 1:1 als ConflictException weitergegeben.
   */
  async aktualisiereOrgUnit(id: string, input: { name?: string; parentId?: string }): Promise<OrgUnitDto> {
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.ladeOrgUnit(client, id);

        const felder: string[] = [];
        const werte: unknown[] = [];
        const setze = (spalte: string, wert: unknown) => {
          werte.push(wert);
          felder.push(`${spalte} = $${werte.length}`);
        };
        if (input.name !== undefined) setze("name", input.name);
        if (input.parentId !== undefined) setze("parent_id", input.parentId);

        werte.push(id);
        const { rows } = await client.query(
          `UPDATE org_unit SET ${felder.join(", ")} WHERE id = $${werte.length}
           RETURNING id, parent_id, typ, standort_id, name, aktiv`,
          werte
        );
        const nachher = zuOrgUnitDto(rows[0]);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "org-unit.bearbeiten",
          objektTyp: "org_unit",
          objektId: id,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Diese Verschiebung ist nicht zulässig.");
      }
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException("Übergeordnete Organisationseinheit nicht gefunden.");
      }
      throw err;
    }
  }

  /**
   * Geschwister-Reihenfolge fuer Organisationseinheiten (Positionen siehe
   * setzePositionenReihenfolge() im Positionen-Abschnitt unten). Ein Update
   * in einer Abfrage statt N Einzel-UPDATEs: unnest() koppelt jede Id an
   * ihren neuen Index, das WHERE auf elternId filtert zugleich auf
   * "tatsaechlich Geschwister" -- RLS filtert zusaetzlich automatisch auf
   * den eigenen Mandanten (CLAUDE.md Regel 2). Kommen weniger Zeilen zurueck
   * als Ids uebergeben wurden, war mindestens eine Id kein Geschwister
   * (falscher Elternknoten oder mandantsfremd) -- das ist ein Bedienfehler
   * des Aufrufers (der Baum im Client kennt die tatsaechlichen Geschwister),
   * kein Serverfehler.
   */
  async setzeOrgUnitReihenfolge(elternId: string, geordneteIds: string[]): Promise<void> {
    await this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `UPDATE org_unit AS o
         SET reihenfolge = v.idx
         FROM (SELECT * FROM unnest($1::uuid[], $2::int[]) AS t(id, idx)) AS v
         WHERE o.id = v.id AND o.parent_id = $3
         RETURNING o.id`,
        [geordneteIds, geordneteIds.map((_, i) => i), elternId]
      );
      if (rows.length !== geordneteIds.length) {
        throw new BadRequestException("Nicht alle angegebenen Ids sind Geschwister dieser Organisationseinheit.");
      }
      await this.audit.protokollieren(client, {
        modul: "organigramm",
        aktion: "org-unit.reihenfolge-setzen",
        objektTyp: "org_unit",
        objektId: elternId,
        vorher: null,
        nachher: { geordneteIds },
      });
    });
  }

  // ---------------------------------------------------------------------
  // Positionen
  // ---------------------------------------------------------------------

  private async holePositionRoh(client: PoolClient, id: string): Promise<any> {
    const { rows } = await client.query(`${POSITIONEN_SELECT} WHERE p.id = $1 GROUP BY p.id`, [id]);
    if (rows.length === 0) throw new NotFoundException("Position nicht gefunden.");
    return rows[0];
  }

  private async findeEinzelnePosition(client: PoolClient, id: string, zeigeNamen: boolean): Promise<PositionDto> {
    return zuPositionDto(await this.holePositionRoh(client, id), zeigeNamen);
  }

  /**
   * ist_geplant wird NICHT aus dem Body uebernommen -- die DB-Spalte hat
   * DEFAULT false, fachlich korrekt fuer eine frisch angelegte, noch
   * unbesetzte Position, bis jemand sie absichtlich per PATCH als
   * Platzhalter markiert (siehe aktualisierePosition()).
   */
  async legePositionAn(input: {
    orgUnitId: string;
    titel: string;
    typ?: "linie" | "stabsstelle";
    accountTypId: string;
    parentPositionId?: string;
    sollBesetzung?: number;
    gueltigAb?: string;
    gueltigBis?: string;
  }): Promise<PositionDto> {
    const ctx = requireTenantContext();
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO org_position
             (mandant_id, org_unit_id, titel, typ, account_typ_id, parent_position_id,
              soll_besetzung, gueltig_ab, gueltig_bis, erstellt_von)
           VALUES ($1, $2, $3, COALESCE($4::org_position_typ, 'linie'), $5, $6,
                   COALESCE($7, 1), COALESCE($8, CURRENT_DATE), $9, $10)
           RETURNING id`,
          [
            ctx.mandantId,
            input.orgUnitId,
            input.titel,
            input.typ ?? null,
            input.accountTypId,
            input.parentPositionId ?? null,
            input.sollBesetzung ?? null,
            input.gueltigAb ?? null,
            input.gueltigBis ?? null,
            ctx.benutzerId,
          ]
        );
        const id = rows[0].id;
        const nachher = await this.findeEinzelnePosition(client, id, zeigeNamen);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "position.anlegen",
          objektTyp: "org_position",
          objektId: id,
          vorher: null,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException("Organisationseinheit, Account-Typ oder übergeordnete Position nicht gefunden.");
      }
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Diese Position konnte nicht angelegt werden.");
      }
      throw err;
    }
  }

  /**
   * Reparenting loest den Zyklenschutz-Trigger org_position_closure_update
   * aus, Setzen von istGeplant=true auf eine aktiv besetzte Position den
   * Trigger org_position_geplant_pruefen -- beide generisches P0001 (siehe
   * migrations/0042_org_position.sql). aktiv=false zaehlt bewusst NICHT zu
   * diesem Endpunkt, siehe deaktiviertPosition() (gleiches Muster wie
   * zimmer.service.ts: aktualisieren() vs. deaktivieren()).
   */
  async aktualisierePosition(
    id: string,
    input: {
      titel?: string;
      accountTypId?: string;
      parentPositionId?: string;
      sollBesetzung?: number;
      gueltigBis?: string | null;
      istGeplant?: boolean;
    }
  ): Promise<PositionDto> {
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.findeEinzelnePosition(client, id, zeigeNamen);

        const felder: string[] = [];
        const werte: unknown[] = [];
        const setze = (spalte: string, wert: unknown) => {
          werte.push(wert);
          felder.push(`${spalte} = $${werte.length}`);
        };
        if (input.titel !== undefined) setze("titel", input.titel);
        if (input.accountTypId !== undefined) setze("account_typ_id", input.accountTypId);
        if (input.parentPositionId !== undefined) setze("parent_position_id", input.parentPositionId);
        if (input.sollBesetzung !== undefined) setze("soll_besetzung", input.sollBesetzung);
        if ("gueltigBis" in input) setze("gueltig_bis", input.gueltigBis);
        if (input.istGeplant !== undefined) setze("ist_geplant", input.istGeplant);

        if (felder.length > 0) {
          werte.push(id);
          await client.query(`UPDATE org_position SET ${felder.join(", ")} WHERE id = $${werte.length}`, werte);
        }
        const nachher = await this.findeEinzelnePosition(client, id, zeigeNamen);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "position.bearbeiten",
          objektTyp: "org_position",
          objektId: id,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Diese Änderung ist nicht zulässig.");
      }
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException("Account-Typ oder übergeordnete Position nicht gefunden.");
      }
      throw err;
    }
  }

  /**
   * Bewusst kein DELETE (wie bei zimmer.service.ts) -- deaktivieren ist
   * eine eigene, einschneidendere Aktion als eine normale Bearbeitung.
   * Loest ggf. den "letzter Vollzugriff-Inhaber bleibt bestehen"-Trigger
   * org_position_vollzugriff_schutz aus (migrations/0042), P0001.
   */
  async deaktiviertPosition(id: string): Promise<PositionDto> {
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.findeEinzelnePosition(client, id, zeigeNamen);
        await client.query("UPDATE org_position SET aktiv = false WHERE id = $1", [id]);
        const nachher = await this.findeEinzelnePosition(client, id, zeigeNamen);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "position.deaktivieren",
          objektTyp: "org_position",
          objektId: id,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Diese Position kann nicht deaktiviert werden.");
      }
      throw err;
    }
  }

  /**
   * "SELECT 1 FROM benutzer" statt einer ungeprueften Weitergabe der ID an
   * das INSERT: RLS auf benutzer filtert automatisch auf den eigenen
   * Mandanten, ein Treffer bedeutet also nicht nur "existiert", sondern
   * "gehoert zu diesem Mandanten" -- Muster aus aufgabe.service.ts
   * (pruefeBenutzerErlaubt()), liefert eine bessere 404-Meldung statt eines
   * FK-Fehlers.
   */
  private async pruefeBenutzerErlaubt(client: PoolClient, benutzerId: string): Promise<void> {
    const { rows } = await client.query("SELECT 1 FROM benutzer WHERE id = $1", [benutzerId]);
    if (rows.length === 0) throw new NotFoundException("Benutzer nicht gefunden.");
  }

  /**
   * gueltig_ab wird nur dann als Spalte mitgeschrieben, wenn es uebergeben
   * wurde -- sonst greift der DB-Default CURRENT_DATE (nicht hier im Code
   * nachgebildet). Der Trigger org_position_besetzung_geplant_aufheben
   * setzt ist_geplant automatisch zurueck, unabhaengig vom Gueltigkeitsdatum
   * -- kein eigener Code dafuer noetig.
   */
  async besetzen(positionId: string, input: { benutzerId: string; gueltigAb?: string }): Promise<PositionDto> {
    const ctx = requireTenantContext();
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    try {
      return await this.db.withTenant(async (client) => {
        await this.pruefeBenutzerErlaubt(client, input.benutzerId);

        // Das breite organigramm.bearbeiten (Controller-Gate dieser Route)
        // reicht hier NICHT: wer nur das hat, koennte sonst jemanden auf eine
        // Vollzugriff-Position setzen und sich darueber selbst Vollzugriff
        // verschaffen -- genau das ist Rechteverwaltung, nicht
        // Organigramm-Pflege, und braucht deshalb das engere, strukturell nie
        // delegierbare organigramm.manage-permissions.
        const { rows: posRows } = await client.query<{ ist_vollzugriff: boolean }>(
          `SELECT a.ist_vollzugriff
           FROM org_position p
           JOIN account_typ a ON a.id = p.account_typ_id
           WHERE p.id = $1`,
          [positionId]
        );
        if (posRows.length === 0) throw new NotFoundException("Position nicht gefunden.");
        if (posRows[0].ist_vollzugriff && !(await this.rechte.hatRecht("organigramm", "manage-permissions"))) {
          throw new ForbiddenException("Nur Rechteverwaltung darf jemanden auf eine Vollzugriff-Position setzen.");
        }

        const vorher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);

        const spalten = ["mandant_id", "position_id", "benutzer_id", "erstellt_von"];
        const werte: unknown[] = [ctx.mandantId, positionId, input.benutzerId, ctx.benutzerId];
        if (input.gueltigAb !== undefined) {
          spalten.push("gueltig_ab");
          werte.push(input.gueltigAb);
        }
        const platzhalter = werte.map((_, i) => `$${i + 1}`).join(", ");
        const { rows } = await client.query(
          `INSERT INTO org_position_besetzung (${spalten.join(", ")}) VALUES (${platzhalter}) RETURNING id`,
          werte
        );

        const nachher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "position.besetzen",
          objektTyp: "org_position_besetzung",
          objektId: rows[0].id,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException("Position nicht gefunden.");
      }
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Diese Besetzung ist nicht zulässig.");
      }
      throw err;
    }
  }

  /**
   * org_position_besetzung erlaubt der App-Rolle laut Migration 0042
   * ausschliesslich UPDATE (gueltig_bis) -- dieses SQL setzt bewusst nur
   * genau diese eine Spalte (Vorbild: belegung.service.ts::bearbeiten()).
   */
  async besetzungBeenden(
    positionId: string,
    besetzungId: string,
    input: { gueltigBis?: string }
  ): Promise<PositionDto> {
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);
        const { rows } = await client.query(
          `UPDATE org_position_besetzung SET gueltig_bis = COALESCE($1, CURRENT_DATE)
           WHERE id = $2 AND position_id = $3
           RETURNING id`,
          [input.gueltigBis ?? null, besetzungId, positionId]
        );
        if (rows.length === 0) throw new NotFoundException("Besetzung nicht gefunden.");

        const nachher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "position.besetzung-beenden",
          objektTyp: "org_position_besetzung",
          objektId: besetzungId,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Diese Besetzung kann nicht beendet werden.");
      }
      if (isPgError(err) && err.code === CHECK_VIOLATION) {
        throw new BadRequestException("Das Ende-Datum muss nach dem Anfangsdatum der Besetzung liegen.");
      }
      throw err;
    }
  }

  /**
   * Ersetzt die komplette Scope-Liste (DELETE + INSERT, eine Transaktion
   * ueber db.withTenant()). Nur fuer typ="stabsstelle" gueltig -- der
   * Trigger org_position_stabsstelle_scope_pruefen lehnt sonst mit P0001
   * ab (migrations/0042).
   */
  async setzeStabsstelleScope(positionId: string, orgUnitIds: string[]): Promise<PositionDto> {
    const ctx = requireTenantContext();
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    const eindeutig = [...new Set(orgUnitIds)];
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);
        await client.query("DELETE FROM org_position_stabsstelle_scope WHERE position_id = $1", [positionId]);
        for (const orgUnitId of eindeutig) {
          await client.query(
            `INSERT INTO org_position_stabsstelle_scope (mandant_id, position_id, org_unit_id) VALUES ($1, $2, $3)`,
            [ctx.mandantId, positionId, orgUnitId]
          );
        }
        const nachher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "position.stabsstelle-scope-setzen",
          objektTyp: "org_position",
          objektId: positionId,
          vorher,
          nachher: { ...nachher, stabsstelleScope: eindeutig },
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(
          err.message ?? "Nur Stabsstellen bekommen einen expliziten Organisationseinheiten-Scope."
        );
      }
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException("Organisationseinheit nicht gefunden.");
      }
      throw err;
    }
  }

  /**
   * Ersetzt die komplette Liste weiterer Organisationseinheiten (DELETE +
   * INSERT, exakt das Muster von setzeStabsstelleScope() oben) -- nur fuer
   * typ="linie" gueltig, der Trigger org_position_weitere_einheit_pruefen
   * lehnt sonst (und bei einem Duplikat der eigenen org_unit_id) mit P0001
   * ab (Migration 0047). Wirkt sich sofort auf die Rechte-Engine aus
   * (rechte.service.ts::orgUnitIdsFuerScope() unioniert Scopes ueber alle
   * zugeordneten Einheiten), nicht nur auf die Darstellung im Baum.
   */
  async setzeWeitereEinheiten(positionId: string, orgUnitIds: string[]): Promise<PositionDto> {
    const ctx = requireTenantContext();
    const zeigeNamen = await this.rechte.hatRecht("organigramm", "personendaten-sehen");
    const eindeutig = [...new Set(orgUnitIds)];
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);
        await client.query("DELETE FROM org_position_weitere_einheit WHERE position_id = $1", [positionId]);
        for (const orgUnitId of eindeutig) {
          await client.query(
            `INSERT INTO org_position_weitere_einheit (mandant_id, position_id, org_unit_id) VALUES ($1, $2, $3)`,
            [ctx.mandantId, positionId, orgUnitId]
          );
        }
        const nachher = await this.findeEinzelnePosition(client, positionId, zeigeNamen);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "position.weitere-einheiten-setzen",
          objektTyp: "org_position",
          objektId: positionId,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(
          err.message ?? "Weitere Organisationseinheiten gibt es nur für Linienpositionen."
        );
      }
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException("Organisationseinheit nicht gefunden.");
      }
      throw err;
    }
  }

  /**
   * Geschwister-Reihenfolge fuer Positionen (Organisationseinheiten siehe
   * setzeOrgUnitReihenfolge() oben bei den Organisationseinheiten-Methoden).
   * "Geschwister" heisst hier: gleiche org_unit_id UND gleiche
   * parent_position_id (siehe Organigramm.tsx::baueBaum() -- genau so
   * werden Positions-Kinder dort gruppiert). parentPositionId=null braucht
   * IS NOT DISTINCT FROM statt "=", sonst matcht NULL=NULL in SQL nie.
   */
  async setzePositionenReihenfolge(
    orgUnitId: string,
    parentPositionId: string | null,
    geordneteIds: string[]
  ): Promise<void> {
    await this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `UPDATE org_position AS p
         SET reihenfolge = v.idx
         FROM (SELECT * FROM unnest($1::uuid[], $2::int[]) AS t(id, idx)) AS v
         WHERE p.id = v.id AND p.org_unit_id = $3 AND p.parent_position_id IS NOT DISTINCT FROM $4
         RETURNING p.id`,
        [geordneteIds, geordneteIds.map((_, i) => i), orgUnitId, parentPositionId]
      );
      if (rows.length !== geordneteIds.length) {
        throw new BadRequestException("Nicht alle angegebenen Ids sind Geschwister dieser Position.");
      }
      await this.audit.protokollieren(client, {
        modul: "organigramm",
        aktion: "position.reihenfolge-setzen",
        objektTyp: "org_position",
        objektId: orgUnitId,
        vorher: null,
        nachher: { orgUnitId, parentPositionId, geordneteIds },
      });
    });
  }

  // ---------------------------------------------------------------------
  // Account-Typen
  // ---------------------------------------------------------------------

  private async holeAccountTypRoh(client: PoolClient, id: string): Promise<any> {
    const { rows } = await client.query(
      `SELECT a.id, a.name, a.kategorie, a.ist_system, a.ist_vollzugriff,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object('modul', r.modul, 'aktion', r.aktion, 'scope', r.scope, 'erlaubt', r.erlaubt)
                  ORDER BY r.modul, r.aktion
                ) FILTER (WHERE r.id IS NOT NULL),
                '[]'::jsonb
              ) AS rechte
       FROM account_typ a
       LEFT JOIN account_typ_recht r ON r.account_typ_id = a.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [id]
    );
    if (rows.length === 0) throw new NotFoundException("Account-Typ nicht gefunden.");
    return rows[0];
  }

  private async findeEinzelnenAccountTyp(client: PoolClient, id: string): Promise<AccountTypDto> {
    return zuAccountTypDto(await this.holeAccountTypRoh(client, id));
  }

  /**
   * ist_system/ist_vollzugriff sind NIEMALS ueber die API setzbar (bleiben
   * false) -- der einzige Vollzugriff-Systemtyp ("Entwickler") entsteht
   * ausschliesslich ueber den Seed-Trigger auf mandant (migrations/0048),
   * siehe Kommentar in migrations/0041.
   */
  async legeAccountTypAn(input: { name: string; kategorie?: "intern" | "extern" }): Promise<AccountTypDto> {
    const ctx = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO account_typ (mandant_id, name, kategorie)
           VALUES ($1, $2, COALESCE($3::account_typ_kategorie, 'intern'))
           RETURNING id`,
          [ctx.mandantId, input.name, input.kategorie ?? null]
        );
        const nachher = await this.findeEinzelnenAccountTyp(client, rows[0].id);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "account-typ.anlegen",
          objektTyp: "account_typ",
          objektId: nachher.id,
          vorher: null,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Ein Account-Typ mit diesem Namen existiert bereits.");
      }
      throw err;
    }
  }

  /**
   * Keine DB-Trigger-Pruefung fuer die ist_system-Umbenennungssperre
   * (gepruefte Abwesenheit in migrations/0041_account_typ.sql) -- deshalb
   * hier im Service, VOR dem UPDATE.
   */
  async aktualisiereAccountTyp(id: string, input: { name?: string }): Promise<AccountTypDto> {
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.findeEinzelnenAccountTyp(client, id);
        if (vorher.istSystem) {
          throw new BadRequestException("Systemvorlagen können nicht umbenannt werden.");
        }
        if (input.name !== undefined) {
          await client.query("UPDATE account_typ SET name = $1 WHERE id = $2", [input.name, id]);
        }
        const nachher = await this.findeEinzelnenAccountTyp(client, id);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "account-typ.bearbeiten",
          objektTyp: "account_typ",
          objektId: id,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Ein Account-Typ mit diesem Namen existiert bereits.");
      }
      throw err;
    }
  }

  /**
   * Ersetzt die komplette account_typ_recht-Zeilenmenge (DELETE + INSERT).
   * Jedes (modul,aktion)-Paar wird GEGEN DIE REGISTRY validiert, bevor
   * irgendetwas geschrieben wird -- ein unbekanntes Paar darf nicht einmal
   * das bestehende DELETE auslösen. Fuer ist_vollzugriff=true-Typen und
   * fuer kategorie=extern mit erlaubt=true/scope<>assigned lehnt der
   * Trigger account_typ_recht_pruefen (migrations/0041) jede Zeile mit
   * P0001 ab.
   */
  async setzeAccountTypRechte(id: string, rechte: AccountTypRechtDto[]): Promise<AccountTypDto> {
    const ctx = requireTenantContext();
    for (const eintrag of rechte) {
      if (!istGueltigesRecht(eintrag.modul, eintrag.aktion)) {
        throw new BadRequestException(`Unbekanntes Recht: ${eintrag.modul}.${eintrag.aktion}`);
      }
    }
    try {
      return await this.db.withTenant(async (client) => {
        const vorher = await this.findeEinzelnenAccountTyp(client, id);
        await client.query("DELETE FROM account_typ_recht WHERE account_typ_id = $1", [id]);
        for (const eintrag of rechte) {
          await client.query(
            `INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ctx.mandantId, id, eintrag.modul, eintrag.aktion, eintrag.scope, eintrag.erlaubt]
          );
        }
        const nachher = await this.findeEinzelnenAccountTyp(client, id);
        await this.audit.protokollieren(client, {
          modul: "organigramm",
          aktion: "account-typ.rechte-setzen",
          objektTyp: "account_typ",
          objektId: id,
          vorher,
          nachher,
        });
        return nachher;
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Diese Rechte-Zeile ist nicht zulässig.");
      }
      throw err;
    }
  }
}
