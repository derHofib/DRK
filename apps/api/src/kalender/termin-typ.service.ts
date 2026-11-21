import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Leistungsart, TerminTypAendernEingabe, TerminTypBetreuungszeit, TerminTypDto, TerminTypEingabe, TerminTypFarbe } from "@zimmerakte/shared";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { isPgError } from "../common/pg-error";
import { RechteService } from "../rechte/rechte.service";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

interface TypZeile {
  id: string;
  bezeichnung: string;
  farbe: TerminTypFarbe;
  betreuungszeit: TerminTypBetreuungszeit;
  leistungsart: Leistungsart | null;
  reihenfolge: number;
  aktiv: boolean;
  ist_standard: boolean;
}

const SPALTEN = "id, bezeichnung, farbe, betreuungszeit, leistungsart, reihenfolge, aktiv, ist_standard";

function zuDto(r: TypZeile): TerminTypDto {
  return {
    id: r.id,
    bezeichnung: r.bezeichnung,
    farbe: r.farbe,
    istStandard: r.ist_standard,
    betreuungszeit: r.betreuungszeit,
    leistungsart: r.leistungsart,
    reihenfolge: r.reihenfolge,
    aktiv: r.aktiv,
  };
}

function doppelt(err: unknown): never {
  if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
    throw new ConflictException("Einen Termintyp mit dieser Bezeichnung gibt es schon.");
  }
  throw err;
}

/**
 * Eigene Termintypen (migrations/0085). Lesen darf jede:r Mitarbeitende --
 * der Termin-Dialog braucht die Liste. Alles Schreibende verlangt
 * kalender.typen-verwalten; die Pruefung steht hier neben dem SQL, nicht im
 * Controller (CLAUDE.md, Rollenpruefungen).
 */
