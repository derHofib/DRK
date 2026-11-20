import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  KalenderStundenEinstellungenDto,
  Leistungsart,
  StundenVormerkungDto,
  TerminStundenBuchungDto,
} from "@zimmerakte/shared";
import { berlinTag, terminMinuten, terminStundenHindernis, terminStundenLeistungsart } from "@zimmerakte/shared";
import { KlientNamen } from "../common/klient-namen";
import { aktuellerTeilnehmer, requireTenantContext } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";
import { buchbarkeitsFehler } from "./stunden-pruefung";

/** Gruende fuer automatische Stornos -- stehen so in der Zeile und in der Stundenliste. */
export const STORNO_TERMIN_GEAENDERT = "Termin nachträglich geändert";
export const STORNO_TERMIN_ABGESAGT = "Termin abgesagt";
export const STORNO_VORMERKUNG_ZURUECK = "Vormerkung zurückgenommen";
export const STORNO_KLIENT_ABGESAGT = "Klient:in hat abgesagt";

interface PlanTermin {
  id: string;
  titel: string;
  beginn: Date;
  ende: Date;
  ganztaegig: boolean;
  abgesagt_am: Date | null;
  stunden_leistungsart: Leistungsart | null;
  stunden_erfassen: boolean;
  antwort: string;
  klient_ids: string[];
  vorbei: boolean;
}

interface Soll {
  datum: string;
  minuten: number;
  leistungsart: Leistungsart;
}

interface BuchungZeile {
  id: string;
  termin_id: string;
  klient_id: string;
  datum: string;
  minuten: number;
  leistungsart: Leistungsart;
  storniert: boolean;
  storno_automatisch: boolean;
}

export interface NachziehErgebnis {
  gebucht: number;
  storniert: number;
  /** Faellige Vormerkungen, die nicht gebucht werden konnten (je Termin und Klient:in). */
  nichtGebucht: { terminId: string; klientId: string; grund: string }[];
}

const LEER: NachziehErgebnis = { gebucht: 0, storniert: 0, nichtGebucht: [] };

/**
 * Stunden aus Kalenderterminen (migrations/0080, Konzept
 * stunden-kalender/konzept-stunden-aus-kalender.md).
 *
 * Vor dem Terminende ist der Haken nur eine Vormerkung an der eigenen
 * Teilnahmezeile; nach dem Ende entsteht eine normale stundenbuchung mit
 * termin_id. "Nachziehen" gleicht beides ab -- immer im Tenant-Kontext der
 * Person, deren Zeit es ist, nie fuer jemand anderen: mitarbeiter_id und
 * gebucht_von sind immer die angemeldete Person.
 *
 * Aendert sich ein Termin nach der Buchung, wird die alte Buchung storniert
 * (storno_automatisch) und in DERSELBEN Transaktion neu gebucht -- so hat
 * Dennis es entschieden (20.11.2026). Still angepasst wird nie: die
 * stornierte Zeile bleibt als Nachweis gegenueber dem Amt sichtbar.
 */
