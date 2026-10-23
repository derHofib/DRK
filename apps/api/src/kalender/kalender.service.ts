import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  TerminAnlegenEingabe,
  TerminAntwort,
  TerminDto,
  TerminPersonDto,
  TerminTeilnehmerDto,
  TerminTeilnehmerEingabe,
} from "@zimmerakte/shared";
import { initialen } from "../common/anonymisierung";
import { klientIstErlaubt } from "../common/standort-restriction";
import { aktuellerTeilnehmer, requireTenantContext, type Teilnehmer } from "../common/tenant-context";
import { DatabaseService } from "../database/database.service";
import { terminAlsIcs } from "./ics";

const MAX_SPANNE_TAGE = 400;
const MAX_TEILNEHMER = 50;
const TAG_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const ZEITPUNKT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface TerminAendernEingabe {
  titel?: string;
  beschreibung?: string | null;
  ort?: string | null;
  beginn?: string;
  ende?: string;
  ganztaegig?: boolean;
}

interface TerminRow {
  id: string;
  titel: string;
  beschreibung: string | null;
  ort: string | null;
  beginn: Date;
  ende: Date;
  ganztaegig: boolean;
  erstellt_am: Date;
  abgesagt_am: Date | null;
  erstellt_von_benutzer_id: string | null;
  erstellt_von_klient_id: string | null;
  ersteller_benutzer_name: string | null;
  ersteller_klient_vorname: string | null;
  ersteller_klient_nachname: string | null;
  meine_antwort: TerminAntwort | null;
}

interface TeilnehmerRow {
  termin_id: string;
  benutzer_id: string | null;
  klient_id: string | null;
  antwort: TerminAntwort;
  geantwortet_am: Date | null;
  benutzer_name: string | null;
  klient_vorname: string | null;
  klient_nachname: string | null;
}

/**
 * Sichtbarkeit steckt in der RLS-Policy (termin_sichtbar, migrations/0053):
 * jede Abfrage hier liefert von sich aus nur Termine, an denen die
 * aufrufende Person beteiligt ist -- ein fremder Termin ist schlicht
 * "nicht gefunden" (404), nicht "verboten", damit seine Existenz nicht
 * verraten wird. 403 gibt es nur fuer sichtbare Termine, die man nicht
 * aendern darf.
 */
@Injectable()
export class KalenderService {
  constructor(private readonly db: DatabaseService) {}

