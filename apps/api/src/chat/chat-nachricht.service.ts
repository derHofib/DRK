import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  ChatAnhangDto,
  ChatNachrichtArt,
  ChatNachrichtDto,
  ChatNachrichtEingabe,
  ChatNachrichtenSeiteDto,
  TerminAntwort,
} from "@zimmerakte/shared";
import { verkleinereBild } from "../common/bild";
import { KlientNamen } from "../common/klient-namen";
import { aktuellerTeilnehmer, requireTenantContext, type Teilnehmer } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";
import { KalenderService, zeitraumFuerAusgabe } from "../kalender/kalender.service";
import { ChatService, prinzipalParameter } from "./chat.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STANDARD_LIMIT = 50;

interface NachrichtRow {
  id: string;
  chat_id: string;
  art: ChatNachrichtArt;
  text: string | null;
  erstellt_am: Date;
  geloescht_am: Date | null;
  absender_benutzer_id: string | null;
  absender_klient_id: string | null;
  standort_lat: string | null;
  standort_lng: string | null;
  standort_genauigkeit_m: number | null;
  standort_bezeichnung: string | null;
  termin_id: string | null;
  benutzer_name: string | null;
  klient_vorname: string | null;
  klient_nachname: string | null;
  t_titel: string | null;
  t_ort: string | null;
  t_beginn: Date | null;
  t_ende: Date | null;
  t_ganztaegig: boolean | null;
  t_abgesagt_am: Date | null;
  t_meine_antwort: TerminAntwort | null;
}

interface AnhangRow {
  id: string;
  nachricht_id: string;
  dateiname: string;
  mime_type: ChatAnhangDto["mimeType"];
  groesse: number;
}

@Injectable()
export class ChatNachrichtService {
  constructor(
    private readonly db: DatabaseService,
    private readonly chats: ChatService,
    private readonly kalender: KalenderService
  ) {}

  /** Fuer Upload-Endpunkte: vor dem Einlesen eines grossen Bodys klaeren, ob der Chat ueberhaupt sichtbar ist. */
  async pruefeTeilnahme(chatId: string): Promise<void> {
    await this.db.withTenant((client) => this.chats.pruefeTeilnahme(client, chatId));
  }

  async seite(chatId: string, vor: string | undefined, limit: number | undefined): Promise<ChatNachrichtenSeiteDto> {
    const ich = aktuellerTeilnehmer();
    const anzahl = limit ?? STANDARD_LIMIT;
    return this.db.withTenant(async (client) => {
      await this.chats.pruefeTeilnahme(client, chatId);
      const parameter: unknown[] = [chatId];
      let bedingung = "m.chat_id = $3::uuid";
      if (vor) {
        const { rows } = await client.query("SELECT 1 FROM chat_nachricht WHERE id = $1 AND chat_id = $2", [vor, chatId]);
        if (rows.length === 0) throw new BadRequestException("„vor“ verweist auf keine Nachricht dieses Chats.");
        // Tupelvergleich passend zur Sortierung (erstellt_am, id) und per Unterabfrage statt
        // mit einem JS-Date: Postgres speichert Mikrosekunden, Date nur Millisekunden -- ein
        // abgeschnittener Zeitstempel wuerde Nachrichten innerhalb derselben Millisekunde verschlucken.
        parameter.push(vor);
        bedingung += " AND (m.erstellt_am, m.id) < (SELECT v.erstellt_am, v.id FROM chat_nachricht v WHERE v.id = $4::uuid)";
      }
      const nachrichten = await this.ladeNachrichten(client, ich, bedingung, parameter, anzahl + 1);
      const weitere = nachrichten.length > anzahl;
      return { nachrichten: nachrichten.slice(0, anzahl), weitere };
    });
  }

