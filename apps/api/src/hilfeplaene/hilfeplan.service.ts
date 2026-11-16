import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { heuteBerlin } from "../common/heute";
import { isPgError } from "../common/pg-error";
import { klientIstArchiviert, klientIstErlaubt } from "../common/standort-restriction";

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

export interface HilfeplanVerlaufDto {
  id: string;
  fortschritt: number;
  notiz: string | null;
  erstelltAm: string;
  erstelltVonName: string | null;
  tagesbericht: { id: string; datum: string } | null;
}

export interface HilfeplanZielDto {
  id: string;
  hilfeplanId: string;
  titel: string;
  beschreibung: string | null;
  faelligAm: string | null;
  verworfen: boolean;
  /** Abgeleitet: Fortschritt des juengsten Verlaufseintrags, 0 ohne Eintrag. */
  fortschritt: number;
  erreicht: boolean;
  ueberfaellig: boolean;
  /** Neueste zuerst. */
  verlauf: HilfeplanVerlaufDto[];
}

export interface HilfeplanDto {
  id: string;
  klientId: string;
  von: string;
  bis: string | null;
  naechstesGespraech: string | null;
  bemerkung: string | null;
  ziele: HilfeplanZielDto[];
}

@Injectable()
export class HilfeplanService {
  constructor(private readonly db: DatabaseService) {}

