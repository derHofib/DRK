import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  alleBausteine,
  beispielDaten,
  pdfGestaltungMitVorgaben,
  pdfGestaltungVorgabe,
  pdfMitAnschriftfeld,
  STANDORT_ANGEBOTSFORM_LABEL,
  type FeldWerte,
  type FormularDefinition,
  type PdfExportAngebotDto,
  type PdfExportDto,
  type PdfGestaltung,
  type PdfVorlage,
  type PdfZielgruppe,
  type ProtokollDto,
  type StandortAngebotsform,
  type TraegerAngabenDto,
  type TraegerDateiDto,
} from "@zimmerakte/shared";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { heuteBerlin } from "../common/heute";
import { RechteService } from "../rechte/rechte.service";
import { ProtokollService } from "../protokolle/protokoll.service";
import { pdfExportRendern, pdfExportRendernMitBericht, type PdfRenderBericht, type PdfUnterschriftStand } from "./pdf-export-render";

const DATUM_BERLIN = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

/** Stand der Unterschriftsplaetze aus dem Protokoll (Migration 0086) fuer den Renderer. */
function pdfUnterschriften(p: ProtokollDto | null): Record<string, PdfUnterschriftStand> {
  const out: Record<string, PdfUnterschriftStand> = {};
  for (const u of p?.unterschriften ?? []) {
    const g = u.geleistet;
    out[`${u.baustein}:${u.platz}`] = {
      name: g?.name ?? u.name,
      bild: g ? Buffer.from(g.bild.slice(g.bild.indexOf(",") + 1), "base64") : null,
      ort: g?.ort ?? null,
      datum: g ? DATUM_BERLIN.format(new Date(g.am)) : null,
      pruefnummer: g?.pruefnummer ?? null,
    };
  }
  return out;
}

const MASKE = "Beispieltext";
/**
 * Laenge eines echten Werts behalten, Inhalt verwerfen: jedes Zeichen ausser
 * Leerraum wird durch Beispieltext ersetzt. Wortlaengen und Zeilenumbrueche
 * bleiben, damit der Umbruch im PDF derselbe ist.
 */
export function laengeOhneInhalt(text: string): string {
  let i = 0;
  return text.replace(/\S/g, () => MASKE[i++ % MASKE.length]);
}

/**
 * PDF-Exporte je Formular (Migration 0082). Rollenpruefungen stehen hier
 * neben dem SQL (CLAUDE.md):
 *  - Exporte gestalten: protokolle.formulare-verwalten (wer Formulare baut,
 *    entscheidet auch, wie sie auf Papier aussehen).
 *  - Gemeinsame Angaben und Logos aendern: mandanten.branding-bearbeiten
 *    (wie die Traegerfarbe); lesen darf sie auch, wer Exporte gestaltet.
 *  - PDF erzeugen: wer das Protokoll sehen darf; externe Exporte zusaetzlich
 *    protokolle.pdf-extern.
 */

const MAX_LOGO = 2 * 1024 * 1024;

export interface ExportSpeichern {
  name: string;
  zielgruppe: PdfZielgruppe;
  logoId: string | null;
  gestaltung: PdfGestaltung;
}

interface VersionZeile {
  export_id: string;
  formular_id: string;
  ist_standard: boolean;
  stillgelegt_am: string | null;
  kopiert_aus: string | null;
  version_id: string;
  nummer: number;
  name: string;
  zielgruppe: PdfZielgruppe;
  logo_id: string | null;
  gestaltung: unknown;
  gespeichert_am: string;
  gespeichert_von_name: string | null;
  anzahl: number;
  zuletzt: string | null;
}

const EXPORT_AUSWAHL = `
  SELECT e.id AS export_id, e.formular_id, e.ist_standard, e.stillgelegt_am, e.kopiert_aus,
         v.id AS version_id, v.nummer, v.name, v.zielgruppe, v.logo_id, v.gestaltung, v.gespeichert_am,
         b.name AS gespeichert_von_name,
         (SELECT count(*)::int FROM pdf_export_erzeugt z JOIN pdf_export_version vv ON vv.id = z.pdf_export_version_id
           WHERE vv.pdf_export_id = e.id) AS anzahl,
         (SELECT max(z.erzeugt_am) FROM pdf_export_erzeugt z JOIN pdf_export_version vv ON vv.id = z.pdf_export_version_id
           WHERE vv.pdf_export_id = e.id) AS zuletzt
  FROM pdf_export e
  JOIN LATERAL (SELECT * FROM pdf_export_version x WHERE x.pdf_export_id = e.id ORDER BY x.nummer DESC LIMIT 1) v ON true
  LEFT JOIN benutzer b ON b.id = v.gespeichert_von
`;

