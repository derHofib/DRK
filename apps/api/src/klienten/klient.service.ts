import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";

export interface KlientListEintrag {
  id: string;
  vorname: string;
  nachname: string;
  aktenzeichen: string;
  amt: string;
  hzlRhythmus: "monatlich" | "woechentlich";
  aktuellesZimmer: { id: string; nummer: string; standortName: string } | null;
}

export interface KlientDetail extends KlientListEintrag {
  geburtsdatum: string;
}

@Injectable()
export class KlientService {
  constructor(private readonly db: DatabaseService) {}

  async findeAlle(): Promise<KlientListEintrag[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          k.id, k.vorname, k.nachname, k.aktenzeichen, k.amt, k.hzl_rhythmus,
          z.id AS zimmer_id, z.nummer AS zimmer_nummer, s.name AS standort_name
        FROM klient k
        LEFT JOIN belegung b ON b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
        LEFT JOIN zimmer z ON z.id = b.zimmer_id
        LEFT JOIN standort s ON s.id = z.standort_id
        ORDER BY k.nachname, k.vorname
        `
      );
      return rows.map(zuListEintrag);
    });
  }

  async anlegen(input: {
    vorname: string;
    nachname: string;
    geburtsdatum: string;
    aktenzeichen: string;
    amt: string;
    hzlRhythmus: "monatlich" | "woechentlich";
  }) {
    const { mandantId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus`,
        [mandantId, input.vorname, input.nachname, input.geburtsdatum, input.aktenzeichen, input.amt, input.hzlRhythmus]
      );
      return { ...rows[0], hzlRhythmus: rows[0].hzl_rhythmus, aktuellesZimmer: null };
    });
  }

  async findeEinen(id: string): Promise<KlientDetail> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          k.id, k.vorname, k.nachname, k.geburtsdatum, k.aktenzeichen, k.amt, k.hzl_rhythmus,
          z.id AS zimmer_id, z.nummer AS zimmer_nummer, s.name AS standort_name
        FROM klient k
        LEFT JOIN belegung b ON b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
        LEFT JOIN zimmer z ON z.id = b.zimmer_id
        LEFT JOIN standort s ON s.id = z.standort_id
        WHERE k.id = $1
        `,
        [id]
      );
      if (rows.length === 0) throw new NotFoundException("Klient nicht gefunden.");
      return { ...zuListEintrag(rows[0]), geburtsdatum: rows[0].geburtsdatum };
    });
  }
}

function zuListEintrag(r: any): KlientListEintrag {
  return {
    id: r.id,
    vorname: r.vorname,
    nachname: r.nachname,
    aktenzeichen: r.aktenzeichen,
    amt: r.amt,
    hzlRhythmus: r.hzl_rhythmus,
    aktuellesZimmer: r.zimmer_id
      ? { id: r.zimmer_id, nummer: r.zimmer_nummer, standortName: r.standort_name }
      : null,
  };
}
