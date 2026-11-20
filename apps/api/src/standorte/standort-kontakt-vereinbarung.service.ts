import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  STANDORT_KONTAKT_ROLLE_LABEL,
  type StandortKontaktDto,
  type StandortKontaktEingabe,
  type StandortKontaktRolle,
  type StandortVereinbarungAenderung,
  type StandortVereinbarungDto,
  type StandortVereinbarungEingabe,
} from "@zimmerakte/shared";
import { AuditService } from "../audit/audit.service";
import { requireTenantContext } from "../common/tenant-context";
import { standortIstErlaubt } from "../common/standort-restriction";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";

/**
 * Kontakte vor Ort und Vereinbarungen eines Standorts (Steckbrief Phase 2,
 * migrations/0081). Lesen laeuft ueber steckbrief() im StandortService,
 * der die Helfer unten aufruft; hier stehen die Schreibwege mit ihren
 * Rechtepruefungen neben dem SQL, das sie schuetzen.
 */

const KONTAKT_REIHENFOLGE = Object.keys(STANDORT_KONTAKT_ROLLE_LABEL) as StandortKontaktRolle[];

export async function kontakteLesen(client: PoolClient, standortId: string): Promise<StandortKontaktDto[]> {
  const { rows } = await client.query(
    `SELECT id, rolle, name, telefon, email, hinweis
     FROM standort_kontakt WHERE standort_id = $1
     ORDER BY array_position($2::text[], rolle), name`,
    [standortId, KONTAKT_REIHENFOLGE]
  );
  return rows;
}

// "Schon verlaengert" wie in der Erinnerungsfunktion (0081): eine
// Folgevereinbarung derselben Art schliesst nahtlos an.
const FOLGE_EXISTIERT = `EXISTS (
  SELECT 1 FROM standort_vereinbarung folge
  WHERE folge.standort_id = v.standort_id AND folge.art = v.art AND folge.id <> v.id
    AND folge.storniert_am IS NULL
    AND folge.gueltig_von > v.gueltig_von
    AND folge.gueltig_von <= v.gueltig_bis + 1
    AND (folge.gueltig_bis IS NULL OR folge.gueltig_bis > v.gueltig_bis))`;

const HEUTE_GUELTIG = `v.storniert_am IS NULL AND v.gueltig_von <= CURRENT_DATE
  AND (v.gueltig_bis IS NULL OR v.gueltig_bis >= CURRENT_DATE)`;

/**
 * Status wird abgeleitet (CLAUDE.md Regel 4). "endet_bald" ab 90 Tagen --
 * dieselbe Schwelle wie die erste Erinnerungsaufgabe.
 */
export async function vereinbarungenLesen(client: PoolClient, standortId: string): Promise<StandortVereinbarungDto[]> {
  const { rows } = await client.query(
    `SELECT v.*, b.name AS erstellt_von_name,
            CASE
              WHEN v.storniert_am IS NOT NULL THEN 'storniert'
              WHEN v.gueltig_von > CURRENT_DATE THEN 'kuenftig'
              WHEN v.gueltig_bis IS NOT NULL AND v.gueltig_bis < CURRENT_DATE THEN 'abgelaufen'
              WHEN v.gueltig_bis IS NOT NULL AND ${FOLGE_EXISTIERT} THEN 'verlaengert'
              WHEN v.gueltig_bis IS NOT NULL AND v.gueltig_bis <= CURRENT_DATE + 90 THEN 'endet_bald'
              ELSE 'gueltig'
            END AS status,
            (v.gueltig_bis - CURRENT_DATE) AS tage
     FROM standort_vereinbarung v
     LEFT JOIN benutzer b ON b.id = v.erstellt_von
     WHERE v.standort_id = $1
     ORDER BY (v.storniert_am IS NOT NULL), v.gueltig_von DESC, v.erstellt_am DESC`,
    [standortId]
  );
  return rows.map((r) => ({
    id: r.id,
    art: r.art,
    partner: r.partner,
    kennung: r.kennung,
    gueltigVon: r.gueltig_von,
    gueltigBis: r.gueltig_bis,
    plaetze: r.plaetze,
    verguetungTagCent: r.verguetung_tag_cent,
    bemerkung: r.bemerkung,
    erstelltAm: r.erstellt_am instanceof Date ? r.erstellt_am.toISOString() : r.erstellt_am,
    erstelltVonName: r.erstellt_von_name,
    storniertAm: r.storniert_am instanceof Date ? r.storniert_am.toISOString() : r.storniert_am,
    stornoGrund: r.storno_grund,
    status: r.status,
    endetInTagen: r.status === "endet_bald" ? Number(r.tage) : null,
  }));
}

