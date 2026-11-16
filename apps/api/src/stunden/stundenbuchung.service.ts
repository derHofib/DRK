import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { Leistungsart, StundenbuchungDto, StundenSummeDto } from "@zimmerakte/shared";
import { STUNDENBUCHUNG_MINUTEN_MAX } from "@zimmerakte/shared";
import { DatabaseService } from "../database/database.service";
import { heuteBerlin } from "../common/heute";
import { isPgError } from "../common/pg-error";
import { KlientNamen } from "../common/klient-namen";
import { requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds, klientIstArchiviert, klientIstErlaubt, klientStandortBedingung } from "../common/standort-restriction";
import { RechteService } from "../rechte/rechte.service";

const UNIQUE_VIOLATION = "23505";

export interface StundenbuchungAnlegenEingabe {
  klientId: string;
  /** Wer die Leistung erbracht hat; ohne Angabe die buchende Person selbst. */
  mitarbeiterId?: string;
  datum: string;
  minuten: number;
  leistungsart: Leistungsart;
  notiz?: string;
}

export interface StundenFilter {
  klientId?: string;
  mitarbeiterId?: string;
  von?: string;
  bis?: string;
}

/**
 * Inhalt der Anfrage als Hash (wie fingerabdruck() im Kassenbuch, 0062):
 * derselbe Schluessel mit ANDEREM Inhalt ist kein Wiederholungsversuch,
 * sondern ein Fehler im Client -- dann 409 statt die neue Buchung still zu
 * verschlucken. mitarbeiterId wird vor dem Hash aufgeloest, sonst waere
 * "ohne Angabe" und "ich selbst" faelschlich zwei verschiedene Anfragen.
 */
export function stundenFingerabdruck(input: StundenbuchungAnlegenEingabe & { mitarbeiterId: string }): string {
  return createHash("sha256")
    .update(
      JSON.stringify([input.klientId, input.mitarbeiterId, input.datum, input.minuten, input.leistungsart, input.notiz?.trim() ?? ""])
    )
    .digest("hex");
}

const AUSWAHL = `
  SELECT s.id, s.klient_id, k.vorname, k.nachname, s.mitarbeiter_id, m.name AS mitarbeiter_name,
         s.datum, s.minuten, s.leistungsart, s.notiz, s.gebucht_von, g.name AS gebucht_von_name, s.erstellt_am,
         s.storniert, s.storno_grund, sv.name AS storno_von_name, s.storniert_am
  FROM stundenbuchung s
  JOIN klient k ON k.id = s.klient_id
  JOIN benutzer m ON m.id = s.mitarbeiter_id
  LEFT JOIN benutzer g ON g.id = s.gebucht_von
  LEFT JOIN benutzer sv ON sv.id = s.storniert_von
`;

