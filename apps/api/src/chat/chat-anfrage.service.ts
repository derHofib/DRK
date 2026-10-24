import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  ChatAnfrageAnnahmeDto,
  ChatAnfrageDto,
  ChatAnfrageEingabe,
  ChatAnfrageZielDto,
  ChatAnfrageZustand,
} from "@zimmerakte/shared";
import { KlientNamen } from "../common/klient-namen";
import { isPgError } from "../common/pg-error";
import { aktuellerTeilnehmer, type Teilnehmer } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Klient:innen sehen ihre juengsten Anfragen (auch beantwortete), nicht die ganze Historie.
const KLIENT_LIMIT = 50;
export const MAX_OFFENE_ANFRAGEN = 5;

interface AnfrageRow {
  id: string;
  klient_id: string;
  ziel_benutzer_id: string | null;
  standort_id: string | null;
  nachricht: string | null;
  erstellt_am: Date;
  beantwortet_am: Date | null;
  beantwortet_von: string | null;
  angenommen: boolean | null;
  ablehnungsgrund: string | null;
  chat_id: string | null;
  klient_vorname: string;
  klient_nachname: string;
  ziel_name: string | null;
  standort_name: string | null;
  von_name: string | null;
}

/**
 * Chat-Anfragen (migrations/0056). Wer eine Anfrage sehen und beantworten darf,
 * steckt in der RLS (Ziel, Team des Standorts, die Klient:in selbst); hier
 * liegt nur, was eine Policy nicht ausdruecken kann: ob die Klient:in fuer die
 * Mitarbeitenden sichtbar ist (Standort-Einschraenkung), und die
 * Fehlerabbildung. Unsichtbare Anfragen sind "nicht gefunden" (404).
 */
@Injectable()
export class ChatAnfrageService {
  constructor(private readonly db: DatabaseService) {}

