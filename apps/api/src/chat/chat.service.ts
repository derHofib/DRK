import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  ChatDto,
  ChatKontaktDto,
  ChatKontaktEingabe,
  ChatNachrichtArt,
  ChatPersonDto,
  ChatTeilnehmerDto,
  ChatVorschauDto,
} from "@zimmerakte/shared";
import { KlientNamen } from "../common/klient-namen";
import { pruefeKontakt } from "../common/kontakt-pruefung";
import { aktuellerTeilnehmer, requireTenantContext, type Teilnehmer } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";

export const MAX_TEILNEHMER = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VORSCHAU_LAENGE = 120;

interface ChatRow {
  id: string;
  art: "direkt" | "gruppe";
  name: string | null;
  erstellt_am: Date;
  beigetreten_am: Date;
  ist_admin: boolean;
  ungelesen: number;
  l_id: string | null;
  l_art: ChatNachrichtArt | null;
  l_text: string | null;
  l_geloescht_am: Date | null;
  l_erstellt_am: Date | null;
  l_absender_benutzer_id: string | null;
  l_absender_klient_id: string | null;
  l_termin_titel: string | null;
  l_standort_bezeichnung: string | null;
  l_benutzer_name: string | null;
  l_klient_vorname: string | null;
  l_klient_nachname: string | null;
}

interface TeilnehmerRow {
  id: string;
  chat_id: string;
  benutzer_id: string | null;
  klient_id: string | null;
  ist_admin: boolean;
  beigetreten_am: Date;
  benutzer_name: string | null;
  klient_vorname: string | null;
  klient_nachname: string | null;
}

/** $1 = benutzer_id, $2 = klient_id des Aufrufers (je eines NULL). */
export function prinzipalParameter(ich: Teilnehmer): [string | null, string | null] {
  return ich.art === "benutzer" ? [ich.id, null] : [null, ich.id];
}

/**
 * Sichtbarkeit steckt in der RLS (chat_ist_teilnehmer, migrations/0055; die
 * Historien-Grenze fuer Gruppen chat_nachricht_lesbar, 0056): letzte Nachricht,
 * Ungelesen-Zaehler und Verlauf lesen alle durch dieselbe Policy und zeigen
 * deshalb nie etwas aus der Zeit vor dem Beitritt.
 *
 * Ein fremder Chat ist "nicht gefunden" (404), nicht "verboten" -- seine Existenz
 * soll nicht verraten werden. 403 gibt es nur fuer Chats, die man sieht, aber
 * nicht verwalten darf. Das gilt auch fuer ist_vollzugriff-Konten.
 */
@Injectable()
export class ChatService {
  constructor(private readonly db: DatabaseService) {}

