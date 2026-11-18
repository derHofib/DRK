import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  alleBausteine,
  BAUSTEIN_LABEL,
  datentypVon,
  formularStatus,
  pruefeVeroeffentlichung,
  istEingabe,
  pruefeDefinition,
  pruefeWerte,
  speichernderBaustein,
  typFehler,
  werteAus,
  type Datenquelle,
  type FeldFehler,
  type FeldWert,
  type FeldWerte,
  type FormularDefinition,
  type AnheftModus,
  type Anheftpunkt,
  type AngeheftetesProtokollEingabe,
  type FormularAnheftung,
  type FormularAngebotDto,
  type FormularDetailDto,
  type FormularVerwaltungDto,
  type ProtokollAenderungDto,
  type ProtokollDto,
  type ProtokolleRechteDto,
  type ProtokollKurzDto,
  type ProtokollWertQuelle,
} from "@zimmerakte/shared";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { heuteBerlin } from "../common/heute";
import { initialen } from "../common/anonymisierung";
import {
  ermittleErlaubteStandortIds,
  klientIstArchiviert,
  klientIstErlaubt,
  klientStandortBedingung,
} from "../common/standort-restriction";
import { RechteService } from "../rechte/rechte.service";

interface WertZeile {
  feld_schluessel: string;
  datentyp: string;
  wert_text: string | null;
  wert_zahl: string | null;
  wert_datum: string | null;
  wert_zeit: string | null;
  wert_bool: boolean | null;
  wert_liste: string[] | null;
  quelle: ProtokollWertQuelle;
}

interface ProtokollKopf {
  id: string;
  autor_id: string;
  klient_id: string;
  abgeschlossen_am: string | null;
  definition: FormularDefinition;
  formular_id: string;
  version_nummer: number;
}

function jetztBerlin(): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

function wertAusZeile(z: WertZeile): FeldWert {
  switch (z.datentyp) {
    case "zahl":
      // numeric kommt aus pg als String (kein Genauigkeitsverlust im Treiber).
      return Number(z.wert_zahl);
    case "datum":
      return z.wert_datum as string;
    case "zeit":
      return (z.wert_zeit as string).slice(0, 5);
    case "bool":
      return z.wert_bool as boolean;
    case "liste":
      return z.wert_liste as string[];
    default:
      return z.wert_text as string;
  }
}