@Injectable()
export class TerminTypService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  /** Auch ausgeblendete: die Verwaltungsseite muss sie wieder einblenden koennen; die Auswahl filtert auf aktiv. */
  async liste(): Promise<TerminTypDto[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<TypZeile>(`SELECT ${SPALTEN} FROM termin_typ ORDER BY reihenfolge, bezeichnung`);
      return rows.map(zuDto);
    });
  }

  async anlegen(eingabe: TerminTypEingabe): Promise<TerminTypDto> {
    const ctx = requireTenantContext();
    await this.verlangeRecht();
    try {
      return await this.db.withTenant(async (client) => {
        // Neue Typen ans Ende: wer einen Typ ergaenzt, will die gewohnte
        // Reihenfolge im Termin-Dialog nicht durcheinanderbringen.
        const { rows } = await client.query<TypZeile>(
          `INSERT INTO termin_typ (mandant_id, bezeichnung, farbe, betreuungszeit, leistungsart, reihenfolge)
           VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(max(reihenfolge), -1) + 1 FROM termin_typ))
           RETURNING ${SPALTEN}`,
          [ctx.mandantId, eingabe.bezeichnung.trim(), eingabe.farbe, eingabe.betreuungszeit, eingabe.leistungsart]
        );
        return zuDto(rows[0]);
      });
    } catch (err) {
      doppelt(err);
    }
  }

  /**
   * Ausblenden (aktiv=false) aendert keinen bestehenden Termin: alte Termine
   * behalten Name und Farbe, nur die Auswahl bietet den Typ nicht mehr an.
   * Bewusst kein "kuenftige Termine umstellen": Termine sind per RLS nur
   * fuer Beteiligte sichtbar (0053), auch fuer die Leitung -- ein solches
   * Umstellen ginge nur an der Sichtbarkeit vorbei.
   */
  async aendern(id: string, eingabe: TerminTypAendernEingabe): Promise<TerminTypDto> {
    await this.verlangeRecht();
    try {
      return await this.db.withTenant(async (client) => {
        const alt = await ladeTyp(client, id);
        if (alt.ist_standard && eingabe.aktiv === false) {
          throw new BadRequestException("Der Standardtyp kann nicht ausgeblendet werden: Termine ohne gewählten Typ landen dort.");
        }
        const { rows } = await client.query<TypZeile>(
          `UPDATE termin_typ
           SET bezeichnung = $2, farbe = $3, betreuungszeit = $4, leistungsart = $5, aktiv = $6
           WHERE id = $1
           RETURNING ${SPALTEN}`,
          [
            id,
            eingabe.bezeichnung !== undefined ? eingabe.bezeichnung.trim() : alt.bezeichnung,
            eingabe.farbe ?? alt.farbe,
            eingabe.betreuungszeit ?? alt.betreuungszeit,
            eingabe.leistungsart !== undefined ? eingabe.leistungsart : alt.leistungsart,
            eingabe.aktiv ?? alt.aktiv,
          ]
        );
        return zuDto(rows[0]);
      });
    } catch (err) {
      doppelt(err);
    }
  }

  /** Neue Reihenfolge als vollstaendige ID-Liste -- so kann keine halbe Sortierung entstehen. */
  async reihenfolge(ids: string[]): Promise<TerminTypDto[]> {
    await this.verlangeRecht();
    await this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ id: string }>("SELECT id FROM termin_typ");
      const vorhanden = new Set(rows.map((r) => r.id));
      if (ids.length !== vorhanden.size || new Set(ids).size !== ids.length || !ids.every((i) => vorhanden.has(i))) {
        throw new BadRequestException("Die Reihenfolge muss jeden Termintyp genau einmal enthalten.");
      }
      for (const [i, typId] of ids.entries()) {
        await client.query("UPDATE termin_typ SET reihenfolge = $2 WHERE id = $1", [typId, i]);
      }
    });
    return this.liste();
  }

  /**
   * Nur ein nie benutzter Typ verschwindet ganz. Ob er benutzt ist, weiss
   * verbindlich nur der Fremdschluessel -- auch Termine, die die anfragende
   * Person nicht sehen darf, zaehlen. Deshalb kein vorheriges Zaehlen.
   */
  async loeschen(id: string): Promise<void> {
    await this.verlangeRecht();
    try {
      await this.db.withTenant(async (client) => {
        const alt = await ladeTyp(client, id);
        if (alt.ist_standard) throw new BadRequestException("Der Standardtyp kann nicht gelöscht werden.");
        await client.query("DELETE FROM termin_typ WHERE id = $1", [id]);
      });
    } catch (err) {
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new ConflictException("Dieser Typ steckt schon in Terminen. Blende ihn stattdessen aus, dann behalten die Termine ihren Typ.");
      }
      throw err;
    }
  }

  private async verlangeRecht(): Promise<void> {
    if (!(await this.rechte.hatRecht("kalender", "typen-verwalten"))) {
      throw new ForbiddenException("Termintypen verwalten darf nur, wer das Recht dazu hat.");
    }
  }
}

async function ladeTyp(client: PoolClient, id: string): Promise<TypZeile> {
  const { rows } = await client.query<TypZeile>(`SELECT ${SPALTEN} FROM termin_typ WHERE id = $1`, [id]);
  if (rows.length === 0) throw new NotFoundException("Termintyp nicht gefunden.");
  return rows[0];
}

/**
 * Fuer KalenderService: der gewaehlte Typ eines neuen oder geaenderten
 * Termins. Ausgeblendete Typen lassen sich nicht neu waehlen; ein Termin,
 * der ihn schon hat, behaelt ihn (der Aufrufer prueft nur bei Wechsel).
 */
export async function waehlbarerTyp(client: PoolClient, id: string): Promise<{ id: string; leistungsart: Leistungsart | null }> {
  const { rows } = await client.query<{ id: string; aktiv: boolean; leistungsart: Leistungsart | null }>(
    "SELECT id, aktiv, leistungsart FROM termin_typ WHERE id = $1",
    [id]
  );
  if (rows.length === 0) throw new BadRequestException("Unbekannter Termintyp.");
  if (!rows[0].aktiv) throw new BadRequestException("Dieser Termintyp ist ausgeblendet und kann nicht mehr gewählt werden.");
  return rows[0];
}
