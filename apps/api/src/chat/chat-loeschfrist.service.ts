import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

// Stuendlich statt taeglich: der Lauf ist billig (Indexzugriff ueber
// erstellt_am, siehe chat_nachricht_verlauf_idx), und eine Frist soll nicht
// je nach Neustartzeitpunkt bis zu einen Tag zu spaet greifen.
const INTERVALL_MS = 60 * 60 * 1000;
// Kurz nach dem Start, nicht sofort: Migrationen und Healthcheck zuerst.
const ERSTER_LAUF_MS = 60 * 1000;

export interface LoeschlaufErgebnis {
  mandantId: string;
  nachrichten: number;
  anhaenge: number;
  anfragen: number;
}

/**
 * Wendet die Loeschfrist fuer Chatinhalte an (migrations/0061).
 *
 * Laeuft ohne Tenant-Kontext ueber withoutTenant() -- die zweite
 * dokumentierte Ausnahme neben dem Login: ein Hintergrundlauf hat keine
 * anfragende Person und damit keinen app.mandant_id. Vertretbar, weil die
 * Funktion keine Parameter nimmt und ausschliesslich loescht, was nach der
 * eigenen Frist des jeweiligen Mandanten abgelaufen ist; was sie anfassen
 * darf, entscheidet die Datenbank, nicht dieser Code.
 *
 * Bewusst ein Timer in der API statt eines Cronjobs auf dem Server: ein
 * vergessener Cronjob faellt niemandem auf, und die Daten bleiben dann
 * stillschweigend fuer immer liegen.
 */
@Injectable()
export class ChatLoeschfristService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ChatLoeschfristService.name);
  private timer: NodeJS.Timeout[] = [];

  constructor(private readonly db: DatabaseService) {}

  onApplicationBootstrap() {
    // In Tests nicht: ein Lauf mitten in einer Suite wuerde Nachrichten mit
    // absichtlich alten Zeitstempeln wegraeumen. Die Specs rufen anwenden()
    // gezielt selbst auf.
    if (process.env.NODE_ENV === "test" || process.env.CHAT_LOESCHFRIST_AUTOMATISCH === "aus") return;
    this.timer.push(setTimeout(() => void this.sicherAnwenden(), ERSTER_LAUF_MS));
    this.timer.push(setInterval(() => void this.sicherAnwenden(), INTERVALL_MS));
  }

  onModuleDestroy() {
    for (const t of this.timer) clearTimeout(t);
    this.timer = [];
  }

  async anwenden(): Promise<LoeschlaufErgebnis[]> {
    return this.db.withoutTenant(async (client) => {
      const { rows } = await client.query<{ mandant_id: string; nachrichten: string; anhaenge: string; anfragen: string }>(
        "SELECT mandant_id, nachrichten, anhaenge, anfragen FROM chat_loeschfrist_anwenden()"
      );
      return rows.map((r) => ({
        mandantId: r.mandant_id,
        nachrichten: Number(r.nachrichten),
        anhaenge: Number(r.anhaenge),
        anfragen: Number(r.anfragen),
      }));
    });
  }

  private async sicherAnwenden() {
    try {
      // Nur Anzahlen ins Log, nie Inhalte oder Personen.
      for (const e of await this.anwenden()) {
        this.log.log(`Löschfrist: Mandant ${e.mandantId}: ${e.nachrichten} Nachrichten, ${e.anhaenge} Bilder, ${e.anfragen} Anfragen entfernt.`);
      }
    } catch (err) {
      this.log.error(`Löschfrist-Lauf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