function gleich(a: FeldWert | undefined, b: FeldWert | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function feldFehlerAusnahme(fehler: FeldFehler[]): BadRequestException {
  const meldung =
    fehler.length === 1 ? "Eine Angabe fehlt oder ist ungültig." : `${fehler.length} Angaben fehlen oder sind ungültig.`;
  return new BadRequestException({ statusCode: 400, message: meldung, fehler });
}

/**
 * Protokolle aus Formularen (Migration 0075). Rollenpruefungen stehen hier
 * neben dem SQL, das sie schuetzen (CLAUDE.md); die Unveraenderlichkeit
 * veroeffentlichter Versionen und abgeschlossener Protokolle sowie die
 * Historie erzwingt die Datenbank selbst.
 */
@Injectable()
export class ProtokollService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async rechteFuerMich(): Promise<ProtokolleRechteDto> {
    const [ansehen, ausfuellen, formulareVerwalten] = await Promise.all([
      this.rechte.hatRecht("protokolle", "ansehen"),
      this.rechte.hatRecht("protokolle", "ausfuellen"),
      this.rechte.hatRecht("protokolle", "formulare-verwalten"),
    ]);
    return { ansehen, ausfuellen, formulareVerwalten };
  }

  private async brauche(aktion: "ansehen" | "ausfuellen" | "formulare-verwalten", meldung: string) {
    if (!(await this.rechte.hatRecht("protokolle", aktion))) throw new ForbiddenException(meldung);
  }

  // -------------------------------------------------------------------------
  // Formulare verwalten (Menuepunkt "Formulare", Migration 0076)
  // -------------------------------------------------------------------------

  async verwaltungsListe(): Promise<FormularVerwaltungDto[]> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    return this.db.withTenant((client) => ladeVerwaltung(client));
  }

  async verwaltungsDetail(id: string): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    return this.db.withTenant((client) => ladeFormularDetail(client, id));
  }

  /**
   * Ein neues Formular beginnt immer "in Entwicklung": Version 1 als leerer
   * Entwurf. Keine Vorlagen (Rueckmeldung "Formulare": "ich brauche keine
   * Vorlagen").
   */
  async formularAnlegen(input: { name: string; beschreibung: string | null }): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO formular (mandant_id, name, beschreibung, bezug, erstellt_von)
         VALUES ($1, $2, $3, 'klient', $4) RETURNING id`,
        [mandantId, input.name, input.beschreibung, benutzerId]
      );
      await client.query(
        `INSERT INTO formular_version (mandant_id, formular_id, nummer, definition, erstellt_von)
         VALUES ($1, $2, 1, $3, $4)`,
        [mandantId, rows[0].id, JSON.stringify({ bausteine: [] }), benutzerId]
      );
      return ladeFormularDetail(client, rows[0].id);
    });
  }

  /**
   * "Bearbeiten" eines veroeffentlichten Formulars legt den Entwurf der
   * naechsten Version an -- ein veroeffentlichtes Formular geht nie "zurueck
   * in Entwicklung", sonst waere es mitten im Dienst ploetzlich weg.
   */
  async entwurfStarten(id: string): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const f = await ladeFormularKopf(client, id);
      if (f.archiviert) throw new BadRequestException("Ein stillgelegtes Formular wird nicht mehr bearbeitet.");
      const { rows } = await client.query<{ nummer: number; definition: FormularDefinition; veroeffentlicht_am: string | null }>(
        "SELECT nummer, definition, veroeffentlicht_am FROM formular_version WHERE formular_id = $1 ORDER BY nummer DESC LIMIT 1",
        [id]
      );
      if (rows[0] && rows[0].veroeffentlicht_am === null) return ladeFormularDetail(client, id);
      await client.query(
        `INSERT INTO formular_version (mandant_id, formular_id, nummer, definition, erstellt_von)
         VALUES ($1, $2, $3, $4, $5)`,
        [mandantId, id, (rows[0]?.nummer ?? 0) + 1, JSON.stringify(rows[0]?.definition ?? { bausteine: [] }), benutzerId]
      );
      return ladeFormularDetail(client, id);
    });
  }

  /**
   * Zwischenspeichern des Entwurfs aus dem Editor. Ein Entwurf darf
   * unfertig sein (eine Beschriftung fehlt noch) -- geprueft wird nur die
   * Form, damit nichts Unlesbares in der Datenbank landet. Die volle
   * Pruefung kommt beim Veroeffentlichen.
   */
  async formularEntwurfSpeichern(id: string, definition: FormularDefinition): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    const form = strukturFehler(definition);
    if (form) throw new BadRequestException(form);
    return this.db.withTenant(async (client) => {
      await ladeFormularKopf(client, id);
      const { rowCount } = await client.query(
        "UPDATE formular_version SET definition = $2 WHERE formular_id = $1 AND veroeffentlicht_am IS NULL",
        [id, JSON.stringify(definition)]
      );
      if (!rowCount) throw new BadRequestException("Es gibt keinen Entwurf. Bitte zuerst „Bearbeiten“ wählen.");
      return ladeFormularDetail(client, id);
    });
  }

  async entwurfVerwerfen(id: string): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    return this.db.withTenant(async (client) => {
      const f = await ladeFormularKopf(client, id);
      if (f.veroeffentlichteVersion === null) {
        throw new BadRequestException("Dieses Formular war noch nie veröffentlicht. Es kann nur ganz gelöscht werden.");
      }
      await client.query("DELETE FROM formular_version WHERE formular_id = $1 AND veroeffentlicht_am IS NULL", [id]);
      return ladeFormularDetail(client, id);
    });
  }

  /**
   * Veroeffentlichen: volle Pruefung der Definition und der Vertraeglichkeit
   * mit allen frueheren Versionen (pruefeVeroeffentlichung, derselbe Code
   * wie im Editor). Danach friert der Trigger aus 0075 die Version ein.
   */
  async veroeffentlichen(id: string): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const f = await ladeFormularKopf(client, id);
      if (f.archiviert) throw new BadRequestException("Ein stillgelegtes Formular wird nicht veröffentlicht.");
      const { rows } = await client.query<{ id: string; definition: FormularDefinition; veroeffentlicht_am: string | null }>(
        "SELECT id, definition, veroeffentlicht_am FROM formular_version WHERE formular_id = $1 ORDER BY nummer",
        [id]
      );
      const entwurf = rows.find((r) => r.veroeffentlicht_am === null);
      if (!entwurf) throw new BadRequestException("Es gibt keinen Entwurf zum Veröffentlichen.");
      const fehler = pruefeVeroeffentlichung(
        entwurf.definition,
        rows.filter((r) => r.veroeffentlicht_am !== null).map((r) => r.definition)
      );
      if (fehler.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: fehler.length === 1 ? fehler[0] : `${fehler.length} Punkte verhindern das Veröffentlichen.`,
          pruefung: fehler,
        });
      }
      await client.query("UPDATE formular_version SET veroeffentlicht_am = now(), veroeffentlicht_von = $2 WHERE id = $1", [
        entwurf.id,
        benutzerId,
      ]);
      return ladeFormularDetail(client, id);
    });
  }

  /**
   * Nur ein nie veroeffentlichtes Formular. Danach verhindert es die
   * Datenbank (Trigger formular_version_eingefroren + Fremdschluessel), nicht
   * nur diese Pruefung.
   */
  async formularLoeschen(id: string): Promise<void> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    await this.db.withTenant(async (client) => {
      const f = await ladeFormularKopf(client, id);
      if (f.veroeffentlichteVersion !== null) {
        throw new BadRequestException("Ein veröffentlichtes Formular kann nicht gelöscht, nur stillgelegt werden.");
      }
      await client.query("DELETE FROM formular_version WHERE formular_id = $1", [id]);
      await client.query("DELETE FROM formular WHERE id = $1", [id]);
    });
  }

  /**
   * Formular-Einstellungen: wirken sofort, ohne neue Version -- sie aendern
   * nicht, WAS gefragt wird, sondern WO das Formular angeboten wird.
   */
  async einstellungenSpeichern(
    id: string,
    input: { name: string; beschreibung: string | null; standortIds: string[]; anheftungen: FormularAnheftung[] }
  ): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    const { mandantId } = requireTenantContext();
    for (const a of input.anheftungen) {
      if (a.pflicht && a.modus !== "automatisch") throw new BadRequestException("Pflicht geht nur bei „automatisch dabei“.");
    }
    if (new Set(input.anheftungen.map((a) => a.anheftpunkt)).size !== input.anheftungen.length) {
      throw new BadRequestException("Ein Anheftpunkt ist doppelt angegeben.");
    }
    return this.db.withTenant(async (client) => {
      await ladeFormularKopf(client, id);
      const standortIds = [...new Set(input.standortIds)];
      if (standortIds.length > 0) {
        // RLS: Standorte eines fremden Traegers sind hier unsichtbar -> "gibt es nicht".
        const { rows } = await client.query("SELECT id FROM standort WHERE id = ANY($1::uuid[])", [standortIds]);
        if (rows.length !== standortIds.length) throw new BadRequestException("Ein ausgewählter Standort existiert nicht.");
      }
      await client.query("UPDATE formular SET name = $2, beschreibung = $3 WHERE id = $1", [id, input.name, input.beschreibung]);
      await client.query("DELETE FROM formular_standort WHERE formular_id = $1", [id]);
      for (const s of standortIds) {
        await client.query("INSERT INTO formular_standort (mandant_id, formular_id, standort_id) VALUES ($1, $2, $3)", [mandantId, id, s]);
      }
      await client.query("DELETE FROM formular_anheftung WHERE formular_id = $1", [id]);
      for (const a of input.anheftungen) {
        await client.query(
          "INSERT INTO formular_anheftung (mandant_id, formular_id, anheftpunkt, modus, pflicht) VALUES ($1, $2, $3, $4, $5)",
          [mandantId, id, a.anheftpunkt, a.modus, a.pflicht]
        );
      }
      return ladeFormularDetail(client, id);
    });
  }

  async formularArchivieren(formularId: string, archiviert: boolean): Promise<FormularDetailDto> {
    await this.brauche("formulare-verwalten", "Keine Berechtigung, Formulare zu verwalten.");
    return this.db.withTenant(async (client) => {
      const { rowCount } = await client.query(
        "UPDATE formular SET archiviert_am = CASE WHEN $2 THEN COALESCE(archiviert_am, now()) ELSE NULL END WHERE id = $1",
        [formularId, archiviert]
      );
      if (!rowCount) throw new NotFoundException("Formular nicht gefunden.");
      return ladeFormularDetail(client, formularId);
    });
  }

  // -------------------------------------------------------------------------
  // Angebot: welche Formulare wo ausgefuellt werden koennen
  // -------------------------------------------------------------------------

  /**
   * Formulare fuer eine Klient:in -- ohne Anheftpunkt die der Klientenakte
   * (alle veroeffentlichten), mit Anheftpunkt nur die dort angehefteten.
   * Immer nur veroeffentlichte, nicht stillgelegte und fuer den Standort der
   * Klient:in zugelassene. Mit Vorbelegung, damit z. B. der Tagesbericht das
   * Formular direkt zeigen kann, ohne erst einen Entwurf anzulegen.
   */
  async angebot(input: { klientId: string; anheftpunkt?: Anheftpunkt }): Promise<FormularAngebotDto[]> {
    await this.brauche("ausfuellen", "Keine Berechtigung, Protokolle auszufüllen.");
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      await schreibbarerKlient(client, benutzerId, input.klientId);
      const angebote = await ladeAngebot(client, input.klientId, input.anheftpunkt ?? null);
      if (angebote.length === 0) return [];
      const quellen = await ladeQuellen(client, input.klientId, benutzerId);
      return angebote.map((a) => ({ ...a, ...vorbelegung(a.definition, quellen) }));
    });
  }

  /**
   * Die an einen Tagesbericht angehefteten Formulare -- in DERSELBEN
   * Transaktion wie der Tagesbericht (TagesberichtService.anlegen): entweder
   * beides oder nichts. Jedes wird als ganz normales, abgeschlossenes
   * Protokoll gespeichert, mit allen Pruefungen aus Schritt 1. Pflicht-
   * Formulare prueft der Server, nicht nur die Oberflaeche.
   */
  async angehefteteAbschliessen(
    client: PoolClient,
    input: { klientId: string; tagesberichtId: string; datum: string; eingaben: AngeheftetesProtokollEingabe[] }
  ): Promise<void> {
    const { mandantId, benutzerId } = requireTenantContext();
    const angebote = await ladeAngebot(client, input.klientId, "tagesbericht");
    const nachId = new Map(angebote.map((a) => [a.id, a]));
    const fehlend = angebote.filter((a) => a.pflicht && !input.eingaben.some((e) => e.formularId === a.id));
    if (fehlend.length > 0) {
      throw new BadRequestException(`Bitte auch „${fehlend[0].name}“ ausfüllen, es gehört an diesem Standort zum Tagesbericht.`);
    }
    if (new Set(input.eingaben.map((e) => e.formularId)).size !== input.eingaben.length) {
      throw new BadRequestException("Ein Formular ist doppelt angegeben.");
    }
    if (input.eingaben.length === 0) return;
    if (!(await this.rechte.hatRecht("protokolle", "ausfuellen"))) {
      throw new ForbiddenException("Keine Berechtigung, Protokolle auszufüllen.");
    }
    const quellen = await ladeQuellen(client, input.klientId, benutzerId);
    for (const e of input.eingaben) {
      const a = nachId.get(e.formularId);
      // Nicht angeheftet, nicht fuer den Standort zugelassen, in Entwicklung oder stillgelegt: gibt es hier nicht.
      if (!a) throw new NotFoundException("Dieses Formular wird beim Tagesbericht nicht angeboten.");
      const zusammen: FeldWerte = { ...e.werte };
      for (const b of alleBausteine(a.definition)) {
        if (istEingabe(b) && b.vorausfuellen?.art === "festgehalten") {
          const w = quellen[b.vorausfuellen.quelle];
          zusammen[b.schluessel] = w !== null && w !== undefined && w !== "" && typFehler(b, w) === null ? w : null;
        }
      }
      const fehler = pruefeWerte(a.definition, zusammen, { heute: heuteBerlin() });
      await mitarbeitendePruefen(client, a.definition, zusammen, fehler);
      if (fehler.length > 0) {
        const ausnahme = feldFehlerAusnahme(fehler);
        const antwort = ausnahme.getResponse() as Record<string, unknown>;
        throw new BadRequestException({ ...antwort, message: `${a.name}: ${antwort.message}`, formularId: a.id });
      }
      const { werte } = werteAus(a.definition, zusammen);
      const vor = vorbelegung(a.definition, quellen).werte;
      const ins = await client.query<{ id: string }>(
        `INSERT INTO protokoll (mandant_id, formular_version_id, klient_id, autor_id, bezugsdatum, tagesbericht_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [mandantId, a.versionId, input.klientId, benutzerId, bezugsdatumAus(a.definition, werte, input.datum), input.tagesberichtId]
      );
      const vorAlt: Record<string, { wert: FeldWert; quelle: ProtokollWertQuelle }> = {};
      for (const [k, w] of Object.entries(vor)) vorAlt[k] = { wert: w, quelle: "vorschlag" };
      await schreibeWerte(client, mandantId, ins.rows[0].id, a.definition, werte, quellenFuer(a.definition, werte, vorAlt));
      await client.query("UPDATE protokoll SET abgeschlossen_am = now(), abgeschlossen_von = $2 WHERE id = $1", [
        ins.rows[0].id,
        benutzerId,
      ]);
    }
  }

  // -------------------------------------------------------------------------
  // Protokolle lesen
  // -------------------------------------------------------------------------

  /**
   * Abgeschlossene Protokolle plus die EIGENEN Entwuerfe -- ein fremder
   * Entwurf ist noch nicht Teil der Akte. Standort-Einschraenkung wie bei
   * Tagesberichten ueber klientStandortBedingung.
   */
  async liste(filter: { klientId?: string }): Promise<ProtokollKurzDto[]> {
    await this.brauche("ansehen", "Keine Berechtigung, Protokolle zu sehen.");
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubte = await ermittleErlaubteStandortIds(client, benutzerId);
      const params: unknown[] = [benutzerId];
      const bedingungen = ["(p.abgeschlossen_am IS NOT NULL OR p.autor_id = $1)"];
      if (filter.klientId) {
        params.push(filter.klientId);
        bedingungen.push(`p.klient_id = $${params.length}`);
      }
      bedingungen.push(klientStandortBedingung(erlaubte, "k", params));
      const { rows } = await client.query(
        `${KURZ_AUSWAHL} WHERE ${bedingungen.join(" AND ")}
         ORDER BY p.bezugsdatum DESC, p.erstellt_am DESC`,
        params
      );
      return rows.map(kurzDto);
    });
  }

  async detail(id: string): Promise<ProtokollDto> {
    await this.brauche("ansehen", "Keine Berechtigung, Protokolle zu sehen.");
    const { benutzerId } = requireTenantContext();
    const darfFremde = await this.rechte.hatRecht("protokolle", "korrigieren-fremde");
    const darfAusfuellen = await this.rechte.hatRecht("protokolle", "ausfuellen");
    return this.db.withTenant(async (client) => {
      await this.sichtbarerKopf(client, id, benutzerId);
      return ladeDetail(client, id, { benutzerId, darfFremde, darfAusfuellen });
    });
  }

  async historie(id: string): Promise<ProtokollAenderungDto[]> {
    await this.brauche("ansehen", "Keine Berechtigung, Protokolle zu sehen.");
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const kopf = await this.sichtbarerKopf(client, id, benutzerId);
      const beschriftung = new Map(alleBausteine(kopf.definition).map((b) => [b.schluessel, b.beschriftung]));
      const { rows } = await client.query(
        `SELECT a.id, a.feld_schluessel, a.wert_alt, a.wert_neu, a.grund, a.geaendert_am, b.name AS von
         FROM protokoll_aenderung a LEFT JOIN benutzer b ON b.id = a.geaendert_von
         WHERE a.protokoll_id = $1 ORDER BY a.geaendert_am DESC`,
        [id]
      );
      return rows.map((r) => ({
        id: r.id,
        feldSchluessel: r.feld_schluessel,
        feldBeschriftung: beschriftung.get(r.feld_schluessel) ?? r.feld_schluessel,
        wertAlt: r.wert_alt,
        wertNeu: r.wert_neu,
        grund: r.grund,
        geaendertAm: new Date(r.geaendert_am).toISOString(),
        geaendertVonName: r.von,
      }));
    });
  }

  /** 404 statt 403 fuer Fremdes: ob es ein Protokoll gibt, verraet nichts. */
  private async sichtbarerKopf(client: PoolClient, id: string, benutzerId: string): Promise<ProtokollKopf> {
    const kopf = await ladeKopf(client, id);
    if (!kopf) throw new NotFoundException("Protokoll nicht gefunden.");
    if (!kopf.abgeschlossen_am && kopf.autor_id !== benutzerId) throw new NotFoundException("Protokoll nicht gefunden.");
    if (!(await klientIstErlaubt(client, benutzerId, kopf.klient_id))) throw new NotFoundException("Protokoll nicht gefunden.");
    return kopf;
  }

  // -------------------------------------------------------------------------
  // Ausfuellen
  // -------------------------------------------------------------------------

  /** Legt einen Entwurf an und fuellt "vorschlag"- und "festgehalten"-Felder vor. */
  async anlegen(input: { formularId: string; klientId: string }): Promise<ProtokollDto> {
    await this.brauche("ausfuellen", "Keine Berechtigung, Protokolle auszufüllen.");
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      await schreibbarerKlient(client, benutzerId, input.klientId);
      // Dieselbe Abfrage wie das Angebot der Klientenakte: veroeffentlicht,
      // nicht stillgelegt, fuer den Standort der Klient:in zugelassen. Der
      // Browser bietet nur das an; hier wird es verbindlich geprueft.
      const angebot = (await ladeAngebot(client, input.klientId, null)).find((a) => a.id === input.formularId);
      if (!angebot) throw new NotFoundException("Formular nicht gefunden.");
      const { versionId, definition } = angebot;

      const quellen = await ladeQuellen(client, input.klientId, benutzerId);
      const vor: Record<string, { wert: FeldWert; quelle: ProtokollWertQuelle }> = {};
      const vb = vorbelegung(definition, quellen);
      for (const [k, w] of Object.entries(vb.werte)) vor[k] = { wert: w, quelle: vb.quellen[k] };
      const bezugsdatum = bezugsdatumAus(definition, vb.werte);

      const ins = await client.query<{ id: string }>(
        `INSERT INTO protokoll (mandant_id, formular_version_id, klient_id, autor_id, bezugsdatum)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mandantId, versionId, input.klientId, benutzerId, bezugsdatum]
      );
      const protokollId = ins.rows[0].id;
      const { werte } = werteAus(definition, Object.fromEntries(Object.entries(vor).map(([k, v]) => [k, v.wert])));
      const quelleJe: Record<string, ProtokollWertQuelle> = {};
      for (const [k, v] of Object.entries(vor)) quelleJe[k] = v.quelle;
      await schreibeWerte(client, mandantId, protokollId, definition, werte, quelleJe);
      return ladeDetail(client, protokollId, { benutzerId, darfFremde: false, darfAusfuellen: true });
    });
  }

  /** Zwischenspeichern eines Entwurfs: Typen werden geprueft, Pflicht noch nicht. */
  async entwurfSpeichern(id: string, eingabe: FeldWerte): Promise<ProtokollDto> {
    await this.brauche("ausfuellen", "Keine Berechtigung, Protokolle auszufüllen.");
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const kopf = await this.eigenerEntwurf(client, id, benutzerId);
      await schreibbarerKlient(client, benutzerId, kopf.klient_id);
      const alt = await ladeWerte(client, id);
      const zusammen = mitFestenWerten(kopf.definition, eingabe, alt);
      const fehler = typFehlerAlle(kopf.definition, zusammen);
      await mitarbeitendePruefen(client, kopf.definition, zusammen, fehler);
      if (fehler.length > 0) throw feldFehlerAusnahme(fehler);
      const { werte } = werteAus(kopf.definition, zusammen);
      await schreibeWerte(client, mandantId, id, kopf.definition, werte, quellenFuer(kopf.definition, werte, alt));
      await client.query("UPDATE protokoll SET bezugsdatum = $2 WHERE id = $1", [id, bezugsdatumAus(kopf.definition, werte)]);
      return ladeDetail(client, id, { benutzerId, darfFremde: false, darfAusfuellen: true });
    });
  }

  /**
   * Abschliessen: volle Pruefung, "festgehalten" wird mit dem Stand JETZT
   * gesetzt, Berechnungen werden mitgespeichert. Werte werden geschrieben,
   * BEVOR abgeschlossen_am gesetzt wird -- so erzeugt das Abschliessen keine
   * Historie (der Trigger protokolliert nur abgeschlossene Protokolle).
   */
  async abschliessen(id: string, eingabe: FeldWerte): Promise<ProtokollDto> {
    await this.brauche("ausfuellen", "Keine Berechtigung, Protokolle auszufüllen.");
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const kopf = await this.eigenerEntwurf(client, id, benutzerId);
      await schreibbarerKlient(client, benutzerId, kopf.klient_id);
      const alt = await ladeWerte(client, id);
      const quellenDaten = await ladeQuellen(client, kopf.klient_id, benutzerId);
      const zusammen: FeldWerte = { ...eingabe };
      for (const b of alleBausteine(kopf.definition)) {
        if (istEingabe(b) && b.vorausfuellen?.art === "festgehalten") {
          const w = quellenDaten[b.vorausfuellen.quelle];
          zusammen[b.schluessel] = w !== null && w !== undefined && w !== "" && typFehler(b, w) === null ? w : null;
        }
      }
      const fehler = pruefeWerte(kopf.definition, zusammen, { heute: heuteBerlin() });
      await mitarbeitendePruefen(client, kopf.definition, zusammen, fehler);
      if (fehler.length > 0) throw feldFehlerAusnahme(fehler);
      const { werte } = werteAus(kopf.definition, zusammen);
      await schreibeWerte(client, mandantId, id, kopf.definition, werte, quellenFuer(kopf.definition, werte, alt));
      await client.query(
        "UPDATE protokoll SET bezugsdatum = $2, abgeschlossen_am = now(), abgeschlossen_von = $3 WHERE id = $1",
        [id, bezugsdatumAus(kopf.definition, werte), benutzerId]
      );
      return ladeDetail(client, id, { benutzerId, darfFremde: false, darfAusfuellen: true });
    });
  }

  /**
   * Korrektur eines abgeschlossenen Protokolls. Die eigene Autor:in darf
   * immer (wie beim Tagesbericht), andere nur mit protokolle.korrigieren-fremde.
   * Der Grund wird als Transaktionsvariable gesetzt; den Eintrag in
   * protokoll_aenderung schreibt der Trigger (Migration 0075), nicht dieser Code.
   * "Festgehalten" bleibt, wie es beim Abschliessen war.
   */
  async korrigieren(id: string, eingabe: FeldWerte, grund: string): Promise<ProtokollDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    const darfFremde = await this.rechte.hatRecht("protokolle", "korrigieren-fremde");
    const darfAusfuellen = await this.rechte.hatRecht("protokolle", "ausfuellen");
    return this.db.withTenant(async (client) => {
      const kopf = await this.sichtbarerKopf(client, id, benutzerId);
      if (!kopf.abgeschlossen_am) throw new BadRequestException("Ein Entwurf wird gespeichert, nicht korrigiert.");
      const eigenes = kopf.autor_id === benutzerId;
      if (!((eigenes && darfAusfuellen) || darfFremde)) {
        throw new ForbiddenException("Nur die Autorin bzw. der Autor oder die Leitung darf dieses Protokoll korrigieren.");
      }
      await schreibbarerKlient(client, benutzerId, kopf.klient_id);
      const alt = await ladeWerte(client, id);
      const zusammen = mitFestenWerten(kopf.definition, eingabe, alt);
      const erlaubeAusgeblendet: Record<string, string[]> = {};
      for (const [k, w] of Object.entries(alt)) {
        if (typeof w.wert === "string") erlaubeAusgeblendet[k] = [w.wert];
        else if (Array.isArray(w.wert)) erlaubeAusgeblendet[k] = w.wert;
      }
      const fehler = pruefeWerte(kopf.definition, zusammen, { heute: heuteBerlin(), erlaubeAusgeblendet });
      await mitarbeitendePruefen(client, kopf.definition, zusammen, fehler);
      if (fehler.length > 0) throw feldFehlerAusnahme(fehler);
      const { werte } = werteAus(kopf.definition, zusammen);
      await client.query("SELECT set_config('app.aenderungsgrund', $1, true)", [grund]);
      await schreibeWerte(client, mandantId, id, kopf.definition, werte, quellenFuer(kopf.definition, werte, alt));
      return ladeDetail(client, id, { benutzerId, darfFremde, darfAusfuellen });
    });
  }

  async entwurfLoeschen(id: string): Promise<void> {
    await this.brauche("ausfuellen", "Keine Berechtigung, Protokolle auszufüllen.");
    const { benutzerId } = requireTenantContext();
    await this.db.withTenant(async (client) => {
      await this.eigenerEntwurf(client, id, benutzerId);
      await client.query("DELETE FROM protokoll WHERE id = $1", [id]);
    });
  }

  private async eigenerEntwurf(client: PoolClient, id: string, benutzerId: string): Promise<ProtokollKopf> {
    const kopf = await this.sichtbarerKopf(client, id, benutzerId);
    if (kopf.abgeschlossen_am) throw new BadRequestException("Das Protokoll ist schon abgeschlossen.");
    return kopf;
  }
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

async function schreibbarerKlient(client: PoolClient, benutzerId: string, klientId: string) {
  if (!(await klientIstErlaubt(client, benutzerId, klientId))) throw new NotFoundException("Klient nicht gefunden.");
  if (await klientIstArchiviert(client, klientId)) {
    throw new BadRequestException("Dieser Klient ist archiviert und kann nicht mehr bearbeitet werden.");
  }
}

function bezugsdatumAus(def: FormularDefinition, werte: FeldWerte, sonst?: string): string {
  const w = def.bezugsdatumFeld ? werte[def.bezugsdatumFeld] : undefined;
  return typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : (sonst ?? heuteBerlin());
}

/**
 * Eingabe der Oberflaeche plus die Werte, die die Oberflaeche NICHT aendern
 * darf: "festgehalten" kommt immer aus der Datenbank, nie aus dem Request.
 */
function mitFestenWerten(def: FormularDefinition, eingabe: FeldWerte, alt: Record<string, { wert: FeldWert; quelle: ProtokollWertQuelle }>): FeldWerte {
  const out: FeldWerte = { ...eingabe };
  for (const b of alleBausteine(def)) {
    if (istEingabe(b) && b.vorausfuellen?.art === "festgehalten") out[b.schluessel] = alt[b.schluessel]?.wert ?? null;
  }
  return out;
}

function typFehlerAlle(def: FormularDefinition, werte: FeldWerte): FeldFehler[] {
  const fehler: FeldFehler[] = [];
  for (const b of alleBausteine(def)) {
    if (!istEingabe(b)) continue;
    const w = werte[b.schluessel];
    if (w === null || w === undefined || w === "" || (Array.isArray(w) && w.length === 0)) continue;
    const tf = typFehler(b, w);
    if (tf) fehler.push({ schluessel: b.schluessel, meldung: tf });
  }
  return fehler;
}

/** Mitarbeitende-Felder duerfen nur auf Personen DIESES Traegers zeigen (RLS auf benutzer). */
async function mitarbeitendePruefen(client: PoolClient, def: FormularDefinition, werte: FeldWerte, fehler: FeldFehler[]) {
  for (const b of alleBausteine(def)) {
    if (b.typ !== "mitarbeitende") continue;
    const w = werte[b.schluessel];
    if (!Array.isArray(w) || w.length === 0 || fehler.some((f) => f.schluessel === b.schluessel)) continue;
    const { rows } = await client.query("SELECT id FROM benutzer WHERE id = ANY($1::uuid[])", [w]);
    if (rows.length !== w.length) fehler.push({ schluessel: b.schluessel, meldung: "Eine ausgewählte Person gibt es nicht." });
  }
}

/**
 * Quelle je Wert. Ein Vorschlag bleibt "vorschlag", solange er unveraendert
 * ist; einmal geaendert, bleibt er "vorschlag_geaendert" -- auch wenn spaeter
 * wieder derselbe Wert eingetragen wird, war es eine bewusste Entscheidung.
 */
function quellenFuer(
  def: FormularDefinition,
  werte: Record<string, FeldWert>,
  alt: Record<string, { wert: FeldWert; quelle: ProtokollWertQuelle }>
): Record<string, ProtokollWertQuelle> {
  const out: Record<string, ProtokollWertQuelle> = {};
  for (const b of alleBausteine(def)) {
    if (!(b.schluessel in werte)) continue;
    if (b.typ === "berechnung") out[b.schluessel] = "berechnet";
    else if (istEingabe(b) && b.vorausfuellen?.art === "festgehalten") out[b.schluessel] = "festgehalten";
    else if (istEingabe(b) && b.vorausfuellen?.art === "vorschlag") {
      const a = alt[b.schluessel];
      out[b.schluessel] = a?.quelle === "vorschlag" && gleich(a.wert, werte[b.schluessel]) ? "vorschlag" : "vorschlag_geaendert";
    } else out[b.schluessel] = "eingabe";
  }
  return out;
}

async function ladeWerte(client: PoolClient, protokollId: string) {
  const { rows } = await client.query<WertZeile>(
    `SELECT feld_schluessel, datentyp, wert_text, wert_zahl, wert_datum, wert_zeit::text AS wert_zeit, wert_bool, wert_liste, quelle
     FROM protokoll_wert WHERE protokoll_id = $1`,
    [protokollId]
  );
  const out: Record<string, { wert: FeldWert; quelle: ProtokollWertQuelle }> = {};
  for (const r of rows) out[r.feld_schluessel] = { wert: wertAusZeile(r), quelle: r.quelle };
  return out;
}

/**
 * Gleicht die Datenpunkte mit dem neuen Stand ab: nur Geaendertes wird
 * geschrieben, Verschwundenes (geleert oder ausgeblendet) geloescht. So
 * entsteht bei einer Korrektur je tatsaechlich geaendertem Feld genau ein
 * Historieneintrag.
 */
async function schreibeWerte(
  client: PoolClient,
  mandantId: string,
  protokollId: string,
  def: FormularDefinition,
  werte: Record<string, FeldWert>,
  quellen: Record<string, ProtokollWertQuelle>
) {
  const alt = await ladeWerte(client, protokollId);
  const bausteine = new Map(alleBausteine(def).filter(speichernderBaustein).map((b) => [b.schluessel, b]));
  for (const schluessel of Object.keys(alt)) {
    if (!(schluessel in werte)) {
      await client.query("DELETE FROM protokoll_wert WHERE protokoll_id = $1 AND feld_schluessel = $2", [protokollId, schluessel]);
    }
  }
  for (const [schluessel, wert] of Object.entries(werte)) {
    const b = bausteine.get(schluessel);
    if (!b) continue;
    const datentyp = datentypVon(b.typ)!;
    const quelle = quellen[schluessel] ?? "eingabe";
    const a = alt[schluessel];
    if (a && gleich(a.wert, wert) && a.quelle === quelle) continue;
    const spalten = {
      text: datentyp === "text" ? wert : null,
      zahl: datentyp === "zahl" ? wert : null,
      datum: datentyp === "datum" ? wert : null,
      zeit: datentyp === "zeit" ? wert : null,
      bool: datentyp === "bool" ? wert : null,
      liste: datentyp === "liste" ? wert : null,
    };
    await client.query(
      `INSERT INTO protokoll_wert
         (mandant_id, protokoll_id, feld_schluessel, datentyp, wert_text, wert_zahl, wert_datum, wert_zeit, wert_bool, wert_liste, quelle)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (protokoll_id, feld_schluessel) DO UPDATE SET
         wert_text = EXCLUDED.wert_text, wert_zahl = EXCLUDED.wert_zahl, wert_datum = EXCLUDED.wert_datum,
         wert_zeit = EXCLUDED.wert_zeit, wert_bool = EXCLUDED.wert_bool, wert_liste = EXCLUDED.wert_liste,
         quelle = EXCLUDED.quelle`,
      [mandantId, protokollId, schluessel, datentyp, spalten.text, spalten.zahl, spalten.datum, spalten.zeit, spalten.bool, spalten.liste, quelle]
    );
  }
}

/**
 * Werte aller Datenquellen fuer eine Klient:in und die ausfuellende Person.
 * Identitaetsquellen (Name, Geburtsdatum, ...) werden hier fuer die ANZEIGE
 * gelesen -- gespeichert werden sie nie (pruefeDefinition verbietet es).
 * Nach einer Anonymisierung steht in klient schon der Platzhalter, also
 * zeigt auch jedes Protokoll automatisch nur noch ihn.
 */
async function ladeQuellen(client: PoolClient, klientId: string, benutzerId: string): Promise<Record<Datenquelle, FeldWert | null>> {
  const { rows } = await client.query(
    `SELECT k.vorname, k.nachname, k.geburtsdatum, k.aktenzeichen, k.amt,
            bb.name AS bezugsbetreuung,
            (SELECT s.name FROM belegung b JOIN zimmer z ON z.id = b.zimmer_id JOIN standort s ON s.id = z.standort_id
             WHERE b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE ORDER BY b.einzug DESC LIMIT 1) AS standort,
            (SELECT z.nummer FROM belegung b JOIN zimmer z ON z.id = b.zimmer_id
             WHERE b.klient_id = k.id AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE ORDER BY b.einzug DESC LIMIT 1) AS zimmer,
            (SELECT name FROM benutzer WHERE id = $2) AS ausfuellende
     FROM klient k
     LEFT JOIN klient_stammdaten ks ON ks.klient_id = k.id
     LEFT JOIN benutzer bb ON bb.id = ks.bezugsbetreuer_id
     WHERE k.id = $1`,
    [klientId, benutzerId]
  );
  const r = rows[0] ?? {};
  const heute = heuteBerlin();
  let alter: number | null = null;
  if (r.geburtsdatum) {
    const [gj, gm, gt] = String(r.geburtsdatum).split("-").map(Number);
    const [hj, hm, ht] = heute.split("-").map(Number);
    alter = hj - gj - (hm < gm || (hm === gm && ht < gt) ? 1 : 0);
  }
  return {
    "klient.name": r.vorname !== undefined ? `${r.vorname} ${r.nachname}` : null,
    "klient.vorname": r.vorname ?? null,
    "klient.nachname": r.nachname ?? null,
    "klient.initialen": r.vorname !== undefined ? initialen(r.vorname, r.nachname) : null,
    "klient.geburtsdatum": r.geburtsdatum ?? null,
    "klient.alter": alter,
    "klient.aktenzeichen": r.aktenzeichen ?? null,
    "klient.amt": r.amt ?? null,
    "klient.bezugsbetreuung": r.bezugsbetreuung ?? null,
    "belegung.standort": r.standort ?? null,
    "belegung.zimmer": r.zimmer ?? null,
    "belegung.wohnung": r.standort ? (r.zimmer ? `${r.standort}, Zimmer ${r.zimmer}` : r.standort) : null,
    "ausfuellende.name": r.ausfuellende ?? null,
    "zeit.heute": heute,
    "zeit.jetzt": jetztBerlin(),
  };
}

const KURZ_AUSWAHL = `
  SELECT p.id, f.id AS formular_id, f.name AS formular_name, v.nummer AS version_nummer,
         p.klient_id, k.vorname, k.nachname, b.name AS autor_name, p.bezugsdatum, p.abgeschlossen_am, p.tagesbericht_id,
         (SELECT count(*)::int FROM protokoll_aenderung a WHERE a.protokoll_id = p.id) AS anzahl_aenderungen
  FROM protokoll p
  JOIN formular_version v ON v.id = p.formular_version_id
  JOIN formular f ON f.id = v.formular_id
  JOIN klient k ON k.id = p.klient_id
  LEFT JOIN benutzer b ON b.id = p.autor_id
`;

function kurzDto(r: Record<string, any>): ProtokollKurzDto {
  return {
    id: r.id,
    formularId: r.formular_id,
    formularName: r.formular_name,
    versionNummer: r.version_nummer,
    klientId: r.klient_id,
    klientName: `${r.vorname} ${r.nachname}`,
    autorName: r.autor_name,
    bezugsdatum: r.bezugsdatum,
    abgeschlossen: r.abgeschlossen_am !== null,
    abgeschlossenAm: r.abgeschlossen_am ? new Date(r.abgeschlossen_am).toISOString() : null,
    anzahlAenderungen: r.anzahl_aenderungen,
    tagesberichtId: r.tagesbericht_id,
  };
}

async function ladeKopf(client: PoolClient, id: string): Promise<ProtokollKopf | null> {
  const { rows } = await client.query<ProtokollKopf>(
    `SELECT p.id, p.autor_id, p.klient_id, p.abgeschlossen_am, v.definition, v.formular_id, v.nummer AS version_nummer
     FROM protokoll p JOIN formular_version v ON v.id = p.formular_version_id
     WHERE p.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function ladeDetail(
  client: PoolClient,
  id: string,
  wer: { benutzerId: string; darfFremde: boolean; darfAusfuellen: boolean }
): Promise<ProtokollDto> {
  const { rows } = await client.query(`${KURZ_AUSWAHL} WHERE p.id = $1`, [id]);
  const kurz = kurzDto(rows[0]);
  const kopf = (await ladeKopf(client, id))!;
  const alt = await ladeWerte(client, id);
  const werte: Record<string, FeldWert> = {};
  const quellen: Record<string, ProtokollWertQuelle> = {};
  for (const [k, v] of Object.entries(alt)) {
    werte[k] = v.wert;
    quellen[k] = v.quelle;
  }
  const bausteine = alleBausteine(kopf.definition);
  const anzeige: Record<string, string | null> = {};
  if (bausteine.some((b) => b.typ === "anzeige")) {
    const q = await ladeQuellen(client, kopf.klient_id, kopf.autor_id);
    for (const b of bausteine) {
      if (b.typ === "anzeige") {
        const w = q[b.quelle];
        anzeige[b.schluessel] = w === null || w === undefined ? null : String(w);
      }
    }
  }
  const personenIds = new Set<string>();
  for (const b of bausteine) {
    const w = werte[b.schluessel];
    if (b.typ === "mitarbeitende" && Array.isArray(w)) w.forEach((x) => personenIds.add(x));
  }
  const personen: Record<string, string> = {};
  if (personenIds.size > 0) {
    const p = await client.query<{ id: string; name: string }>("SELECT id, name FROM benutzer WHERE id = ANY($1::uuid[])", [[...personenIds]]);
    for (const r of p.rows) personen[r.id] = r.name;
  }
  const neuer = await client.query(
    "SELECT 1 FROM formular_version WHERE formular_id = $1 AND nummer > $2 AND veroeffentlicht_am IS NOT NULL LIMIT 1",
    [kopf.formular_id, kopf.version_nummer]
  );
  const eigenes = kopf.autor_id === wer.benutzerId;
  const bearbeitbar = kurz.abgeschlossen ? (eigenes && wer.darfAusfuellen) || wer.darfFremde : eigenes && wer.darfAusfuellen;
  return {
    ...kurz,
    autorId: kopf.autor_id,
    definition: kopf.definition,
    werte,
    quellen,
    anzeige,
    personen,
    bearbeitbar,
    neuereVersion: neuer.rows.length > 0,
  };
}

const VERWALTUNG_AUSWAHL = `
  SELECT f.id, f.name, f.beschreibung, f.archiviert_am,
         (SELECT max(nummer) FROM formular_version v WHERE v.formular_id = f.id AND v.veroeffentlicht_am IS NOT NULL) AS veroeffentlicht,
         (SELECT nummer FROM formular_version v WHERE v.formular_id = f.id AND v.veroeffentlicht_am IS NULL) AS entwurf,
         COALESCE((SELECT array_agg(fs.standort_id) FROM formular_standort fs WHERE fs.formular_id = f.id), '{}') AS standort_ids,
         COALESCE((SELECT json_agg(json_build_object('anheftpunkt', fa.anheftpunkt, 'modus', fa.modus, 'pflicht', fa.pflicht))
                   FROM formular_anheftung fa WHERE fa.formular_id = f.id), '[]') AS anheftungen,
         (SELECT count(*)::int FROM protokoll p JOIN formular_version pv ON pv.id = p.formular_version_id
          WHERE pv.formular_id = f.id AND p.abgeschlossen_am IS NOT NULL) AS anzahl
  FROM formular f
`;

function verwaltungDto(r: Record<string, any>): FormularVerwaltungDto {
  const veroeffentlicht: number | null = r.veroeffentlicht ?? null;
  return {
    id: r.id,
    name: r.name,
    beschreibung: r.beschreibung,
    status: formularStatus(r.archiviert_am !== null, veroeffentlicht),
    veroeffentlichteVersion: veroeffentlicht,
    entwurfVersion: r.entwurf ?? null,
    standortIds: r.standort_ids,
    anheftungen: r.anheftungen,
    anzahlProtokolle: r.anzahl,
  };
}

async function ladeVerwaltung(client: PoolClient): Promise<FormularVerwaltungDto[]> {
  const { rows } = await client.query(`${VERWALTUNG_AUSWAHL} ORDER BY f.archiviert_am IS NOT NULL, f.name`);
  return rows.map(verwaltungDto);
}

async function ladeFormularKopf(client: PoolClient, id: string): Promise<{ archiviert: boolean; veroeffentlichteVersion: number | null }> {
  const { rows } = await client.query(`${VERWALTUNG_AUSWAHL} WHERE f.id = $1`, [id]);
  if (!rows[0]) throw new NotFoundException("Formular nicht gefunden.");
  const d = verwaltungDto(rows[0]);
  return { archiviert: d.status === "stillgelegt", veroeffentlichteVersion: d.veroeffentlichteVersion };
}

async function ladeFormularDetail(client: PoolClient, id: string): Promise<FormularDetailDto> {
  const { rows } = await client.query(`${VERWALTUNG_AUSWAHL} WHERE f.id = $1`, [id]);
  if (!rows[0]) throw new NotFoundException("Formular nicht gefunden.");
  const basis = verwaltungDto(rows[0]);
  const versionen = await client.query<{
    id: string;
    nummer: number;
    definition: FormularDefinition;
    veroeffentlicht_am: Date | null;
    von: string | null;
    anzahl: number;
  }>(
    `SELECT v.id, v.nummer, v.definition, v.veroeffentlicht_am, b.name AS von,
            (SELECT count(*)::int FROM protokoll p WHERE p.formular_version_id = v.id AND p.abgeschlossen_am IS NOT NULL) AS anzahl
     FROM formular_version v LEFT JOIN benutzer b ON b.id = v.veroeffentlicht_von
     WHERE v.formular_id = $1 ORDER BY v.nummer DESC`,
    [id]
  );
  const veroeffentlichte = versionen.rows.filter((v) => v.veroeffentlicht_am !== null);
  const entwurf = versionen.rows.find((v) => v.veroeffentlicht_am === null);
  const offen = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM protokoll p JOIN formular_version v ON v.id = p.formular_version_id
     WHERE v.formular_id = $1 AND p.abgeschlossen_am IS NULL`,
    [id]
  );
  return {
    ...basis,
    entwurf: entwurf ? { nummer: entwurf.nummer, definition: entwurf.definition } : null,
    veroeffentlicht: veroeffentlichte[0] ? { nummer: veroeffentlichte[0].nummer, definition: veroeffentlichte[0].definition } : null,
    versionen: versionen.rows.map((v) => ({
      nummer: v.nummer,
      veroeffentlichtAm: v.veroeffentlicht_am ? new Date(v.veroeffentlicht_am).toISOString() : null,
      veroeffentlichtVonName: v.von,
      anzahlProtokolle: v.anzahl,
    })),
    frueher: veroeffentlichte.map((v) => v.definition),
    offeneEntwuerfe: offen.rows[0].n,
  };
}

interface AngebotZeile {
  id: string;
  name: string;
  beschreibung: string | null;
  versionId: string;
  versionNummer: number;
  definition: FormularDefinition;
  modus: AnheftModus | null;
  pflicht: boolean;
}

/**
 * Die eine Stelle, die entscheidet, welches Formular wo ausgefuellt werden
 * darf: neueste veroeffentlichte Version, nicht stillgelegt, Standort der
 * Klient:in zugelassen (keine Zeile in formular_standort = alle Standorte;
 * ohne aktuelle Belegung nur solche), ggf. am Anheftpunkt angeheftet.
 * Angebot, Anlegen und Tagesbericht benutzen sie alle -- so kann der Browser
 * nichts einreichen, was hier nicht angeboten wuerde.
 */
async function ladeAngebot(client: PoolClient, klientId: string, anheftpunkt: Anheftpunkt | null): Promise<AngebotZeile[]> {
  const { rows } = await client.query(
    `SELECT f.id, f.name, f.beschreibung, v.id AS version_id, v.nummer, v.definition, fa.modus, COALESCE(fa.pflicht, false) AS pflicht
     FROM formular f
     JOIN LATERAL (
       SELECT id, nummer, definition FROM formular_version
       WHERE formular_id = f.id AND veroeffentlicht_am IS NOT NULL ORDER BY nummer DESC LIMIT 1
     ) v ON true
     LEFT JOIN formular_anheftung fa ON fa.formular_id = f.id AND fa.anheftpunkt = $2
     WHERE f.archiviert_am IS NULL
       AND ($2::text IS NULL OR fa.formular_id IS NOT NULL)
       AND (
         NOT EXISTS (SELECT 1 FROM formular_standort fs WHERE fs.formular_id = f.id)
         OR EXISTS (
           SELECT 1 FROM formular_standort fs
           JOIN zimmer z ON z.standort_id = fs.standort_id
           JOIN belegung b ON b.zimmer_id = z.id
           WHERE fs.formular_id = f.id AND b.klient_id = $1 AND b.auszug IS NULL AND b.einzug <= CURRENT_DATE
         )
       )
     ORDER BY fa.modus = 'automatisch' DESC NULLS LAST, f.name`,
    [klientId, anheftpunkt]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    beschreibung: r.beschreibung,
    versionId: r.version_id,
    versionNummer: r.nummer,
    definition: r.definition,
    modus: anheftpunkt ? r.modus : null,
    pflicht: anheftpunkt ? r.pflicht : false,
  }));
}

/** Vorausgefuellte Werte (Vorschlag und festgehalten) und Anzeigewerte fuer eine Klient:in. */
function vorbelegung(
  definition: FormularDefinition,
  quellen: Record<Datenquelle, FeldWert | null>
): { werte: Record<string, FeldWert>; quellen: Record<string, ProtokollWertQuelle>; anzeige: Record<string, string | null> } {
  const werte: Record<string, FeldWert> = {};
  const herkunft: Record<string, ProtokollWertQuelle> = {};
  const anzeige: Record<string, string | null> = {};
  for (const b of alleBausteine(definition)) {
    if (b.typ === "anzeige") {
      const w = quellen[b.quelle];
      anzeige[b.schluessel] = w === null || w === undefined ? null : String(w);
      continue;
    }
    if (!istEingabe(b) || !b.vorausfuellen) continue;
    const w = quellen[b.vorausfuellen.quelle];
    if (w === null || w === undefined || w === "") continue;
    // Nur uebernehmen, was zum Feldtyp passt (ein "Amt" in ein Zahlenfeld nie).
    if (typFehler(b, w) !== null) continue;
    werte[b.schluessel] = w;
    herkunft[b.schluessel] = b.vorausfuellen.art === "festgehalten" ? "festgehalten" : "vorschlag";
  }
  return { werte, quellen: herkunft, anzeige };
}

/**
 * Grobe Form einer Definition aus dem Editor: lesbar fuer werteAus und die
 * Anzeige, auch wenn noch nicht fertig. Inhaltliches (Beschriftungen,
 * Verweise, Identitaetsquellen) prueft pruefeDefinition beim Veroeffentlichen.
 */
function strukturFehler(def: unknown): string | null {
  if (!def || typeof def !== "object" || !Array.isArray((def as FormularDefinition).bausteine)) return "Die Definition hat keine Bausteine.";
  let anzahl = 0;
  const pruefe = (liste: unknown[], tiefe: number): string | null => {
    if (tiefe > 3) return "Abschnitte sind zu tief verschachtelt.";
    for (const b of liste) {
      anzahl++;
      if (anzahl > 400) return "Das Formular hat zu viele Bausteine.";
      if (!b || typeof b !== "object") return "Ein Baustein ist ungültig.";
      const x = b as Record<string, unknown>;
      if (typeof x.typ !== "string" || !(x.typ in BAUSTEIN_LABEL)) return "Ein Baustein hat einen unbekannten Typ.";
      if (typeof x.schluessel !== "string" || typeof x.beschriftung !== "string") return "Ein Baustein hat keinen Schlüssel.";
      if (x.typ === "abschnitt") {
        if (!Array.isArray(x.kinder)) return "Ein Abschnitt ist ungültig.";
        const f = pruefe(x.kinder, tiefe + 1);
        if (f) return f;
      }
      if ((x.typ === "auswahl" || x.typ === "mehrfachauswahl") && !Array.isArray(x.optionen)) return "Eine Auswahl hat keine Optionen.";
      if (x.typ === "berechnung" && (x.ausdruck === undefined || x.ausdruck === null)) return "Eine Berechnung hat keine Formel.";
      if (x.typ === "anzeige" && typeof x.quelle !== "string") return "Eine Anzeige hat keine Quelle.";
    }
    return null;
  };
  return pruefe((def as FormularDefinition).bausteine, 0);
}
