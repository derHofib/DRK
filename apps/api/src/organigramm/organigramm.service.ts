import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";

export interface OrgUnitDto {
  id: string;
  parentId: string | null;
  typ: "traeger" | "einrichtung" | "bereich" | "team";
  standortId: string | null;
  name: string;
  aktiv: boolean;
}

export interface BesetzungDto {
  benutzerId: string | null;
  benutzerName: string | null;
}

export interface PositionDto {
  id: string;
  orgUnitId: string;
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

/**
 * Ausschliesslich LESENDE Endpunkte (Organigramm-Plan, Lieferreihenfolge
 * Schritt 6) -- Reparenting, Account-Typ-Matrix bearbeiten und
 * Delegation anlegen/genehmigen/widerrufen sind eigene, spaetere Schritte.
 * Kein org_unit_id/parent_id-Filter im SQL (CLAUDE.md Regel 2): RLS liefert
 * automatisch nur den eigenen Mandanten, egal wie der Baum spaeter gerendert
 * wird (Baum-Aufbau selbst ist ein UI-Schritt, hier bewusst nur flache Listen).
 */
@Injectable()
export class OrganigrammService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async findeOrgUnits(): Promise<OrgUnitDto[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT id, parent_id, typ, standort_id, name, aktiv FROM org_unit ORDER BY name`
      );
      return rows.map(
        (r): OrgUnitDto => ({
          id: r.id,
          parentId: r.parent_id,
          typ: r.typ,
          standortId: r.standort_id,
          name: r.name,
          aktiv: r.aktiv,
        })
      );
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
        `SELECT p.id, p.org_unit_id, p.parent_position_id, p.titel, p.typ, p.account_typ_id,
                p.ist_geplant, p.aktiv, p.soll_besetzung, p.gueltig_ab, p.gueltig_bis,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object('benutzerId', b.benutzer_id, 'benutzerName', bu.name)
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
         GROUP BY p.id
         ORDER BY p.titel`
      );
      return rows.map(
        (r): PositionDto => ({
          id: r.id,
          orgUnitId: r.org_unit_id,
          parentPositionId: r.parent_position_id,
          titel: r.titel,
          typ: r.typ,
          accountTypId: r.account_typ_id,
          istGeplant: r.ist_geplant,
          aktiv: r.aktiv,
          sollBesetzung: r.soll_besetzung,
          gueltigAb: r.gueltig_ab,
          gueltigBis: r.gueltig_bis,
          besetztMit: (r.besetzt_mit as { benutzerId: string; benutzerName: string }[]).map((b) =>
            zeigeNamen ? b : { benutzerId: null, benutzerName: null }
          ),
        })
      );
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
      return rows.map(
        (r): AccountTypDto => ({
          id: r.id,
          name: r.name,
          kategorie: r.kategorie,
          istSystem: r.ist_system,
          istVollzugriff: r.ist_vollzugriff,
          rechte: r.rechte,
        })
      );
    });
  }
}
