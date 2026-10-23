import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { AuditService } from "../audit/audit.service";
import { isPgError } from "../common/pg-error";
import { neuerResetToken, resetTokenHash } from "../common/reset-token";
import { klientIstErlaubt } from "../common/standort-restriction";
import { requireTenantContext } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";

const UNIQUE_VIOLATION = "23505";
const EINLADUNG_GUELTIGKEIT_TAGE = 7;

export type KlientZugangStatus = "keiner" | "eingeladen" | "aktiv" | "deaktiviert";

export interface KlientZugangDto {
  status: KlientZugangStatus;
  email: string | null;
  /** Nur bei "eingeladen": wann der offene Link ablaeuft bzw. abgelaufen ist. */
  einladungLaeuftAbAm: string | null;
  einladungAbgelaufen: boolean;
}

export interface KlientEinladungDto {
  /** Der Roh-Token steckt nur in diesem Link und wird nirgends gespeichert. */
  einladungsLink: string;
  laeuftAbAm: string;
}

interface ZugangRow {
  id: string;
  email: string;
  passwort_hash: string | null;
  aktiv: boolean;
  einladung_ablauf: Date | null;
}

@Injectable()
export class KlientZugangService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly audit: AuditService
  ) {}

  async status(klientId: string): Promise<KlientZugangDto> {
    return this.mitBerechtigung(klientId, async (client) => zuDto(await ladeZugang(client, klientId)));
  }

  async einladen(klientId: string, email: string): Promise<KlientEinladungDto> {
    const ctx = requireTenantContext();
    try {
      return await this.mitBerechtigung(klientId, async (client) => {
        await verlangeNichtGesperrt(client, klientId);
        if (await ladeZugang(client, klientId)) {
          throw new ConflictException("Für diese Person besteht bereits ein Zugang — bitte „Neu einladen“ verwenden.");
        }
        const einladung = neueEinladung();
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO klient_zugang (mandant_id, klient_id, email, einladung_token_hash, einladung_ablauf, eingeladen_von)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [ctx.mandantId, klientId, email, einladung.hash, einladung.ablauf, ctx.benutzerId]
        );
        await this.audit.protokollieren(client, {
          modul: "klienten",
          aktion: "zugang-einladen",
          objektTyp: "klient_zugang",
          objektId: rows[0].id,
          nachher: { klientId, email },
        });
        return einladung.dto;
      });
    } catch (err) {
      if (isPgError(err) && err.code === UNIQUE_VIOLATION) {
        throw new ConflictException("Diese E-Mail-Adresse wird bereits für einen anderen Zugang verwendet.");
      }
      throw err;
    }
  }

  /**
   * Ersetzt einen offenen Link und erlaubt auch nach bereits gesetztem
   * Passwort ein neues (Passwort vergessen). Ein deaktivierter Zugang wird
   * dabei NICHT still reaktiviert -- das waere eine versteckte
   * Freischaltung; dafuer gibt es PATCH.
   */
  async neuEinladen(klientId: string): Promise<KlientEinladungDto> {
    const ctx = requireTenantContext();
    return this.mitBerechtigung(klientId, async (client) => {
      const zugang = await ladeZugang(client, klientId);
      if (!zugang) throw new NotFoundException("Für diese Person besteht noch kein Zugang.");
      await verlangeNichtGesperrt(client, klientId);
      if (!zugang.aktiv) {
        throw new ConflictException("Der Zugang ist deaktiviert — bitte zuerst wieder aktivieren.");
      }
      const einladung = neueEinladung();
      await client.query(
        `UPDATE klient_zugang SET einladung_token_hash = $2, einladung_ablauf = $3, eingeladen_von = $4 WHERE id = $1`,
        [zugang.id, einladung.hash, einladung.ablauf, ctx.benutzerId]
      );
      await this.audit.protokollieren(client, {
        modul: "klienten",
        aktion: "zugang-neu-einladen",
        objektTyp: "klient_zugang",
        objektId: zugang.id,
        nachher: { klientId },
      });
      return einladung.dto;
    });
  }

  async aktivSetzen(klientId: string, aktiv: boolean): Promise<KlientZugangDto> {
    return this.mitBerechtigung(klientId, async (client) => {
      const zugang = await ladeZugang(client, klientId);
      if (!zugang) throw new NotFoundException("Für diese Person besteht noch kein Zugang.");
      if (aktiv) await verlangeNichtGesperrt(client, klientId);
      if (zugang.aktiv !== aktiv) {
        await client.query("UPDATE klient_zugang SET aktiv = $2 WHERE id = $1", [zugang.id, aktiv]);
        await this.audit.protokollieren(client, {
          modul: "klienten",
          aktion: aktiv ? "zugang-aktivieren" : "zugang-deaktivieren",
          objektTyp: "klient_zugang",
          objektId: zugang.id,
          vorher: { aktiv: zugang.aktiv },
          nachher: { aktiv },
        });
      }
      return zuDto(await ladeZugang(client, klientId));
    });
  }

  /**
   * Recht UND Sichtbarkeit des Klienten (Standort-Einschraenkung) -- ein
   * unsichtbarer Klient ist 404, nicht 403, damit seine Existenz nicht
   * durchsickert (gleiches Verhalten wie archivieren()).
   */
  private async mitBerechtigung<T>(klientId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const ctx = requireTenantContext();
    if (!(await this.rechte.hatRecht("klienten", "zugang-verwalten"))) {
      throw new ForbiddenException("Keine Berechtigung, Zugänge für Klient:innen zu verwalten.");
    }
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, ctx.benutzerId, klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      const { rows } = await client.query("SELECT 1 FROM klient WHERE id = $1", [klientId]);
      if (rows.length === 0) throw new NotFoundException("Klient nicht gefunden.");
      return fn(client);
    });
  }
}