  async ziele(): Promise<ChatAnfrageZielDto[]> {
    const ich = this.nurKlient();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{
        benutzer_id: string | null;
        standort_id: string | null;
        ist_bezugsbetreuer: boolean;
        benutzer_name: string | null;
        standort_name: string | null;
        direkt_chat_id: string | null;
      }>(
        `SELECT z.benutzer_id, z.standort_id, z.ist_bezugsbetreuer, b.name AS benutzer_name, s.name AS standort_name, c.id AS direkt_chat_id
         FROM chat_anfrage_ziele($1::uuid) z
         LEFT JOIN benutzer b ON b.id = z.benutzer_id
         LEFT JOIN standort s ON s.id = z.standort_id
         LEFT JOIN chat c ON c.direkt_schluessel = 'benutzer:' || z.benutzer_id::text || '|klient:' || ($1::uuid)::text`,
        [ich.id]
      );
      const ziele: ChatAnfrageZielDto[] = rows.map((r) =>
        r.benutzer_id
          ? { art: "benutzer", benutzerId: r.benutzer_id, name: r.benutzer_name ?? "", istBezugsbetreuer: r.ist_bezugsbetreuer, direktChatId: r.direkt_chat_id }
          : { art: "team", standortId: r.standort_id!, name: `Team ${r.standort_name ?? ""}`.trim() }
      );
      const rang = (z: ChatAnfrageZielDto) => (z.art === "benutzer" && z.istBezugsbetreuer ? 0 : z.art === "team" ? 1 : 2);
      return ziele.sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, "de"));
    });
  }

  async stellen(eingabe: ChatAnfrageEingabe): Promise<ChatAnfrageDto> {
    const ich = this.nurKlient();
    const benutzerId = "benutzerId" in eingabe ? eingabe.benutzerId : null;
    const standortId = "standortId" in eingabe ? eingabe.standortId : null;
    const nachricht = eingabe.nachricht?.trim() || null;
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ ok: boolean }>(
        "SELECT chat_anfrage_ziel_erlaubt($1::uuid, $2::uuid, $3::uuid) AS ok",
        [ich.id, benutzerId, standortId]
      );
      if (!rows[0]?.ok) throw new BadRequestException("An dieses Ziel kannst du keine Anfrage stellen.");

      const id = randomUUID();
      try {
        await client.query(
          `INSERT INTO chat_anfrage (id, mandant_id, klient_id, ziel_benutzer_id, standort_id, nachricht)
           VALUES ($1, current_setting('app.mandant_id')::uuid, $2, $3, $4, $5)`,
          [id, ich.id, benutzerId, standortId, nachricht]
        );
      } catch (err) {
        if (isPgError(err) && err.code === "23505") throw new ConflictException("Hier hast du schon eine offene Anfrage.");
        if (isPgError(err) && err.code === "53400") {
          throw new ConflictException(`Du hast schon ${MAX_OFFENE_ANFRAGEN} offene Anfragen. Warte auf eine Antwort oder ziehe eine zurück.`);
        }
        throw err;
      }
      return this.ladeEine(client, ich, id);
    });
  }

  async liste(): Promise<ChatAnfrageDto[]> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant((client) =>
      ich.art === "klient" ? this.lade(client, ich, "true", [], KLIENT_LIMIT) : this.offeneFuerBenutzer(client, ich)
    );
  }

  async offeneAnzahl(): Promise<number> {
    const ich = aktuellerTeilnehmer();
    if (ich.art === "klient") return 0;
    // Dieselbe Abfrage wie die Liste, damit Badge und Liste nie auseinanderlaufen.
    return this.db.withTenant(async (client) => (await this.offeneFuerBenutzer(client, ich)).length);
  }

  async annehmen(id: string): Promise<ChatAnfrageAnnahmeDto> {
    const ich = this.nurMitarbeitende();
    return this.db.withTenant(async (client) => {
      await this.ladeEine(client, ich, id);
      let chatId: string;
      try {
        const { rows } = await client.query<{ chat_id: string }>("SELECT chat_anfrage_annehmen($1::uuid) AS chat_id", [id]);
        chatId = rows[0].chat_id;
      } catch (err) {
        if (isPgError(err) && err.code === "55000") throw new ConflictException(err.message);
        if (isPgError(err) && err.code === "P0002") throw new NotFoundException("Anfrage nicht gefunden.");
        throw err;
      }
      return { chatId, anfrage: await this.ladeEine(client, ich, id) };
    });
  }

  async ablehnen(id: string, begruendung: string | null): Promise<ChatAnfrageDto> {
    const ich = this.nurMitarbeitende();
    return this.db.withTenant(async (client) => {
      await this.beantworten(client, ich, id, () =>
        client.query(
          `UPDATE chat_anfrage SET beantwortet_am = clock_timestamp(), beantwortet_von = $2::uuid, angenommen = false, ablehnungsgrund = $3
           WHERE id = $1::uuid AND beantwortet_am IS NULL`,
          [id, ich.id, begruendung]
        )
      );
      return this.ladeEine(client, ich, id);
    });
  }

  async zurueckziehen(id: string): Promise<ChatAnfrageDto> {
    const ich = this.nurKlient();
    return this.db.withTenant(async (client) => {
      await this.beantworten(client, ich, id, () =>
        client.query("UPDATE chat_anfrage SET beantwortet_am = clock_timestamp() WHERE id = $1::uuid AND beantwortet_am IS NULL", [id])
      );
      return this.ladeEine(client, ich, id);
    });
  }

  /** Erst sichtbar (sonst 404), dann offen (sonst 409); ein Wettlauf zwischen beiden Pruefungen und dem UPDATE endet ebenfalls in 409. */
  private async beantworten(client: PoolClient, ich: Teilnehmer, id: string, update: () => Promise<{ rowCount: number | null }>): Promise<void> {
    const anfrage = await this.ladeEine(client, ich, id);
    if (anfrage.zustand !== "offen") throw new ConflictException("Die Anfrage ist bereits beantwortet.");
    if (!(await update()).rowCount) throw new ConflictException("Die Anfrage ist bereits beantwortet.");
  }

  private nurKlient(): Teilnehmer {
    const ich = aktuellerTeilnehmer();
    if (ich.art !== "klient") throw new ForbiddenException("Das können nur Klient:innen.");
    return ich;
  }

  private nurMitarbeitende(): Teilnehmer {
    const ich = aktuellerTeilnehmer();
    if (ich.art === "klient") throw new ForbiddenException("Das können nur Mitarbeitende.");
    return ich;
  }

  private async offeneFuerBenutzer(client: PoolClient, ich: Teilnehmer): Promise<ChatAnfrageDto[]> {
    return this.lade(client, ich, "a.beantwortet_am IS NULL", [], null);
  }

  private async ladeEine(client: PoolClient, ich: Teilnehmer, id: string): Promise<ChatAnfrageDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException("Anfrage nicht gefunden.");
    const [anfrage] = await this.lade(client, ich, "a.id = $1::uuid", [id], 1);
    if (!anfrage) throw new NotFoundException("Anfrage nicht gefunden.");
    return anfrage;
  }

  /** Was RLS liefert, abzueglich Anfragen, deren Klient:in die Mitarbeitenden nicht sehen duerfen. Neueste zuerst. */
  private async lade(client: PoolClient, ich: Teilnehmer, bedingung: string, parameter: unknown[], limit: number | null): Promise<ChatAnfrageDto[]> {
    const { rows } = await client.query<AnfrageRow>(
      `SELECT a.id, a.klient_id, a.ziel_benutzer_id, a.standort_id, a.nachricht, a.erstellt_am, a.beantwortet_am,
              a.beantwortet_von, a.angenommen, a.ablehnungsgrund, a.chat_id,
              k.vorname AS klient_vorname, k.nachname AS klient_nachname,
              zb.name AS ziel_name, s.name AS standort_name, bv.name AS von_name
       FROM chat_anfrage a
       JOIN klient k ON k.id = a.klient_id
       LEFT JOIN benutzer zb ON zb.id = a.ziel_benutzer_id
       LEFT JOIN standort s ON s.id = a.standort_id
       LEFT JOIN benutzer bv ON bv.id = a.beantwortet_von
       WHERE ${bedingung}
       ORDER BY a.erstellt_am DESC, a.id
       ${limit ? `LIMIT ${Math.trunc(limit)}` : ""}`,
      parameter
    );
    const sichtbarkeit = new KlientNamen(client, ich);
    const dtos: ChatAnfrageDto[] = [];
    for (const r of rows) {
      if (ich.art === "benutzer" && !(await sichtbarkeit.darfVollstaendigSehen(r.klient_id))) continue;
      const zustand: ChatAnfrageZustand =
        r.beantwortet_am === null ? "offen" : r.angenommen === true ? "angenommen" : r.angenommen === false ? "abgelehnt" : "zurueckgezogen";
      dtos.push({
        id: r.id,
        zustand,
        erstelltAm: r.erstellt_am.toISOString(),
        klient: { art: "klient", id: r.klient_id, name: await sichtbarkeit.name(r.klient_id, r.klient_vorname, r.klient_nachname) },
        ziel: r.ziel_benutzer_id
          ? { art: "benutzer", id: r.ziel_benutzer_id, name: r.ziel_name ?? "" }
          : { art: "team", id: r.standort_id!, name: `Team ${r.standort_name ?? ""}`.trim() },
        nachricht: r.nachricht,
        beantwortetAm: r.beantwortet_am?.toISOString() ?? null,
        beantwortetVon: r.beantwortet_von ? { id: r.beantwortet_von, name: r.von_name ?? "" } : null,
        ablehnungsgrund: r.ablehnungsgrund,
        chatId: r.chat_id,
      });
    }
    return dtos;
  }
}
