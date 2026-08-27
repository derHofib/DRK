import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { dateiAusBase64 } from "../common/datei";
import { ermittleErlaubteStandortIds, klientIstErlaubt, klientStandortBedingung } from "../common/standort-restriction";

// SQLSTATE-Codes, siehe
// https://www.postgresql.org/docs/current/errcodes-appendix.html
// P0001: PL/pgSQL RAISE EXCEPTION ohne explizite SQLSTATE-Angabe (der
// Übergangs-Trigger, siehe migrations/0014_rechnung.sql).
// 23514: CHECK-Constraint verletzt (grund fehlt bei status='abgelehnt').
const RAISE_EXCEPTION = "P0001";
const CHECK_VIOLATION = "23514";

export type RechnungStatus = "beantragt" | "genehmigt" | "ausgezahlt" | "abgelehnt";

export interface RechnungDto {
  id: string;
  klientId: string;
  klientName: string;
  betragCent: number;
  beschreibung: string;
  erstelltAm: string;
  status: RechnungStatus;
  statusGrund: string | null;
  hatDokument: boolean;
}

export interface RechnungDetailDto extends RechnungDto {
  statusVerlauf: { status: RechnungStatus; grund: string | null; geaendertAm: string }[];
}

// Ob eine Rechnung genehmigt, abgelehnt oder ausgezahlt wird, ist eine
// Entscheidung ueber Traegermittel -- gleiches Rollenmuster wie
// ROLLEN_MIT_STORNO in kassenbuchung.service.ts. Wer eine Rechnung anlegt
// (jede Rolle, siehe anlegen()), darf ihren Status nicht selbst festlegen.
const ROLLEN_MIT_STATUSWECHSEL = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

const LISTEN_SELECT = `
  SELECT r.id, r.klient_id, k.vorname, k.nachname, r.betrag_cent, r.beschreibung, r.erstellt_am,
         sw.status, sw.grund,
         (d.id IS NOT NULL) AS hat_dokument
  FROM rechnung r
  JOIN klient k ON k.id = r.klient_id
  JOIN LATERAL (
    SELECT status, grund FROM rechnung_statuswechsel
    WHERE rechnung_id = r.id ORDER BY lfd_nr DESC LIMIT 1
  ) sw ON true
  LEFT JOIN rechnung_dokument d ON d.rechnung_id = r.id
`;

@Injectable()
export class RechnungService {
  constructor(private readonly db: DatabaseService) {}