  async liste(): Promise<ChatDto[]> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant((client) => this.ladeChats(client, ich, null));
  }

  async einzeln(id: string): Promise<ChatDto> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant((client) => this.ladeEinen(client, ich, id));
  }

  async ungelesenGesamt(): Promise<{ ungelesen: number }> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM chat_nachricht m
         JOIN chat_teilnehmer me ON me.chat_id = m.chat_id AND me.verlassen_am IS NULL
              AND (me.benutzer_id = $1::uuid OR me.klient_id = $2::uuid)
         WHERE m.erstellt_am > me.zuletzt_gelesen_am AND m.geloescht_am IS NULL AND m.art <> 'system'
           AND NOT (COALESCE(m.absender_benutzer_id = $1::uuid, false) OR COALESCE(m.absender_klient_id = $2::uuid, false))`,
        prinzipalParameter(ich)
      );
      return { ungelesen: rows[0].n };
    });
  }

  /** Klient:innen bekommen bewusst eine leere Liste: sie koennen niemanden von sich aus ansprechen. */
  async kontakte(): Promise<ChatKontaktDto[]> {
    const ich = aktuellerTeilnehmer();
    if (ich.art === "klient") return [];
    return this.db.withTenant(async (client) => {
      const { rows: benutzer } = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM benutzer WHERE aktiv AND id <> $1 ORDER BY name, id",
        [ich.id]
      );
      const { rows: klienten } = await client.query<{ id: string; vorname: string; nachname: string }>(
        `SELECT k.id, k.vorname, k.nachname
         FROM klient k
         JOIN klient_zugang z ON z.klient_id = k.id
         WHERE z.aktiv AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL
         ORDER BY k.nachname, k.vorname, k.id`
      );
      const sichtbarkeit = new KlientNamen(client, ich);
      const sichtbare: typeof klienten = [];
      for (const k of klienten) if (await sichtbarkeit.darfVollstaendigSehen(k.id)) sichtbare.push(k);

      const personen: ChatPersonDto[] = [
        ...benutzer.map((b) => ({ art: "benutzer" as const, id: b.id, name: b.name })),
        ...sichtbare.map((k) => ({ art: "klient" as const, id: k.id, name: `${k.vorname} ${k.nachname}` })),
      ];
      const schluessel = personen.map((p) => direktSchluessel(ich, p));
      // RLS liefert nur Direktchats, in denen man selbst aktiv ist.
      const { rows: direkt } = await client.query<{ id: string; direkt_schluessel: string }>(
        "SELECT id, direkt_schluessel FROM chat WHERE direkt_schluessel = ANY($1::text[])",
        [schluessel]
      );
      const chatIdJeSchluessel = new Map(direkt.map((d) => [d.direkt_schluessel, d.id]));
      return personen.map((p, i) => ({ ...p, direktChatId: chatIdJeSchluessel.get(schluessel[i]) ?? null }));
    });
  }

  async direktAnlegen(ziel: ChatKontaktEingabe): Promise<{ chat: ChatDto; neu: boolean }> {
    const ctx = requireTenantContext();
    const ich = aktuellerTeilnehmer();
    this.nurMitarbeitende(ich);
    const gegenueber: Teilnehmer =
      "benutzerId" in ziel ? { art: "benutzer", id: ziel.benutzerId } : { art: "klient", id: ziel.klientId };
    if (gegenueber.art === ich.art && gegenueber.id === ich.id) {
      throw new BadRequestException("Ein Chat mit dir selbst ist nicht möglich.");
    }

    return this.db.withTenant(async (client) => {
      await pruefeKontakt(client, ich.id, ziel);
      const schluessel = direktSchluessel(ich, gegenueber);
      const vorhanden = await client.query<{ id: string }>("SELECT id FROM chat WHERE direkt_schluessel = $1", [schluessel]);
      if (vorhanden.rows.length > 0) return { chat: await this.ladeEinen(client, ich, vorhanden.rows[0].id), neu: false };

      // Unique-Index statt "erst pruefen, dann anlegen": zwei gleichzeitige Anfragen beider
      // Seiten duerfen nicht zwei Direktchats erzeugen. Bewusst kein ON CONFLICT DO NOTHING:
      // das prueft zusaetzlich die SELECT-Policy gegen die neue Zeile (die noch keine
      // Teilnehmerzeile hat) und wuerde das Anlegen selbst abweisen. Stattdessen faengt ein
      // Savepoint die Unique-Verletzung ab, ohne die Transaktion zu verwerfen.
      const id = randomUUID();
      await client.query("SAVEPOINT direktchat_anlegen");
      try {
        await client.query(
          `INSERT INTO chat (id, mandant_id, art, direkt_schluessel, erstellt_von_benutzer_id) VALUES ($1, $2, 'direkt', $3, $4)`,
          [id, ctx.mandantId, schluessel, ich.id]
        );
      } catch (err) {
        if ((err as { code?: string }).code !== "23505") throw err;
        await client.query("ROLLBACK TO SAVEPOINT direktchat_anlegen");
        const jetzt = await client.query<{ id: string }>("SELECT id FROM chat WHERE direkt_schluessel = $1", [schluessel]);
        if (jetzt.rows.length === 0) throw new ConflictException("Der Chat wird gerade angelegt. Bitte gleich noch einmal versuchen.");
        return { chat: await this.ladeEinen(client, ich, jetzt.rows[0].id), neu: false };
      }
      await this.teilnehmerEintragen(client, ctx.mandantId, id, [
        { benutzerId: ich.id, istAdmin: false },
        { ...("benutzerId" in ziel ? { benutzerId: ziel.benutzerId } : { klientId: ziel.klientId }), istAdmin: false },
      ]);
      return { chat: await this.ladeEinen(client, ich, id), neu: true };
    });
  }

  async gruppeAnlegen(name: string, eingeladen: ChatKontaktEingabe[]): Promise<ChatDto> {
    const ctx = requireTenantContext();
    const ich = aktuellerTeilnehmer();
    this.nurMitarbeitende(ich);
    const andere = dedupliziere(eingeladen, ich);
    if (andere.length === 0) throw new BadRequestException("Eine Gruppe braucht mindestens eine weitere Person.");
    if (andere.length + 1 > MAX_TEILNEHMER) throw new BadRequestException(`Höchstens ${MAX_TEILNEHMER} Personen pro Gruppe.`);

    return this.db.withTenant(async (client) => {
      for (const t of andere) await pruefeKontakt(client, ich.id, t);
      const id = randomUUID();
      await client.query(
        `INSERT INTO chat (id, mandant_id, art, name, erstellt_von_benutzer_id) VALUES ($1, $2, 'gruppe', $3, $4)`,
        [id, ctx.mandantId, name.trim(), ich.id]
      );
      await this.teilnehmerEintragen(client, ctx.mandantId, id, [
        { benutzerId: ich.id, istAdmin: true },
        ...andere.map((t) => ({ ...t, istAdmin: false })),
      ]);
      return this.ladeEinen(client, ich, id);
    });
  }

  async umbenennen(id: string, name: string): Promise<ChatDto> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      const chat = await this.ladeEinen(client, ich, id);
      this.nurGruppe(chat);
      this.nurAdmin(chat);
      await client.query("UPDATE chat SET name = $2 WHERE id = $1", [id, name.trim()]);
      return this.ladeEinen(client, ich, id);
    });
  }

  /** Idempotent: wer schon aktiv dabei ist, aendert nichts. */
  async teilnehmerHinzufuegen(id: string, ziel: ChatKontaktEingabe): Promise<ChatDto> {
    const ctx = requireTenantContext();
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      const chat = await this.ladeEinen(client, ich, id);
      this.nurGruppe(chat);
      this.nurAdmin(chat);
      const schon = chat.teilnehmer.some((t) => ("benutzerId" in ziel ? t.art === "benutzer" && t.id === ziel.benutzerId : t.art === "klient" && t.id === ziel.klientId));
      if (schon) return chat;
      if (chat.teilnehmer.length + 1 > MAX_TEILNEHMER) throw new BadRequestException(`Höchstens ${MAX_TEILNEHMER} Personen pro Gruppe.`);
      await pruefeKontakt(client, ich.id, ziel);
      await this.teilnehmerEintragen(client, ctx.mandantId, id, [{ ...ziel, istAdmin: false }]);
      return this.ladeEinen(client, ich, id);
    });
  }

  /**
   * Eigene Teilnahme = Verlassen (jede:r darf), fremde = Entfernen (nur Admins).
   * Direktchats bleiben bestehen: ihre Eindeutigkeit (ein Chat je Paar) haengt
   * daran, dass beide dauerhaft dabei sind.
   */
  async teilnahmeBeenden(id: string, teilnehmerId: string): Promise<{ entfernt: true }> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      const chat = await this.ladeEinen(client, ich, id);
      if (chat.art === "direkt") throw new ConflictException("Einen Direktchat kannst du nicht verlassen.");
      const ziel = chat.teilnehmer.find((t) => t.teilnehmerId === teilnehmerId);
      if (!ziel) throw new NotFoundException("Teilnehmer:in nicht gefunden.");
      const bin = ziel.art === ich.art && ziel.id === ich.id;
      if (!bin) this.nurAdmin(chat);

      if (bin && chat.binAdmin && !chat.teilnehmer.some((t) => t.istAdmin && t.teilnehmerId !== teilnehmerId)) {
        // Letzter Admin geht: Adminrechte erbt die dienstaelteste andere Benutzer-Teilnahme
        // (Klient:innen koennen nicht Admin sein). Muss VOR dem eigenen Austritt passieren --
        // danach waere man kein Admin mehr und duerfte niemanden befoerdern.
        const erbe = chat.teilnehmer.find((t) => t.art === "benutzer" && t.teilnehmerId !== teilnehmerId);
        if (erbe) await client.query("UPDATE chat_teilnehmer SET ist_admin = true WHERE id = $1", [erbe.teilnehmerId]);
      }
      await client.query("UPDATE chat_teilnehmer SET verlassen_am = now() WHERE id = $1 AND verlassen_am IS NULL", [teilnehmerId]);
      return { entfernt: true as const };
    });
  }

  // --- intern, auch vom Nachrichten-Service genutzt ---

  /** Wirft 404, wenn der Chat fuer die aufrufende Person nicht sichtbar ist (Nicht-Teilnehmer, anderer Mandant, verlassen). */
  async pruefeTeilnahme(client: PoolClient, chatId: string): Promise<void> {
    if (!UUID_RE.test(chatId)) throw new NotFoundException("Chat nicht gefunden.");
    const { rows } = await client.query("SELECT 1 FROM chat WHERE id = $1", [chatId]);
    if (rows.length === 0) throw new NotFoundException("Chat nicht gefunden.");
  }

  private async ladeEinen(client: PoolClient, ich: Teilnehmer, id: string): Promise<ChatDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException("Chat nicht gefunden.");
    const chats = await this.ladeChats(client, ich, id);
    if (chats.length === 0) throw new NotFoundException("Chat nicht gefunden.");
    return chats[0];
  }

  private nurMitarbeitende(ich: Teilnehmer): void {
    if (ich.art === "klient") throw new ForbiddenException("Als Klient:in kannst du keine Chats anlegen.");
  }

  private nurGruppe(chat: ChatDto): void {
    if (chat.art !== "gruppe") throw new BadRequestException("Das geht nur in Gruppen.");
  }

  private nurAdmin(chat: ChatDto): void {
    if (!chat.binAdmin) throw new ForbiddenException("Nur Admins der Gruppe dürfen das.");
  }

  /** Alle Zeilen in EINEM Statement: die Erst-Befuellungs-Policy (chat_ersteller_befuellt) gilt nur, solange noch keine existiert. */
  private async teilnehmerEintragen(
    client: PoolClient,
    mandantId: string,
    chatId: string,
    personen: ({ benutzerId: string; istAdmin: boolean } | { klientId: string; istAdmin: boolean })[]
  ): Promise<void> {
    await client.query(
      `INSERT INTO chat_teilnehmer (mandant_id, chat_id, benutzer_id, klient_id, ist_admin)
       SELECT $1, $2, p.benutzer_id, p.klient_id, p.ist_admin
       FROM unnest($3::uuid[], $4::uuid[], $5::boolean[]) AS p(benutzer_id, klient_id, ist_admin)`,
      [
        mandantId,
        chatId,
        personen.map((p) => ("benutzerId" in p ? p.benutzerId : null)),
        personen.map((p) => ("klientId" in p ? p.klientId : null)),
        personen.map((p) => p.istAdmin),
      ]
    );
  }

  /** Zwei Abfragen fuer beliebig viele Chats (Chats + letzte Nachricht + Lesestand, dann Teilnehmende) -- kein N+1. */
  private async ladeChats(client: PoolClient, ich: Teilnehmer, chatId: string | null): Promise<ChatDto[]> {
    const { rows } = await client.query<ChatRow>(
      `SELECT c.id, c.art, c.name, c.erstellt_am, me.beigetreten_am, me.ist_admin,
              (SELECT count(*)::int FROM chat_nachricht u
               WHERE u.chat_id = c.id AND u.geloescht_am IS NULL AND u.art <> 'system'
                 AND u.erstellt_am > me.zuletzt_gelesen_am
                 AND NOT (COALESCE(u.absender_benutzer_id = $1::uuid, false) OR COALESCE(u.absender_klient_id = $2::uuid, false))) AS ungelesen,
              l.id AS l_id, l.art AS l_art, l.text AS l_text, l.geloescht_am AS l_geloescht_am, l.erstellt_am AS l_erstellt_am,
              l.absender_benutzer_id AS l_absender_benutzer_id, l.absender_klient_id AS l_absender_klient_id,
              l.standort_bezeichnung AS l_standort_bezeichnung, lt.titel AS l_termin_titel,
              lb.name AS l_benutzer_name, lk.vorname AS l_klient_vorname, lk.nachname AS l_klient_nachname
       FROM chat c
       JOIN chat_teilnehmer me ON me.chat_id = c.id AND me.verlassen_am IS NULL
            AND (me.benutzer_id = $1::uuid OR me.klient_id = $2::uuid)
       LEFT JOIN LATERAL (
         SELECT * FROM chat_nachricht m WHERE m.chat_id = c.id ORDER BY m.erstellt_am DESC, m.id DESC LIMIT 1
       ) l ON true
       LEFT JOIN termin lt ON lt.id = l.termin_id
       LEFT JOIN benutzer lb ON lb.id = l.absender_benutzer_id
       LEFT JOIN klient lk ON lk.id = l.absender_klient_id
       WHERE ($3::uuid IS NULL OR c.id = $3::uuid)
       ORDER BY COALESCE(l.erstellt_am, me.beigetreten_am) DESC, c.id`,
      [...prinzipalParameter(ich), chatId]
    );
    if (rows.length === 0) return [];

    const { rows: tn } = await client.query<TeilnehmerRow>(
      `SELECT ct.id, ct.chat_id, ct.benutzer_id, ct.klient_id, ct.ist_admin, ct.beigetreten_am,
              b.name AS benutzer_name, k.vorname AS klient_vorname, k.nachname AS klient_nachname
       FROM chat_teilnehmer ct
       LEFT JOIN benutzer b ON b.id = ct.benutzer_id
       LEFT JOIN klient k ON k.id = ct.klient_id
       WHERE ct.chat_id = ANY($1::uuid[]) AND ct.verlassen_am IS NULL
       ORDER BY ct.beigetreten_am, ct.id`,
      [rows.map((r) => r.id)]
    );
    const sichtbarkeit = new KlientNamen(client, ich);
    const nachChat = new Map<string, ChatTeilnehmerDto[]>();
    for (const r of tn) {
      const liste = nachChat.get(r.chat_id) ?? [];
      liste.push({
        teilnehmerId: r.id,
        ...(r.benutzer_id
          ? { art: "benutzer" as const, id: r.benutzer_id, name: r.benutzer_name ?? "" }
          : { art: "klient" as const, id: r.klient_id!, name: await sichtbarkeit.name(r.klient_id!, r.klient_vorname ?? "", r.klient_nachname ?? "") }),
        istAdmin: r.ist_admin,
        beigetretenAm: r.beigetreten_am.toISOString(),
      });
      nachChat.set(r.chat_id, liste);
    }

    const dtos: ChatDto[] = [];
    for (const r of rows) {
      const teilnehmer = nachChat.get(r.id) ?? [];
      let letzte: ChatVorschauDto | null = null;
      if (r.l_id && r.l_art && r.l_erstellt_am) {
        const absender: ChatPersonDto | null = r.l_absender_benutzer_id
          ? { art: "benutzer", id: r.l_absender_benutzer_id, name: r.l_benutzer_name ?? "" }
          : r.l_absender_klient_id
            ? { art: "klient", id: r.l_absender_klient_id, name: await sichtbarkeit.name(r.l_absender_klient_id, r.l_klient_vorname ?? "", r.l_klient_nachname ?? "") }
            : null;
        letzte = {
          nachrichtId: r.l_id,
          art: r.l_art,
          vorschau: vorschauText(r),
          absender,
          eigene: absender !== null && absender.art === ich.art && absender.id === ich.id,
          geloescht: r.l_geloescht_am !== null,
          erstelltAm: r.l_erstellt_am.toISOString(),
        };
      }
      const gegenueber = teilnehmer.find((t) => !(t.art === ich.art && t.id === ich.id));
      dtos.push({
        id: r.id,
        art: r.art,
        name: r.name,
        anzeigename: r.art === "gruppe" ? (r.name ?? "") : (gegenueber?.name ?? "Unbekannt"),
        erstelltAm: r.erstellt_am.toISOString(),
        binAdmin: r.ist_admin,
        ungelesen: r.ungelesen,
        teilnehmer,
        letzteNachricht: letzte,
        letzteAktivitaetAm: (letzte?.erstelltAm ?? r.beigetreten_am.toISOString()),
      });
    }
    return dtos;
  }
}

/** Platzhalter statt Inhalt: die Liste soll weder Bildnamen noch Koordinaten ausplaudern. */
function vorschauText(r: ChatRow): string {
  if (r.l_geloescht_am) return "Nachricht gelöscht";
  const kurz = (t: string | null) => {
    const s = (t ?? "").replace(/\s+/g, " ").trim();
    return s.length > VORSCHAU_LAENGE ? `${s.slice(0, VORSCHAU_LAENGE - 1)}…` : s;
  };
  switch (r.l_art) {
    case "text":
      return kurz(r.l_text);
    case "bild":
      return r.l_text ? `Bild: ${kurz(r.l_text)}` : "Bild";
    case "standort":
      return "Standort";
    case "termin":
      return r.l_termin_titel ? `Termin: ${kurz(r.l_termin_titel)}` : "Termin";
    default:
      return kurz(r.l_text);
  }
}

/** Kanonischer Schluessel eines Direktchats, unabhaengig von der Reihenfolge der beiden. */
export function direktSchluessel(a: Teilnehmer | ChatPersonDto, b: Teilnehmer | ChatPersonDto): string {
  return [`${a.art}:${a.id}`, `${b.art}:${b.id}`].sort().join("|");
}

/** Doppelte Eintraege und die eigene Person fallen weg. */
function dedupliziere(liste: ChatKontaktEingabe[], ich: Teilnehmer): ChatKontaktEingabe[] {
  const gesehen = new Set<string>();
  const ergebnis: ChatKontaktEingabe[] = [];
  for (const t of liste) {
    const art = "benutzerId" in t ? "benutzer" : "klient";
    const id = "benutzerId" in t ? t.benutzerId : t.klientId;
    const schluessel = `${art}:${id}`;
    if (gesehen.has(schluessel) || (art === ich.art && id === ich.id)) continue;
    gesehen.add(schluessel);
    ergebnis.push(t);
  }
  return ergebnis;
}
