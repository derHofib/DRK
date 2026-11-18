import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AbwesenheitAnlegenEingabe, AbwesenheitArt, AbwesenheitDto, AbwesenheitRechteDto } from "@zimmerakte/shared";
import { requireTenantContext } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SPANNE_TAGE = 400;
const TAG_MS = 24 * 60 * 60 * 1000;

interface AbwesenheitRow {
  id: string;
  benutzer_id: string;
  benutzer_name: string;
  art: AbwesenheitArt;
  von: string;
  bis: string;
  notiz: string | null;
}

/**
 * Abwesenheiten (migrations/0074). Wer sie SIEHT, regelt die RLS-Policy
 * (alle Mitarbeitenden desselben Traegers, keine Klient:innen). Wer den
 * GRUND sieht, regelt dieser Service beim Lesen (CLAUDE.md Regel 6): die
 * Person selbst und wer abwesenheiten.art-sehen hat. Alle anderen bekommen
 * art = null und keine Notiz -- auch kein "krank" ueber Umwege wie die Notiz.
 *
 * Rollenpruefungen stehen hier neben dem SQL, nicht im Controller.
 */
@Injectable()
export class AbwesenheitService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async meineRechte(): Promise<AbwesenheitRechteDto> {
    const [artSehen, verwalten] = await Promise.all([
      this.rechte.hatRecht("abwesenheiten", "art-sehen"),
      this.rechte.hatRecht("abwesenheiten", "verwalten"),
    ]);
    return { artSehen, verwalten };
  }

  async liste(von: string, bis: string): Promise<AbwesenheitDto[]> {
    pruefeDatum(von, "von");
    pruefeDatum(bis, "bis");
    if (bis < von) throw new BadRequestException("„bis“ darf nicht vor „von“ liegen.");
    if (new Date(bis).getTime() - new Date(von).getTime() > MAX_SPANNE_TAGE * TAG_MS) {
      throw new BadRequestException(`Der Zeitraum darf höchstens ${MAX_SPANNE_TAGE} Tage umfassen.`);
    }
    const rechte = await this.meineRechte();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<AbwesenheitRow>(
        `SELECT a.id, a.benutzer_id, b.name AS benutzer_name, a.art, a.von, a.bis, a.notiz
         FROM abwesenheit a
         JOIN benutzer b ON b.id = a.benutzer_id
         WHERE a.storniert_am IS NULL AND a.von <= $2 AND a.bis >= $1
         ORDER BY a.von, b.name, a.id`,
        [von, bis]
      );
      return rows.map((r) => zuDto(r, rechte));
    });
  }

  async anlegen(eingabe: AbwesenheitAnlegenEingabe): Promise<AbwesenheitDto> {
    const ctx = requireTenantContext();
    pruefeDatum(eingabe.von, "von");
    pruefeDatum(eingabe.bis, "bis");
    if (eingabe.bis < eingabe.von) throw new BadRequestException("Das Ende darf nicht vor dem Beginn liegen.");
    if (new Date(eingabe.bis).getTime() - new Date(eingabe.von).getTime() > 366 * TAG_MS) {
      throw new BadRequestException("Eine Abwesenheit darf höchstens ein Jahr umfassen.");
    }
    const fuer = eingabe.benutzerId ?? ctx.benutzerId;
    const rechte = await this.meineRechte();
    if (fuer !== ctx.benutzerId && !rechte.verwalten) {
      throw new ForbiddenException("Für das Eintragen von Abwesenheiten anderer Mitarbeitender fehlt die Berechtigung.");
    }
    const notiz = eingabe.notiz?.trim() || null;
    return this.db.withTenant(async (client) => {
      // Ein Konto eines anderen Traegers ist hier per RLS unsichtbar -- also
      // "nicht gefunden", nicht "verboten" (verraet seine Existenz nicht).
      const { rows: person } = await client.query(`SELECT aktiv FROM benutzer WHERE id = $1`, [fuer]);
      if (person.length === 0) throw new NotFoundException("Mitarbeiter:in nicht gefunden.");
      if (!person[0].aktiv) throw new ConflictException("Für deaktivierte Konten können keine Abwesenheiten eingetragen werden.");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO abwesenheit (mandant_id, benutzer_id, art, von, bis, notiz, eingetragen_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [ctx.mandantId, fuer, eingabe.art, eingabe.von, eingabe.bis, notiz, ctx.benutzerId]
      );
      return this.ladeEinzeln(client, rows[0].id, rechte);
    });
  }

  /** Die eigene Abwesenheit darf jede:r stornieren, fremde nur mit abwesenheiten.verwalten. */
  async stornieren(id: string): Promise<void> {
    const ctx = requireTenantContext();
    if (!UUID_RE.test(id)) throw new NotFoundException("Abwesenheit nicht gefunden.");
    const rechte = await this.meineRechte();
    await this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ benutzer_id: string; storniert_am: Date | null }>(
        `SELECT benutzer_id, storniert_am FROM abwesenheit WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) throw new NotFoundException("Abwesenheit nicht gefunden.");
      if (rows[0].benutzer_id !== ctx.benutzerId && !rechte.verwalten) {
        throw new ForbiddenException("Abwesenheiten anderer Mitarbeitender darfst du nicht stornieren.");
      }
      if (rows[0].storniert_am) throw new ConflictException("Die Abwesenheit ist bereits storniert.");
      await client.query(`UPDATE abwesenheit SET storniert_am = now(), storniert_von = $2 WHERE id = $1`, [id, ctx.benutzerId]);
    });
  }

  private async ladeEinzeln(client: import("pg").PoolClient, id: string, rechte: AbwesenheitRechteDto): Promise<AbwesenheitDto> {
    const { rows } = await client.query<AbwesenheitRow>(
      `SELECT a.id, a.benutzer_id, b.name AS benutzer_name, a.art, a.von, a.bis, a.notiz
       FROM abwesenheit a JOIN benutzer b ON b.id = a.benutzer_id
       WHERE a.id = $1`,
      [id]
    );
    return zuDto(rows[0], rechte);
  }
}

function zuDto(r: AbwesenheitRow, rechte: AbwesenheitRechteDto): AbwesenheitDto {
  const ctx = requireTenantContext();
  const eigene = r.benutzer_id === ctx.benutzerId;
  const grundSichtbar = eigene || rechte.artSehen;
  return {
    id: r.id,
    benutzer: { id: r.benutzer_id, name: r.benutzer_name },
    art: grundSichtbar ? r.art : null,
    von: r.von,
    bis: r.bis,
    notiz: grundSichtbar ? r.notiz : null,
    stornierbar: eigene || rechte.verwalten,
  };
}

function pruefeDatum(wert: string, name: string): void {
  if (!DATUM_RE.test(wert) || Number.isNaN(new Date(`${wert}T00:00:00Z`).getTime())) {
    throw new BadRequestException(`„${name}“ muss ein Datum (JJJJ-MM-TT) sein.`);
  }
}
