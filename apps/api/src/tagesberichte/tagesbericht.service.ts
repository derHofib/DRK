import { Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { requireTenantContext } from "../common/tenant-context";
import { ermittleErlaubteStandortIds, klientIstErlaubt, klientStandortBedingung } from "../common/standort-restriction";

export interface TagDto {
  id: string;
  name: string;
}

export interface TagesberichtDto {
  id: string;
  klientId: string;
  klientName: string;
  autorName: string | null;
  datum: string;
  text: string;
  tags: TagDto[];
}

const AUSWAHL = `
  SELECT
    t.id, t.klient_id, k.vorname, k.nachname, b.name AS autor_name, t.datum, t.text,
    COALESCE(
      json_agg(json_build_object('id', tag.id, 'name', tag.name)) FILTER (WHERE tag.id IS NOT NULL),
      '[]'
    ) AS tags
  FROM tagesbericht t
  JOIN klient k ON k.id = t.klient_id
  LEFT JOIN benutzer b ON b.id = t.autor_id
  LEFT JOIN tagesbericht_tag tt ON tt.tagesbericht_id = t.id
  LEFT JOIN tag ON tag.id = tt.tag_id
`;

@Injectable()
export class TagesberichtService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Ohne klientId: alle Tagesberichte des Mandanten (der allgemeine
   * Menuepunkt). Mit klientId: nur die eines einzelnen Klienten (der Tab
   * in der Klientenakte) -- dieselbe Methode traegt beide Faelle, wie schon
   * bei kassenbuchungenListe(klientId?) etabliert.
   *
   * Standort-Einschraenkung greift in BEIDEN Faellen ueber
   * klientStandortBedingung: ein standortbeschraenkter Betreuer sieht
   * auch im allgemeinen Menuepunkt nur Berichte "ihrer" Klient:innen.
   */
  async findeAlle(klientId?: string): Promise<TagesberichtDto[]> {
    const ctx = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const erlaubteStandorte = await ermittleErlaubteStandortIds(client, ctx.benutzerId);
      const bedingungen: string[] = [];
      const params: unknown[] = [];

      if (klientId) {
        params.push(klientId);
        bedingungen.push(`t.klient_id = $${params.length}`);
      }
      bedingungen.push(klientStandortBedingung(erlaubteStandorte, "k", params));

      const { rows } = await client.query(
        `${AUSWAHL}
         WHERE ${bedingungen.join(" AND ")}
         GROUP BY t.id, k.vorname, k.nachname, b.name
         ORDER BY t.datum DESC, t.erstellt_am DESC`,
        params
      );
      return rows.map(zuDto);
    });
  }

  async anlegen(input: {
    klientId: string;
    datum: string;
    text: string;
    tagNamen?: string[];
  }): Promise<TagesberichtDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      if (!(await klientIstErlaubt(client, benutzerId, input.klientId))) {
        throw new NotFoundException("Klient nicht gefunden.");
      }
      const { rows } = await client.query(
        `INSERT INTO tagesbericht (mandant_id, klient_id, autor_id, datum, text)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mandantId, input.klientId, benutzerId, input.datum, input.text]
      );
      const tagesberichtId = rows[0].id as string;

      for (const name of input.tagNamen ?? []) {
        await tagZuweisen(client, mandantId, tagesberichtId, name);
      }
      return ladeEinen(client, tagesberichtId);
    });
  }

  /**
   * "Ein Tag kann auch nachtraeglich hinzugefuegt werden" -- deshalb ein
   * eigener Endpunkt statt nur beim Anlegen. Bewusst NICHT ueber das
   * REVOKE UPDATE auf tagesbericht selbst betroffen (siehe Migration
   * 0024): das aendert nur die Zuordnungstabelle, nie den Berichtstext.
   */
  async tagHinzufuegen(tagesberichtId: string, name: string): Promise<TagesberichtDto> {
    const { mandantId, benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const klientId = await klientIdDesBerichts(client, tagesberichtId);
      if (!klientId || !(await klientIstErlaubt(client, benutzerId, klientId))) {
        throw new NotFoundException("Tagesbericht nicht gefunden.");
      }
      await tagZuweisen(client, mandantId, tagesberichtId, name);
      return ladeEinen(client, tagesberichtId);
    });
  }

  async tagEntfernen(tagesberichtId: string, tagId: string): Promise<void> {
    const { benutzerId } = requireTenantContext();
    return this.db.withTenant(async (client) => {
      const klientId = await klientIdDesBerichts(client, tagesberichtId);
      if (!klientId || !(await klientIstErlaubt(client, benutzerId, klientId))) {
        throw new NotFoundException("Tagesbericht nicht gefunden.");
      }
      await client.query("DELETE FROM tagesbericht_tag WHERE tagesbericht_id = $1 AND tag_id = $2", [
        tagesberichtId,
        tagId,
      ]);
    });
  }

  /** Vorschlagsliste zum Tippen -- Tags sind mandantweit geteiltes Vokabular,
   * keine klientbezogene Information, deshalb ohne Standort-Einschraenkung. */
  async tagsListe(): Promise<TagDto[]> {
    return this.db.withTenant(async (client) => {
      const { rows } = await client.query<TagDto>("SELECT id, name FROM tag ORDER BY name");
      return rows;
    });
  }
}

async function klientIdDesBerichts(client: PoolClient, tagesberichtId: string): Promise<string | null> {
  const { rows } = await client.query<{ klient_id: string }>("SELECT klient_id FROM tagesbericht WHERE id = $1", [
    tagesberichtId,
  ]);
  return rows[0]?.klient_id ?? null;
}

/**
 * Legt den Tag an, falls es ihn im Mandanten noch nicht gibt, und
 * verknuepft ihn -- "ON CONFLICT DO UPDATE" statt "DO NOTHING", nur damit
 * RETURNING auch im Konfliktfall die vorhandene Zeile liefert (reines
 * Idiom, name aendert sich dabei nicht). Wiederholtes Hinzufuegen
 * desselben Tags ist ein no-op (ON CONFLICT DO NOTHING auf der
 * Zuordnung).
 */
async function tagZuweisen(client: PoolClient, mandantId: string, tagesberichtId: string, name: string) {
  const bereinigt = name.trim();
  if (!bereinigt) return;
  const { rows } = await client.query(
    `INSERT INTO tag (mandant_id, name) VALUES ($1, $2)
     ON CONFLICT (mandant_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [mandantId, bereinigt]
  );
  await client.query(
    `INSERT INTO tagesbericht_tag (mandant_id, tagesbericht_id, tag_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [mandantId, tagesberichtId, rows[0].id]
  );
}

async function ladeEinen(client: PoolClient, id: string): Promise<TagesberichtDto> {
  const { rows } = await client.query(
    `${AUSWAHL} WHERE t.id = $1 GROUP BY t.id, k.vorname, k.nachname, b.name`,
    [id]
  );
  return zuDto(rows[0]);
}

function zuDto(r: any): TagesberichtDto {
  return {
    id: r.id,
    klientId: r.klient_id,
    klientName: `${r.vorname} ${r.nachname}`,
    autorName: r.autor_name,
    datum: r.datum,
    text: r.text,
    tags: r.tags,
  };
}