  async findeAlleFuerKlient(klientId: string): Promise<HilfeplanDto[]> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, klientId))) return [];
      return ladeFuerKlient(client, klientId);
    });
  }

  async planAnlegen(input: {
    klientId: string;
    von: string;
    bis?: string;
    naechstesGespraech?: string;
    bemerkung?: string;
  }): Promise<HilfeplanDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      await schreibzugriffPruefen(client, benutzerId, input.klientId);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hilfeplan (mandant_id, klient_id, von, bis, naechstes_gespraech, bemerkung, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          mandantId,
          input.klientId,
          input.von,
          input.bis ?? null,
          input.naechstesGespraech ?? null,
          input.bemerkung || null,
          benutzerId,
        ]
      );
      return ladeEinenPlan(client, rows[0].id);
    });
  }

  async planAendern(
    planId: string,
    input: { bis?: string | null; naechstesGespraech?: string | null; bemerkung?: string | null }
  ): Promise<HilfeplanDto> {
    const { benutzerId } = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        const klientId = await klientIdDesPlans(client, planId);
        if (!klientId) throw new NotFoundException("Hilfeplan nicht gefunden.");
        await schreibzugriffPruefen(client, benutzerId, klientId);
        // Pro Feld "fehlend = unveraendert, null = leeren" -- deshalb die
        // Schalter-Parameter statt COALESCE, das ein bewusstes Leeren nicht
        // von "nicht angegeben" unterscheiden koennte.
        await client.query(
          `UPDATE hilfeplan SET
             bis = CASE WHEN $2 THEN $3::date ELSE bis END,
             naechstes_gespraech = CASE WHEN $4 THEN $5::date ELSE naechstes_gespraech END,
             bemerkung = CASE WHEN $6 THEN $7 ELSE bemerkung END
           WHERE id = $1`,
          [
            planId,
            input.bis !== undefined,
            input.bis ?? null,
            input.naechstesGespraech !== undefined,
            input.naechstesGespraech ?? null,
            input.bemerkung !== undefined,
            input.bemerkung || null,
          ]
        );
        return ladeEinenPlan(client, planId);
      });
    } catch (err) {
      if (isPgError(err) && err.code === CHECK_VIOLATION) {
        throw new BadRequestException("Das Enddatum muss nach dem Startdatum liegen.");
      }
      throw err;
    }
  }

  async zielAnlegen(
    planId: string,
    input: { titel: string; beschreibung?: string; faelligAm?: string }
  ): Promise<HilfeplanDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const klientId = await klientIdDesPlans(client, planId);
      if (!klientId) throw new NotFoundException("Hilfeplan nicht gefunden.");
      await schreibzugriffPruefen(client, benutzerId, klientId);
      await client.query(
        `INSERT INTO hilfeplan_ziel (mandant_id, klient_id, hilfeplan_id, titel, beschreibung, faellig_am, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [mandantId, klientId, planId, input.titel, input.beschreibung || null, input.faelligAm ?? null, benutzerId]
      );
      return ladeEinenPlan(client, planId);
    });
  }

  async zielAendern(
    zielId: string,
    input: { titel?: string; beschreibung?: string | null; faelligAm?: string | null; verworfen?: boolean }
  ): Promise<HilfeplanDto> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const ziel = await zielLaden(client, zielId);
      if (!ziel) throw new NotFoundException("Ziel nicht gefunden.");
      await schreibzugriffPruefen(client, benutzerId, ziel.klient_id);
      await client.query(
        `UPDATE hilfeplan_ziel SET
           titel = COALESCE($2, titel),
           beschreibung = CASE WHEN $3 THEN $4 ELSE beschreibung END,
           faellig_am = CASE WHEN $5 THEN $6::date ELSE faellig_am END,
           verworfen_am = CASE WHEN $7::boolean IS NULL THEN verworfen_am
                               WHEN $7 THEN COALESCE(verworfen_am, now())
                               ELSE NULL END
         WHERE id = $1`,
        [
          zielId,
          input.titel ?? null,
          input.beschreibung !== undefined,
          input.beschreibung || null,
          input.faelligAm !== undefined,
          input.faelligAm ?? null,
          input.verworfen ?? null,
        ]
      );
      return ladeEinenPlan(client, ziel.hilfeplan_id);
    });
  }

  /**
   * Haengt einen Fortschrittsstand an. Verlaeufe werden nie geaendert -- eine
   * Korrektur ist ein neuer Eintrag (append-only, Migration 0070).
   */
  async verlaufErfassen(
    zielId: string,
    input: { fortschritt: number; notiz?: string; tagesberichtId?: string }
  ): Promise<HilfeplanDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    try {
      return await this.db.withTenant(async (client) => {
        const ziel = await zielLaden(client, zielId);
        if (!ziel) throw new NotFoundException("Ziel nicht gefunden.");
        await schreibzugriffPruefen(client, benutzerId, ziel.klient_id);
        if (ziel.verworfen_am) {
          throw new BadRequestException("Ein verworfenes Ziel kann keinen neuen Fortschritt mehr erhalten.");
        }
        await client.query(
          `INSERT INTO hilfeplan_ziel_verlauf
             (mandant_id, klient_id, ziel_id, fortschritt, notiz, tagesbericht_id, erstellt_von)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [mandantId, ziel.klient_id, zielId, input.fortschritt, input.notiz || null, input.tagesberichtId ?? null, benutzerId]
        );
        return ladeEinenPlan(client, ziel.hilfeplan_id);
      });
    } catch (err) {
      // Zusammengesetzter FK (tagesbericht_id, klient_id): der Bericht
      // existiert nicht oder gehoert zu einem anderen Klienten.
      if (isPgError(err) && err.code === FOREIGN_KEY_VIOLATION) {
        throw new BadRequestException("Dieser Tagesbericht gehört nicht zu diesem Klienten.");
      }
      throw err;
    }
  }
}

async function schreibzugriffPruefen(client: PoolClient, benutzerId: string, klientId: string): Promise<void> {
  if (!(await klientIstErlaubt(client, benutzerId, klientId))) {
    throw new NotFoundException("Klient nicht gefunden.");
  }
  // klientIstErlaubt() laesst unbeschraenkte Konten ohne Existenzpruefung
  // durch; das SELECT hier laeuft unter RLS und findet einen fremden Klienten
  // deshalb nicht. Die Datenbank sichert dasselbe zusaetzlich per
  // mandantenfestem Fremdschluessel (Migration 0070).
  const { rows } = await client.query("SELECT 1 FROM klient WHERE id = $1", [klientId]);
  if (rows.length === 0) throw new NotFoundException("Klient nicht gefunden.");
  if (await klientIstArchiviert(client, klientId)) {
    throw new BadRequestException("Dieser Klient ist archiviert und kann nicht mehr bearbeitet werden.");
  }
}

async function klientIdDesPlans(client: PoolClient, planId: string): Promise<string | null> {
  const { rows } = await client.query<{ klient_id: string }>("SELECT klient_id FROM hilfeplan WHERE id = $1", [planId]);
  return rows[0]?.klient_id ?? null;
}