  async senden(chatId: string, eingabe: ChatNachrichtEingabe): Promise<ChatNachrichtDto> {
    const ctx = requireTenantContext();
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      await this.chats.pruefeTeilnahme(client, chatId);
      const id = randomUUID();
      let text: string | null = null;
      let terminId: string | null = null;
      let standort: { lat: number; lng: number; genauigkeitM: number | null; bezeichnung: string | null } | null = null;

      if (eingabe.art === "text") {
        text = eingabe.text.trim();
      } else if (eingabe.art === "standort") {
        standort = {
          lat: eingabe.lat,
          lng: eingabe.lng,
          genauigkeitM: eingabe.genauigkeitM === undefined ? null : Math.round(eingabe.genauigkeitM),
          bezeichnung: eingabe.bezeichnung?.trim() || null,
        };
      } else {
        const hatId = "terminId" in eingabe && eingabe.terminId !== undefined;
        const hatNeu = "termin" in eingabe && eingabe.termin !== undefined;
        if (hatId === hatNeu) throw new BadRequestException("Bei einer Termin-Nachricht genau „terminId“ ODER „termin“ angeben.");
        if (hatId) {
          // Nur Termine teilen, die man selbst sehen darf (RLS) -- sonst liesse sich
          // ein fremder Termin per erratener ID in einen Chat "einschleusen".
          const { rows } = await client.query("SELECT 1 FROM termin WHERE id = $1", [(eingabe as { terminId: string }).terminId]);
          if (rows.length === 0) throw new NotFoundException("Termin nicht gefunden.");
          terminId = (eingabe as { terminId: string }).terminId;
        } else {
          terminId = await this.kalender.anlegenIn(client, (eingabe as { termin: Parameters<KalenderService["anlegenIn"]>[1] }).termin);
        }
      }

      await client.query(
        `INSERT INTO chat_nachricht (id, mandant_id, chat_id, absender_benutzer_id, absender_klient_id, art, text, termin_id,
                                     standort_lat, standort_lng, standort_genauigkeit_m, standort_bezeichnung)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id, ctx.mandantId, chatId, ...prinzipalParameter(ich), eingabe.art, text, terminId,
          standort?.lat ?? null, standort?.lng ?? null, standort?.genauigkeitM ?? null, standort?.bezeichnung ?? null,
        ]
      );
      return this.ladeEine(client, ich, id);
    });
  }

  async bildSenden(
    chatId: string,
    bild: { inhalt: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp"; dateiname: string; text: string | null }
  ): Promise<ChatNachrichtDto> {
    const ctx = requireTenantContext();
    const ich = aktuellerTeilnehmer();
    // Verkleinern (Sekunden Rechenzeit) bewusst NACH der Teilnahme-Pruefung und
    // AUSSERHALB der Transaktion: sie soll keine DB-Verbindung blockieren.
    await this.pruefeTeilnahme(chatId);
    const { inhalt } = await verkleinereBild(bild.inhalt, bild.mimeType);

    return this.db.withTenant(async (client) => {
      await this.chats.pruefeTeilnahme(client, chatId);
      const nachrichtId = randomUUID();
      await client.query(
        `INSERT INTO chat_nachricht (id, mandant_id, chat_id, absender_benutzer_id, absender_klient_id, art, text)
         VALUES ($1, $2, $3, $4, $5, 'bild', $6)`,
        [nachrichtId, ctx.mandantId, chatId, ...prinzipalParameter(ich), bild.text || null]
      );
      await client.query(
        `INSERT INTO chat_anhang (mandant_id, nachricht_id, dateiname, mime_type, inhalt, inhalt_hash, groesse)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ctx.mandantId, nachrichtId, bild.dateiname, bild.mimeType, inhalt, createHash("sha256").update(inhalt).digest("hex"), inhalt.length]
      );
      return this.ladeEine(client, ich, nachrichtId);
    });
  }

  async anhang(id: string): Promise<{ inhalt: Buffer; mimeType: string; dateiname: string; hash: string }> {
    if (!UUID_RE.test(id)) throw new NotFoundException("Anhang nicht gefunden.");
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ inhalt: Buffer; mime_type: string; dateiname: string; inhalt_hash: string }>(
        "SELECT inhalt, mime_type, dateiname, inhalt_hash FROM chat_anhang WHERE id = $1",
        [id]
      );
      if (rows.length === 0) throw new NotFoundException("Anhang nicht gefunden.");
      return { inhalt: rows[0].inhalt, mimeType: rows[0].mime_type, dateiname: rows[0].dateiname, hash: rows[0].inhalt_hash };
    });
  }

  /** Idempotent. Die Zeile bleibt als "Nachricht gelöscht"; Inhalt, Standort, Termin-Freigabe und Bild verschwinden wirklich. */
  async loeschen(id: string): Promise<ChatNachrichtDto> {
    const ich = aktuellerTeilnehmer();
    if (!UUID_RE.test(id)) throw new NotFoundException("Nachricht nicht gefunden.");
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ absender_benutzer_id: string | null; absender_klient_id: string | null; geloescht_am: Date | null }>(
        "SELECT absender_benutzer_id, absender_klient_id, geloescht_am FROM chat_nachricht WHERE id = $1",
        [id]
      );
      if (rows.length === 0) throw new NotFoundException("Nachricht nicht gefunden.");
      const von = rows[0];
      const meine = ich.art === "benutzer" ? von.absender_benutzer_id === ich.id : von.absender_klient_id === ich.id;
      if (!meine) throw new ForbiddenException("Du kannst nur deine eigenen Nachrichten löschen.");
      if (!von.geloescht_am) {
        await client.query(
          `UPDATE chat_nachricht
           SET text = NULL, termin_id = NULL, standort_lat = NULL, standort_lng = NULL,
               standort_genauigkeit_m = NULL, standort_bezeichnung = NULL, geloescht_am = clock_timestamp()
           WHERE id = $1`,
          [id]
        );
        await client.query("DELETE FROM chat_anhang WHERE nachricht_id = $1", [id]);
      }
      return this.ladeEine(client, ich, id);
    });
  }

  async gelesen(chatId: string): Promise<{ gelesen: true }> {
    const ich = aktuellerTeilnehmer();
    if (!UUID_RE.test(chatId)) throw new NotFoundException("Chat nicht gefunden.");
    return this.db.withTenant(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE chat_teilnehmer SET zuletzt_gelesen_am = clock_timestamp()
         WHERE chat_id = $1 AND verlassen_am IS NULL AND (benutzer_id = $2::uuid OR klient_id = $3::uuid)`,
        [chatId, ...prinzipalParameter(ich)]
      );
      if (!rowCount) throw new NotFoundException("Chat nicht gefunden.");
      return { gelesen: true as const };
    });
  }

  private async ladeEine(client: PoolClient, ich: Teilnehmer, id: string): Promise<ChatNachrichtDto> {
    const [nachricht] = await this.ladeNachrichten(client, ich, "m.id = $3::uuid", [id], 1);
    if (!nachricht) throw new NotFoundException("Nachricht nicht gefunden.");
    return nachricht;
  }

  /** $1/$2 = Prinzipal; die Bedingung zaehlt ab $3. Neueste zuerst. */
  private async ladeNachrichten(
    client: PoolClient,
    ich: Teilnehmer,
    bedingung: string,
    weitere: unknown[],
    limit: number
  ): Promise<ChatNachrichtDto[]> {
    const { rows } = await client.query<NachrichtRow>(
      `SELECT m.id, m.chat_id, m.art, m.text, m.erstellt_am, m.geloescht_am, m.absender_benutzer_id, m.absender_klient_id,
              m.standort_lat, m.standort_lng, m.standort_genauigkeit_m, m.standort_bezeichnung, m.termin_id,
              b.name AS benutzer_name, k.vorname AS klient_vorname, k.nachname AS klient_nachname,
              t.titel AS t_titel, t.ort AS t_ort, t.beginn AS t_beginn, t.ende AS t_ende, t.ganztaegig AS t_ganztaegig,
              t.abgesagt_am AS t_abgesagt_am, mein.antwort AS t_meine_antwort
       FROM chat_nachricht m
       LEFT JOIN benutzer b ON b.id = m.absender_benutzer_id
       LEFT JOIN klient k ON k.id = m.absender_klient_id
       LEFT JOIN termin t ON t.id = m.termin_id
       LEFT JOIN termin_teilnehmer mein ON mein.termin_id = t.id AND (mein.benutzer_id = $1::uuid OR mein.klient_id = $2::uuid)
       WHERE ${bedingung}
       ORDER BY m.erstellt_am DESC, m.id DESC
       LIMIT ${Math.trunc(limit)}`,
      [...prinzipalParameter(ich), ...weitere]
    );
    if (rows.length === 0) return [];

    const { rows: anhangRows } = await client.query<AnhangRow>(
      "SELECT id, nachricht_id, dateiname, mime_type, groesse FROM chat_anhang WHERE nachricht_id = ANY($1::uuid[]) ORDER BY id",
      [rows.map((r) => r.id)]
    );
    const anhaenge = new Map<string, ChatAnhangDto[]>();
    for (const a of anhangRows) {
      const liste = anhaenge.get(a.nachricht_id) ?? [];
      liste.push({ id: a.id, dateiname: a.dateiname, mimeType: a.mime_type, groesse: a.groesse });
      anhaenge.set(a.nachricht_id, liste);
    }

    const sichtbarkeit = new KlientNamen(client, ich);
    const dtos: ChatNachrichtDto[] = [];
    for (const r of rows) {
      const absender: ChatNachrichtDto["absender"] = r.absender_benutzer_id
        ? { art: "benutzer", id: r.absender_benutzer_id, name: r.benutzer_name ?? "" }
        : r.absender_klient_id
          ? { art: "klient", id: r.absender_klient_id, name: await sichtbarkeit.name(r.absender_klient_id, r.klient_vorname ?? "", r.klient_nachname ?? "") }
          : null;
      dtos.push({
        id: r.id,
        chatId: r.chat_id,
        art: r.art,
        erstelltAm: r.erstellt_am.toISOString(),
        absender,
        eigene: absender !== null && absender.art === ich.art && absender.id === ich.id,
        geloescht: r.geloescht_am !== null,
        text: r.text,
        standort:
          r.standort_lat !== null && r.standort_lng !== null
            ? {
                lat: Number(r.standort_lat),
                lng: Number(r.standort_lng),
                genauigkeitM: r.standort_genauigkeit_m,
                bezeichnung: r.standort_bezeichnung,
              }
            : null,
        termin:
          r.termin_id && r.t_titel !== null && r.t_beginn && r.t_ende
            ? {
                id: r.termin_id,
                titel: r.t_titel,
                ort: r.t_ort,
                ...zeitraumFuerAusgabe({ beginn: r.t_beginn, ende: r.t_ende, ganztaegig: r.t_ganztaegig ?? false }),
                ganztaegig: r.t_ganztaegig ?? false,
                abgesagtAm: r.t_abgesagt_am?.toISOString() ?? null,
                meineAntwort: r.t_meine_antwort,
                uebernommen: r.t_meine_antwort === "zugesagt",
              }
            : null,
        anhaenge: anhaenge.get(r.id) ?? [],
      });
    }
    return dtos;
  }
}
