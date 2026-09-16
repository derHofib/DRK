import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { BenutzerRolle, requireTenantContext } from "../common/tenant-context";
import { klientIstErlaubt } from "../common/standort-restriction";
import { ArchivPdfInput, erzeugeArchivPdf } from "./klient-archiv-pdf";
import { zuKontaktDto, zuStammdatenDto } from "./klient.service";

// Gleiches Rollenpaar wie bei der Anonymisierung -- Archivieren ist zwar
// (anders als Anonymisierung) reversibel, aber trotzdem eine traegerweite
// Statusaenderung, keine alltaegliche Betreuungsaktion.
const ROLLEN_MIT_ARCHIVIERUNG = new Set<BenutzerRolle>(["bereichsleitung", "einrichtungsleitung"]);

export interface KlientArchivPdfEintrag {
  id: string;
  erstelltAm: string;
  erstelltVonName: string | null;
}

@Injectable()
export class KlientArchivService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Erzeugt den PDF-Snapshot synchron innerhalb der Transaktion, die auch
   * archiviert_am setzt -- dadurch ist ausgeschlossen, dass zwischen dem
   * Datensammeln und dem Einfrieren noch eine Schreiboperation
   * dazwischenkommt (kein separater Job, siehe Architekturhinweis im
   * Umsetzungsplan: keine Warteschlange im Projekt vorhanden, und es ist
   * eine seltene Einzelaktion, kein Volumenpfad).
   */
  async archivieren(klientId: string): Promise<void> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_ARCHIVIERUNG.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen einen Klienten archivieren.");
    }
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, ctx.benutzerId, klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      const { rows: klientRows } = await client.query(
        `SELECT vorname, nachname, geburtsdatum, aktenzeichen, amt, archiviert_am FROM klient WHERE id = $1`,
        [klientId]
      );
      if (klientRows.length === 0) throw new NotFoundException("Klient nicht gefunden.");
      if (klientRows[0].archiviert_am) throw new ConflictException("Klient ist bereits archiviert.");

      const pdfInput = await datenSammeln(client, klientId, klientRows[0], ctx.benutzerId);
      const pdf = await erzeugeArchivPdf(pdfInput);
      const pdfHash = createHash("sha256").update(pdf).digest("hex");

      await client.query(
        `INSERT INTO klient_archiv_pdf (mandant_id, klient_id, erstellt_von, pdf, pdf_hash) VALUES ($1, $2, $3, $4, $5)`,
        [ctx.mandantId, klientId, ctx.benutzerId, pdf, pdfHash]
      );
      await client.query(`UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1`, [
        klientId,
        ctx.benutzerId,
      ]);
    });
  }

  /**
   * Setzt nur archiviert_am/archiviert_von zurueck -- der PDF-Snapshot in
   * klient_archiv_pdf bleibt unangetastet stehen (Beleg, append-only, siehe
   * migrations/0036). Ein erneutes Archivieren spaeter erzeugt einen
   * weiteren, unabhaengigen Snapshot.
   */
  async entarchivieren(klientId: string): Promise<void> {
    const ctx = requireTenantContext();
    if (!ROLLEN_MIT_ARCHIVIERUNG.has(ctx.rolle)) {
      throw new ForbiddenException("Nur Bereichs- oder Einrichtungsleitung dürfen einen Klienten entarchivieren.");
    }
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, ctx.benutzerId, klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      const { rows } = await client.query(
        `UPDATE klient SET archiviert_am = NULL, archiviert_von = NULL WHERE id = $1 AND archiviert_am IS NOT NULL RETURNING id`,
        [klientId]
      );
      if (rows.length === 0) {
        const { rows: vorhanden } = await client.query("SELECT id FROM klient WHERE id = $1", [klientId]);
        if (vorhanden.length === 0) throw new NotFoundException("Klient nicht gefunden.");
        throw new ConflictException("Klient ist nicht archiviert.");
      }
    });
  }

  /**
   * Leseweg, von der Archivsperre unberuehrt (siehe klientIstArchiviert() in
   * common/standort-restriction.ts) -- ein Snapshot muss auch nach dem
   * Entarchivieren weiterhin herunterladbar bleiben.
   */
  async pdfHerunterladen(
    klientId: string,
    archivId: string
  ): Promise<{ pdf: Buffer; hash: string; dateiname: string } | null> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<{ pdf: Buffer; pdf_hash: string; vorname: string; nachname: string }>(
        `SELECT a.pdf, a.pdf_hash, k.vorname, k.nachname
         FROM klient_archiv_pdf a
         JOIN klient k ON k.id = a.klient_id
         WHERE a.id = $1 AND a.klient_id = $2`,
        [archivId, klientId]
      );
      if (rows.length === 0) return null;
      if (!(await klientIstErlaubt(client, benutzerId, klientId))) return null;
      const dateiname = `Aktenauszug_${rows[0].nachname}_${rows[0].vorname}.pdf`.replace(/\s+/g, "_");
      return { pdf: rows[0].pdf, hash: rows[0].pdf_hash, dateiname };
    });
  }
}

