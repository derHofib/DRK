import type { PoolClient } from "pg";
import { initialen } from "./anonymisierung";
import { ermittleErlaubteStandortIds, klientIstErlaubt } from "./standort-restriction";
import type { Teilnehmer } from "./tenant-context";

/**
 * Klientennamen beim Lesen anonymisieren (CLAUDE.md Regel 6): Klient:innen
 * sehen andere Klient:innen (und sich selbst) nur mit Vornamen; Mitarbeitende
 * sehen den vollen Namen, wenn sie die Person auch in der Klientenliste sehen
 * duerften, sonst nur Initialen -- ein standortbeschraenkter Kollege, der zu
 * einem Termin oder Chat dazukommt, soll dadurch keine fremde Akte erkennen.
 *
 * Eine Instanz gilt fuer EINE Anfrage: sie merkt sich Ergebnisse und die
 * Standort-Einschraenkung der Person, damit eine Liste mit vielen Klient:innen
 * nicht je Eintrag neu nachfragt.
 */
export class KlientNamen {
  private readonly erlaubt = new Map<string, boolean>();
  private eingeschraenkt: Promise<boolean> | null = null;

  constructor(private readonly client: PoolClient, private readonly ich: Teilnehmer) {}

  async name(klientId: string, vorname: string, nachname: string): Promise<string> {
    if (this.ich.art === "klient") return vorname;
    return (await this.darfVollstaendigSehen(klientId)) ? `${vorname} ${nachname}` : initialen(vorname, nachname);
  }

  async darfVollstaendigSehen(klientId: string): Promise<boolean> {
    if (this.ich.art === "klient") return false;
    const benutzerId = this.ich.id;
    this.eingeschraenkt ??= ermittleErlaubteStandortIds(this.client, benutzerId).then((s) => s !== null);
    if (!(await this.eingeschraenkt)) return true;
    let darf = this.erlaubt.get(klientId);
    if (darf === undefined) {
      darf = await klientIstErlaubt(this.client, benutzerId, klientId);
      this.erlaubt.set(klientId, darf);
    }
    return darf;
  }
}