@Injectable()
export class StundenKalenderService {
  private readonly logger = new Logger(StundenKalenderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  /**
   * Darf die angemeldete Person ueberhaupt einen Haken setzen? Wirft 403
   * (Funktion aus / kein Recht) bzw. 400 (Termin so nicht buchbar). Vor dem
   * Oeffnen einer Transaktion aufrufen -- hatRecht() braucht eine eigene
   * Verbindung.
   */
  async verlangeVormerkbar(termin: { ganztaegig: boolean; beginn: string | Date; ende: string | Date; klientAnzahl: number }): Promise<void> {
    const ich = aktuellerTeilnehmer();
    if (ich.art !== "benutzer") throw new ForbiddenException("Klient:innen buchen keine Stunden.");
    const [an, darf] = await Promise.all([this.funktionAn(), this.rechte.hatRecht("stunden", "buchen")]);
    if (!an) throw new ForbiddenException("Termine als Betreuungszeit zu erfassen ist bei diesem Träger ausgeschaltet.");
    if (!darf) throw new ForbiddenException("Für das Buchen von Stunden fehlt die Berechtigung.");
    const hindernis = terminStundenHindernis(termin);
    if (hindernis) throw new BadRequestException(hindernis);
  }

  /** Eigene Vormerkung setzen -- die Policy laesst ohnehin nur die eigene Zeile zu. */
  async setzeVormerkung(client: PoolClient, terminId: string, erfassen: boolean): Promise<void> {
    const ich = aktuellerTeilnehmer();
    if (ich.art !== "benutzer") return;
    await client.query("UPDATE termin_teilnehmer SET stunden_erfassen = $3 WHERE termin_id = $1 AND benutzer_id = $2", [terminId, ich.id, erfassen]);
  }

  /**
   * Wie nachziehen(), aber ohne Fehler nach aussen: laeuft als Nebeneffekt von
   * Seitenaufrufen und Kalenderaktionen. Scheitert es, soll die eigentliche
   * Anfrage trotzdem gelingen -- der naechste Aufruf versucht es erneut.
   */
  async nachziehenStill(): Promise<NachziehErgebnis> {
    try {
      return await this.nachziehen();
    } catch (err) {
      this.logger.warn(`Stunden aus dem Kalender nachziehen fehlgeschlagen: ${(err as Error).message}`);
      return LEER;
    }
  }

  async nachziehen(): Promise<NachziehErgebnis> {
    const ich = aktuellerTeilnehmer();
    if (ich.art !== "benutzer") return LEER;
    const { mandantId } = requireTenantContext();
    const [an, darf] = await Promise.all([this.funktionAn(), this.rechte.hatRecht("stunden", "buchen")]);
    // Funktion aus oder Recht weg: Vormerkungen bleiben liegen und werden
    // angezeigt, aber weder gebucht noch abgeglichen.
    if (!an || !darf) return LEER;

    return this.db.withTenant(async (client) => {
      // Ein Nachziehen je Person zur Zeit: zwei Seitenaufrufe gleichzeitig
      // wuerden sonst beide stornieren und neu buchen wollen. Der eindeutige
      // Index (0080) faengt das Doppelbuchen zusaetzlich ab, das Storno nicht.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('stunden-kalender'), hashtext($1))", [ich.id]);
      const termine = await ladePlan(client, ich.id);
      if (termine.length === 0) return LEER;
      const { rows: vorhanden } = await client.query<BuchungZeile>(
        `SELECT id, termin_id, klient_id, datum, minuten, leistungsart, storniert, storno_automatisch
         FROM stundenbuchung
         WHERE mitarbeiter_id = $1 AND termin_id = ANY($2::uuid[])
         ORDER BY erstellt_am DESC`,
        [ich.id, termine.map((t) => t.id)]
      );

      const ergebnis: NachziehErgebnis = { gebucht: 0, storniert: 0, nichtGebucht: [] };
      for (const t of termine) {
        const soll = sollFuer(t);
        const buchungen = vorhanden.filter((b) => b.termin_id === t.id);

        // 1. Gueltige Buchungen, die nicht mehr zum Termin passen: stornieren.
        const gueltig = new Set<string>();
        for (const b of buchungen.filter((x) => !x.storniert)) {
          if (soll && t.klient_ids.includes(b.klient_id) && passt(b, soll)) {
            gueltig.add(b.klient_id);
            continue;
          }
          await client.query(
            `UPDATE stundenbuchung SET storniert = true, storno_grund = $2, storniert_von = $3, storniert_am = now(), storno_automatisch = true
             WHERE id = $1 AND NOT storniert`,
            [b.id, stornoGrund(t, b.klient_id), ich.id]
          );
          ergebnis.storniert++;
        }

        // 2. Fehlende Buchungen anlegen -- ausser jemand hat die letzte von
        // Hand storniert ("fand nicht statt"): die lebt nicht wieder auf.
        if (!soll) continue;
        for (const klientId of t.klient_ids) {
          if (gueltig.has(klientId)) continue;
          const letzte = buchungen.find((b) => b.klient_id === klientId);
          if (letzte && letzte.storniert && !letzte.storno_automatisch) continue;

          const grund = await this.hindernisBeimBuchen(client, ich.id, klientId, soll);
          if (grund) {
            ergebnis.nichtGebucht.push({ terminId: t.id, klientId, grund });
            continue;
          }
          await client.query(
            `INSERT INTO stundenbuchung (mandant_id, klient_id, mitarbeiter_id, datum, minuten, leistungsart, notiz, gebucht_von, termin_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $3, $8)`,
            [mandantId, klientId, ich.id, soll.datum, soll.minuten, soll.leistungsart, t.titel, t.id]
          );
          ergebnis.gebucht++;
        }
      }
      return ergebnis;
    });
  }

  /** Eigene Vormerkungen, die noch nicht (oder nicht) gebucht sind -- zaehlen nicht zum Saldo. */
  async vormerkungen(): Promise<StundenVormerkungDto[]> {
    const ich = aktuellerTeilnehmer();
    if (ich.art !== "benutzer") return [];
    const nachgezogen = await this.nachziehenStill();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<PlanTermin & { klient_namen: { id: string; vorname: string; nachname: string }[] }>(
        `SELECT t.id, t.titel, t.beginn, t.ende, t.ganztaegig,
                COALESCE(json_agg(json_build_object('id', k.id, 'vorname', k.vorname, 'nachname', k.nachname) ORDER BY k.nachname)
                         FILTER (WHERE k.id IS NOT NULL), '[]') AS klient_namen
         FROM termin t
         JOIN termin_teilnehmer ich ON ich.termin_id = t.id AND ich.benutzer_id = $1 AND ich.stunden_erfassen AND ich.antwort <> 'abgelehnt'
         LEFT JOIN termin_teilnehmer kt ON kt.termin_id = t.id AND kt.klient_id IS NOT NULL AND kt.antwort <> 'abgelehnt'
         LEFT JOIN klient k ON k.id = kt.klient_id
         WHERE t.abgesagt_am IS NULL
           AND (t.ende > now() OR t.id = ANY($2::uuid[]))
         GROUP BY t.id
         ORDER BY t.beginn`,
        [ich.id, [...new Set(nachgezogen.nichtGebucht.map((n) => n.terminId))]]
      );
      const namen = new KlientNamen(client, ich);
      const ergebnis: StundenVormerkungDto[] = [];
      for (const r of rows) {
        const vorbei = r.ende.getTime() <= Date.now();
        const fehler = nachgezogen.nichtGebucht.filter((n) => n.terminId === r.id);
        ergebnis.push({
          terminId: r.id,
          titel: r.titel,
          beginn: r.beginn.toISOString(),
          ende: r.ende.toISOString(),
          minuten: Math.max(0, terminMinuten(r.beginn, r.ende)),
          klientNamen: await Promise.all(r.klient_namen.map((k) => namen.name(k.id, k.vorname, k.nachname))),
          status: vorbei ? "nicht-gebucht" : "geplant",
          grund:
            terminStundenHindernis({ ...r, klientAnzahl: r.klient_namen.length }) ??
            (fehler.length ? [...new Set(fehler.map((f) => f.grund))].join(" ") : null),
        });
      }
      return ergebnis;
    });
  }

  /** Eigene Buchungen je Termin -- fuer den Abschnitt "Stunden" im Termindetail. */
  async buchungenFuerTermine(client: PoolClient, terminIds: string[]): Promise<Map<string, TerminStundenBuchungDto[]>> {
    const ich = aktuellerTeilnehmer();
    const ergebnis = new Map<string, TerminStundenBuchungDto[]>();
    if (ich.art !== "benutzer" || terminIds.length === 0) return ergebnis;
    const { rows } = await client.query(
      `SELECT s.id, s.termin_id, s.klient_id, k.vorname, k.nachname, s.datum, s.minuten, s.leistungsart, s.erstellt_am,
              s.storniert, s.storno_grund, s.storno_automatisch
       FROM stundenbuchung s JOIN klient k ON k.id = s.klient_id
       WHERE s.mitarbeiter_id = $1 AND s.termin_id = ANY($2::uuid[])
       ORDER BY s.erstellt_am DESC`,
      [ich.id, terminIds]
    );
    const namen = new KlientNamen(client, ich);
    for (const r of rows) {
      const liste = ergebnis.get(r.termin_id) ?? [];
      liste.push({
        id: r.id,
        klientName: await namen.name(r.klient_id, r.vorname, r.nachname),
        datum: r.datum,
        minuten: r.minuten,
        leistungsart: r.leistungsart,
        erstelltAm: new Date(r.erstellt_am).toISOString(),
        storniert: r.storniert,
        stornoGrund: r.storno_grund,
        stornoAutomatisch: r.storno_automatisch,
      });
      ergebnis.set(r.termin_id, liste);
    }
    return ergebnis;
  }

  async einstellungen(): Promise<KalenderStundenEinstellungenDto> {
    const ctx = requireTenantContext();
    const [darfBuchen, darfTraegerAendern] = await Promise.all([
      this.rechte.hatRecht("stunden", "buchen"),
      this.rechte.hatRecht("stunden", "einstellungen-verwalten"),
    ]);
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT m.termin_stunden_erlaubt, m.termin_stunden_vorauswahl,
                p.termin_stunden_vorauswahl AS eigene, p.termin_stunden_vorauswahl_zusage AS eigene_zusage
         FROM mandant m
         LEFT JOIN mitarbeiter_profil p ON p.benutzer_id = $1`,
        [ctx.benutzerId]
      );
      const r = rows[0];
      return {
        funktionAn: r.termin_stunden_erlaubt,
        darfBuchen,
        darfTraegerAendern,
        traegerVorauswahl: r.termin_stunden_vorauswahl,
        eigeneVorauswahl: r.eigene,
        eigeneVorauswahlZusage: r.eigene_zusage,
        vorauswahl: r.eigene ?? r.termin_stunden_vorauswahl,
        vorauswahlZusage: r.eigene_zusage ?? r.termin_stunden_vorauswahl,
      };
    });
  }

  /** null = folgt wieder dem Traeger. Nur die eigene Zeile (Policy aus 0058). */
  async eigeneSpeichern(eingabe: { vorauswahl: boolean | null; vorauswahlZusage: boolean | null }): Promise<KalenderStundenEinstellungenDto> {
    const ctx = requireTenantContext();
    await this.db.withTenant(async (client) => {
      await client.query(
        `INSERT INTO mitarbeiter_profil (benutzer_id, mandant_id, termin_stunden_vorauswahl, termin_stunden_vorauswahl_zusage)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (benutzer_id) DO UPDATE
           SET termin_stunden_vorauswahl = EXCLUDED.termin_stunden_vorauswahl,
               termin_stunden_vorauswahl_zusage = EXCLUDED.termin_stunden_vorauswahl_zusage`,
        [ctx.benutzerId, ctx.mandantId, eingabe.vorauswahl, eingabe.vorauswahlZusage]
      );
    });
    return this.einstellungen();
  }

  async traegerSpeichern(eingabe: { erlaubt: boolean; vorauswahl: boolean }): Promise<KalenderStundenEinstellungenDto> {
    if (!(await this.rechte.hatRecht("stunden", "einstellungen-verwalten"))) {
      throw new ForbiddenException("Für die Träger-Einstellung „Stunden aus dem Kalender“ fehlt die Berechtigung.");
    }
    // Kein WHERE id = ... (Regel 2): RLS laesst nur den eigenen Traeger durch,
    // die spaltenscharfen GRANTs (0019, 0080) nur diese beiden Spalten.
    await this.db.withTenant((client) =>
      client.query("UPDATE mandant SET termin_stunden_erlaubt = $1, termin_stunden_vorauswahl = $2", [eingabe.erlaubt, eingabe.vorauswahl])
    );
    return this.einstellungen();
  }

  async funktionAn(): Promise<boolean> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ an: boolean }>("SELECT termin_stunden_erlaubt AS an FROM mandant");
      return rows[0]?.an ?? false;
    });
  }

  /** Dieselben Pruefungen wie die Buchung von Hand, dazu: an dem Tag selbst abwesend. */
  private async hindernisBeimBuchen(client: PoolClient, benutzerId: string, klientId: string, soll: Soll): Promise<string | null> {
    // Wer an dem Tag krank oder im Urlaub war, hat den Termin nicht
    // wahrgenommen -- vermutlich wurde er nur nicht abgesagt. Lieber nicht
    // buchen und anzeigen als eine Leistung nachweisen, die nicht stattfand.
    const { rows } = await client.query(
      "SELECT 1 FROM abwesenheit WHERE benutzer_id = $1 AND storniert_am IS NULL AND $2::date BETWEEN von AND bis LIMIT 1",
      [benutzerId, soll.datum]
    );
    if (rows.length > 0) return "Nicht gebucht: an diesem Tag abwesend.";
    const fehler = await buchbarkeitsFehler(client, benutzerId, benutzerId, klientId, soll.datum, soll.minuten);
    return fehler ? `Nicht gebucht: ${fehler.meldung}` : null;
  }
}

/**
 * Alle eigenen Teilnahmen, die gebucht werden sollen ODER schon eine gueltige
 * Buchung haben (die dann evtl. storniert werden muss, z. B. nach Absage).
 * RLS filtert auf sichtbare Termine; kein WHERE mandant_id (Regel 2).
 */
async function ladePlan(client: PoolClient, benutzerId: string): Promise<PlanTermin[]> {
  const { rows } = await client.query<PlanTermin>(
    `SELECT t.id, t.titel, t.beginn, t.ende, t.ganztaegig, t.abgesagt_am, t.stunden_leistungsart,
            ich.stunden_erfassen, ich.antwort::text AS antwort,
            COALESCE(array_agg(kt.klient_id ORDER BY kt.klient_id) FILTER (WHERE kt.klient_id IS NOT NULL), '{}') AS klient_ids,
            t.ende <= now() AS vorbei
     FROM termin t
     JOIN termin_teilnehmer ich ON ich.termin_id = t.id AND ich.benutzer_id = $1
     LEFT JOIN termin_teilnehmer kt ON kt.termin_id = t.id AND kt.klient_id IS NOT NULL AND kt.antwort <> 'abgelehnt'
     WHERE (ich.stunden_erfassen AND t.ende <= now())
        OR EXISTS (SELECT 1 FROM stundenbuchung s
                   WHERE s.termin_id = t.id AND s.mitarbeiter_id = $1 AND NOT s.storniert)
     GROUP BY t.id, ich.id`,
    [benutzerId]
  );
  return rows;
}

/** Was jetzt gebucht sein muesste; null = nichts (abgesagt, Haken weg, nicht buchbar, noch nicht vorbei). */
function sollFuer(t: PlanTermin): Soll | null {
  if (t.abgesagt_am || !t.stunden_erfassen || t.antwort === "abgelehnt" || !t.vorbei) return null;
  if (terminStundenHindernis({ ganztaegig: t.ganztaegig, beginn: t.beginn, ende: t.ende, klientAnzahl: t.klient_ids.length })) return null;
  return {
    datum: berlinTag(t.beginn),
    minuten: terminMinuten(t.beginn, t.ende),
    leistungsart: terminStundenLeistungsart(t.stunden_leistungsart, t.klient_ids.length),
  };
}

function passt(b: BuchungZeile, soll: Soll): boolean {
  return b.datum === soll.datum && b.minuten === soll.minuten && b.leistungsart === soll.leistungsart;
}

function stornoGrund(t: PlanTermin, klientId: string): string {
  if (t.abgesagt_am) return STORNO_TERMIN_ABGESAGT;
  if (!t.stunden_erfassen || t.antwort === "abgelehnt") return STORNO_VORMERKUNG_ZURUECK;
  if (!t.klient_ids.includes(klientId)) return STORNO_KLIENT_ABGESAGT;
  return STORNO_TERMIN_GEAENDERT;
}
