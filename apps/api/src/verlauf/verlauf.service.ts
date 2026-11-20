import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  protokollKurzfassung,
  type FeldWerte,
  type FormularDefinition,
  type KlientEintragAenderungDto,
  type KlientEintragAnlegenDto,
  type KlientEintragDto,
  type VerlaufDto,
  type VerlaufRechteDto,
  type VerlaufWiedervorlageDto,
  type VerlaufZeileDto,
  GESPRAECH_ART_LABEL,
  type GespraechArt,
} from "@zimmerakte/shared";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";
import { requireTenantContext } from "../common/tenant-context";
import { klientIstArchiviert, klientIstErlaubt } from "../common/standort-restriction";

/**
 * Hoechstens so viele Zeilen je Abruf. Der Verlauf einer langen Betreuung
 * hat schnell tausende Tagesberichte; wer weiter zurueck will, grenzt den
 * Zeitraum ein (der Client bietet das an, sobald "gekuerzt" kommt).
 */
const MAX_ZEILEN = 400;

/**
 * Wie lange die Autor:in den eigenen Eintrag ohne Grund korrigieren darf.
 * Danach (und fuer fremde Eintraege immer) nur mit dem Recht
 * verlauf.korrigieren-fremde und mit Grund -- ein Eintrag ist Nachweis
 * gegenueber dem Amt, eine spaete stille Korrektur waere keiner mehr.
 */
const FREIE_KORREKTUR_STUNDEN = 24;

const EINTRAG_AUSWAHL = `
  SELECT e.*, a.name AS autor_name, ev.name AS entschieden_von_name,
    (SELECT count(*)::int FROM klient_eintrag_aenderung x WHERE x.eintrag_id = e.id) AS anzahl_korrekturen,
    COALESCE((SELECT json_agg(json_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
              FROM klient_eintrag_teilnehmer t JOIN benutzer b ON b.id = t.benutzer_id
              WHERE t.eintrag_id = e.id), '[]') AS teilnehmende,
    (SELECT json_build_object('id', g.id, 'faelligAm', g.faellig_am, 'erledigt', g.erledigt_am IS NOT NULL)
     FROM aufgabe g WHERE g.klient_eintrag_id = e.id ORDER BY g.erstellt_am LIMIT 1) AS aufgabe
  FROM klient_eintrag e
  LEFT JOIN benutzer a ON a.id = e.autor_id
  LEFT JOIN benutzer ev ON ev.id = e.entschieden_von_id
`;

function iso(wert: unknown): string {
  return wert instanceof Date ? wert.toISOString() : String(wert);
}

