import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

// Stuendlich: der Lauf ist idempotent und billig; so greift eine Stufe
// nicht je nach Neustartzeitpunkt erst einen Tag spaeter.
const INTERVALL_MS = 60 * 60 * 1000;
const ERSTER_LAUF_MS = 90 * 1000;

export interface ErinnerungsErgebnis {
  mandantId: string;
  aufgaben: number;
}

/**
 * Erzeugt die Erinnerungs-Aufgaben vor Ablauf einer Kostenuebernahme
 * (migrations/0071). Wie ChatLoeschfristService ein Hintergrundlauf ohne
 * anfragende Person: er ruft nur die parameterlose SECURITY-DEFINER-
 * Funktion auf, was sie anlegen darf, entscheidet die Datenbank.
 *
 * Timer in der API statt Cronjob: ein vergessener Cronjob faellt nicht auf,
 * und die Erinnerung bliebe stillschweigend aus.
 */
@Injectable()
export class KostenuebernahmeErinnerungService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(KostenuebernahmeErinnerungService.name);
  private timer: NodeJS.Timeout[] = [];

  constructor(private readonly db: DatabaseService) {}

  onApplicationBootstrap() {
    // In Tests nicht: ein Lauf mitten in einer Suite wuerde unerwartete
    // Aufgaben anlegen. Die Specs rufen erzeugen() gezielt selbst auf.
    if (process.env.NODE_ENV === "test" || process.env.KOSTENUEBERNAHME_ERINNERUNG_AUTOMATISCH === "aus") return;
    this.timer.push(setTimeout(() => void this.sicherErzeugen(), ERSTER_LAUF_MS));
    this.timer.push(setInterval(() => void this.sicherErzeugen(), INTERVALL_MS));
  }

  onModuleDestroy() {
    for (const t of this.timer) clearTimeout(t);
    this.timer = [];
  }

  async erzeugen(): Promise<ErinnerungsErgebnis[]> {
    return this.db.withoutTenant(async (client) => {
      const { rows } = await client.query<{ mandant_id: string; aufgaben: string }>(
        "SELECT mandant_id, aufgaben FROM kostenuebernahme_erinnerungen_erzeugen()"
      );
      return rows.map((r) => ({ mandantId: r.mandant_id, aufgaben: Number(r.aufgaben) }));
    });
  }

  private async sicherErzeugen() {
    try {
      // Nur Anzahlen ins Log, nie Personen.
      for (const e of await this.erzeugen()) {
        this.log.log(`Kostenübernahme-Erinnerung: Mandant ${e.mandantId}: ${e.aufgaben} Aufgaben angelegt.`);
      }
    } catch (err) {
      this.log.error(`Erinnerungslauf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
