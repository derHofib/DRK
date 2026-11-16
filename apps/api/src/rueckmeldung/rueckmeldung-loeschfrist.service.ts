import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

// Stuendlich, aus demselben Grund wie bei den anderen Fristlaeufen (0061, 0070).
const INTERVALL_MS = 60 * 60 * 1000;
const ERSTER_LAUF_MS = 60 * 1000;

/**
 * Wendet die Loeschfrist fuer Rueckmeldungen an (migrations/0073): Bilder 30
 * Tage, Eintraege 365 Tage nach Abschluss. Vierte Ausnahme vom Tenant-Kontext,
 * aus dem Grund der Chat-Frist: ein Hintergrundlauf hat keine anfragende
 * Person, und die parameterlose Funktion kann nur genau das loeschen.
 */
@Injectable()
export class RueckmeldungLoeschfristService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(RueckmeldungLoeschfristService.name);
  private timer: NodeJS.Timeout[] = [];

  constructor(private readonly db: DatabaseService) {}

  onApplicationBootstrap() {
    // In Tests nicht: ein Lauf mitten in einer Suite wuerde Zeilen mit
    // absichtlich alten Zeitstempeln wegraeumen.
    if (process.env.NODE_ENV === "test") return;
    this.timer.push(setTimeout(() => void this.sicherAnwenden(), ERSTER_LAUF_MS));
    this.timer.push(setInterval(() => void this.sicherAnwenden(), INTERVALL_MS));
  }

  onModuleDestroy() {
    for (const t of this.timer) clearTimeout(t);
    this.timer = [];
  }

  async anwenden(): Promise<{ bilder: number; eintraege: number }> {
    return this.db.withoutTenant(async (client) => {
      const { rows } = await client.query("SELECT bilder, eintraege FROM rueckmeldung_loeschfrist_anwenden()");
      return { bilder: Number(rows[0]?.bilder ?? 0), eintraege: Number(rows[0]?.eintraege ?? 0) };
    });
  }

  private async sicherAnwenden() {
    try {
      const e = await this.anwenden();
      if (e.bilder > 0 || e.eintraege > 0) this.log.log(`Rückmeldungen-Löschfrist: ${e.bilder} Bilder, ${e.eintraege} Einträge gelöscht.`);
    } catch (err) {
      this.log.error(`Rückmeldungen-Löschfrist fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
