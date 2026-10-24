import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import { Client, type Notification } from "pg";
import type { ChatEreignisDto } from "@zimmerakte/shared";
import { tenantContextStorage, type TenantContext } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";

// 25 s liegt unter den ueblichen Leerlauf-Timeouts von Proxys (nginx 60 s, Mobilfunk-NAT oft 30 s).
// CHAT_HEARTBEAT_MS gibt es nur, damit die Tests den Heartbeat nicht 25 s abwarten muessen.
const HEARTBEAT_MS = 25_000;
const WIEDERVERBINDEN_MIN_MS = 1_000;
const WIEDERVERBINDEN_MAX_MS = 30_000;
// setTimeout vertraegt sich bei Werten ueber 2^31-1 ms zu einem Sofort-Ablauf.
const MAX_TIMEOUT_MS = 2_147_483_647;
const CHAT_ARTEN = new Set(["nachricht", "teilnehmer", "chat"]);

interface Abonnent {
  mandantId: string;
  ctx: TenantContext;
  res: Response;
  /** chat_id -> war ich beim letzten Pruefen aktive:r Teilnehmer:in. */
  mitgliedschaft: Map<string, boolean>;
  /** Ereignisse eines Abonnenten laufen nacheinander, damit ein Teilnehmer-Ereignis den Cache VOR dem naechsten Nachrichten-Ereignis erneuert. */
  warteschlange: Promise<void>;
  timer: NodeJS.Timeout[];
  beendet: boolean;
}

/**
 * Echtzeit per Server-Sent Events. Die Datenbank meldet per NOTIFY nur
 * "in Chat X ist etwas passiert" bzw. "Anfrage Y hat sich geaendert"
 * (migrations/0055/0056, ohne Inhalt); der Dienst
 * haelt dafuer EINE dedizierte Verbindung (LISTEN braucht eine dauerhafte,
 * keine Pool-Verbindung) und verteilt an die Abonnent:innen, die in diesem
 * Chat aktiv sind. Inhalte holt sich der Client danach per REST -- so laufen
 * alle Inhaltszugriffe unter RLS, und selbst ein Fehler in der Verteilung
 * koennte hoechstens verraten, DASS in einem Chat etwas passiert ist.
 *
 * Die Verbindung entsteht erst beim ersten Abonnenten: ohne Zuhoerer gibt es
 * nichts zu verteilen, und die vielen Testlaeufe, die AppModule starten,
 * halten dann keine zusaetzliche Datenbankverbindung offen.
 */