async function datenSammeln(
  client: PoolClient,
  klientId: string,
  klient: { vorname: string; nachname: string; geburtsdatum: string | null; aktenzeichen: string; amt: string },
  benutzerId: string
): Promise<ArchivPdfInput> {
  // Aufnahme-/Entlassungsdatum: gleiche Ableitung wie in
  // klient.service.ts::holeDetail() (siehe dortiger Kommentar).
  const { rows: zeitraumRows } = await client.query(
    `SELECT MIN(einzug) AS aufnahme_am,
            CASE WHEN bool_or(auszug IS NULL AND einzug <= CURRENT_DATE) THEN NULL ELSE MAX(auszug) END AS entlassen_am
     FROM belegung WHERE klient_id = $1`,
    [klientId]
  );

  const { rows: stammdatenRows } = await client.query(
    `SELECT ks.*, b.name AS bezugsbetreuer_name
     FROM klient_stammdaten ks
     LEFT JOIN benutzer b ON b.id = ks.bezugsbetreuer_id
     WHERE ks.klient_id = $1`,
    [klientId]
  );

  const { rows: kontaktRows } = await client.query(
    `SELECT id, beziehung, name, adresse, email, telefon FROM klient_kontakt WHERE klient_id = $1 ORDER BY erstellt_am`,
    [klientId]
  );

  const { rows: belegungRows } = await client.query(
    `SELECT s.name AS standort_name, z.nummer AS zimmer_nummer, bel.einzug, bel.auszug
     FROM belegung bel
     JOIN zimmer z ON z.id = bel.zimmer_id
     JOIN standort s ON s.id = z.standort_id
     WHERE bel.klient_id = $1
     ORDER BY bel.einzug`,
    [klientId]
  );

  const { rows: kostenuebernahmeRows } = await client.query(
    `SELECT amt, von, bis FROM kostenuebernahme WHERE klient_id = $1 ORDER BY von`,
    [klientId]
  );

  const { rows: kassenbuchungRows } = await client.query(
    `SELECT b.datum, t.bezeichnung AS typ_bezeichnung,
            CASE WHEN b.betrag_cent < 0 THEN 'auszahlung' ELSE 'einzahlung' END AS richtung,
            ABS(b.betrag_cent) AS betrag_cent, b.verwendungszweck, b.storniert
     FROM kassenbuchung b
     JOIN kassenbuchung_typ t ON t.id = b.typ_id
     WHERE b.klient_id = $1
     ORDER BY b.datum`,
    [klientId]
  );

  const { rows: rechnungRows } = await client.query<{
    erstellt_am: string;
    betrag_cent: number;
    beschreibung: string;
    status: string;
    id: string;
  }>(
    `SELECT r.id, r.erstellt_am, r.betrag_cent, r.beschreibung, sw.status
     FROM rechnung r
     JOIN LATERAL (
       SELECT status FROM rechnung_statuswechsel WHERE rechnung_id = r.id ORDER BY lfd_nr DESC LIMIT 1
     ) sw ON true
     WHERE r.klient_id = $1
     ORDER BY r.erstellt_am`,
    [klientId]
  );
  const rechnungDokumente = await client.query<{
    rechnung_id: string;
    dateiname: string;
    mime_type: string;
    inhalt: Buffer;
  }>(`SELECT rechnung_id, dateiname, mime_type, inhalt FROM rechnung_dokument WHERE rechnung_id = ANY($1)`, [
    rechnungRows.map((r) => r.id),
  ]);
  const rechnungDokumentByRechnungId = new Map(rechnungDokumente.rows.map((d) => [d.rechnung_id, d]));

  const { rows: tagesberichtRows } = await client.query<{
    id: string;
    datum: string;
    text: string;
    autor_name: string | null;
  }>(
    `SELECT t.id, t.datum, t.text, ben.name AS autor_name
     FROM tagesbericht t
     LEFT JOIN benutzer ben ON ben.id = t.autor_id
     WHERE t.klient_id = $1
     ORDER BY t.datum, t.erstellt_am`,
    [klientId]
  );
  const tagesberichtDokumente = await client.query<{
    tagesbericht_id: string;
    dateiname: string;
    mime_type: string;
    inhalt: Buffer;
  }>(
    `SELECT tagesbericht_id, dateiname, mime_type, inhalt FROM tagesbericht_dokument
     WHERE tagesbericht_id = ANY($1) ORDER BY erstellt_am`,
    [tagesberichtRows.map((t) => t.id)]
  );
  const tagesberichtDokumenteById = new Map<string, typeof tagesberichtDokumente.rows>();
  for (const dok of tagesberichtDokumente.rows) {
    const liste = tagesberichtDokumenteById.get(dok.tagesbericht_id) ?? [];
    liste.push(dok);
    tagesberichtDokumenteById.set(dok.tagesbericht_id, liste);
  }

  // "Wer archiviert gerade" -- der handelnde Benutzer selbst, nicht
  // klient.archiviert_von (das wird erst NACH diesem Datensammeln gesetzt,
  // siehe archivieren() oben).
  const { rows: benutzerRows } = await client.query<{ name: string }>("SELECT name FROM benutzer WHERE id = $1", [
    benutzerId,
  ]);

  return {
    klient: {
      vorname: klient.vorname,
      nachname: klient.nachname,
      geburtsdatum: klient.geburtsdatum,
      aktenzeichen: klient.aktenzeichen,
      amt: klient.amt,
      aufnahmeAm: zeitraumRows[0]?.aufnahme_am ?? null,
      entlassenAm: zeitraumRows[0]?.entlassen_am ?? null,
    },
    archiviertAm: new Date().toISOString(),
    archiviertVonName: benutzerRows[0]?.name ?? null,
    stammdaten: stammdatenRows.length > 0 ? zuStammdatenDto(stammdatenRows[0]) : null,
    kontakte: kontaktRows.map(zuKontaktDto),
    belegungen: belegungRows.map((r) => ({
      standortName: r.standort_name,
      zimmerNummer: r.zimmer_nummer,
      einzug: r.einzug,
      auszug: r.auszug,
    })),
    kostenuebernahmen: kostenuebernahmeRows.map((r) => ({ amt: r.amt, von: r.von, bis: r.bis })),
    kassenbuchungen: kassenbuchungRows.map((r) => ({
      datum: r.datum,
      typBezeichnung: r.typ_bezeichnung,
      richtung: r.richtung,
      betragCent: r.betrag_cent,
      verwendungszweck: r.verwendungszweck,
      storniert: r.storniert,
    })),
    rechnungen: rechnungRows.map((r) => {
      const dok = rechnungDokumentByRechnungId.get(r.id);
      return {
        // rechnung.erstellt_am ist timestamptz -- anders als bei "date"-Spalten
        // (siehe database.service.ts, OID 1082) liefert pg dafuer ein echtes
        // Date-Objekt, kein "YYYY-MM-DD"-String. .slice() wuerde hier zur
        // Laufzeit scheitern.
        datum: new Date(r.erstellt_am).toISOString().slice(0, 10),
        betragCent: r.betrag_cent,
        beschreibung: r.beschreibung,
        status: r.status,
        dokument: dok ? { dateiname: dok.dateiname, mimeType: dok.mime_type, inhalt: dok.inhalt } : null,
      };
    }),
    tagesberichte: tagesberichtRows.map((t) => ({
      datum: t.datum,
      autorName: t.autor_name,
      text: t.text,
      dokumente: (tagesberichtDokumenteById.get(t.id) ?? []).map((d) => ({
        dateiname: d.dateiname,
        mimeType: d.mime_type,
        inhalt: d.inhalt,
      })),
    })),
  };
}