async function ladeZugang(client: PoolClient, klientId: string): Promise<ZugangRow | null> {
  const { rows } = await client.query<ZugangRow>(
    "SELECT id, email, passwort_hash, aktiv, einladung_ablauf FROM klient_zugang WHERE klient_id = $1",
    [klientId]
  );
  return rows[0] ?? null;
}

async function verlangeNichtGesperrt(client: PoolClient, klientId: string): Promise<void> {
  const { rows } = await client.query(
    "SELECT 1 FROM klient WHERE id = $1 AND (archiviert_am IS NOT NULL OR anonymisiert_am IS NOT NULL)",
    [klientId]
  );
  if (rows.length > 0) {
    throw new ConflictException("Für archivierte oder anonymisierte Klient:innen ist kein Zugang möglich.");
  }
}

function neueEinladung(): { hash: string; ablauf: Date; dto: KlientEinladungDto } {
  const token = neuerResetToken();
  const ablauf = new Date(Date.now() + EINLADUNG_GUELTIGKEIT_TAGE * 24 * 60 * 60 * 1000);
  return {
    hash: resetTokenHash(token),
    ablauf,
    dto: { einladungsLink: `/?klient-einladung=${token}`, laeuftAbAm: ablauf.toISOString() },
  };
}

function zuDto(zugang: ZugangRow | null): KlientZugangDto {
  if (!zugang) return { status: "keiner", email: null, einladungLaeuftAbAm: null, einladungAbgelaufen: false };
  const status: KlientZugangStatus = !zugang.aktiv ? "deaktiviert" : zugang.passwort_hash ? "aktiv" : "eingeladen";
  const ablauf = zugang.einladung_ablauf;
  return {
    status,
    email: zugang.email,
    einladungLaeuftAbAm: ablauf ? ablauf.toISOString() : null,
    einladungAbgelaufen: ablauf ? ablauf.getTime() < Date.now() : false,
  };
}
