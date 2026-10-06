import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { RechteService } from "../rechte/rechte.service";

export type AnwaerterStatus = "offen" | "angenommen" | "abgelehnt";

export interface AnwaerterEintrag {
  id: string;
  vorname: string;
  nachname: string;
  geburtsdatum: string | null;
  telefon: string | null;
  email: string | null;
  anfragendeStelle: string | null;
  notiz: string | null;
  status: AnwaerterStatus;
  ablehnungGrund: string | null;
  klientId: string | null;
  erstelltAm: string;
  erstelltVonName: string | null;
  entschiedenAm: string | null;
  entschiedenVonName: string | null;
}

const LISTEN_SELECT = `
  SELECT a.id, a.vorname, a.nachname, a.geburtsdatum, a.telefon, a.email, a.anfragende_stelle, a.notiz,
         a.status, a.ablehnung_grund, a.klient_id, a.erstellt_am, eb.name AS erstellt_von_name,
         a.entschieden_am, db.name AS entschieden_von_name
  FROM anwaerter a
  LEFT JOIN benutzer eb ON eb.id = a.erstellt_von
  LEFT JOIN benutzer db ON db.id = a.entschieden_von
`;

@Injectable()
export class AnwaerterService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async findeAlle(status: AnwaerterStatus = "offen"): Promise<AnwaerterEintrag[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(`${LISTEN_SELECT} WHERE a.status = $1 ORDER BY a.erstellt_am DESC`, [
        status,
      ]);
      return rows.map(zuEintrag);
    });
  }

  async findeEinen(id: string): Promise<AnwaerterEintrag> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(`${LISTEN_SELECT} WHERE a.id = $1`, [id]);
      if (rows.length === 0) throw new NotFoundException("Anfrage nicht gefunden.");
      return zuEintrag(rows[0]);
    });
  }

  async anlegen(input: {
    vorname: string;
    nachname: string;
    geburtsdatum?: string;
    telefon?: string;
    email?: string;
    anfragendeStelle?: string;
    notiz?: string;
  }): Promise<AnwaerterEintrag> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO anwaerter (mandant_id, vorname, nachname, geburtsdatum, telefon, email, anfragende_stelle, notiz, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          mandantId,
          input.vorname,
          input.nachname,
          input.geburtsdatum ?? null,
          input.telefon ?? null,
          input.email ?? null,
          input.anfragendeStelle ?? null,
          input.notiz ?? null,
          benutzerId,
        ]
      );
      return this.findeEineIntern(client, rows[0].id);
    });
  }

  async aktualisieren(
    id: string,
    input: {
      vorname?: string;
      nachname?: string;
      geburtsdatum?: string;
      telefon?: string;
      email?: string;
      anfragendeStelle?: string;
      notiz?: string;
    }
  ): Promise<AnwaerterEintrag> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `UPDATE anwaerter SET
           vorname = COALESCE($1, vorname),
           nachname = COALESCE($2, nachname),
           geburtsdatum = COALESCE($3, geburtsdatum),
           telefon = COALESCE($4, telefon),
           email = COALESCE($5, email),
           anfragende_stelle = COALESCE($6, anfragende_stelle),
           notiz = COALESCE($7, notiz)
         WHERE id = $8 AND status = 'offen'
         RETURNING id`,
        [
          input.vorname ?? null,
          input.nachname ?? null,
          input.geburtsdatum ?? null,
          input.telefon ?? null,
          input.email ?? null,
          input.anfragendeStelle ?? null,
          input.notiz ?? null,
          id,
        ]
      );
      if (rows.length === 0) {
        const { rows: vorhanden } = await client.query("SELECT id FROM anwaerter WHERE id = $1", [id]);
        if (vorhanden.length === 0) throw new NotFoundException("Anfrage nicht gefunden.");
        throw new BadRequestException("Eine bereits entschiedene Anfrage kann nicht mehr bearbeitet werden.");
      }
      return this.findeEineIntern(client, id);
    });
  }

  async loeschen(id: string): Promise<void> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query("DELETE FROM anwaerter WHERE id = $1 AND status = 'offen' RETURNING id", [
        id,
      ]);
      if (rows.length === 0) {
        const { rows: vorhanden } = await client.query("SELECT id FROM anwaerter WHERE id = $1", [id]);
        if (vorhanden.length === 0) throw new NotFoundException("Anfrage nicht gefunden.");
        throw new BadRequestException("Eine bereits entschiedene Anfrage kann nicht mehr gelöscht werden.");
      }
    });
  }

  /**
   * Legt in derselben Transaktion einen echten Klienten an und verweist
   * vom Anwaerter-Datensatz darauf -- "WHERE status = 'offen'" beim
   * abschliessenden UPDATE verhindert ein doppeltes Annehmen (409 bei
   * einer zweiten, gleichzeitigen Entscheidung), ohne dass ein separater
   * Lese-Check noetig waere (gleiches Prinzip wie kostenuebernahme.beenden()).
   */
  // Eine Aufnahmeentscheidung ist eine strukturelle Entscheidung ueber die
  // Einrichtung (Kapazitaet, Traegermittel), kein alltaegliches Erfassen
  // einer Anfrage. Das blosse Anlegen/Bearbeiten/Loeschen einer Anfrage
  // bleibt dagegen fuer alle Rollen offen, wie klient.anlegen() heute schon.
  async annehmen(
    id: string,
    input: { aktenzeichen: string; amt: string; hzlRhythmus: "monatlich" | "woechentlich" }
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("anwaerter", "entscheiden"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen eine Anfrage annehmen.");
    }
    return this.db.withTenant(async (client) => {
      const { rows: anwaerterRows } = await client.query(
        "SELECT vorname, nachname, geburtsdatum FROM anwaerter WHERE id = $1 AND status = 'offen'",
        [id]
      );
      if (anwaerterRows.length === 0) {
        const { rows: vorhanden } = await client.query("SELECT id FROM anwaerter WHERE id = $1", [id]);
        if (vorhanden.length === 0) throw new NotFoundException("Anfrage nicht gefunden.");
        throw new ConflictException("Über diese Anfrage wurde bereits entschieden.");
      }
      const anwaerterRow = anwaerterRows[0];

      const { rows: klientRows } = await client.query(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt, hzl_rhythmus)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          ctx.mandantId,
          anwaerterRow.vorname,
          anwaerterRow.nachname,
          anwaerterRow.geburtsdatum,
          input.aktenzeichen,
          input.amt,
          input.hzlRhythmus,
        ]
      );
      const klientId = klientRows[0].id;

      const { rows } = await client.query(
        `UPDATE anwaerter SET status = 'angenommen', klient_id = $1, entschieden_von = $2, entschieden_am = now()
         WHERE id = $3 AND status = 'offen'
         RETURNING id`,
        [klientId, ctx.benutzerId, id]
      );
      if (rows.length === 0) {
        throw new ConflictException("Über diese Anfrage wurde bereits entschieden.");
      }
      return { id: klientId };
    });
  }

  async ablehnen(id: string, grund: string): Promise<AnwaerterEintrag> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("anwaerter", "entscheiden"))) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen eine Anfrage ablehnen.");
    }
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `UPDATE anwaerter SET status = 'abgelehnt', ablehnung_grund = $1, entschieden_von = $2, entschieden_am = now()
         WHERE id = $3 AND status = 'offen'
         RETURNING id`,
        [grund, ctx.benutzerId, id]
      );
      if (rows.length === 0) {
        const { rows: vorhanden } = await client.query("SELECT id FROM anwaerter WHERE id = $1", [id]);
        if (vorhanden.length === 0) throw new NotFoundException("Anfrage nicht gefunden.");
        throw new ConflictException("Über diese Anfrage wurde bereits entschieden.");
      }
      return this.findeEineIntern(client, id);
    });
  }

  private async findeEineIntern(client: import("pg").PoolClient, id: string): Promise<AnwaerterEintrag> {
    const { rows } = await client.query(`${LISTEN_SELECT} WHERE a.id = $1`, [id]);
    return zuEintrag(rows[0]);
  }
}

function zuEintrag(r: any): AnwaerterEintrag {
  return {
    id: r.id,
    vorname: r.vorname,
    nachname: r.nachname,
    geburtsdatum: r.geburtsdatum,
    telefon: r.telefon,
    email: r.email,
    anfragendeStelle: r.anfragende_stelle,
    notiz: r.notiz,
    status: r.status,
    ablehnungGrund: r.ablehnung_grund,
    klientId: r.klient_id,
    erstelltAm: r.erstellt_am,
    erstelltVonName: r.erstellt_von_name,
    entschiedenAm: r.entschieden_am,
    entschiedenVonName: r.entschieden_von_name,
  };
}
