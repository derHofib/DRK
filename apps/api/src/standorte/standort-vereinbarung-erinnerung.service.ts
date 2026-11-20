import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

const INTERVALL_MS = 60 * 60 * 1000;
// Versetzt zur Kostenuebernahme-Erinnerung (90 s), damit nicht beide Laeufe
// beim Start gleichzeitig ueber alle Mandanten gehen.
const ERSTER_LAUF_MS = 120 * 1000;

export interface VereinbarungErinnerungsErgebnis {
  mandantId: string;
  aufgaben: number;
}

/**
 * Erinnerungs-Aufgaben vor dem Ende einer Standort-Vereinbarung
 * (migrations/0081), gleiches Muster wie KostenuebernahmeErinnerungService:
 * Hintergrundlauf ohne anfragende Person, der nur die parameterlose
 * SECURITY-DEFINER-Funktion aufruft. Timer in der API statt Cronjob, weil
 * ein vergessener Cronjob nicht auffaellt.
 */
@Injectable()
export class StandortVereinbarungErinnerungService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(StandortVereinbarungErinnerungService.name);
  private timer: NodeJS.Timeout[] = [];

  constructor(private readonly db: DatabaseService) {}

  onApplicationBootstrap() {
    // In Tests nicht: die Specs rufen erzeugen() gezielt selbst auf.
    if (process.env.NODE_ENV === "test" || process.env.VEREINBARUNG_ERINNERUNG_AUTOMATISCH === "aus") return;
    this.timer.push(setTimeout(() => void this.sicherErzeugen(), ERSTER_LAUF_MS));
    this.timer.push(setInterval(() => void this.sicherErzeugen(), INTERVALL_MS));
  }

  onModuleDestroy() {
    for (const t of this.timer) clearTimeout(t);
    this.timer = [];
  }

  async erzeugen(): Promise<VereinbarungErinnerungsErgebnis[]> {
    return this.db.withoutTenant(async (client) => {
      const { rows } = await client.query<{ mandant_id: string; aufgaben: string }>(
        "SELECT mandant_id, aufgaben FROM standort_vereinbarung_erinnerungen_erzeugen()"
      );
      return rows.map((r) => ({ mandantId: r.mandant_id, aufgaben: Number(r.aufgaben) }));
    });
  }

  private async sicherErzeugen() {
    try {
      for (const e of await this.erzeugen()) {
        this.log.log(`Vereinbarungs-Erinnerung: Mandant ${e.mandantId}: ${e.aufgaben} Aufgaben angelegt.`);
      }
    } catch (err) {
      this.log.error(`Erinnerungslauf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