async function zielLaden(client: PoolClient, zielId: string) {
  const { rows } = await client.query<{ klient_id: string; hilfeplan_id: string; verworfen_am: string | null }>(
    "SELECT klient_id, hilfeplan_id, verworfen_am FROM hilfeplan_ziel WHERE id = $1",
    [zielId]
  );
  return rows[0] ?? null;
}

async function ladeEinenPlan(client: PoolClient, planId: string): Promise<HilfeplanDto> {
  const klientId = await klientIdDesPlans(client, planId);
  if (!klientId) throw new NotFoundException("Hilfeplan nicht gefunden.");
  const alle = await ladeFuerKlient(client, klientId);
  const plan = alle.find((p) => p.id === planId);
  if (!plan) throw new NotFoundException("Hilfeplan nicht gefunden.");
  return plan;
}

async function ladeFuerKlient(client: PoolClient, klientId: string): Promise<HilfeplanDto[]> {
  const { rows: plaene } = await client.query(
    `SELECT id, klient_id, von, bis, naechstes_gespraech, bemerkung
     FROM hilfeplan WHERE klient_id = $1 ORDER BY von DESC, erstellt_am DESC`,
    [klientId]
  );
  const { rows: ziele } = await client.query(
    `SELECT id, hilfeplan_id, titel, beschreibung, faellig_am, verworfen_am
     FROM hilfeplan_ziel WHERE klient_id = $1 ORDER BY faellig_am NULLS LAST, erstellt_am`,
    [klientId]
  );
  const { rows: verlaeufe } = await client.query(
    `SELECT v.id, v.ziel_id, v.fortschritt, v.notiz, v.erstellt_am, b.name AS von_name,
            t.id AS bericht_id, t.datum AS bericht_datum
     FROM hilfeplan_ziel_verlauf v
     LEFT JOIN benutzer b ON b.id = v.erstellt_von
     LEFT JOIN tagesbericht t ON t.id = v.tagesbericht_id
     WHERE v.klient_id = $1
     ORDER BY v.erstellt_am DESC`,
    [klientId]
  );

  const heute = heuteBerlin();
  const verlaufJeZiel = new Map<string, HilfeplanVerlaufDto[]>();
  for (const v of verlaeufe) {
    const eintrag: HilfeplanVerlaufDto = {
      id: v.id,
      fortschritt: v.fortschritt,
      notiz: v.notiz,
      erstelltAm: new Date(v.erstellt_am).toISOString(),
      erstelltVonName: v.von_name,
      tagesbericht: v.bericht_id ? { id: v.bericht_id, datum: v.bericht_datum } : null,
    };
    const liste = verlaufJeZiel.get(v.ziel_id) ?? [];
    liste.push(eintrag);
    verlaufJeZiel.set(v.ziel_id, liste);
  }

  const zieleJePlan = new Map<string, HilfeplanZielDto[]>();
  for (const z of ziele) {
    const verlauf = verlaufJeZiel.get(z.id) ?? [];
    const fortschritt = verlauf[0]?.fortschritt ?? 0;
    const verworfen = z.verworfen_am !== null;
    const erreicht = !verworfen && fortschritt === 100;
    const dto: HilfeplanZielDto = {
      id: z.id,
      hilfeplanId: z.hilfeplan_id,
      titel: z.titel,
      beschreibung: z.beschreibung,
      faelligAm: z.faellig_am,
      verworfen,
      fortschritt,
      erreicht,
      ueberfaellig: !verworfen && !erreicht && z.faellig_am !== null && z.faellig_am < heute,
      verlauf,
    };
    const liste = zieleJePlan.get(z.hilfeplan_id) ?? [];
    liste.push(dto);
    zieleJePlan.set(z.hilfeplan_id, liste);
  }

  return plaene.map((p) => ({
    id: p.id,
    klientId: p.klient_id,
    von: p.von,
    bis: p.bis,
    naechstesGespraech: p.naechstes_gespraech,
    bemerkung: p.bemerkung,
    ziele: zieleJePlan.get(p.id) ?? [],
  }));
}
