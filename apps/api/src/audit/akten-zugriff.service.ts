import { ForbiddenException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { KlientNamen } from "../common/klient-namen";
import { aktuellerTeilnehmer, requireTenantContext } from "../common/tenant-context";
import { RechteService } from "../rechte/rechte.service";

export interface AktenZugriffEintragDto {
  id: string;
  erstelltAm: string;
  benutzerId: string;
  benutzerName: string;
  klientId: string;
  klientName: string;
  aktion: "akte_geoeffnet" | "archiv_pdf_geladen";
}

export interface AktenZugriffJeBenutzerDto {
  benutzerId: string;
  benutzerName: string;
  anzahl: number;
  anzahlKlienten: number;
  letzterZugriff: string;
}

export interface AktenZugriffAuswertungDto {
  eintraege: AktenZugriffEintragDto[];
  /** Ueber ALLE Treffer des Filters, nicht nur die angezeigte Seite. */
  gesamt: number;
  jeBenutzer: AktenZugriffJeBenutzerDto[];
}

export interface AktenZugriffFilter {
  von?: string;
  bis?: string;
  benutzerId?: string;
  klientId?: string;
  offset: number;
  limit: number;
}

// Nur Lesezugriffe -- Strukturaenderungen im selben audit_log gehoeren zur
// Rechteverwaltung (AuditController) und haben ein eigenes Recht.
const LESE_AKTIONEN = ["akte_geoeffnet", "archiv_pdf_geladen"];

/**
 * Auswertung der Lesezugriffe auf Klientenakten fuer die Leitung. Die Pruefung
 * steht hier neben dem SQL (CLAUDE.md, Rollenpruefungen im Service), nicht nur
 * am Controller: die Auswertung zeigt, wer wann welche Person eingesehen hat.
 */
@Injectable()
export class AktenZugriffService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async auswerten(filter: AktenZugriffFilter): Promise<AktenZugriffAuswertungDto> {
    const ctx = requireTenantContext();
    if (ctx.klientId || !(await this.rechte.hatRecht("klienten", "zugriffsprotokoll"))) {
      throw new ForbiddenException("Keine Berechtigung für das Zugriffsprotokoll.");
    }

    return this.db.withTenant(async (client) => {
      const werte: unknown[] = [LESE_AKTIONEN];
      const bedingungen = ["a.modul = 'klienten'", "a.objekt_typ = 'klient'", "a.aktion = ANY($1)"];
      // Tage nach Berliner Zeit: "heute" aus Sicht der Einrichtung, nicht UTC --
      // sonst fiele ein Zugriff um 00:30 Uhr auf den Vortag.
      if (filter.von) {
        werte.push(filter.von);
        bedingungen.push(`(a.erstellt_am AT TIME ZONE 'Europe/Berlin')::date >= $${werte.length}::date`);
      }
      if (filter.bis) {
        werte.push(filter.bis);
        bedingungen.push(`(a.erstellt_am AT TIME ZONE 'Europe/Berlin')::date <= $${werte.length}::date`);
      }
      if (filter.benutzerId) {
        werte.push(filter.benutzerId);
        bedingungen.push(`a.benutzer_id = $${werte.length}`);
      }
      if (filter.klientId) {
        werte.push(filter.klientId);
        bedingungen.push(`a.objekt_id = $${werte.length}`);
      }
      const where = bedingungen.join(" AND ");

      const seitenWerte = [...werte, filter.limit, filter.offset];
      const { rows } = await client.query(
        `SELECT a.id, a.erstellt_am, a.benutzer_id, bu.name AS benutzer_name, a.aktion,
                k.id AS klient_id, k.vorname, k.nachname
         FROM audit_log a
         JOIN benutzer bu ON bu.id = a.benutzer_id
         JOIN klient k ON k.id = a.objekt_id
         WHERE ${where}
         ORDER BY a.erstellt_am DESC, a.id DESC
         LIMIT $${werte.length + 1} OFFSET $${werte.length + 2}`,
        seitenWerte
      );

      const { rows: summe } = await client.query(
        `SELECT a.benutzer_id, bu.name AS benutzer_name, count(*)::int AS anzahl,
                count(DISTINCT a.objekt_id)::int AS anzahl_klienten, max(a.erstellt_am) AS letzter
         FROM audit_log a
         JOIN benutzer bu ON bu.id = a.benutzer_id
         WHERE ${where}
         GROUP BY a.benutzer_id, bu.name
         ORDER BY anzahl DESC, bu.name`,
        werte
      );

      // Klientennamen werden beim Lesen anonymisiert (CLAUDE.md Regel 6): wer
      // die Person sonst nicht sehen duerfte, bekommt nur Initialen.
      const namen = new KlientNamen(client, aktuellerTeilnehmer());
      const eintraege: AktenZugriffEintragDto[] = [];
      for (const r of rows) {
        eintraege.push({
          id: r.id,
          erstelltAm: r.erstellt_am,
          benutzerId: r.benutzer_id,
          benutzerName: r.benutzer_name,
          klientId: r.klient_id,
          klientName: await namen.name(r.klient_id, r.vorname, r.nachname),
          aktion: r.aktion,
        });
      }

      return {
        eintraege,
        gesamt: summe.reduce((n, s) => n + s.anzahl, 0),
        jeBenutzer: summe.map((s) => ({
          benutzerId: s.benutzer_id,
          benutzerName: s.benutzer_name,
          anzahl: s.anzahl,
          anzahlKlienten: s.anzahl_klienten,
          letzterZugriff: s.letzter,
        })),
      };
    });
  }
}