@Injectable()
export class StundenbuchungService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  /** Fuer die Oberflaeche: was darf die angemeldete Person -- blendet nur Knoepfe aus, durchgesetzt wird im Service. */
  async meineRechte(): Promise<{ ansehen: boolean; buchen: boolean; fuerAndereBuchen: boolean }> {
    const [ansehen, buchen, fuerAndereBuchen] = await Promise.all([
      this.rechte.hatRecht("stunden", "ansehen"),
      this.rechte.hatRecht("stunden", "buchen"),
      this.rechte.hatRecht("stunden", "fuer-andere-buchen"),
    ]);
    return { ansehen, buchen, fuerAndereBuchen };
  }

  async findeAlle(filter: StundenFilter = {}): Promise<StundenbuchungDto[]> {
    const ctx = requireTenantContext();
    await this.verlangeRecht("ansehen", "Stunden einzusehen");
    const darfStornieren = await this.rechte.hatRecht("stunden", "stornieren");
    return this.db.withTenant(async (client) => {
      const params: unknown[] = [];
      const bedingungen = await this.filterBedingungen(client, ctx.benutzerId, filter, params);
      const { rows } = await client.query(`${AUSWAHL} WHERE ${bedingungen.join(" AND ")} ORDER BY s.datum DESC, s.erstellt_am DESC`, params);
      const namen = new KlientNamen(client, { art: "benutzer", id: ctx.benutzerId });
      return Promise.all(rows.map(async (r) => zuDto(r, await namen.name(r.klient_id, r.vorname, r.nachname), ctx.benutzerId, darfStornieren)));
    });
  }

  /**
   * Der Stundensaldo je Klient:in und Monat -- eine Summe ueber die nicht
   * stornierten Buchungen, kein gespeicherter Wert (CLAUDE.md Regel 4).
   */
  async summen(filter: StundenFilter = {}): Promise<StundenSummeDto[]> {
    const ctx = requireTenantContext();
    await this.verlangeRecht("ansehen", "Stunden einzusehen");
    return this.db.withTenant(async (client) => {
      const params: unknown[] = [];
      const bedingungen = await this.filterBedingungen(client, ctx.benutzerId, filter, params);
      bedingungen.push("NOT s.storniert");
      const { rows } = await client.query(
        `SELECT s.klient_id, k.vorname, k.nachname, to_char(s.datum, 'YYYY-MM') AS monat,
                sum(s.minuten)::int AS minuten, count(*)::int AS anzahl
         FROM stundenbuchung s JOIN klient k ON k.id = s.klient_id
         WHERE ${bedingungen.join(" AND ")}
         GROUP BY s.klient_id, k.vorname, k.nachname, monat
         ORDER BY monat DESC, k.nachname, k.vorname`,
        params
      );
      const namen = new KlientNamen(client, { art: "benutzer", id: ctx.benutzerId });
      return Promise.all(
        rows.map(async (r) => ({
          klientId: r.klient_id,
          klientName: await namen.name(r.klient_id, r.vorname, r.nachname),
          monat: r.monat,
          minuten: r.minuten,
          anzahl: r.anzahl,
        }))
      );
    });
  }

  async anlegenIdempotent(
    input: StundenbuchungAnlegenEingabe,
    idempotenzSchluessel?: string
  ): Promise<{ buchung: StundenbuchungDto; wiederholt: boolean }> {
    const { mandantId, benutzerId } = requireTenantContext();
    await this.verlangeRecht("buchen", "Stunden zu buchen");
    const mitarbeiterId = input.mitarbeiterId ?? benutzerId;
    if (mitarbeiterId !== benutzerId) {
      await this.verlangeRecht("fuer-andere-buchen", "Stunden für andere Mitarbeitende zu buchen");
    }
    // ISO-Daten sind lexikographisch vergleichbar. Im Service, weil jeder Weg
    // zum INSERT hier vorbei muss, nicht nur der Controller.
    if (input.datum > heuteBerlin()) {
      throw new BadRequestException("Stunden dürfen nicht in der Zukunft gebucht werden.");
    }
    const vollstaendig = { ...input, mitarbeiterId };
    const abdruck = idempotenzSchluessel ? stundenFingerabdruck(vollstaendig) : null;

    try {
      return await this.db.withTenant(async (client) => {
        // Vor allen fachlichen Pruefungen: ist die Buchung schon angekommen,
        // gilt sie -- auch wenn die Klientin inzwischen archiviert wurde.
        if (idempotenzSchluessel) {
          const vorhanden = await this.wiederholung(client, idempotenzSchluessel, abdruck!, benutzerId);
          if (vorhanden) return { buchung: vorhanden, wiederholt: true };
        }

        // klientIstErlaubt() sagt fuer Personen OHNE Standort-Einschraenkung
        // immer "ja", auch zu einer ID, die es im Mandanten nicht gibt. Der
        // Fremdschluessel allein schuetzt nicht: seine Pruefung laeuft an RLS
        // vorbei, ein Mandant koennte so auf die Klient:in eines anderen
        // verweisen. Erst die Abfrage hier -- durch RLS gefiltert -- stellt
        // fest, dass die Klient:in zu DIESEM Mandanten gehoert.
        const { rows: klient } = await client.query("SELECT 1 FROM klient WHERE id = $1", [input.klientId]);
        if (klient.length === 0 || !(await klientIstErlaubt(client, benutzerId, input.klientId))) {
          throw new NotFoundException("Klient nicht gefunden.");
        }
        if (await klientIstArchiviert(client, input.klientId)) {
          throw new BadRequestException("Dieser Klient ist archiviert und kann nicht mehr bearbeitet werden.");
        }
        // RLS blendet Mitarbeitende fremder Traeger aus; deaktivierte Konten
        // leisten nichts mehr.
        const { rows: mitarbeiter } = await client.query("SELECT aktiv FROM benutzer WHERE id = $1", [mitarbeiterId]);
        if (mitarbeiter.length === 0) throw new NotFoundException("Mitarbeiter:in nicht gefunden.");
        if (!mitarbeiter[0].aktiv) throw new BadRequestException("Dieses Konto ist deaktiviert.");

        // Niemand leistet mehr als 24 Stunden am Tag. Die Summe haengt an der
        // Person, nicht an der Klientin: zwei Klient:innen zur selben Zeit
        // sind fachlich moeglich (Gruppenangebot), 25 Stunden an einem Tag nicht.
        const { rows: summe } = await client.query(
          "SELECT COALESCE(sum(minuten), 0)::int AS minuten FROM stundenbuchung WHERE mitarbeiter_id = $1 AND datum = $2 AND NOT storniert",
          [mitarbeiterId, input.datum]
        );
        if (summe[0].minuten + input.minuten > STUNDENBUCHUNG_MINUTEN_MAX) {
          throw new BadRequestException("An diesem Tag wären für diese Person mehr als 24 Stunden gebucht.");
        }

        const { rows } = await client.query(
          `INSERT INTO stundenbuchung (mandant_id, klient_id, mitarbeiter_id, datum, minuten, leistungsart, notiz, gebucht_von,
                                       idempotenz_schluessel, idempotenz_fingerabdruck)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            mandantId,
            input.klientId,
            mitarbeiterId,
            input.datum,
            input.minuten,
            input.leistungsart,
            input.notiz?.trim() || null,
            benutzerId,
            idempotenzSchluessel ?? null,
            abdruck,
          ]
        );
        return { buchung: await this.findeEine(client, rows[0].id), wiederholt: false };
      });
    } catch (err) {
      // Zwei Versuche mit demselben Schluessel gleichzeitig: der zweite wartet
      // am Index, bis der erste committet, und scheitert dann -- nachsehen,
      // ob unter dem Schluessel inzwischen eine Buchung steht.
      if (idempotenzSchluessel && isPgError(err) && err.code === UNIQUE_VIOLATION) {
        const vorhanden = await this.db.withTenant((client) => this.wiederholung(client, idempotenzSchluessel, abdruck!, benutzerId));
        if (vorhanden) return { buchung: vorhanden, wiederholt: true };
      }
      throw err;
    }
  }

  /**
   * Storniert eine Buchung. Die buchende bzw. leistende Person darf das
   * immer (Tippfehler korrigiert man selbst); fremde Buchungen nur mit dem
   * Recht stunden.stornieren. Ein Grund ist Pflicht und bleibt mit Urheber
   * und Zeitpunkt in der Zeile stehen.
   */
  async stornieren(id: string, grund: string): Promise<StundenbuchungDto> {
    const ctx = requireTenantContext();
    const darfFremde = await this.rechte.hatRecht("stunden", "stornieren");
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ klient_id: string; gebucht_von: string; mitarbeiter_id: string; storniert: boolean }>(
        "SELECT klient_id, gebucht_von, mitarbeiter_id, storniert FROM stundenbuchung WHERE id = $1",
        [id]
      );
      // Auch "darf diese Klient:in nicht sehen" ist fuer die Person ein 404:
      // die Existenz einer Buchung bei fremden Standorten bleibt verborgen.
      if (rows.length === 0 || !(await klientIstErlaubt(client, ctx.benutzerId, rows[0].klient_id))) {
        throw new NotFoundException("Stundenbuchung nicht gefunden.");
      }
      const eigene = rows[0].gebucht_von === ctx.benutzerId || rows[0].mitarbeiter_id === ctx.benutzerId;
      if (!eigene && !darfFremde) {
        throw new ForbiddenException("Fremde Stundenbuchungen dürfen nur mit der Berechtigung „Stunden stornieren“ storniert werden.");
      }
      if (rows[0].storniert) throw new ConflictException("Diese Buchung ist bereits storniert.");
      await client.query(
        "UPDATE stundenbuchung SET storniert = true, storno_grund = $2, storniert_von = $3, storniert_am = now() WHERE id = $1",
        [id, grund.trim(), ctx.benutzerId]
      );
      return this.findeEine(client, id);
    });
  }

  private async verlangeRecht(aktion: string, was: string): Promise<void> {
    if (!(await this.rechte.hatRecht("stunden", aktion))) {
      throw new ForbiddenException(`Für ${was} fehlt die Berechtigung.`);
    }
  }

  private async filterBedingungen(client: PoolClient, benutzerId: string, filter: StundenFilter, params: unknown[]): Promise<string[]> {
    const bedingungen: string[] = [];
    if (filter.klientId) {
      params.push(filter.klientId);
      bedingungen.push(`s.klient_id = $${params.length}`);
    }
    if (filter.mitarbeiterId) {
      params.push(filter.mitarbeiterId);
      bedingungen.push(`s.mitarbeiter_id = $${params.length}`);
    }
    if (filter.von) {
      params.push(filter.von);
      bedingungen.push(`s.datum >= $${params.length}`);
    }
    if (filter.bis) {
      params.push(filter.bis);
      bedingungen.push(`s.datum <= $${params.length}`);
    }
    bedingungen.push(klientStandortBedingung(await ermittleErlaubteStandortIds(client, benutzerId), "k", params));
    return bedingungen;
  }

  private async findeEine(client: PoolClient, id: string): Promise<StundenbuchungDto> {
    const ctx = requireTenantContext();
    const { rows } = await client.query(`${AUSWAHL} WHERE s.id = $1`, [id]);
    const namen = new KlientNamen(client, { art: "benutzer", id: ctx.benutzerId });
    return zuDto(rows[0], await namen.name(rows[0].klient_id, rows[0].vorname, rows[0].nachname), ctx.benutzerId, await this.rechte.hatRecht("stunden", "stornieren"));
  }

  /**
   * Nur fuer dieselbe Person und denselben Inhalt eine Wiederholung: sonst
   * wuerde die Antwort einer anderen Person eine Buchung zeigen, die sie
   * vielleicht gar nicht sehen darf (Standort).
   */
  private async wiederholung(client: PoolClient, schluessel: string, abdruck: string, benutzerId: string): Promise<StundenbuchungDto | null> {
    const { rows } = await client.query<{ id: string; idempotenz_fingerabdruck: string; gebucht_von: string }>(
      "SELECT id, idempotenz_fingerabdruck, gebucht_von FROM stundenbuchung WHERE idempotenz_schluessel = $1",
      [schluessel]
    );
    if (rows.length === 0) return null;
    if (rows[0].gebucht_von !== benutzerId || rows[0].idempotenz_fingerabdruck !== abdruck) {
      throw new ConflictException("Dieser Idempotenzschlüssel wurde bereits für eine andere Buchung verwendet.");
    }
    return this.findeEine(client, rows[0].id);
  }
}

function zuDto(r: Record<string, any>, klientName: string, benutzerId: string, darfFremdeStornieren: boolean): StundenbuchungDto {
  const eigene = r.gebucht_von === benutzerId || r.mitarbeiter_id === benutzerId;
  return {
    id: r.id,
    klientId: r.klient_id,
    klientName,
    mitarbeiterId: r.mitarbeiter_id,
    mitarbeiterName: r.mitarbeiter_name,
    datum: r.datum,
    minuten: r.minuten,
    leistungsart: r.leistungsart,
    notiz: r.notiz,
    gebuchtVonName: r.gebucht_von_name,
    erstelltAm: new Date(r.erstellt_am).toISOString(),
    storniert: r.storniert,
    stornoGrund: r.storno_grund,
    stornoVonName: r.storno_von_name,
    stornoAm: r.storniert_am ? new Date(r.storniert_am).toISOString() : null,
    stornierbar: !r.storniert && (eigene || darfFremdeStornieren),
  };
}