  async findeAlle(filter?: { klientId?: string }): Promise<RechnungDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, benutzerId);
      const params: unknown[] = [];
      const bedingungen = [klientStandortBedingung(erlaubteStandorte, "k", params)];
      if (filter?.klientId) {
        params.push(filter.klientId);
        bedingungen.push(`r.klient_id = $${params.length}`);
      }
      const { rows } = await client.query(
        `${LISTEN_SELECT} WHERE ${bedingungen.join(" AND ")} ORDER BY r.erstellt_am DESC`,
        params
      );
      return rows.map(zuDto);
    });
  }

  async findeEine(id: string): Promise<RechnungDetailDto> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(`${LISTEN_SELECT} WHERE r.id = $1`, [id]);
      if (rows.length === 0 || !(await klientIstErlaubt(client, benutzerId, rows[0].klient_id))) {
        throw new NotFoundException("Rechnung nicht gefunden.");
      }

      const { rows: verlaufRows } = await client.query(
        `SELECT status, grund, geaendert_am FROM rechnung_statuswechsel WHERE rechnung_id = $1 ORDER BY lfd_nr`,
        [id]
      );

      return {
        ...zuDto(rows[0]),
        statusVerlauf: verlaufRows.map((v) => ({ status: v.status, grund: v.grund, geaendertAm: v.geaendert_am })),
      };
    });
  }

  async anlegen(input: {
    klientId: string;
    betragCent: number;
    beschreibung: string;
    dokumentBase64?: string;
    dokumentDateiname?: string;
    dokumentMimeType?: string;
  }): Promise<RechnungDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, input.klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }

      const { rows } = await client.query(
        `INSERT INTO rechnung (mandant_id, klient_id, betrag_cent, beschreibung, erstellt_von)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mandantId, input.klientId, input.betragCent, input.beschreibung, benutzerId]
      );
      const rechnungId = rows[0].id;

      await client.query(
        `INSERT INTO rechnung_statuswechsel (mandant_id, rechnung_id, status, geaendert_von) VALUES ($1, $2, 'beantragt', $3)`,
        [mandantId, rechnungId, benutzerId]
      );

      if (input.dokumentBase64) {
        const inhalt = dateiAusBase64(input.dokumentBase64);
        const inhaltHash = createHash("sha256").update(inhalt).digest("hex");
        await client.query(
          `INSERT INTO rechnung_dokument (mandant_id, rechnung_id, dateiname, mime_type, inhalt, inhalt_hash, hochgeladen_von)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            mandantId,
            rechnungId,
            input.dokumentDateiname ?? "dokument",
            input.dokumentMimeType ?? "application/octet-stream",
            inhalt,
            inhaltHash,
            benutzerId,
          ]
        );
      }

      return this.findeEineIntern(client, rechnungId);
    });
  }

  /**
   * Die erlaubten Übergänge (beantragt -> genehmigt/abgelehnt, genehmigt ->
   * ausgezahlt, ausgezahlt/abgelehnt sind Endzustände) werden vom Trigger
   * rechnung_statuswechsel_pruefen() in der Datenbank erzwungen, nicht hier
   * -- das ist eine Prüfung innerhalb einer einzelnen Tabelle gegen die
   * vorherige Zeile derselben rechnung_id, gehört also dorthin.
   */
  async statusAendern(id: string, status: RechnungStatus, grund?: string): Promise<RechnungDto> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_STATUSWECHSEL.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen den Status einer Rechnung ändern.");
    }
    const { mandantId, benutzerId } = ctx;
    try {
      return await this.db.withTenant(async (client) => {
        const { rows: bestehend } = await client.query("SELECT klient_id FROM rechnung WHERE id = $1", [id]);
        if (bestehend.length === 0 || !(await klientIstErlaubt(client, benutzerId, bestehend[0].klient_id))) {
          throw new NotFoundException("Rechnung nicht gefunden.");
        }

        await client.query(
          `INSERT INTO rechnung_statuswechsel (mandant_id, rechnung_id, status, grund, geaendert_von) VALUES ($1, $2, $3, $4, $5)`,
          [mandantId, id, status, grund ?? null, benutzerId]
        );
        return this.findeEineIntern(client, id);
      });
    } catch (err) {
      if (isPgError(err) && err.code === RAISE_EXCEPTION) {
        throw new ConflictException(err.message ?? "Dieser Statuswechsel ist nicht zulässig.");
      }
      if (isPgError(err) && err.code === CHECK_VIOLATION) {
        throw new BadRequestException("Beim Ablehnen ist ein Grund erforderlich.");
      }
      throw err;
    }
  }

  async dokumentBild(rechnungId: string): Promise<{ inhalt: Buffer; mimeType: string; dateiname: string; hash: string } | null> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{
        inhalt: Buffer;
        mime_type: string;
        dateiname: string;
        inhalt_hash: string;
        klient_id: string;
      }>(
        `SELECT d.inhalt, d.mime_type, d.dateiname, d.inhalt_hash, r.klient_id
         FROM rechnung_dokument d
         JOIN rechnung r ON r.id = d.rechnung_id
         WHERE d.rechnung_id = $1`,
        [rechnungId]
      );
      if (rows.length === 0) return null;
      if (!(await klientIstErlaubt(client, benutzerId, rows[0].klient_id))) return null;
      return { inhalt: rows[0].inhalt, mimeType: rows[0].mime_type, dateiname: rows[0].dateiname, hash: rows[0].inhalt_hash };
    });
  }

  private async findeEineIntern(client: import("pg").PoolClient, id: string): Promise<RechnungDto> {
    const { rows } = await client.query(`${LISTEN_SELECT} WHERE r.id = $1`, [id]);
    return zuDto(rows[0]);
  }
}

function zuDto(r: any): RechnungDto {
  return {
    id: r.id,
    klientId: r.klient_id,
    klientName: `${r.vorname} ${r.nachname}`,
    betragCent: r.betrag_cent,
    beschreibung: r.beschreibung,
    erstelltAm: r.erstellt_am,
    status: r.status,
    statusGrund: r.grund,
    hatDokument: r.hat_dokument,
  };
}

function isPgError(err: unknown): err is { code: string; message: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