@Injectable()
export class VerlaufService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async rechteFuerMich(): Promise<VerlaufRechteDto> {
    const [ansehen, anlegen, entscheidungenAnlegen, korrigierenFremde] = await Promise.all([
      this.rechte.hatRecht("verlauf", "ansehen"),
      this.rechte.hatRecht("verlauf", "anlegen"),
      this.rechte.hatRecht("verlauf", "entscheidungen-anlegen"),
      this.rechte.hatRecht("verlauf", "korrigieren-fremde"),
    ]);
    return { ansehen, anlegen, entscheidungenAnlegen, korrigierenFremde };
  }

  /**
   * Der Verlauf einer Klient:in: gespeicherte Eintraege plus Ereignisse, die
   * beim Lesen aus ihren Quelltabellen abgeleitet werden. Eine abgeleitete
   * Quelle erscheint nur, wenn man sie auch an ihrem eigentlichen Ort sehen
   * duerfte (Kostenuebernahmen, Protokolle) -- der Verlauf ist kein
   * Seiteneingang an Rechten vorbei.
   */
  async verlauf(klientId: string, zeitraum: { von?: string; bis?: string } = {}): Promise<VerlaufDto> {
    const { benutzerId } = requireTenantContext();
    const r = await this.rechteFuerMich();
    if (!r.ansehen) throw new ForbiddenException("Keine Berechtigung, den Verlauf anzusehen.");
    const [kuAnsehen, protokolleAnsehen] = await Promise.all([
      this.rechte.hatRecht("kostenuebernahmen", "ansehen"),
      this.rechte.hatRecht("protokolle", "ansehen"),
    ]);

    return this.db.withTenant(async (client) => {
      await pruefeKlient(client, benutzerId, klientId);
      // Grenzen als Datum, inklusiv. Zeitpunkte vergleichen wir in
      // Europe/Berlin, sonst rutscht ein Eintrag um 0:30 Uhr in den Vortag.
      const von = zeitraum.von ?? "0001-01-01";
      const bis = zeitraum.bis ?? "9999-12-31";
      const zeilen: VerlaufZeileDto[] = [];

      // 1. Gespeicherte Eintraege
      const { rows: eintraege } = await client.query(
        `${EINTRAG_AUSWAHL}
         WHERE e.klient_id = $1 AND (e.zeitpunkt AT TIME ZONE 'Europe/Berlin')::date BETWEEN $2 AND $3
         ORDER BY e.zeitpunkt DESC LIMIT ${MAX_ZEILEN + 1}`,
        [klientId, von, bis]
      );
      for (const e of eintraege) {
        const dto = eintragDto(e, benutzerId, r.korrigierenFremde);
        zeilen.push({
          schluessel: `${dto.art}:${dto.id}`,
          quelle: dto.art,
          zeitpunkt: dto.zeitpunkt,
          ganztaegig: false,
          titel: eintragTitel(dto),
          text: dto.text,
          autorName: dto.autorName,
          bezugId: null,
          eintrag: dto,
        });
      }

      // 2. Tagesberichte (Dokumentation). Der Zeitpunkt ist das Anlegen, wenn
      // es am Berichtstag geschah -- sonst nur der Tag (nachgetragen).
      const { rows: berichte } = await client.query(
        `SELECT t.id, t.datum, t.text, t.erstellt_am, b.name AS autor_name,
                (t.erstellt_am AT TIME ZONE 'Europe/Berlin')::date = t.datum AS am_tag,
                COALESCE((SELECT json_agg(json_build_object(
                    'name', f.name, 'definition', v.definition,
                    'werte', (SELECT COALESCE(jsonb_object_agg(w.feld_schluessel, COALESCE(
                                to_jsonb(w.wert_text), to_jsonb(w.wert_zahl), to_jsonb(w.wert_datum::text),
                                to_jsonb(left(w.wert_zeit::text, 5)), to_jsonb(w.wert_bool), to_jsonb(w.wert_liste))), '{}')
                              FROM protokoll_wert w WHERE w.protokoll_id = p.id)) ORDER BY f.name)
                  FROM protokoll p JOIN formular_version v ON v.id = p.formular_version_id JOIN formular f ON f.id = v.formular_id
                  WHERE p.tagesbericht_id = t.id), '[]') AS formulare
         FROM tagesbericht t LEFT JOIN benutzer b ON b.id = t.autor_id
         WHERE t.klient_id = $1 AND t.datum BETWEEN $2 AND $3
         ORDER BY t.datum DESC, t.erstellt_am DESC LIMIT ${MAX_ZEILEN + 1}`,
        [klientId, von, bis]
      );
      for (const t of berichte) {
        const formulare = (t.formulare as { name: string; definition: FormularDefinition; werte: FeldWerte }[]) ?? [];
        const kurz = formulare.map((f) => protokollKurzfassung(f.definition, f.werte)).filter(Boolean);
        const text = [String(t.text ?? "").trim(), ...kurz].filter(Boolean).join(" · ");
        zeilen.push({
          schluessel: `tagesbericht:${t.id}`,
          quelle: "tagesbericht",
          zeitpunkt: t.am_tag ? iso(t.erstellt_am) : `${t.datum}T12:00:00.000Z`,
          ganztaegig: !t.am_tag,
          titel: formulare.length > 0 ? formulare.map((f) => f.name).join(", ") : "Tagesbericht",
          text: text || null,
          autorName: t.autor_name,
          bezugId: t.id,
          eintrag: null,
        });
      }

      // 3. Eigenstaendige Protokolle (nicht an einem Tagesbericht -- die
      // stehen schon in dessen Zeile).
      if (protokolleAnsehen) {
        const { rows: protokolle } = await client.query(
          `SELECT p.id, p.abgeschlossen_am, f.name, v.definition, b.name AS autor_name,
                  (SELECT COALESCE(jsonb_object_agg(w.feld_schluessel, COALESCE(
                      to_jsonb(w.wert_text), to_jsonb(w.wert_zahl), to_jsonb(w.wert_datum::text),
                      to_jsonb(left(w.wert_zeit::text, 5)), to_jsonb(w.wert_bool), to_jsonb(w.wert_liste))), '{}')
                   FROM protokoll_wert w WHERE w.protokoll_id = p.id) AS werte
           FROM protokoll p
           JOIN formular_version v ON v.id = p.formular_version_id
           JOIN formular f ON f.id = v.formular_id
           LEFT JOIN benutzer b ON b.id = p.autor_id
           WHERE p.klient_id = $1 AND p.tagesbericht_id IS NULL AND p.abgeschlossen_am IS NOT NULL
             AND (p.abgeschlossen_am AT TIME ZONE 'Europe/Berlin')::date BETWEEN $2 AND $3
           ORDER BY p.abgeschlossen_am DESC LIMIT ${MAX_ZEILEN + 1}`,
          [klientId, von, bis]
        );
        for (const p of protokolle) {
          zeilen.push({
            schluessel: `protokoll:${p.id}`,
            quelle: "protokoll",
            zeitpunkt: iso(p.abgeschlossen_am),
            ganztaegig: false,
            titel: p.name,
            text: protokollKurzfassung(p.definition, p.werte) || null,
            autorName: p.autor_name,
            bezugId: p.id,
            eintrag: null,
          });
        }
      }

      // 4. Belegung: Einzug und Auszug (nur was schon eingetreten ist).
      const { rows: belegungen } = await client.query(
        `SELECT b.id, b.einzug, b.auszug, z.nummer, s.name AS standort
         FROM belegung b JOIN zimmer z ON z.id = b.zimmer_id JOIN standort s ON s.id = z.standort_id
         WHERE b.klient_id = $1`,
        [klientId]
      );
      const heute = await heuteDatum(client);
      for (const b of belegungen) {
        if (b.einzug <= heute && b.einzug >= von && b.einzug <= bis) {
          zeilen.push(ganztag(`belegung:${b.id}:einzug`, "belegung", b.einzug, `Einzug in Zimmer ${b.nummer}, ${b.standort}`));
        }
        if (b.auszug && b.auszug <= heute && b.auszug >= von && b.auszug <= bis) {
          zeilen.push(ganztag(`belegung:${b.id}:auszug`, "belegung", b.auszug, `Auszug aus Zimmer ${b.nummer}, ${b.standort}`));
        }
      }

      // 5. Kostenuebernahmen: Beginn und Ende.
      if (kuAnsehen) {
        const { rows: ku } = await client.query("SELECT id, amt, von, bis FROM kostenuebernahme WHERE klient_id = $1", [klientId]);
        for (const k of ku) {
          if (k.von <= heute && k.von >= von && k.von <= bis) {
            zeilen.push(ganztag(`kostenuebernahme:${k.id}:von`, "kostenuebernahme", k.von, `Kostenübernahme beginnt (${k.amt})`));
          }
          if (k.bis && k.bis <= heute && k.bis >= von && k.bis <= bis) {
            zeilen.push(ganztag(`kostenuebernahme:${k.id}:bis`, "kostenuebernahme", k.bis, `Kostenübernahme endet (${k.amt})`));
          }
        }
      }

      // 6. Hilfeplan: Beginn eines Hilfeplanzeitraums.
      const { rows: hp } = await client.query("SELECT id, von FROM hilfeplan WHERE klient_id = $1", [klientId]);
      for (const h of hp) {
        if (h.von <= heute && h.von >= von && h.von <= bis) {
          zeilen.push(ganztag(`hilfeplan:${h.id}`, "hilfeplan", h.von, "Neuer Hilfeplan beginnt"));
        }
      }

      // 7. Archivierung der Akte.
      const { rows: akte } = await client.query("SELECT archiviert_am FROM klient WHERE id = $1", [klientId]);
      if (akte[0]?.archiviert_am) {
        const am = iso(akte[0].archiviert_am);
        const tag = am.slice(0, 10);
        if (tag >= von && tag <= bis) {
          zeilen.push({ schluessel: `akte:${klientId}:archiviert`, quelle: "akte", zeitpunkt: am, ganztaegig: false, titel: "Akte archiviert", text: null, autorName: null, bezugId: null, eintrag: null });
        }
      }

      zeilen.sort((a, b) => (a.zeitpunkt < b.zeitpunkt ? 1 : a.zeitpunkt > b.zeitpunkt ? -1 : a.schluessel.localeCompare(b.schluessel)));
      const gekuerzt = zeilen.length > MAX_ZEILEN;

      return { zeilen: zeilen.slice(0, MAX_ZEILEN), wiedervorlagen: await wiedervorlagen(client, klientId), gekuerzt };
    });
  }

  async anlegen(klientId: string, input: KlientEintragAnlegenDto): Promise<KlientEintragDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    const r = await this.rechteFuerMich();
    if (!r.anlegen) throw new ForbiddenException("Keine Berechtigung, Einträge im Verlauf anzulegen.");
    if (input.art === "entscheidung" && !r.entscheidungenAnlegen) {
      throw new ForbiddenException("Entscheidungen dürfen nur Personen mit dem passenden Recht eintragen.");
    }
    const zeitpunkt = input.zeitpunkt ? new Date(input.zeitpunkt) : new Date();
    // Fuenf Minuten Spielraum fuer abweichende Geraeteuhren.
    if (zeitpunkt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException("Ein Eintrag darf nicht in der Zukunft liegen.");
    }
    if (input.aufgabeFaelligAm !== undefined && !input.naechsterSchritt?.trim()) {
      throw new BadRequestException("Für eine Aufgabe bitte den nächsten Schritt angeben.");
    }

    return this.db.withTenant(async (client) => {
      await pruefeKlient(client, benutzerId, klientId);
      if (await klientIstArchiviert(client, klientId)) {
        throw new BadRequestException("Diese Akte ist archiviert. Neue Einträge sind erst nach dem Entarchivieren möglich.");
      }
      const telefonat = input.art === "telefonat";
      const gespraech = input.art === "gespraech";
      const entscheidung = input.art === "entscheidung";
      const notiz = input.art === "notiz";
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO klient_eintrag
           (mandant_id, klient_id, art, zeitpunkt, text, gegenueber, richtung, dauer_minuten, gespraech_art,
            ergebnis, entschieden_von_id, wiedervorlage_am, naechster_schritt, autor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          mandantId,
          klientId,
          input.art,
          zeitpunkt.toISOString(),
          input.text.trim(),
          notiz ? null : leerZuNull(input.gegenueber),
          telefonat ? (input.richtung ?? "eingehend") : null,
          telefonat ? (input.dauerMinuten ?? null) : null,
          gespraech ? (input.gespraechArt ?? "sonstiges") : null,
          gespraech || entscheidung ? leerZuNull(input.ergebnis) : null,
          entscheidung ? (input.entschiedenVonId ?? benutzerId) : null,
          entscheidung ? (input.wiedervorlageAm ?? null) : null,
          notiz ? null : leerZuNull(input.naechsterSchritt),
          benutzerId,
        ]
      );
      const id = rows[0].id;
      if (gespraech) {
        for (const tid of new Set(input.teilnehmendeIds ?? [])) {
          await client.query(
            "INSERT INTO klient_eintrag_teilnehmer (mandant_id, eintrag_id, benutzer_id) VALUES ($1, $2, $3)",
            [mandantId, id, tid]
          );
        }
      }
      // Die Aufgabe nennt nur den Schritt, nicht die Klient:in: Aufgaben sieht
      // ein anderer Personenkreis als die Akte. Der Bezug steckt in der Spalte.
      if (!notiz && input.aufgabeFaelligAm !== undefined && input.naechsterSchritt?.trim()) {
        await client.query(
          `INSERT INTO aufgabe (mandant_id, titel, faellig_am, zugewiesen_an, erstellt_von, klient_eintrag_id)
           VALUES ($1, $2, $3, $4, $4, $5)`,
          [mandantId, input.naechsterSchritt.trim(), input.aufgabeFaelligAm || null, benutzerId, id]
        );
      }
      return ladeEintrag(client, id, benutzerId, r.korrigierenFremde);
    });
  }

  async korrigieren(eintragId: string, input: { text: string; grund?: string }): Promise<KlientEintragDto> {
    const { benutzerId } = requireTenantContext();
    const r = await this.rechteFuerMich();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query(
        "SELECT klient_id, autor_id, erstellt_am FROM klient_eintrag WHERE id = $1",
        [eintragId]
      );
      if (!rows[0] || !r.ansehen) throw new NotFoundException("Eintrag nicht gefunden.");
      await pruefeKlient(client, benutzerId, rows[0].klient_id);
      if (await klientIstArchiviert(client, rows[0].klient_id)) {
        throw new BadRequestException("Diese Akte ist archiviert und kann nicht mehr bearbeitet werden.");
      }
      const k = korrekturRegel(rows[0], benutzerId, r.korrigierenFremde);
      if (!k.erlaubt) throw new ForbiddenException("Diesen Eintrag darfst du nicht mehr korrigieren.");
      if (k.brauchtGrund && !input.grund?.trim()) {
        throw new BadRequestException("Bitte einen Grund für die Korrektur angeben.");
      }
      // Den Grund liest der Trigger (Migration 0078); gilt nur in dieser Transaktion.
      await client.query("SELECT set_config('app.korrektur_grund', $1, true)", [input.grund?.trim() ?? ""]);
      await client.query("UPDATE klient_eintrag SET text = $2 WHERE id = $1", [eintragId, input.text.trim()]);
      return ladeEintrag(client, eintragId, benutzerId, r.korrigierenFremde);
    });
  }

  async historie(eintragId: string): Promise<KlientEintragAenderungDto[]> {
    const { benutzerId } = requireTenantContext();
    const r = await this.rechteFuerMich();
    if (!r.ansehen) throw new NotFoundException("Eintrag nicht gefunden.");
    return this.db.withTenant(async (client) => {
      const { rows: e } = await client.query("SELECT klient_id FROM klient_eintrag WHERE id = $1", [eintragId]);
      if (!e[0]) throw new NotFoundException("Eintrag nicht gefunden.");
      await pruefeKlient(client, benutzerId, e[0].klient_id);
      const { rows } = await client.query(
        `SELECT a.id, a.geaendert_am, b.name AS von, a.text_alt, a.text_neu, a.grund
         FROM klient_eintrag_aenderung a LEFT JOIN benutzer b ON b.id = a.geaendert_von
         WHERE a.eintrag_id = $1 ORDER BY a.geaendert_am DESC`,
        [eintragId]
      );
      return rows.map((x) => ({
        id: x.id,
        geaendertAm: iso(x.geaendert_am),
        geaendertVonName: x.von,
        textAlt: x.text_alt,
        textNeu: x.text_neu,
        grund: x.grund,
      }));
    });
  }
}