/** Die engste heute gueltige Grenze bindet; null = keine Vereinbarung mit Plaetzen. */
export async function genehmigtePlaetzeLesen(client: PoolClient, standortId: string): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT min(v.plaetze) AS plaetze FROM standort_vereinbarung v
     WHERE v.standort_id = $1 AND v.plaetze IS NOT NULL AND ${HEUTE_GUELTIG}`,
    [standortId]
  );
  return rows[0].plaetze === null ? null : Number(rows[0].plaetze);
}

const KONTAKT_SPALTEN = { rolle: "rolle", name: "name", telefon: "telefon", email: "email", hinweis: "hinweis" } as const;
const VEREINBARUNG_AENDERBAR = { gueltigBis: "gueltig_bis", kennung: "kennung", bemerkung: "bemerkung" } as const;

@Injectable()
export class StandortKontaktVereinbarungService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly audit: AuditService
  ) {}

  /**
   * Recht UND Standort: eine auf Haus A beschraenkte Leitung hat das Recht
   * auch, darf an Haus B aber nichts aendern. 404 statt 403 wie in
   * aktualisieren(), damit ein fremder Standort nicht erkennbar ist.
   */
  private async pruefe(client: PoolClient, standortId: string) {
    const { benutzerId } = requireTenantContext();
    if (!(await standortIstErlaubt(client, benutzerId, standortId))) {
      throw new NotFoundException("Standort nicht gefunden.");
    }
  }

  private async brauchtRecht(aktion: "bearbeiten" | "vereinbarungen", meldung: string) {
    if (!(await this.rechte.hatRecht("standorte", aktion))) throw new ForbiddenException(meldung);
  }

  // --- Kontakte vor Ort -----------------------------------------------------

  async kontaktAnlegen(standortId: string, eingabe: StandortKontaktEingabe): Promise<StandortKontaktDto> {
    await this.brauchtRecht("bearbeiten", "Kontakte vor Ort pflegt, wer den Standort bearbeiten darf.");
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      await this.pruefe(client, standortId);
      const { rows } = await client.query(
        `INSERT INTO standort_kontakt (mandant_id, standort_id, rolle, name, telefon, email, hinweis, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, rolle, name, telefon, email, hinweis`,
        [
          ctx.mandantId,
          standortId,
          eingabe.rolle,
          eingabe.name,
          eingabe.telefon ?? null,
          eingabe.email ?? null,
          eingabe.hinweis ?? null,
          ctx.benutzerId,
        ]
      );
      await this.audit.protokollieren(client, {
        modul: "standorte",
        aktion: "kontakt-anlegen",
        objektTyp: "standort_kontakt",
        objektId: rows[0].id,
        nachher: { standortId, ...eingabe },
      });
      return rows[0];
    });
  }

  async kontaktAendern(
    standortId: string,
    kontaktId: string,
    eingabe: Partial<StandortKontaktEingabe>
  ): Promise<StandortKontaktDto> {
    await this.brauchtRecht("bearbeiten", "Kontakte vor Ort pflegt, wer den Standort bearbeiten darf.");
    return this.db.withTenant(async (client) => {
      await this.pruefe(client, standortId);
      const { rows: alt } = await client.query(
        "SELECT * FROM standort_kontakt WHERE id = $1 AND standort_id = $2 FOR UPDATE",
        [kontaktId, standortId]
      );
      if (alt.length === 0) throw new NotFoundException("Kontakt nicht gefunden.");
      const felder = (Object.keys(eingabe) as (keyof StandortKontaktEingabe)[]).filter(
        (k) => eingabe[k] !== undefined && k in KONTAKT_SPALTEN
      );
      const vorher: Record<string, unknown> = {};
      const nachher: Record<string, unknown> = {};
      for (const k of felder) {
        if (alt[0][KONTAKT_SPALTEN[k]] === eingabe[k]) continue;
        vorher[k] = alt[0][KONTAKT_SPALTEN[k]];
        nachher[k] = eingabe[k];
      }
      const geaendert = Object.keys(nachher) as (keyof StandortKontaktEingabe)[];
      if (geaendert.length > 0) {
        const werte: unknown[] = geaendert.map((k) => eingabe[k]);
        const setzen = geaendert.map((k, i) => `${KONTAKT_SPALTEN[k]} = $${i + 1}`);
        werte.push(kontaktId);
        await client.query(`UPDATE standort_kontakt SET ${setzen.join(", ")} WHERE id = $${werte.length}`, werte);
        await this.audit.protokollieren(client, {
          modul: "standorte",
          aktion: "kontakt-bearbeiten",
          objektTyp: "standort_kontakt",
          objektId: kontaktId,
          vorher,
          nachher,
        });
      }
      const { rows } = await client.query(
        "SELECT id, rolle, name, telefon, email, hinweis FROM standort_kontakt WHERE id = $1",
        [kontaktId]
      );
      return rows[0];
    });
  }

  async kontaktLoeschen(standortId: string, kontaktId: string): Promise<void> {
    await this.brauchtRecht("bearbeiten", "Kontakte vor Ort pflegt, wer den Standort bearbeiten darf.");
    return this.db.withTenant(async (client) => {
      await this.pruefe(client, standortId);
      const { rows } = await client.query(
        "DELETE FROM standort_kontakt WHERE id = $1 AND standort_id = $2 RETURNING rolle, name, telefon, email, hinweis",
        [kontaktId, standortId]
      );
      if (rows.length === 0) throw new NotFoundException("Kontakt nicht gefunden.");
      // Der geloeschte Inhalt bleibt im Protokoll nachvollziehbar.
      await this.audit.protokollieren(client, {
        modul: "standorte",
        aktion: "kontakt-loeschen",
        objektTyp: "standort_kontakt",
        objektId: kontaktId,
        vorher: { standortId, ...rows[0] },
      });
    });
  }

  // --- Vereinbarungen -------------------------------------------------------

  async vereinbarungAnlegen(standortId: string, eingabe: StandortVereinbarungEingabe): Promise<StandortVereinbarungDto> {
    await this.brauchtRecht("vereinbarungen", "Vereinbarungen erfasst, wer das Recht dafür hat.");
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      await this.pruefe(client, standortId);
      const { rows } = await client.query(
        `INSERT INTO standort_vereinbarung
           (mandant_id, standort_id, art, partner, kennung, gueltig_von, gueltig_bis, plaetze, verguetung_tag_cent, bemerkung, erstellt_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          ctx.mandantId,
          standortId,
          eingabe.art,
          eingabe.partner,
          eingabe.kennung ?? null,
          eingabe.gueltigVon,
          eingabe.gueltigBis ?? null,
          eingabe.plaetze ?? null,
          eingabe.verguetungTagCent ?? null,
          eingabe.bemerkung ?? null,
          ctx.benutzerId,
        ]
      );
      const id = rows[0].id as string;
      await this.audit.protokollieren(client, {
        modul: "standorte",
        aktion: "vereinbarung-anlegen",
        objektTyp: "standort_vereinbarung",
        objektId: id,
        nachher: { standortId, ...eingabe },
      });
      return this.eine(client, standortId, id);
    });
  }

  async vereinbarungAendern(
    standortId: string,
    id: string,
    eingabe: StandortVereinbarungAenderung
  ): Promise<StandortVereinbarungDto> {
    await this.brauchtRecht("vereinbarungen", "Vereinbarungen ändert, wer das Recht dafür hat.");
    return this.db.withTenant(async (client) => {
      await this.pruefe(client, standortId);
      const alt = await this.zeileFuerUpdate(client, standortId, id);
      // Die Datenbank prueft dasselbe (CHECK), wuerde aber als 500 enden.
      if (eingabe.gueltigBis && eingabe.gueltigBis <= alt.gueltig_von) {
        throw new BadRequestException("„Gültig bis“ muss nach „gültig von“ liegen.");
      }
      const vorher: Record<string, unknown> = {};
      const nachher: Record<string, unknown> = {};
      for (const k of Object.keys(VEREINBARUNG_AENDERBAR) as (keyof StandortVereinbarungAenderung)[]) {
        if (eingabe[k] === undefined || alt[VEREINBARUNG_AENDERBAR[k]] === eingabe[k]) continue;
        vorher[k] = alt[VEREINBARUNG_AENDERBAR[k]];
        nachher[k] = eingabe[k];
      }
      const geaendert = Object.keys(nachher) as (keyof StandortVereinbarungAenderung)[];
      if (geaendert.length > 0) {
        const werte: unknown[] = geaendert.map((k) => eingabe[k]);
        const setzen = geaendert.map((k, i) => `${VEREINBARUNG_AENDERBAR[k]} = $${i + 1}`);
        werte.push(id);
        await client.query(`UPDATE standort_vereinbarung SET ${setzen.join(", ")} WHERE id = $${werte.length}`, werte);
        await this.audit.protokollieren(client, {
          modul: "standorte",
          aktion: "vereinbarung-bearbeiten",
          objektTyp: "standort_vereinbarung",
          objektId: id,
          vorher,
          nachher,
        });
      }
      return this.eine(client, standortId, id);
    });
  }

  /**
   * Statt Loeschen: ein Tippfehler in Partner, Plaetzen oder Verguetung
   * wird storniert und neu erfasst, damit kein Satz still ueberschrieben
   * wird (0081). Endgueltig -- der Trigger dort verhindert jede weitere
   * Aenderung.
   */
  async vereinbarungStornieren(standortId: string, id: string, grund: string): Promise<StandortVereinbarungDto> {
    await this.brauchtRecht("vereinbarungen", "Vereinbarungen storniert, wer das Recht dafür hat.");
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      await this.pruefe(client, standortId);
      await this.zeileFuerUpdate(client, standortId, id);
      await client.query(
        "UPDATE standort_vereinbarung SET storniert_am = now(), storniert_von = $1, storno_grund = $2 WHERE id = $3",
        [benutzerId, grund, id]
      );
      await this.audit.protokollieren(client, {
        modul: "standorte",
        aktion: "vereinbarung-stornieren",
        objektTyp: "standort_vereinbarung",
        objektId: id,
        nachher: { grund },
      });
      return this.eine(client, standortId, id);
    });
  }

  private async zeileFuerUpdate(client: PoolClient, standortId: string, id: string) {
    const { rows } = await client.query(
      "SELECT * FROM standort_vereinbarung WHERE id = $1 AND standort_id = $2 FOR UPDATE",
      [id, standortId]
    );
    if (rows.length === 0) throw new NotFoundException("Vereinbarung nicht gefunden.");
    if (rows[0].storniert_am) throw new ConflictException("Die Vereinbarung ist storniert und kann nicht mehr geändert werden.");
    return rows[0];
  }

  private async eine(client: PoolClient, standortId: string, id: string): Promise<StandortVereinbarungDto> {
    const alle = await vereinbarungenLesen(client, standortId);
    return alle.find((v) => v.id === id)!;
  }
}
