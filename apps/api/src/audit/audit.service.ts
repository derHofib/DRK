import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface AuditEintragDto {
  id: string;
  benutzerId: string;
  benutzerName: string;
  handelndAlsVertreterVon: string | null;
  handelndAlsVertreterVonName: string | null;
  modul: string;
  aktion: string;
  objektTyp: string;
  objektId: string | null;
  vorher: unknown;
  nachher: unknown;
  erstelltAm: string;
}

export interface AuditFilter {
  offset: number;
  limit: number;
  modul?: string;
  objektTyp?: string;
  objektId?: string;
}

function zuDto(r: any): AuditEintragDto {
  return {
    id: r.id,
    benutzerId: r.benutzer_id,
    benutzerName: r.benutzer_name,
    handelndAlsVertreterVon: r.handelnd_als_vertreter_von,
    handelndAlsVertreterVonName: r.handelnd_als_vertreter_von_name,
    modul: r.modul,
    aktion: r.aktion,
    objektTyp: r.objekt_typ,
    objektId: r.objekt_id,
    vorher: r.vorher,
    nachher: r.nachher,
    erstelltAm: r.erstellt_am,
  };
}

/**
 * Nur lesend -- kein Schreib-Endpunkt hier (laut Fachkonzept schreiben
 * kuenftig die jeweiligen Services selbst ins audit_log, nicht ein
 * eigener Endpunkt). audit_log ist unveraenderlich (REVOKE UPDATE, DELETE,
 * migrations/0044_audit_log.sql) -- rein lesend passt strukturell dazu.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async findeEintraege(filter: AuditFilter): Promise<AuditEintragDto[]> {
    return this.db.withTenant(async (client) => {
      const bedingungen: string[] = [];
      const werte: unknown[] = [];
      if (filter.modul !== undefined) {
        werte.push(filter.modul);
        bedingungen.push(`a.modul = $${werte.length}`);
      }
      if (filter.objektTyp !== undefined) {
        werte.push(filter.objektTyp);
        bedingungen.push(`a.objekt_typ = $${werte.length}`);
      }
      if (filter.objektId !== undefined) {
        werte.push(filter.objektId);
        bedingungen.push(`a.objekt_id = $${werte.length}`);
      }
      const where = bedingungen.length > 0 ? `WHERE ${bedingungen.join(" AND ")}` : "";

      werte.push(filter.limit);
      const limitIdx = werte.length;
      werte.push(filter.offset);
      const offsetIdx = werte.length;

      const { rows } = await client.query(
        `SELECT a.id, a.benutzer_id, bu.name AS benutzer_name,
                a.handelnd_als_vertreter_von, hv.name AS handelnd_als_vertreter_von_name,
                a.modul, a.aktion, a.objekt_typ, a.objekt_id, a.vorher, a.nachher, a.erstellt_am
         FROM audit_log a
         JOIN benutzer bu ON bu.id = a.benutzer_id
         LEFT JOIN benutzer hv ON hv.id = a.handelnd_als_vertreter_von
         ${where}
         ORDER BY a.erstellt_am DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        werte
      );
      return rows.map(zuDto);
    });
  }
}