async function pruefeKlient(client: PoolClient, benutzerId: string, klientId: string): Promise<void> {
  const { rows } = await client.query("SELECT 1 FROM klient WHERE id = $1", [klientId]);
  if (rows.length === 0 || !(await klientIstErlaubt(client, benutzerId, klientId))) {
    throw new NotFoundException("Klient nicht gefunden.");
  }
}

async function heuteDatum(client: PoolClient): Promise<string> {
  const { rows } = await client.query("SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS heute");
  return rows[0].heute;
}

function ganztag(schluessel: string, quelle: VerlaufZeileDto["quelle"], datum: string, titel: string): VerlaufZeileDto {
  // Mittag UTC: sortiert innerhalb des Tages hinter Fruehes und vor Spaetes,
  // und kein Zeitzonenversatz kann das Datum kippen.
  return { schluessel, quelle, zeitpunkt: `${datum}T12:00:00.000Z`, ganztaegig: true, titel, text: null, autorName: null, bezugId: null, eintrag: null };
}

function leerZuNull(wert: string | undefined): string | null {
  const t = wert?.trim();
  return t ? t : null;
}

function korrekturRegel(
  e: { autor_id: string; erstellt_am: Date | string },
  benutzerId: string,
  korrigierenFremde: boolean
): { erlaubt: boolean; brauchtGrund: boolean } {
  const frisch = Date.now() - new Date(e.erstellt_am).getTime() < FREIE_KORREKTUR_STUNDEN * 3600 * 1000;
  if (e.autor_id === benutzerId && frisch) return { erlaubt: true, brauchtGrund: false };
  if (korrigierenFremde) return { erlaubt: true, brauchtGrund: true };
  return { erlaubt: false, brauchtGrund: false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eintragDto(e: any, benutzerId: string, korrigierenFremde: boolean): KlientEintragDto {
  const regel = korrekturRegel(e, benutzerId, korrigierenFremde);
  return {
    id: e.id,
    klientId: e.klient_id,
    art: e.art,
    zeitpunkt: iso(e.zeitpunkt),
    text: e.text,
    gegenueber: e.gegenueber,
    richtung: e.richtung,
    dauerMinuten: e.dauer_minuten,
    gespraechArt: e.gespraech_art,
    ergebnis: e.ergebnis,
    entschiedenVonId: e.entschieden_von_id,
    entschiedenVonName: e.entschieden_von_name,
    wiedervorlageAm: e.wiedervorlage_am,
    naechsterSchritt: e.naechster_schritt,
    teilnehmende: e.teilnehmende ?? [],
    autorName: e.autor_name,
    erstelltAm: iso(e.erstellt_am),
    anzahlKorrekturen: e.anzahl_korrekturen,
    korrigierbar: regel.erlaubt,
    korrekturBrauchtGrund: regel.brauchtGrund,
    aufgabe: e.aufgabe ?? null,
  };
}

function eintragTitel(e: KlientEintragDto): string {
  switch (e.art) {
    case "telefonat":
      return [e.gegenueber ?? "Telefonat", e.richtung === "ausgehend" ? "ausgehend" : "eingehend"].join(" · ");
    case "gespraech":
      return GESPRAECH_ART_LABEL[e.gespraechArt as GespraechArt] ?? "Gespräch";
    case "entscheidung":
      return "Entscheidung";
    default:
      return "Notiz";
  }
}

async function ladeEintrag(client: PoolClient, id: string, benutzerId: string, korrigierenFremde: boolean): Promise<KlientEintragDto> {
  const { rows } = await client.query(`${EINTRAG_AUSWAHL} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw new NotFoundException("Eintrag nicht gefunden.");
  return eintragDto(rows[0], benutzerId, korrigierenFremde);
}

/**
 * Offene Wiedervorlagen: Entscheidungen mit Datum (ab gestern -- was laenger
 * zurueckliegt, ist erledigt oder vergessen und wird sonst nie leer) und
 * nicht erledigte Aufgaben aus "naechster Schritt".
 */
async function wiedervorlagen(client: PoolClient, klientId: string): Promise<VerlaufWiedervorlageDto[]> {
  const { rows } = await client.query(
    `SELECT 'entscheidung' AS herkunft, e.id AS eintrag_id, e.wiedervorlage_am AS datum, e.text AS titel, e.id::text AS schluessel
     FROM klient_eintrag e
     WHERE e.klient_id = $1 AND e.wiedervorlage_am IS NOT NULL
       AND e.wiedervorlage_am >= (now() AT TIME ZONE 'Europe/Berlin')::date - 1
     UNION ALL
     SELECT 'aufgabe', e.id, g.faellig_am, g.titel, g.id::text
     FROM aufgabe g JOIN klient_eintrag e ON e.id = g.klient_eintrag_id
     WHERE e.klient_id = $1 AND g.erledigt_am IS NULL
     ORDER BY datum NULLS LAST`,
    [klientId]
  );
  return rows.map((x) => ({
    schluessel: `${x.herkunft}:${x.schluessel}`,
    datum: x.datum,
    titel: String(x.titel).length > 140 ? `${String(x.titel).slice(0, 139)}…` : x.titel,
    herkunft: x.herkunft,
    eintragId: x.eintrag_id,
  }));
}