function exportDto(r: VersionZeile): PdfExportDto {
  return {
    id: r.export_id,
    formularId: r.formular_id,
    name: r.name,
    zielgruppe: r.zielgruppe,
    istStandard: r.ist_standard,
    stillgelegt: r.stillgelegt_am !== null,
    kopiertAus: r.kopiert_aus,
    versionNummer: r.nummer,
    logoId: r.logo_id,
    gestaltung: pdfGestaltungMitVorgaben(r.gestaltung),
    gespeichertAm: new Date(r.gespeichert_am).toISOString(),
    gespeichertVonName: r.gespeichert_von_name,
    anzahlErzeugt: r.anzahl,
    zuletztErzeugtAm: r.zuletzt ? new Date(r.zuletzt).toISOString() : null,
  };
}

function datumDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [j, m, t] = iso.slice(0, 10).split("-");
  return `${t}.${m}.${j}`;
}

/** "Kranzer Str. 6/7, 14199 Berlin" -> "Berlin" (Ort fuer die Datumszeile, wenn der Standort keinen hat). */
function ortAusAnschrift(a: string | null | undefined): string | null {
  const m = a ? /\b\d{5}\s+(.+)$/.exec(a.trim()) : null;
  return m ? m[1].trim() : null;
}

function pruefnummer(teile: string[]): string {
  const h = createHash("sha256").update(teile.join("|")).digest("hex").slice(0, 8).toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

@Injectable()
export class PdfExportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService,
    private readonly protokolle: ProtokollService
  ) {}

  private async brauche(modul: string, aktion: string, meldung: string) {
    if (!(await this.rechte.hatRecht(modul, aktion))) throw new ForbiddenException(meldung);
  }

  private async braucheGestalten() {
    await this.brauche("protokolle", "formulare-verwalten", "Keine Berechtigung, PDF-Exporte zu gestalten.");
  }

  private async braucheAngabenLesen() {
    const [a, b] = await Promise.all([
      this.rechte.hatRecht("protokolle", "formulare-verwalten"),
      this.rechte.hatRecht("mandanten", "branding-bearbeiten"),
    ]);
    if (!a && !b) throw new ForbiddenException("Keine Berechtigung für die Angaben für Dokumente.");
  }

  private async braucheAngabenAendern() {
    await this.brauche("mandanten", "branding-bearbeiten", "Keine Berechtigung, die Angaben für Dokumente zu ändern.");
  }

  async rechteFuerMich(): Promise<{ angabenBearbeiten: boolean; gestalten: boolean; extern: boolean }> {
    const [angabenBearbeiten, gestalten, extern] = await Promise.all([
      this.rechte.hatRecht("mandanten", "branding-bearbeiten"),
      this.rechte.hatRecht("protokolle", "formulare-verwalten"),
      this.rechte.hatRecht("protokolle", "pdf-extern"),
    ]);
    return { angabenBearbeiten, gestalten, extern };
  }

  // -------------------------------------------------------------------------
  // Gemeinsame Angaben
  // -------------------------------------------------------------------------

  async angaben(): Promise<TraegerAngabenDto> {
    await this.braucheAngabenLesen();
    return this.db.withTenant((c) => ladeAngaben(c));
  }

  async angabenSpeichern(a: TraegerAngabenDto): Promise<TraegerAngabenDto> {
    await this.braucheAngabenAendern();
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (c) => {
      const spalten = Object.keys(LEER_ANGABEN) as (keyof TraegerAngabenDto)[];
      const werte = spalten.map((k) => (a[k] && String(a[k]).trim()) || null);
      await c.query(
        `INSERT INTO traeger_angaben (mandant_id, ${spalten.join(", ")}, geaendert_von, geaendert_am)
         VALUES ($1, ${spalten.map((_, i) => `$${i + 2}`).join(", ")}, $${spalten.length + 2}, now())
         ON CONFLICT (mandant_id) DO UPDATE SET ${spalten.map((k) => `${k} = EXCLUDED.${k}`).join(", ")},
           geaendert_von = EXCLUDED.geaendert_von, geaendert_am = now()`,
        [mandantId, ...werte, benutzerId]
      );
      return ladeAngaben(c);
    });
  }

  async dateien(): Promise<TraegerDateiDto[]> {
    await this.braucheAngabenLesen();
    return this.db.withTenant(async (c) => {
      const { rows } = await c.query(
        `SELECT d.id, d.art, d.name, d.mime, d.groesse, d.hochgeladen_am,
                (SELECT count(*)::int FROM pdf_export_version v WHERE v.logo_id = d.id) AS benutzt
         FROM traeger_datei d ORDER BY d.hochgeladen_am`
      );
      return rows.map((r) => ({ id: r.id, art: r.art, name: r.name, mime: r.mime, groesse: r.groesse, hochgeladenAm: new Date(r.hochgeladen_am).toISOString(), benutzt: r.benutzt }));
    });
  }

  /**
   * Logo hochladen. Der Typ wird an den Bytes erkannt, nicht an der Angabe
   * des Browsers (common/datei.ts). SVG wird in PNG umgerechnet und nur so
   * gespeichert: eine SVG-Datei kann Skript enthalten.
   */
  async logoHochladen(name: string, inhalt: Buffer): Promise<TraegerDateiDto> {
    await this.braucheAngabenAendern();
    if (inhalt.length === 0) throw new BadRequestException("Die Datei ist leer.");
    let mime: string;
    let daten = inhalt;
    if (inhalt.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = "image/png";
    else if (inhalt[0] === 0xff && inhalt[1] === 0xd8 && inhalt[2] === 0xff) mime = "image/jpeg";
    else if (inhalt.subarray(0, 5).toString("ascii") === "%PDF-") mime = "application/pdf";
    else if (/<svg[\s>]/i.test(inhalt.subarray(0, 4096).toString("utf8"))) {
      try {
        // 2000 px Hoehe reichen fuer 13 mm Logo bei weit ueber 300 dpi.
        daten = await sharp(inhalt, { density: 600 }).resize({ height: 2000, withoutEnlargement: false }).png().toBuffer();
      } catch {
        throw new BadRequestException("Die SVG-Datei konnte nicht gelesen werden.");
      }
      mime = "image/png";
    } else {
      throw new BadRequestException("Bitte ein Logo als PNG, JPEG, SVG oder PDF hochladen.");
    }
    if (daten.length > MAX_LOGO) throw new BadRequestException("Das Logo ist zu groß (höchstens 2 MB).");
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO traeger_datei (mandant_id, art, name, mime, inhalt, sha256, groesse, hochgeladen_von)
         VALUES ($1, 'logo', $2, $3, $4, $5, $6, $7) RETURNING id, art, name, mime, groesse, hochgeladen_am`,
        [mandantId, name, mime, daten, createHash("sha256").update(daten).digest("hex"), daten.length, benutzerId]
      );
      const r = rows[0];
      return { id: r.id, art: r.art, name: r.name, mime: r.mime, groesse: r.groesse, hochgeladenAm: new Date(r.hochgeladen_am).toISOString(), benutzt: 0 };
    });
  }

  async datei(id: string): Promise<{ mime: string; inhalt: Buffer; name: string }> {
    await this.braucheAngabenLesen();
    return this.db.withTenant(async (c) => {
      const { rows } = await c.query("SELECT mime, inhalt, name FROM traeger_datei WHERE id = $1", [id]);
      if (!rows[0]) throw new NotFoundException("Datei nicht gefunden.");
      return rows[0];
    });
  }

  async dateiLoeschen(id: string): Promise<void> {
    await this.braucheAngabenAendern();
    await this.db.withTenant(async (c) => {
      const { rows } = await c.query("SELECT 1 FROM pdf_export_version WHERE logo_id = $1 LIMIT 1", [id]);
      if (rows[0]) throw new BadRequestException("Das Logo wird in einem PDF-Export benutzt und kann nicht gelöscht werden.");
      const r = await c.query("DELETE FROM traeger_datei WHERE id = $1", [id]);
      if (r.rowCount === 0) throw new NotFoundException("Datei nicht gefunden.");
    });
  }

  // -------------------------------------------------------------------------
  // Exporte eines Formulars
  // -------------------------------------------------------------------------

  async liste(formularId: string): Promise<PdfExportDto[]> {
    await this.braucheGestalten();
    return this.db.withTenant(async (c) => {
      await formularDa(c, formularId);
      const { rows } = await c.query<VersionZeile>(
        `${EXPORT_AUSWAHL} WHERE e.formular_id = $1 ORDER BY e.ist_standard DESC, e.stillgelegt_am NULLS FIRST, e.angelegt_am`,
        [formularId]
      );
      return rows.map(exportDto);
    });
  }

  async einzeln(id: string): Promise<PdfExportDto> {
    await this.braucheGestalten();
    return this.db.withTenant((c) => ladeExport(c, id));
  }

  /** Neuer Export: leer mit Zimmerakte-Vorgabe, oder Kopie eines vorhandenen (auch aus einem anderen Formular). */
  async anlegen(formularId: string, eingabe: { name: string; vorlage?: PdfVorlage; kopieVon?: string }): Promise<PdfExportDto> {
    await this.braucheGestalten();
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (c) => {
      await formularDa(c, formularId);
      let zielgruppe: PdfZielgruppe = eingabe.vorlage === "brief" ? "extern" : "intern";
      let gestaltung: PdfGestaltung = pdfGestaltungVorgabe(eingabe.vorlage ?? "akte");
      // Hat das Formular eigene Unterschriftsplaetze (0086), waere die
      // Absender-Linie am Ende eine zweite, verwirrende Unterschrift.
      const def = (await neuesteDefinition(c, formularId)).definition;
      if (alleBausteine(def).some((b) => b.typ === "unterschriften")) gestaltung = { ...gestaltung, unterschrift: "keine" };
      let logoId: string | null = null;
      let kopiertAus: string | null = null;
      if (eingabe.kopieVon) {
        const quelle = await ladeExport(c, eingabe.kopieVon);
        const { rows } = await c.query<{ name: string }>("SELECT name FROM formular WHERE id = $1", [quelle.formularId]);
        zielgruppe = quelle.zielgruppe;
        // Die Feldauswahl gehoert zum anderen Formular -- deren Schluessel
        // gibt es hier evtl. nicht. Also mit allen Feldern beginnen.
        gestaltung = { ...quelle.gestaltung, felder: quelle.formularId === formularId ? quelle.gestaltung.felder : "alle" };
        logoId = quelle.logoId;
        kopiertAus = `${rows[0]?.name ?? "Formular"} › ${quelle.name}`;
      }
      const { rows } = await c.query<{ id: string }>(
        "INSERT INTO pdf_export (mandant_id, formular_id, kopiert_aus, angelegt_von) VALUES ($1, $2, $3, $4) RETURNING id",
        [mandantId, formularId, kopiertAus, benutzerId]
      );
      await c.query(
        `INSERT INTO pdf_export_version (mandant_id, pdf_export_id, nummer, name, zielgruppe, logo_id, gestaltung, gespeichert_von)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
        [mandantId, rows[0].id, eingabe.name, zielgruppe, logoId, JSON.stringify(gestaltung), benutzerId]
      );
      return ladeExport(c, rows[0].id);
    });
  }

  /** Speichern = neue Version (append-only, Migration 0082). */
  async speichern(id: string, e: ExportSpeichern): Promise<PdfExportDto> {
    await this.braucheGestalten();
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (c) => {
      const alt = await ladeExport(c, id);
      if (e.logoId) await logoDa(c, e.logoId);
      await c.query(
        `INSERT INTO pdf_export_version (mandant_id, pdf_export_id, nummer, name, zielgruppe, logo_id, gestaltung, gespeichert_von)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [mandantId, id, alt.versionNummer + 1, e.name, e.zielgruppe, e.logoId, JSON.stringify(e.gestaltung), benutzerId]
      );
      return ladeExport(c, id);
    });
  }

  async alsStandard(id: string): Promise<PdfExportDto> {
    await this.braucheGestalten();
    return this.db.withTenant(async (c) => {
      const e = await ladeExport(c, id);
      if (e.stillgelegt) throw new BadRequestException("Ein stillgelegter Export kann nicht Standard sein.");
      await c.query("UPDATE pdf_export SET ist_standard = false WHERE formular_id = $1 AND ist_standard", [e.formularId]);
      await c.query("UPDATE pdf_export SET ist_standard = true WHERE id = $1", [id]);
      return ladeExport(c, id);
    });
  }

  async stilllegen(id: string, still: boolean): Promise<PdfExportDto> {
    await this.braucheGestalten();
    return this.db.withTenant(async (c) => {
      const e = await ladeExport(c, id);
      if (still && e.istStandard) throw new BadRequestException("Der Standard-Export kann nicht stillgelegt werden. Machen Sie zuerst einen anderen Export zum Standard.");
      await c.query("UPDATE pdf_export SET stillgelegt_am = $2 WHERE id = $1", [id, still ? new Date() : null]);
      return ladeExport(c, id);
    });
  }

  /**
   * Vorschau im Editor: die UNGESPEICHERTE Gestaltung mit Beispieldaten oder
   * einem echten Protokoll dieses Formulars. Dasselbe Rendern wie beim
   * echten Export; es wird nichts gespeichert und nichts protokolliert.
   */
  async vorschau(
    formularId: string,
    e: ExportSpeichern & { protokollId: string | null; standortId: string | null; empfaenger: string | null }
  ): Promise<Uint8Array> {
    return (await this.vorschauBericht(formularId, e, false)).pdf;
  }

  /**
   * "Passt es?" im Designer: dieselbe Erzeugung wie die Vorschau, aber
   * zurueck geht nur, WELCHE Bausteine nicht passen -- nie ein Inhalt.
   * Mit "laengste" bekommt jedes Textfeld die Laenge (Woerter, Zeilen) seines
   * laengsten Werts aus den letzten 50 Protokollen dieses Formulars, die
   * Buchstaben selbst werden durch Beispieltext ersetzt. So prueft man mit
   * echten Laengen, ohne dass echte Sozialdaten im Designer landen.
   */
  async pruefen(
    formularId: string,
    e: ExportSpeichern & { protokollId: string | null; standortId: string | null; empfaenger: string | null; laengste: boolean }
  ): Promise<{ ueberlauf: string[]; seiten: number }> {
    const r = await this.vorschauBericht(formularId, e, e.laengste);
    return { ueberlauf: r.ueberlauf, seiten: r.seiten };
  }

  private async vorschauBericht(
    formularId: string,
    e: ExportSpeichern & { protokollId: string | null; standortId: string | null; empfaenger: string | null },
    laengste: boolean
  ): Promise<PdfRenderBericht> {
    await this.braucheGestalten();
    let protokoll: ProtokollDto | null = null;
    if (e.protokollId) {
      protokoll = await this.protokolle.detail(e.protokollId);
      if (protokoll.formularId !== formularId) throw new BadRequestException("Das Protokoll gehört zu einem anderen Formular.");
    }
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (c) => {
      if (e.logoId) await logoDa(c, e.logoId);
      const formular = protokoll
        ? { name: protokoll.formularName, version: protokoll.versionNummer, definition: protokoll.definition }
        : await neuesteDefinition(c, formularId);
      const beispiel = protokoll ? null : beispielDaten(formular.definition);
      if (beispiel && laengste) {
        // Kein WHERE mandant_id: RLS (CLAUDE.md Regel 2). Nur Text-Werte, nur
        // die laengste Fassung je Feld, und sie verlaesst diese Funktion nicht.
        const { rows } = await c.query<{ feld_schluessel: string; wert_text: string }>(
          `WITH p AS (
             SELECT p.id FROM protokoll p
               JOIN formular_version v ON v.id = p.formular_version_id
              WHERE v.formular_id = $1
              ORDER BY p.erstellt_am DESC
              LIMIT 50
           )
           SELECT DISTINCT ON (w.feld_schluessel) w.feld_schluessel, w.wert_text
             FROM protokoll_wert w JOIN p ON p.id = w.protokoll_id
            WHERE w.wert_text IS NOT NULL
            ORDER BY w.feld_schluessel, length(w.wert_text) DESC`,
          [formularId]
        );
        for (const r of rows) {
          if (typeof beispiel.werte[r.feld_schluessel] === "string") beispiel.werte[r.feld_schluessel] = laengeOhneInhalt(r.wert_text);
        }
      }
      const kontext = await ladeKontext(c, {
        benutzerId,
        logoId: e.logoId,
        standortId: e.standortId,
        klientId: protokoll?.klientId ?? null,
        bezugsdatum: protokoll?.bezugsdatum ?? null,
      });
      const klient = protokoll
        ? kontext.klient
        : { "klient.name": "Mira Beispiel", "klient.geburtsdatum": "06.05.2004", "klient.aktenzeichen": "AZ-0000" };
      return pdfExportRendernMitBericht({
        gestaltung: e.gestaltung,
        zielgruppe: e.zielgruppe,
        traegerfarbe: kontext.akzentfarbe,
        logo: kontext.logo,
        formular,
        werte: protokoll?.werte ?? beispiel!.werte,
        anzeige: protokoll?.anzeige ?? beispiel!.anzeige,
        personen: protokoll?.personen ?? beispiel!.personen,
        platzhalter: {
          ...kontext.platzhalter,
          ...klient,
          "formular.name": formular.name,
          "formular.version": String(formular.version),
          "protokoll.datum": datumDe(protokoll?.bezugsdatum ?? heuteBerlin()),
          "protokoll.abgeschlossen_von": protokoll?.autorName ?? "A. Beispiel",
          pruefnummer: "0000-0000",
        },
        empfaenger: e.empfaenger ?? (pdfMitAnschriftfeld(e.gestaltung) ? "Bezirksamt Beispiel\nSoziale Dienste\nMusterstraße 1\n10000 Berlin" : null),
        beispiel: !protokoll,
        unterschriften: pdfUnterschriften(protokoll),
      });
    });
  }

  // -------------------------------------------------------------------------
  // Exportieren aus der Akte
  // -------------------------------------------------------------------------

  async angebot(protokollId: string): Promise<PdfExportAngebotDto[]> {
    const p = await this.protokolle.detail(protokollId);
    const extern = await this.rechte.hatRecht("protokolle", "pdf-extern");
    return this.db.withTenant(async (c) => {
      const { rows } = await c.query<VersionZeile>(
        `${EXPORT_AUSWAHL} WHERE e.formular_id = $1 AND e.stillgelegt_am IS NULL ORDER BY e.ist_standard DESC, e.angelegt_am`,
        [p.formularId]
      );
      const vorschlag = await amtVorschlag(c, p.klientId, p.bezugsdatum);
      return rows
        .map(exportDto)
        .filter((x) => x.zielgruppe === "intern" || extern)
        .map((x) => ({
          id: x.id,
          name: x.name,
          zielgruppe: x.zielgruppe,
          istStandard: x.istStandard,
          mitAnschriftfeld: pdfMitAnschriftfeld(x.gestaltung),
          empfaengerVorschlag: vorschlag,
        }));
    });
  }

  async erzeugen(protokollId: string, exportId: string, empfaenger: string | null): Promise<{ pdf: Uint8Array; dateiname: string }> {
    const p = await this.protokolle.detail(protokollId);
    if (!p.abgeschlossen) throw new BadRequestException("Ein PDF gibt es erst, wenn das Protokoll abgeschlossen ist.");
    const extern = await this.rechte.hatRecht("protokolle", "pdf-extern");
    return this.db.withTenant((c) => this.erzeugenIn(c, p, exportId, empfaenger, extern));
  }

  /**
   * Mehrere Dokumente in eine PDF-Datei (Konzept dokumentation-formulare,
   * Bild 4): je Dokument ein Export seines Formulars, hintereinander, jeder
   * mit eigenem Design und eigener Seitenzaehlung.
   *
   * Nur interne Exporte: ein externer braucht einen Empfaenger und gehoert
   * einzeln aus dem Dokument erzeugt -- im Stapel wuerde ein Bericht ans Amt
   * zu leicht mit etwas anderem zusammen verschickt. Alles in einer
   * Transaktion: scheitert ein Dokument, wird auch keins der anderen als
   * erzeugt protokolliert, denn ausgeliefert wird dann ja nichts.
   */
  async sammelErzeugen(eintraege: { protokollId: string; exportId: string }[]): Promise<{ pdf: Uint8Array; dateiname: string }> {
    const protokolle: ProtokollDto[] = [];
    for (const e of eintraege) {
      const p = await this.protokolle.detail(e.protokollId);
      if (!p.abgeschlossen) throw new BadRequestException(`„${p.formularName}“ vom ${datumDe(p.bezugsdatum)} ist noch ein Entwurf.`);
      protokolle.push(p);
    }
    return this.db.withTenant(async (c) => {
      const gesamt = await PDFDocument.create();
      for (const [i, e] of eintraege.entries()) {
        const { pdf } = await this.erzeugenIn(c, protokolle[i], e.exportId, null, false, true);
        const teil = await PDFDocument.load(pdf);
        for (const seite of await gesamt.copyPages(teil, teil.getPageIndices())) gesamt.addPage(seite);
      }
      gesamt.setTitle(`Dokumentation ${heuteBerlin()}`);
      return { pdf: await gesamt.save(), dateiname: `Dokumentation-${heuteBerlin()}-${eintraege.length}-Dokumente.pdf` };
    });
  }

  /** `extern`: darf diese Person externe Exporte erzeugen? */
  private async erzeugenIn(
    c: PoolClient,
    p: ProtokollDto,
    exportId: string,
    empfaenger: string | null,
    extern: boolean,
    sammel = false
  ): Promise<{ pdf: Uint8Array; dateiname: string }> {
    const { mandantId, benutzerId } = requireTenantContext();
    const { rows } = await c.query<VersionZeile>(`${EXPORT_AUSWAHL} WHERE e.id = $1`, [exportId]);
    const r = rows[0];
    // 404 statt 403 fuer fremde Formulare: verraet nichts.
    if (!r || r.formular_id !== p.formularId || r.stillgelegt_am) throw new NotFoundException("PDF-Export nicht gefunden.");
    if (r.zielgruppe === "extern" && sammel) {
      throw new BadRequestException(`„${r.name}“ ist ein Export für Externe – bitte einzeln aus dem Dokument erzeugen.`);
    }
    if (r.zielgruppe === "extern" && !extern) throw new ForbiddenException("Keine Berechtigung, externe PDFs zu erzeugen.");
    const g = pdfGestaltungMitVorgaben(r.gestaltung);
    const kontext = await ladeKontext(c, { benutzerId, logoId: r.logo_id, standortId: p.standortId, klientId: p.klientId, bezugsdatum: p.bezugsdatum });
    const nr = pruefnummer([r.version_id, p.id, JSON.stringify(p.werte)]);
    const pdf = await pdfExportRendern({
      gestaltung: g,
      zielgruppe: r.zielgruppe,
      traegerfarbe: kontext.akzentfarbe,
      logo: kontext.logo,
      formular: { name: p.formularName, version: p.versionNummer, definition: p.definition },
      werte: p.werte as FeldWerte,
      anzeige: p.anzeige,
      personen: p.personen,
      platzhalter: {
        ...kontext.platzhalter,
        ...kontext.klient,
        "formular.name": p.formularName,
        "formular.version": String(p.versionNummer),
        "protokoll.datum": datumDe(p.bezugsdatum),
        "protokoll.abgeschlossen_von": p.autorName,
        pruefnummer: nr,
      },
      empfaenger: pdfMitAnschriftfeld(g) ? empfaenger : null,
      unterschriften: pdfUnterschriften(p),
    });
    await c.query(
      `INSERT INTO pdf_export_erzeugt (mandant_id, pdf_export_version_id, protokoll_id, standort_id, empfaenger, sha256, erzeugt_von)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [mandantId, r.version_id, p.id, kontext.standortId, pdfMitAnschriftfeld(g) ? empfaenger : null, createHash("sha256").update(pdf).digest("hex"), benutzerId]
    );
    const datei = `${p.formularName} ${p.bezugsdatum} ${r.name}`.replace(/[^\p{L}\p{N} ._-]+/gu, "").replace(/\s+/g, "-");
    return { pdf, dateiname: `${datei}.pdf` };
  }
}

