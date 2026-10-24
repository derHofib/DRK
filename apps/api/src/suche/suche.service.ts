import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { formatBelegnummer, SucheErgebnisDto, SucheGruppe, SucheTrefferDto } from "@zimmerakte/shared";
import { aktuellerTeilnehmer, requireTenantContext } from "../common/tenant-context";
import { KlientNamen } from "../common/klient-namen";
import {
  ermittleErlaubteStandortIds,
  klientStandortBedingung,
  standortIdBedingung,
} from "../common/standort-restriction";
import { DatabaseService } from "../database/database.service";
import { RechteService } from "../rechte/rechte.service";

const MAX_JE_GRUPPE = 8;

/** Entweder Freitext oder eine feste ID-Liste ("zuletzt geoeffnet") -- gleiche Sichtbarkeitsregeln. */
type Filter = { q: string; ids?: undefined } | { ids: string[]; q?: undefined };

/** LIKE-Metazeichen entschaerfen: Nutzereingabe ist ein Wort, kein Muster. */
function likeMuster(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const leer = (): SucheErgebnisDto => ({ klienten: [], zimmer: [], mitarbeitende: [], belege: [] });

/**
 * Serverseitige Suche fuer die Befehlspalette. Der Client laedt bewusst keine
 * Listen vor -- jede Zeile, die hier herausgeht, ist durch RLS (Mandant),
 * Standort-Beschraenkung und das jeweilige Organigramm-Recht gelaufen. Die
 * Rechtepruefung steht hier neben dem SQL (CLAUDE.md), nicht im Controller.
 */
@Injectable()
export class SucheService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rechte: RechteService
  ) {}

  async suchen(q: string): Promise<SucheErgebnisDto> {
    return this.ausfuehren({ q });
  }

  async zuletztGeoeffnet(eintraege: { gruppe: SucheGruppe; id: string }[]): Promise<SucheErgebnisDto> {
    const je = (g: SucheGruppe) => eintraege.filter((e) => e.gruppe === g).map((e) => e.id);
    return this.ausfuehren(undefined, {
      klienten: je("klienten"),
      zimmer: je("zimmer"),
      mitarbeitende: je("mitarbeitende"),
      belege: je("belege"),
    });
  }

  private async ausfuehren(
    q?: { q: string },
    ids?: Record<SucheGruppe, string[]>
  ): Promise<SucheErgebnisDto> {
    const ctx = requireTenantContext();
    const filter = (g: SucheGruppe): Filter | null => {
      if (q) return q;
      return ids && ids[g].length > 0 ? { ids: ids[g] } : null;
    };
    const darf = {
      klienten: await this.rechte.hatRecht("klienten", "ansehen"),
      zimmer: await this.rechte.hatRecht("zimmer", "ansehen"),
      mitarbeitende: await this.rechte.hatRecht("mitarbeitende", "ansehen"),
      belege: await this.rechte.hatRecht("kassenbuch", "ansehen"),
    };

    return this.db.withTenant(async (client) => {
      const erlaubt = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      const namen = new KlientNamen(client, aktuellerTeilnehmer());
      const ergebnis = leer();
      const f = (g: SucheGruppe) => (darf[g] ? filter(g) : null);

      const fk = f("klienten");
      if (fk) ergebnis.klienten = await this.klienten(client, fk, erlaubt, namen);
      const fz = f("zimmer");
      if (fz) ergebnis.zimmer = await this.zimmer(client, fz, erlaubt);
      const fm = f("mitarbeitende");
      if (fm) ergebnis.mitarbeitende = await this.mitarbeitende(client, fm);
      const fb = f("belege");
      if (fb) ergebnis.belege = await this.belege(client, fb, erlaubt, namen);
      return ergebnis;
    });
  }

  private async klienten(
    client: PoolClient,
    filter: Filter,
    erlaubt: string[] | null,
    namen: KlientNamen
  ): Promise<SucheTrefferDto[]> {
    const params: unknown[] = [];
    const bedingungen = [klientStandortBedingung(erlaubt, "k", params), "k.archiviert_am IS NULL"];
    if (filter.ids) {
      params.push(filter.ids);
      bedingungen.push(`k.id = ANY($${params.length})`);
    } else {
      params.push(likeMuster(filter.q));
      const p = `$${params.length}`;
      bedingungen.push(
        `(k.vorname || ' ' || k.nachname ILIKE ${p} OR k.nachname || ' ' || k.vorname ILIKE ${p} OR k.aktenzeichen ILIKE ${p})`
      );
    }
    const { rows } = await client.query(
      `SELECT k.id, k.vorname, k.nachname, k.aktenzeichen, z.nummer AS zimmer_nummer, s.id AS standort_id, s.name AS standort_name
       FROM klient k
       LEFT JOIN belegung b ON b.klient_id = k.id AND b.einzug <= CURRENT_DATE AND (b.auszug IS NULL OR b.auszug > CURRENT_DATE)
       LEFT JOIN zimmer z ON z.id = b.zimmer_id
       LEFT JOIN standort s ON s.id = z.standort_id
       WHERE ${bedingungen.join(" AND ")}
       ORDER BY k.nachname, k.vorname
       LIMIT ${MAX_JE_GRUPPE}`,
      params
    );
    const treffer: SucheTrefferDto[] = [];
    for (const r of rows) {
      treffer.push({
        gruppe: "klienten",
        id: r.id,
        titel: await namen.name(r.id, r.vorname, r.nachname),
        untertitel: [r.aktenzeichen, r.zimmer_nummer ? `Zimmer ${r.zimmer_nummer}` : null, r.standort_name].filter(Boolean).join(" · "),
        standortId: r.standort_id,
        betragCent: null,
      });
    }
    return treffer;
  }

  private async zimmer(client: PoolClient, filter: Filter, erlaubt: string[] | null): Promise<SucheTrefferDto[]> {
    const params: unknown[] = [];
    const bedingungen = ["z.aktiv", standortIdBedingung(erlaubt, "z.standort_id", params)];
    if (filter.ids) {
      params.push(filter.ids);
      bedingungen.push(`z.id = ANY($${params.length})`);
    } else {
      params.push(likeMuster(filter.q));
      const p = `$${params.length}`;
      bedingungen.push(`(z.nummer ILIKE ${p} OR s.name ILIKE ${p})`);
    }
    const { rows } = await client.query(
      `SELECT z.id, z.nummer, s.id AS standort_id, s.name AS standort_name
       FROM zimmer z JOIN standort s ON s.id = z.standort_id
       WHERE ${bedingungen.join(" AND ")}
       ORDER BY s.name, z.nummer
       LIMIT ${MAX_JE_GRUPPE}`,
      params
    );
    return rows.map((r) => ({
      gruppe: "zimmer" as const,
      id: r.id,
      titel: `Zimmer ${r.nummer}`,
      untertitel: r.standort_name,
      standortId: r.standort_id,
      betragCent: null,
    }));
  }

  private async mitarbeitende(client: PoolClient, filter: Filter): Promise<SucheTrefferDto[]> {
    const params: unknown[] = [];
    const bedingungen = ["b.aktiv"];
    if (filter.ids) {
      params.push(filter.ids);
      bedingungen.push(`b.id = ANY($${params.length})`);
    } else {
      // Gesucht wird auch in der E-Mail, ausgeliefert wird sie nicht.
      params.push(likeMuster(filter.q));
      bedingungen.push(`(b.name ILIKE $${params.length} OR b.email ILIKE $${params.length})`);
    }
    const { rows } = await client.query(
      `SELECT b.id, b.name,
              COALESCE(string_agg(DISTINCT p.titel, ', ') FILTER (WHERE p.id IS NOT NULL), NULL) AS positionen
       FROM benutzer b
       LEFT JOIN org_position_besetzung pb ON pb.benutzer_id = b.id
              AND pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)
       LEFT JOIN org_position p ON p.id = pb.position_id AND p.aktiv
       WHERE ${bedingungen.join(" AND ")}
       GROUP BY b.id, b.name
       ORDER BY b.name
       LIMIT ${MAX_JE_GRUPPE}`,
      params
    );
    return rows.map((r) => ({
      gruppe: "mitarbeitende" as const,
      id: r.id,
      titel: r.name,
      untertitel: r.positionen,
      standortId: null,
      betragCent: null,
    }));
  }

  private async belege(
    client: PoolClient,
    filter: Filter,
    erlaubt: string[] | null,
    namen: KlientNamen
  ): Promise<SucheTrefferDto[]> {
    const params: unknown[] = [];
    // Dieselbe Sichtbarkeit wie die Buchungsliste (KassenbuchungService.findeAlle).
    const klientBed = klientStandortBedingung(erlaubt, "k", params);
    const standortBed = standortIdBedingung(erlaubt, "b.standort_id", params);
    const bedingungen = [`((b.klient_id IS NOT NULL AND ${klientBed}) OR (b.standort_id IS NOT NULL AND ${standortBed}))`];
    if (filter.ids) {
      params.push(filter.ids);
      bedingungen.push(`b.id = ANY($${params.length})`);
    } else {
      const teile: string[] = [];
      params.push(likeMuster(filter.q));
      teile.push(`b.verwendungszweck ILIKE $${params.length}`);
      // "KB-42", "kb42" oder "42" -> genau diese Nummer.
      const nummer = /^(?:kb-?)?(\d{1,9})$/i.exec(filter.q.trim());
      if (nummer) {
        params.push(Number(nummer[1]));
        teile.push(`b.belegnummer = $${params.length}`);
      }
      // "20" oder "20,50" -> Betrag in Euro, Vorzeichen egal (Ein- wie Auszahlung).
      const betrag = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(filter.q.trim());
      if (betrag) {
        params.push(Number(betrag[1]) * 100 + Number((betrag[2] ?? "").padEnd(2, "0") || 0));
        teile.push(`abs(b.betrag_cent) = $${params.length}`);
      }
      bedingungen.push(`(${teile.join(" OR ")})`);
    }
    const { rows } = await client.query(
      `SELECT b.id, b.belegnummer, b.datum, b.betrag_cent, b.verwendungszweck, b.klient_id,
              k.vorname, k.nachname, b.standort_id, s.name AS standort_name
       FROM kassenbuchung b
       LEFT JOIN klient k ON k.id = b.klient_id
       LEFT JOIN standort s ON s.id = b.standort_id
       WHERE ${bedingungen.join(" AND ")}
       ORDER BY b.belegnummer DESC
       LIMIT ${MAX_JE_GRUPPE}`,
      params
    );
    const treffer: SucheTrefferDto[] = [];
    for (const r of rows) {
      const wer = r.klient_id ? await namen.name(r.klient_id, r.vorname, r.nachname) : r.standort_name;
      treffer.push({
        gruppe: "belege",
        id: r.id,
        titel: formatBelegnummer(r.belegnummer),
        untertitel: [r.datum, wer, r.verwendungszweck].filter(Boolean).join(" · "),
        standortId: r.standort_id,
        betragCent: r.betrag_cent,
      });
    }
    return treffer;
  }
}