  async liste(vonEingabe: string, bisEingabe: string): Promise<TerminDto[]> {
    const von = parseGrenze(vonEingabe, "von");
    const bis = parseGrenze(bisEingabe, "bis");
    if (bis <= von) throw new BadRequestException("„bis“ muss nach „von“ liegen.");
    if (bis.getTime() - von.getTime() > MAX_SPANNE_TAGE * TAG_MS) {
      throw new BadRequestException(`Der Zeitraum darf höchstens ${MAX_SPANNE_TAGE} Tage umfassen.`);
    }
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      // Ueberlappung statt "beginnt im Zeitraum": ein mehrtaegiger Termin soll auch
      // in den Folgemonaten erscheinen. Zeitpunkt-Termine (ende = beginn) liegen
      // genau auf von, deshalb der zweite Zweig.
      const rows = await ladeTermine(
        client,
        ich,
        `t.beginn < $3 AND (t.ende > $4 OR t.beginn >= $4)
         AND ((mein.id IS NULL AND (t.erstellt_von_benutzer_id = $1::uuid OR t.erstellt_von_klient_id = $2::uuid))
              OR mein.antwort <> 'abgelehnt')`,
        [bis, von]
      );
      return this.zuDtos(client, ich, rows);
    });
  }

  async einzeln(id: string): Promise<TerminDto> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant((client) => this.ladeEinzeln(client, ich, id));
  }

  async anlegen(eingabe: TerminAnlegenEingabe): Promise<TerminDto> {
    const ctx = requireTenantContext();
    const ich = aktuellerTeilnehmer();
    const zeitraum = berechneZeitraum(eingabe.ganztaegig ?? false, eingabe.beginn, eingabe.ende);
    const eingeladen = dedupliziere(eingabe.teilnehmer ?? [], ich);
    if (eingeladen.length > MAX_TEILNEHMER) {
      throw new BadRequestException(`Höchstens ${MAX_TEILNEHMER} Teilnehmende pro Termin.`);
    }
    // Klient:innen laden vorerst niemanden ein: ohne Chat-Beziehung (Schritt 3)
    // gaebe es keine Regel, WEN sie sehen duerfen. Dort wird das auf
    // Gespraechspartner erweitert.
    if (ich.art === "klient" && eingeladen.length > 0) {
      throw new ForbiddenException("Als Klient:in kannst du keine weiteren Teilnehmenden eintragen.");
    }

    return this.db.withTenant(async (client) => {
      for (const t of eingeladen) await this.pruefeEinladbar(client, ctx.benutzerId, t);

      // ID vorab erzeugen und Termin vor den Teilnehmerzeilen einfuegen: die
      // Insert-Policy von termin_teilnehmer fragt termin_ist_ersteller(), das den
      // Termin nur sieht, wenn er in einem frueheren Statement angelegt wurde.
      const id = randomUUID();
      await client.query(
        `INSERT INTO termin (id, mandant_id, titel, beschreibung, ort, beginn, ende, ganztaegig,
                             erstellt_von_benutzer_id, erstellt_von_klient_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id, ctx.mandantId, eingabe.titel.trim(), leerZuNull(eingabe.beschreibung), leerZuNull(eingabe.ort),
          zeitraum.beginn, zeitraum.ende, eingabe.ganztaegig ?? false,
          ich.art === "benutzer" ? ich.id : null, ich.art === "klient" ? ich.id : null,
        ]
      );
      await client.query(
        `INSERT INTO termin_teilnehmer (mandant_id, termin_id, benutzer_id, klient_id, antwort, geantwortet_am)
         VALUES ($1, $2, $3, $4, 'zugesagt', now())`,
        [ctx.mandantId, id, ich.art === "benutzer" ? ich.id : null, ich.art === "klient" ? ich.id : null]
      );
      for (const t of eingeladen) {
        await client.query(
          `INSERT INTO termin_teilnehmer (mandant_id, termin_id, benutzer_id, klient_id) VALUES ($1, $2, $3, $4)`,
          [ctx.mandantId, id, "benutzerId" in t ? t.benutzerId : null, "klientId" in t ? t.klientId : null]
        );
      }
      return this.ladeEinzeln(client, ich, id);
    });
  }

  async aendern(id: string, eingabe: TerminAendernEingabe): Promise<TerminDto> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      const alt = await this.ladeEinzeln(client, ich, id);
      this.pruefeAenderbar(alt);

      const ganztaegig = eingabe.ganztaegig ?? alt.ganztaegig;
      // Umschalten ganztaegig <-> Uhrzeit aendert das Format von beginn/ende; die
      // alten Werte passen dann nicht mehr und duerfen nicht still umgedeutet werden.
      if (ganztaegig !== alt.ganztaegig && (eingabe.beginn === undefined || eingabe.ende === undefined)) {
        throw new BadRequestException("Beim Wechsel zwischen ganztägig und mit Uhrzeit müssen Beginn und Ende neu angegeben werden.");
      }
      const zeitraum = berechneZeitraum(ganztaegig, eingabe.beginn ?? alt.beginn, eingabe.ende ?? alt.ende);

      await client.query(
        `UPDATE termin SET titel = $2, beschreibung = $3, ort = $4, beginn = $5, ende = $6, ganztaegig = $7
         WHERE id = $1`,
        [
          id,
          eingabe.titel !== undefined ? eingabe.titel.trim() : alt.titel,
          eingabe.beschreibung !== undefined ? leerZuNull(eingabe.beschreibung) : alt.beschreibung,
          eingabe.ort !== undefined ? leerZuNull(eingabe.ort) : alt.ort,
          zeitraum.beginn, zeitraum.ende, ganztaegig,
        ]
      );
      return this.ladeEinzeln(client, ich, id);
    });
  }

  async absagen(id: string): Promise<TerminDto> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      this.pruefeAenderbar(await this.ladeEinzeln(client, ich, id));
      await client.query("UPDATE termin SET abgesagt_am = now() WHERE id = $1 AND abgesagt_am IS NULL", [id]);
      return this.ladeEinzeln(client, ich, id);
    });
  }

  async antworten(id: string, antwort: TerminAntwort): Promise<TerminDto> {
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      const termin = await this.ladeEinzeln(client, ich, id);
      if (termin.abgesagtAm) throw new ConflictException("Der Termin wurde abgesagt.");
      const { rowCount } = await client.query(
        `UPDATE termin_teilnehmer SET antwort = $2::termin_antwort, geantwortet_am = CASE WHEN $2::termin_antwort = 'offen' THEN NULL ELSE now() END
         WHERE termin_id = $1 AND (benutzer_id = $3::uuid OR klient_id = $4::uuid)`,
        [id, antwort, ...prinzipalParameter(ich)]
      );
      if (!rowCount) {
        throw new ConflictException("Du bist für diesen Termin nicht eingetragen. Übernimm ihn zuerst in deinen Kalender.");
      }
      return this.ladeEinzeln(client, ich, id);
    });
  }

  /**
   * Idempotent: ein zweiter Aufruf aendert nichts (auch nicht geantwortet_am).
   * Wer abgelehnt oder offen hatte, wird durch das Uebernehmen zur Zusage.
   */
  async uebernehmen(id: string): Promise<TerminDto> {
    const ctx = requireTenantContext();
    const ich = aktuellerTeilnehmer();
    return this.db.withTenant(async (client) => {
      const termin = await this.ladeEinzeln(client, ich, id);
      if (termin.abgesagtAm) throw new ConflictException("Der Termin wurde abgesagt.");
      const konfliktSpalte = ich.art === "benutzer" ? "benutzer_id" : "klient_id";
      await client.query(
        `INSERT INTO termin_teilnehmer (mandant_id, termin_id, benutzer_id, klient_id, antwort, geantwortet_am)
         VALUES ($1, $2, $3, $4, 'zugesagt', now())
         ON CONFLICT (termin_id, ${konfliktSpalte}) WHERE ${konfliktSpalte} IS NOT NULL
         DO UPDATE SET antwort = 'zugesagt', geantwortet_am = now()
         WHERE termin_teilnehmer.antwort <> 'zugesagt'`,
        [ctx.mandantId, id, ich.art === "benutzer" ? ich.id : null, ich.art === "klient" ? ich.id : null]
      );
      return this.ladeEinzeln(client, ich, id);
    });
  }

  async ics(id: string): Promise<{ dateiname: string; inhalt: string }> {
    const termin = await this.einzeln(id);
    return { dateiname: `termin-${termin.id}.ics`, inhalt: terminAlsIcs(termin) };
  }

  private pruefeAenderbar(termin: TerminDto): void {
    if (!termin.binErsteller) throw new ForbiddenException("Nur die Person, die den Termin angelegt hat, darf ihn ändern.");
    if (termin.abgesagtAm) throw new ConflictException("Der Termin wurde abgesagt und kann nicht mehr geändert werden.");
  }

  /**
   * Mitarbeitende duerfen aktive Kolleg:innen und Klient:innen mit aktivem
   * Zugang eintragen, die sie auch in der Klientenliste sehen duerften. Alle
   * Fehlschlaege klingen gleich: ob die Person gar nicht existiert oder nur
   * fuer einen unsichtbar ist, soll sich nicht erkennen lassen.
   */
  private async pruefeEinladbar(client: PoolClient, benutzerId: string, t: TerminTeilnehmerEingabe): Promise<void> {
    if ("benutzerId" in t) {
      const { rows } = await client.query("SELECT 1 FROM benutzer WHERE id = $1 AND aktiv", [t.benutzerId]);
      if (rows.length === 0) throw new BadRequestException("Mitarbeitende:r nicht gefunden oder nicht aktiv.");
      return;
    }
    const { rows } = await client.query(
      `SELECT 1 FROM klient k
       JOIN klient_zugang z ON z.klient_id = k.id
       WHERE k.id = $1 AND z.aktiv AND k.archiviert_am IS NULL AND k.anonymisiert_am IS NULL`,
      [t.klientId]
    );
    if (rows.length === 0 || !(await klientIstErlaubt(client, benutzerId, t.klientId))) {
      throw new BadRequestException("Klient:in nicht gefunden oder ohne aktiven Zugang.");
    }
  }

  private async ladeEinzeln(client: PoolClient, ich: Teilnehmer, id: string): Promise<TerminDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException("Termin nicht gefunden.");
    const rows = await ladeTermine(client, ich, "t.id = $3::uuid", [id]);
    if (rows.length === 0) throw new NotFoundException("Termin nicht gefunden.");
    return (await this.zuDtos(client, ich, rows))[0];
  }

  private async zuDtos(client: PoolClient, ich: Teilnehmer, rows: TerminRow[]): Promise<TerminDto[]> {
    if (rows.length === 0) return [];
    const { rows: tn } = await client.query<TeilnehmerRow>(
      `SELECT tt.termin_id, tt.benutzer_id, tt.klient_id, tt.antwort, tt.geantwortet_am,
              b.name AS benutzer_name, k.vorname AS klient_vorname, k.nachname AS klient_nachname
       FROM termin_teilnehmer tt
       LEFT JOIN benutzer b ON b.id = tt.benutzer_id
       LEFT JOIN klient k ON k.id = tt.klient_id
       WHERE tt.termin_id = ANY($1::uuid[])
       ORDER BY (tt.klient_id IS NOT NULL), COALESCE(b.name, k.vorname), tt.id`,
      [rows.map((r) => r.id)]
    );
    const sichtbarkeit = new KlientNamen(client, ich);
    const nachTermin = new Map<string, TerminTeilnehmerDto[]>();
    for (const r of tn) {
      const person: TerminPersonDto = r.benutzer_id
        ? { art: "benutzer", id: r.benutzer_id, name: r.benutzer_name ?? "" }
        : { art: "klient", id: r.klient_id!, name: await sichtbarkeit.name(r.klient_id!, r.klient_vorname ?? "", r.klient_nachname ?? "") };
      const liste = nachTermin.get(r.termin_id) ?? [];
      liste.push({ ...person, antwort: r.antwort, geantwortetAm: r.geantwortet_am?.toISOString() ?? null });
      nachTermin.set(r.termin_id, liste);
    }

    const dtos: TerminDto[] = [];
    for (const r of rows) {
      const erstelltVon: TerminPersonDto = r.erstellt_von_benutzer_id
        ? { art: "benutzer", id: r.erstellt_von_benutzer_id, name: r.ersteller_benutzer_name ?? "" }
        : {
            art: "klient",
            id: r.erstellt_von_klient_id!,
            name: await sichtbarkeit.name(r.erstellt_von_klient_id!, r.ersteller_klient_vorname ?? "", r.ersteller_klient_nachname ?? ""),
          };
      dtos.push({
        id: r.id,
        titel: r.titel,
        beschreibung: r.beschreibung,
        ort: r.ort,
        ...zeitraumFuerAusgabe(r),
        ganztaegig: r.ganztaegig,
        erstelltVon,
        erstelltAm: r.erstellt_am.toISOString(),
        abgesagtAm: r.abgesagt_am?.toISOString() ?? null,
        binErsteller: erstelltVon.art === ich.art && erstelltVon.id === ich.id,
        meineAntwort: r.meine_antwort,
        teilnehmer: nachTermin.get(r.id) ?? [],
      });
    }
    return dtos;
  }
}

/**
 * Klientennamen beim Lesen anonymisieren (CLAUDE.md Regel 6): Klient:innen
 * sehen andere Klient:innen (und sich selbst) nur mit Vornamen; Mitarbeitende
 * sehen den vollen Namen, wenn sie die Person auch in der Klientenliste sehen
 * duerften, sonst nur Initialen -- ein standortbeschraenkter Kollege, der zu
 * einem Termin eingeladen wurde, soll dadurch keine fremde Akte erkennen.
 */
class KlientNamen {
  private readonly erlaubt = new Map<string, boolean>();
  constructor(private readonly client: PoolClient, private readonly ich: Teilnehmer) {}

  async name(klientId: string, vorname: string, nachname: string): Promise<string> {
    if (this.ich.art === "klient") return vorname;
    let darf = this.erlaubt.get(klientId);
    if (darf === undefined) {
      darf = await klientIstErlaubt(this.client, this.ich.id, klientId);
      this.erlaubt.set(klientId, darf);
    }
    return darf ? `${vorname} ${nachname}` : initialen(vorname, nachname);
  }
}

/** $1 = benutzer_id, $2 = klient_id des Aufrufers (je eines NULL); weitere Parameter ab $3. */
function prinzipalParameter(ich: Teilnehmer): [string | null, string | null] {
  return ich.art === "benutzer" ? [ich.id, null] : [null, ich.id];
}

async function ladeTermine(client: PoolClient, ich: Teilnehmer, bedingung: string, weitere: unknown[]): Promise<TerminRow[]> {
  const { rows } = await client.query<TerminRow>(
    `SELECT t.id, t.titel, t.beschreibung, t.ort, t.beginn, t.ende, t.ganztaegig, t.erstellt_am, t.abgesagt_am,
            t.erstellt_von_benutzer_id, t.erstellt_von_klient_id,
            eb.name AS ersteller_benutzer_name, ek.vorname AS ersteller_klient_vorname, ek.nachname AS ersteller_klient_nachname,
            mein.antwort AS meine_antwort
     FROM termin t
     LEFT JOIN benutzer eb ON eb.id = t.erstellt_von_benutzer_id
     LEFT JOIN klient ek ON ek.id = t.erstellt_von_klient_id
     LEFT JOIN termin_teilnehmer mein ON mein.termin_id = t.id AND (mein.benutzer_id = $1::uuid OR mein.klient_id = $2::uuid)
     WHERE ${bedingung}
     ORDER BY t.beginn, t.id`,
    [...prinzipalParameter(ich), ...weitere]
  );
  return rows;
}

function zeitraumFuerAusgabe(r: TerminRow): { beginn: string; ende: string } {
  if (!r.ganztaegig) return { beginn: r.beginn.toISOString(), ende: r.ende.toISOString() };
  // Gespeichert ist ende exklusiv (Tag nach dem letzten Tag), ausgegeben der letzte Tag.
  return {
    beginn: r.beginn.toISOString().slice(0, 10),
    ende: new Date(r.ende.getTime() - TAG_MS).toISOString().slice(0, 10),
  };
}

function berechneZeitraum(ganztaegig: boolean, beginnEingabe: string, endeEingabe: string): { beginn: Date; ende: Date } {
  if (ganztaegig) {
    if (!DATUM_RE.test(beginnEingabe) || !DATUM_RE.test(endeEingabe)) {
      throw new BadRequestException("Bei ganztägigen Terminen müssen Beginn und Ende Datumsangaben (JJJJ-MM-TT) sein.");
    }
    const beginn = new Date(`${beginnEingabe}T00:00:00Z`);
    const letzterTag = new Date(`${endeEingabe}T00:00:00Z`);
    if (Number.isNaN(beginn.getTime()) || Number.isNaN(letzterTag.getTime())) {
      throw new BadRequestException("Ungültiges Datum.");
    }
    if (letzterTag < beginn) throw new BadRequestException("Das Ende darf nicht vor dem Beginn liegen.");
    return { beginn, ende: new Date(letzterTag.getTime() + TAG_MS) };
  }
  if (!ZEITPUNKT_RE.test(beginnEingabe) || !ZEITPUNKT_RE.test(endeEingabe)) {
    throw new BadRequestException("Beginn und Ende müssen Zeitpunkte mit Zeitzone sein (z. B. 2026-11-05T09:00:00+01:00).");
  }
  const beginn = new Date(beginnEingabe);
  const ende = new Date(endeEingabe);
  if (Number.isNaN(beginn.getTime()) || Number.isNaN(ende.getTime())) throw new BadRequestException("Ungültiger Zeitpunkt.");
  if (ende < beginn) throw new BadRequestException("Das Ende darf nicht vor dem Beginn liegen.");
  return { beginn, ende };
}

function parseGrenze(wert: string, name: string): Date {
  if (!DATUM_RE.test(wert) && !ZEITPUNKT_RE.test(wert)) {
    throw new BadRequestException(`„${name}“ muss ein Datum (JJJJ-MM-TT) oder ein Zeitpunkt mit Zeitzone sein.`);
  }
  const d = new Date(DATUM_RE.test(wert) ? `${wert}T00:00:00Z` : wert);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`„${name}“ ist ungültig.`);
  return d;
}

function leerZuNull(wert: string | null | undefined): string | null {
  const t = wert?.trim();
  return t ? t : null;
}

/** Doppelte Eintraege und die eigene Person fallen weg -- die Ersteller:in ist ohnehin zugesagt eingetragen. */
function dedupliziere(liste: TerminTeilnehmerEingabe[], ich: Teilnehmer): TerminTeilnehmerEingabe[] {
  const gesehen = new Set<string>();
  const ergebnis: TerminTeilnehmerEingabe[] = [];
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
