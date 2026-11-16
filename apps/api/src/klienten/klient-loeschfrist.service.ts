import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

// Stuendlich, aus demselben Grund wie bei der Chat-Loeschfrist: der Lauf ist
// billig, und eine Frist soll nicht je nach Neustartzeitpunkt bis zu einen
// Tag zu spaet greifen.
const INTERVALL_MS = 60 * 60 * 1000;
// Spaeter als der Chat-Lauf (60 s): Migrationen und Healthcheck zuerst, und
// die Anonymisierung stoesst ihrerseits die Chat-Bereinigung an.
const ERSTER_LAUF_MS = 2 * 60 * 1000;

export interface KlientLoeschlaufErgebnis {
  mandantId: string;
  klienten: number;
}

/**
 * Wendet die Loeschfrist fuer archivierte Klient:innen an (migrations/0070).
 *
 * Dritte dokumentierte Ausnahme von withTenant() (neben Login und
 * Chat-Loeschfrist, siehe CLAUDE.md, Regel 1): ein Hintergrundlauf hat keine
 * anfragende Person. Vertretbar, weil die Funktion parameterlos ist und nur
 * anonymisiert, was nach der eigenen Frist des jeweiligen Mandanten
 * abgelaufen ist -- und ohne gesetzte Frist (Standard) gar nichts.
 */
@Injectable()
export class KlientLoeschfristService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(KlientLoeschfristService.name);
  private timer: NodeJS.Timeout[] = [];

  constructor(private readonly db: DatabaseService) {}

  onApplicationBootstrap() {
    // In Tests nicht: ein Lauf mitten in einer Suite wuerde Klient:innen mit
    // absichtlich altem archiviert_am anonymisieren. Die Specs rufen anwenden()
    // gezielt selbst auf.
    if (process.env.NODE_ENV === "test" || process.env.KLIENT_LOESCHFRIST_AUTOMATISCH === "aus") return;
    this.timer.push(setTimeout(() => void this.sicherAnwenden(), ERSTER_LAUF_MS));
    this.timer.push(setInterval(() => void this.sicherAnwenden(), INTERVALL_MS));
  }

  onModuleDestroy() {
    for (const t of this.timer) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timer = [];
  }

  async anwenden(): Promise<KlientLoeschlaufErgebnis[]> {
    return this.db.withoutTenant(async (client) => {
      const { rows } = await client.query<{ mandant_id: string; klienten: string }>(
        "SELECT mandant_id, klienten FROM klient_loeschfrist_anwenden()"
      );
      return rows.map((r) => ({ mandantId: r.mandant_id, klienten: Number(r.klienten) }));
    });
  }

  private async sicherAnwenden() {
    try {
      // Nur Anzahlen ins Log, nie Namen oder Ids von Personen.
      for (const e of await this.anwenden()) {
        this.log.log(`Klienten-Löschfrist: Mandant ${e.mandantId}: ${e.klienten} Klient:innen anonymisiert.`);
      }
    } catch (err) {
      this.log.error(`Klienten-Löschfrist-Lauf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