// ---------------------------------------------------------------------------

const LEER_ANGABEN: TraegerAngabenDto = {
  name: null,
  hauptsitz: null,
  telefon: null,
  email: null,
  website: null,
  geschaeftsfuehrung: null,
  registergericht: null,
  registernummer: null,
  steuernummer: null,
  bank: null,
  iban: null,
  bic: null,
};

async function ladeAngaben(c: PoolClient): Promise<TraegerAngabenDto> {
  const { rows } = await c.query(`SELECT ${Object.keys(LEER_ANGABEN).join(", ")} FROM traeger_angaben`);
  return { ...LEER_ANGABEN, ...(rows[0] ?? {}) };
}

async function formularDa(c: PoolClient, id: string) {
  const { rows } = await c.query("SELECT 1 FROM formular WHERE id = $1", [id]);
  if (!rows[0]) throw new NotFoundException("Formular nicht gefunden.");
}

async function logoDa(c: PoolClient, id: string) {
  const { rows } = await c.query("SELECT 1 FROM traeger_datei WHERE id = $1 AND art = 'logo'", [id]);
  if (!rows[0]) throw new BadRequestException("Dieses Logo gibt es nicht.");
}

async function ladeExport(c: PoolClient, id: string): Promise<PdfExportDto> {
  const { rows } = await c.query<VersionZeile>(`${EXPORT_AUSWAHL} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw new NotFoundException("PDF-Export nicht gefunden.");
  return exportDto(rows[0]);
}

/** Fuer die Vorschau ohne Protokoll: die Entwicklungsversion, sonst die neueste. */
async function neuesteDefinition(c: PoolClient, formularId: string): Promise<{ name: string; version: number; definition: FormularDefinition }> {
  const { rows } = await c.query(
    `SELECT f.name, v.nummer, v.definition FROM formular f JOIN formular_version v ON v.formular_id = f.id
     WHERE f.id = $1 ORDER BY v.nummer DESC LIMIT 1`,
    [formularId]
  );
  if (!rows[0]) throw new NotFoundException("Formular nicht gefunden.");
  return { name: rows[0].name, version: rows[0].nummer, definition: rows[0].definition };
}

/** Amt aus der zum Datum laufenden Kostenuebernahme -- nur ein Vorschlag fuer die erste Zeile des Anschriftfelds. */
async function amtVorschlag(c: PoolClient, klientId: string | null, datum: string): Promise<string | null> {
  // Standort-Dokumente und solche ohne Zuordnung (Migration 0083) haben kein Amt.
  if (!klientId) return null;
  const { rows } = await c.query<{ amt: string }>(
    `SELECT amt FROM kostenuebernahme WHERE klient_id = $1
     ORDER BY (von <= $2::date AND (bis IS NULL OR bis > $2::date)) DESC, von DESC LIMIT 1`,
    [klientId, datum]
  );
  if (rows[0]?.amt) return rows[0].amt;
  // Ohne Kostenuebernahme: das zustaendige Amt aus den Stammdaten.
  const k = await c.query<{ amt: string | null }>("SELECT amt FROM klient WHERE id = $1", [klientId]);
  return k.rows[0]?.amt?.trim() || null;
}

interface Kontext {
  akzentfarbe: string;
  logo: { mime: string; inhalt: Buffer } | null;
  platzhalter: Record<string, string | null>;
  klient: Record<string, string | null>;
  standortId: string | null;
}

/**
 * Alles, was die Platzhalter fuellt. Der Standort ist der der Belegung zum
 * Protokolldatum (sonst die juengste Belegung) -- so steht im Brief der
 * Absender, bei dem die Klient:in zu der Zeit wohnte.
 */
async function ladeKontext(
  c: PoolClient,
  e: { benutzerId: string; logoId: string | null; standortId: string | null; klientId: string | null; bezugsdatum: string | null }
): Promise<Kontext> {
  const m = await c.query<{ name: string; akzentfarbe: string }>("SELECT name, akzentfarbe FROM mandant");
  const angaben = await ladeAngaben(c);
  const ich = await c.query<{ name: string }>("SELECT name FROM benutzer WHERE id = $1", [e.benutzerId]);
  let logo: Kontext["logo"] = null;
  if (e.logoId) {
    const { rows } = await c.query("SELECT mime, inhalt FROM traeger_datei WHERE id = $1", [e.logoId]);
    if (rows[0]) logo = { mime: rows[0].mime, inhalt: rows[0].inhalt };
  }
  let standortId = e.standortId;
  const klient: Record<string, string | null> = {};
  if (e.klientId) {
    const k = await c.query("SELECT vorname, nachname, geburtsdatum, aktenzeichen FROM klient WHERE id = $1", [e.klientId]);
    if (k.rows[0]) {
      klient["klient.name"] = `${k.rows[0].vorname} ${k.rows[0].nachname}`;
      klient["klient.geburtsdatum"] = datumDe(k.rows[0].geburtsdatum);
      klient["klient.aktenzeichen"] = k.rows[0].aktenzeichen;
    }
    if (!standortId) {
      const b = await c.query<{ standort_id: string }>(
        `SELECT z.standort_id FROM belegung b JOIN zimmer z ON z.id = b.zimmer_id
         WHERE b.klient_id = $1
         ORDER BY (b.einzug <= $2::date AND (b.auszug IS NULL OR b.auszug > $2::date)) DESC, b.einzug DESC LIMIT 1`,
        [e.klientId, e.bezugsdatum ?? heuteBerlin()]
      );
      standortId = b.rows[0]?.standort_id ?? null;
    }
  }
  if (!standortId && !e.klientId) {
    const s = await c.query<{ id: string }>("SELECT id FROM standort ORDER BY name LIMIT 1");
    standortId = s.rows[0]?.id ?? null;
  }
  let st: Record<string, any> | null = null;
  if (standortId) {
    const s = await c.query(
      "SELECT name, angebotsform, strasse, plz, ort, adresse, telefon, email, ik_nummer, kostenstelle FROM standort WHERE id = $1",
      [standortId]
    );
    st = s.rows[0] ?? null;
  }
  const plzOrt = st?.plz && st?.ort ? `${st.plz} ${st.ort}` : null;
  return {
    akzentfarbe: m.rows[0]?.akzentfarbe ?? "#5ec4c0",
    logo,
    standortId: st ? standortId : null,
    klient,
    platzhalter: {
      "traeger.name": angaben.name ?? m.rows[0]?.name ?? null,
      "traeger.hauptsitz": angaben.hauptsitz,
      "traeger.telefon": angaben.telefon,
      "traeger.email": angaben.email,
      "traeger.website": angaben.website,
      "traeger.geschaeftsfuehrung": angaben.geschaeftsfuehrung,
      "traeger.registergericht": angaben.registergericht,
      "traeger.registernummer": angaben.registernummer,
      "traeger.steuernummer": angaben.steuernummer,
      "traeger.bank": angaben.bank,
      "traeger.iban": angaben.iban,
      "traeger.bic": angaben.bic,
      "standort.name": st?.name ?? null,
      "standort.angebotsform": st?.angebotsform ? STANDORT_ANGEBOTSFORM_LABEL[st.angebotsform as StandortAngebotsform] : null,
      "standort.strasse": st?.strasse ?? null,
      "standort.plz_ort": plzOrt,
      "standort.anschrift": st?.adresse ?? null,
      "standort.telefon": st?.telefon ?? null,
      "standort.email": st?.email ?? null,
      "standort.ik": st?.ik_nummer ?? null,
      "standort.kostenstelle": st?.kostenstelle ?? null,
      datum: datumDe(heuteBerlin()),
      ort: st?.ort ?? ortAusAnschrift(angaben.hauptsitz),
      "benutzer.name": ich.rows[0]?.name ?? null,
    },
  };
}