@Injectable()
export class ChatEreignisService implements OnModuleDestroy {
  private readonly log = new Logger(ChatEreignisService.name);
  private readonly abonnenten = new Set<Abonnent>();
  private client: Client | null = null;
  private verbindungsversuch: Promise<void> | null = null;
  private wiederverbindenTimer: NodeJS.Timeout | null = null;
  private wartezeitMs = WIEDERVERBINDEN_MIN_MS;
  private beendet = false;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Haelt die Antwort offen, bis die Person trennt, der Token ablaeuft
   * (ablaufAm, ms seit Epoche) oder die Anwendung herunterfaehrt. Ein Stream
   * lebt sonst laenger als das Token, mit dem er geoeffnet wurde: eine
   * zwischenzeitlich deaktivierte Person bekaeme weiter Signale.
   */
  async abonnieren(res: Response, ctx: TenantContext, ablaufAm: number | null): Promise<void> {
    try {
      await this.sichereVerbindung();
    } catch (err) {
      this.log.error(`LISTEN-Verbindung nicht moeglich: ${(err as Error).message}`);
      throw new ServiceUnavailableException("Echtzeit-Verbindung momentan nicht verfügbar.");
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Ohne das puffert nginx die Antwort, und Ereignisse kaemen gesammelt statt sofort.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(": verbunden\n\n");

    const abonnent: Abonnent = {
      mandantId: ctx.mandantId,
      ctx,
      res,
      mitgliedschaft: new Map(),
      warteschlange: Promise.resolve(),
      timer: [],
      beendet: false,
    };
    this.abonnenten.add(abonnent);
    abonnent.timer.push(setInterval(() => this.schreibe(abonnent, ": ping\n\n"), Number(process.env.CHAT_HEARTBEAT_MS) || HEARTBEAT_MS));
    if (ablaufAm !== null) {
      abonnent.timer.push(setTimeout(() => this.beende(abonnent), Math.min(Math.max(ablaufAm - Date.now(), 0), MAX_TIMEOUT_MS)));
    }
    // Nur res: das 'close' von IncomingMessage bedeutet seit Node 16 "Anfrage fertig gelesen", nicht "Verbindung weg".
    res.on("close", () => this.beende(abonnent));
  }

  async onModuleDestroy(): Promise<void> {
    this.beendet = true;
    if (this.wiederverbindenTimer) clearTimeout(this.wiederverbindenTimer);
    for (const a of [...this.abonnenten]) this.beende(a);
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
    // Ein gerade laufender Verbindungsaufbau schliesst sich selbst, sobald er merkt, dass wir beendet sind.
    await this.verbindungsversuch?.catch(() => undefined);
  }

  private beende(a: Abonnent): void {
    if (a.beendet) return;
    a.beendet = true;
    for (const t of a.timer) {
      clearInterval(t);
      clearTimeout(t);
    }
    this.abonnenten.delete(a);
    if (!a.res.writableEnded) a.res.end();
  }

  private schreibe(a: Abonnent, text: string): void {
    if (a.beendet || a.res.writableEnded || a.res.destroyed) return;
    try {
      a.res.write(text);
    } catch {
      this.beende(a);
    }
  }

  private sichereVerbindung(): Promise<void> {
    if (this.beendet) return Promise.reject(new Error("Dienst beendet."));
    if (this.client) return Promise.resolve();
    this.verbindungsversuch ??= this.verbinde().finally(() => {
      this.verbindungsversuch = null;
    });
    return this.verbindungsversuch;
  }

  private async verbinde(): Promise<void> {
    const connectionString = process.env.APP_DATABASE_URL;
    if (!connectionString) throw new Error("APP_DATABASE_URL ist nicht gesetzt (siehe .env.example).");
    const client = new Client({ connectionString });
    // Ohne 'error'-Listener wirft ein Verbindungsabbruch als unbehandeltes Ereignis den ganzen Prozess um.
    client.on("error", (err) => {
      this.log.warn(`LISTEN-Verbindung gestoert: ${err.message}`);
      this.verbindungVerloren(client);
    });
    client.on("end", () => this.verbindungVerloren(client));
    client.on("notification", (n) => this.eingang(n));
    try {
      await client.connect();
      await client.query("LISTEN chat_ereignis");
    } catch (err) {
      client.removeAllListeners("end");
      await client.end().catch(() => undefined);
      throw err;
    }
    if (this.beendet) {
      client.removeAllListeners("end");
      await client.end().catch(() => undefined);
      return;
    }
    this.client = client;
  }

  private verbindungVerloren(client: Client): void {
    if (this.client !== client) return;
    this.client = null;
    if (this.beendet || this.abonnenten.size === 0) return;
    this.plane(this.wartezeitMs);
  }

  private plane(verzoegerungMs: number): void {
    if (this.wiederverbindenTimer || this.beendet) return;
    this.wiederverbindenTimer = setTimeout(async () => {
      this.wiederverbindenTimer = null;
      try {
        await this.sichereVerbindung();
        this.wartezeitMs = WIEDERVERBINDEN_MIN_MS;
        // Waehrend der Luecke verlorene Ereignisse lassen sich nicht nachliefern:
        // alle Abonnent:innen sollen neu laden.
        for (const a of this.abonnenten) {
          a.mitgliedschaft.clear();
          this.schreibe(a, eventText({ chatId: null, art: "resync" }));
        }
      } catch {
        this.wartezeitMs = Math.min(verzoegerungMs * 2, WIEDERVERBINDEN_MAX_MS);
        this.plane(this.wartezeitMs);
      }
    }, verzoegerungMs);
  }

  private eingang(n: Notification): void {
    let nutzlast: { mandant_id?: unknown; chat_id?: unknown; anfrage_id?: unknown; art?: unknown };
    try {
      nutzlast = JSON.parse(n.payload ?? "");
    } catch {
      return;
    }
    if (typeof nutzlast.mandant_id !== "string" || typeof nutzlast.art !== "string") return;
    const mandantId = nutzlast.mandant_id;
    let zustellen: (a: Abonnent) => Promise<void>;
    if (nutzlast.art === "anfrage" && typeof nutzlast.anfrage_id === "string") {
      const anfrageId = nutzlast.anfrage_id;
      zustellen = (a) => this.zustellenAnfrage(a, anfrageId);
    } else if (typeof nutzlast.chat_id === "string" && CHAT_ARTEN.has(nutzlast.art)) {
      const ereignis = { chatId: nutzlast.chat_id, art: nutzlast.art as ChatEreignisDto["art"] };
      zustellen = (a) => this.zustellen(a, ereignis);
    } else {
      return;
    }
    for (const a of this.abonnenten) {
      // Vorab-Filter nach Mandant; die eigentliche Zugangsentscheidung trifft die Datenbank (istMitglied / sieheAnfrage).
      if (a.mandantId !== mandantId) continue;
      a.warteschlange = a.warteschlange.then(() => zustellen(a)).catch((err) => {
        this.log.warn(`Ereignis konnte nicht zugestellt werden: ${(err as Error).message}`);
      });
    }
  }

  /** Anfragen werden nicht zwischengespeichert: ob jemand sie sieht, haengt vom Zustand ab (Team, Beantworter:in) und aendert sich mit jedem Ereignis. */
  private async zustellenAnfrage(a: Abonnent, anfrageId: string): Promise<void> {
    if (a.beendet) return;
    // Plain SELECT unter der Identitaet des Abonnenten: chat_anfrage_lesen (RLS) ist die Zugangsentscheidung.
    const { rows } = await tenantContextStorage.run(a.ctx, () =>
      this.db.withTenant((client) => client.query("SELECT 1 FROM chat_anfrage WHERE id = $1::uuid", [anfrageId]))
    );
    if (rows.length > 0) this.schreibe(a, eventText({ chatId: null, art: "anfrage", anfrageId }));
  }

  private async zustellen(a: Abonnent, e: { chatId: string; art: ChatEreignisDto["art"] }): Promise<void> {
    if (a.beendet) return;
    const vorher = a.mitgliedschaft.get(e.chatId);
    let senden: boolean;
    if (e.art === "teilnehmer") {
      // Mitgliedschaft hat sich geaendert: neu pruefen. Wer eben ENTFERNT wurde, soll das
      // einmal erfahren (Chatliste neu laden), danach nichts mehr aus diesem Chat.
      const jetzt = await this.istMitglied(a, e.chatId);
      a.mitgliedschaft.set(e.chatId, jetzt);
      senden = jetzt || vorher === true;
    } else {
      const jetzt = vorher ?? (await this.istMitglied(a, e.chatId));
      a.mitgliedschaft.set(e.chatId, jetzt);
      senden = jetzt;
    }
    if (senden) this.schreibe(a, eventText(e));
  }

  private async istMitglied(a: Abonnent, chatId: string): Promise<boolean> {
    // Unter dem Kontext des Abonnenten, damit RLS/chat_ist_teilnehmer() mit SEINER Identitaet rechnet.
    const { rows } = await tenantContextStorage.run(a.ctx, () =>
      this.db.withTenant((client) => client.query<{ ok: boolean }>("SELECT chat_ist_teilnehmer($1::uuid) AS ok", [chatId]))
    );
    return rows[0]?.ok === true;
  }
}

function eventText(e: ChatEreignisDto): string {
  return `event: chat\ndata: ${JSON.stringify(e)}\n\n`;
}
