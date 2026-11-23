import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  alleBausteine,
  istLeitungsRolle,
  platzBeschriftung,
  werteAus,
  type FeldWert,
  type FormularDefinition,
  type ProtokollUnterschriftDto,
  type UnterschriftenBaustein,
  type UnterschriftPlatz,
  type UnterschriftRolle,
} from "@zimmerakte/shared";
import { erkenneBildTyp } from "../common/datei";

/**
 * Unterschriften in Formularen (Migration 0087, Konzept unterschriftenfeld).
 *
 * Wer einen Leitungsplatz unterschreiben darf, folgt aus dem Organigramm --
 * wie die Leitung im Standort-Steckbrief (standort.service.ts), aber enger:
 * es zaehlt der TITEL der Position ("Einrichtungsleitung" bzw.
 * "Bereichsleitung"), nicht nur "steht am Knoten oben". Sonst duerfte z. B.
 * eine Hauswirtschaftsleitung oben am Knoten als Einrichtungsleitung
 * unterschreiben. Stellvertretungen sind ausdruecklich eingeschlossen
 * ("stellv. Einrichtungsleitung" enthaelt den Titel) -- im Urlaub der
 * Leitung unterschreibt sie.
 */

export interface Person {
  id: string;
  name: string;
}

export interface Leitung {
  einrichtungsleitung: Person[];
  bereichsleitung: Person[];
}

const HEUTE_BESETZT = `pb.gueltig_ab <= CURRENT_DATE AND (pb.gueltig_bis IS NULL OR pb.gueltig_bis >= CURRENT_DATE)`;
const ECHTE_POSITION = `p.aktiv AND p.typ = 'linie' AND NOT p.ist_sammelrang AND NOT p.ist_geplant`;

/**
 * Einrichtungsleitung: Positionen am Einrichtungsknoten des Standorts (direkt
 * oder ueber weitere_einheit). Bereichsleitung: Positionen an diesem Knoten
 * oder an einem Knoten DARUEBER (org_unit_closure) -- die Bereichsleitung
 * sitzt meist am Bereichs- oder Traegerknoten. Stellvertretung zuletzt, damit
 * im PDF unter der Linie die Leitung selbst steht.
 */
export async function leitungFuerStandort(client: PoolClient, standortId: string | null): Promise<Leitung> {
  if (!standortId) return { einrichtungsleitung: [], bereichsleitung: [] };
  const { rows } = await client.query<{ rolle: "einrichtungsleitung" | "bereichsleitung"; id: string; name: string; stellv: boolean; reihenfolge: number | null }>(
    `WITH einheit AS (
       SELECT id FROM org_unit WHERE standort_id = $1
     ), oben AS (
       SELECT c.ancestor_id AS id FROM org_unit_closure c WHERE c.descendant_id IN (SELECT id FROM einheit)
     ), kandidat AS (
       SELECT p.id, p.titel, p.reihenfolge, p.org_unit_id AS unit_id FROM org_position p WHERE ${ECHTE_POSITION}
       UNION
       SELECT p.id, p.titel, p.reihenfolge, we.org_unit_id FROM org_position p
         JOIN org_position_weitere_einheit we ON we.position_id = p.id WHERE ${ECHTE_POSITION}
     )
     SELECT DISTINCT
            CASE WHEN k.titel ~* 'bereichsleitung' THEN 'bereichsleitung' ELSE 'einrichtungsleitung' END AS rolle,
            b.id, b.name, (k.titel ~* 'stellv') AS stellv, k.reihenfolge
     FROM kandidat k
     JOIN org_position_besetzung pb ON pb.position_id = k.id AND ${HEUTE_BESETZT}
     JOIN benutzer b ON b.id = pb.benutzer_id AND b.aktiv
     WHERE (k.titel ~* 'einrichtungsleitung' AND k.unit_id IN (SELECT id FROM einheit))
        OR (k.titel ~* 'bereichsleitung' AND k.unit_id IN (SELECT id FROM oben))`,
    [standortId]
  );
  rows.sort(
    (a, b) => Number(a.stellv) - Number(b.stellv) || (a.reihenfolge ?? 2147483647) - (b.reihenfolge ?? 2147483647) || a.name.localeCompare(b.name, "de")
  );
  const out: Leitung = { einrichtungsleitung: [], bereichsleitung: [] };
  for (const r of rows) {
    if (!out[r.rolle].some((p) => p.id === r.id)) out[r.rolle].push({ id: r.id, name: r.name });
  }
  return out;
}

/**
 * Standort eines Protokolls = eigener Standort (Standort-Dokument) oder
 * Belegung der Klient:in am Bezugstag -- dieselbe Regel wie PROTOKOLL_STANDORT
 * in protokoll.service.ts.
 */
export async function standortVonProtokoll(client: PoolClient, protokollId: string): Promise<string | null> {
  const { rows } = await client.query<{ standort_id: string | null }>(
    `SELECT COALESCE(p.standort_id, (SELECT z.standort_id FROM belegung b JOIN zimmer z ON z.id = b.zimmer_id
       WHERE b.klient_id = p.klient_id AND b.einzug <= p.bezugsdatum AND (b.auszug IS NULL OR b.auszug > p.bezugsdatum)
       ORDER BY b.einzug DESC LIMIT 1)) AS standort_id
     FROM protokoll p WHERE p.id = $1`,
    [protokollId]
  );
  return rows[0]?.standort_id ?? null;
}

/** Alle sichtbaren Plaetze in Formularreihenfolge. Ein ausgeblendeter Unterschriften-Block hat keine Plaetze. */
export function sichtbarePlaetze(def: FormularDefinition, werte: Record<string, FeldWert>): { b: UnterschriftenBaustein; p: UnterschriftPlatz }[] {
  const { sichtbar } = werteAus(def, werte);
  const out: { b: UnterschriftenBaustein; p: UnterschriftPlatz }[] = [];
  for (const b of alleBausteine(def)) {
    if (b.typ !== "unterschriften" || !sichtbar.has(b.schluessel) || !Array.isArray(b.plaetze)) continue;
    for (const p of b.plaetze) out.push({ b, p });
  }
  return out;
}

/** Pruefsumme des Inhalts, auf den sich eine Unterschrift bezieht: Werte nach Schluessel sortiert. */
export function inhaltHash(werte: Record<string, FeldWert>): string {
  const sortiert = Object.keys(werte)
    .sort()
    .map((k) => [k, werte[k]]);
  return createHash("sha256").update(JSON.stringify(sortiert)).digest("hex");
}

export function pruefnummerAus(bildHash: string, inhalt: string): string {
  const h = createHash("sha256").update(`${bildHash}:${inhalt}`).digest("hex").slice(0, 8).toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

interface Zeile {
  baustein: string;
  platz: string;
  rolle: UnterschriftRolle;
  benutzer_name: string | null;
  name_frei: string | null;
  ort: string | null;
  bild: Buffer;
  bild_hash: string;
  inhalt_hash: string;
  unterschrieben_am: Date;
  vor_aenderung: boolean;
}

export async function geleisteteLesen(client: PoolClient, protokollId: string): Promise<Map<string, Zeile>> {
  const { rows } = await client.query<Zeile>(
    `SELECT u.baustein, u.platz, u.rolle, b.name AS benutzer_name, u.name_frei, u.ort, u.bild, u.bild_hash, u.inhalt_hash, u.unterschrieben_am,
            EXISTS (SELECT 1 FROM protokoll_aenderung a WHERE a.protokoll_id = u.protokoll_id AND a.geaendert_am > u.unterschrieben_am) AS vor_aenderung
     FROM protokoll_unterschrift u LEFT JOIN benutzer b ON b.id = u.benutzer_id
     WHERE u.protokoll_id = $1`,
    [protokollId]
  );
  return new Map(rows.map((r) => [`${r.baustein}:${r.platz}`, r]));
}

/**
 * Stand aller Plaetze fuer die Ansicht. Namen werden hier gelesen, nie aus
 * der Definition oder beim Unterschreiben kopiert (ausser bei der eigenen
 * Rolle, die kein Konto hat): nach einer Anonymisierung steht auch unter einer
 * geleisteten Klient:innen-Unterschrift der anonymisierte Name.
 */
export async function unterschriftenFuerAnsicht(
  client: PoolClient,
  e: {
    protokollId: string;
    definition: FormularDefinition;
    werte: Record<string, FeldWert>;
    abgeschlossen: boolean;
    klientName: string | null;
    autorName: string | null;
    benutzerId: string;
    darfAusfuellen: boolean;
  }
): Promise<ProtokollUnterschriftDto[]> {
  const plaetze = sichtbarePlaetze(e.definition, e.werte);
  if (plaetze.length === 0) return [];
  const geleistet = await geleisteteLesen(client, e.protokollId);
  const brauchtLeitung = plaetze.some(({ p }) => istLeitungsRolle(p.rolle));
  const leitung = brauchtLeitung ? await leitungFuerStandort(client, await standortVonProtokoll(client, e.protokollId)) : null;
  return plaetze.map(({ b, p }) => {
    const g = geleistet.get(`${b.schluessel}:${p.id}`);
    const vorgesehen =
      p.rolle === "klient" ? e.klientName : p.rolle === "mitarbeiter" ? e.autorName : p.rolle === "eigene" ? null : (leitung?.[p.rolle][0]?.name ?? null);
    const fuerAndere = p.rolle === "klient" || p.rolle === "eigene";
    const offen = e.abgeschlossen && !g && !p.nurPapier;
    const darfIch =
      offen &&
      (istLeitungsRolle(p.rolle) ? !!leitung?.[p.rolle as "einrichtungsleitung" | "bereichsleitung"].some((x) => x.id === e.benutzerId) : e.darfAusfuellen);
    return {
      baustein: b.schluessel,
      platz: p.id,
      rolle: p.rolle,
      beschriftung: platzBeschriftung(p),
      name: vorgesehen,
      nurPapier: !!p.nurPapier,
      darfIch,
      fuerAndere,
      geleistet: g
        ? {
            am: new Date(g.unterschrieben_am).toISOString(),
            ort: g.ort,
            name: g.rolle === "klient" ? e.klientName : g.rolle === "eigene" ? g.name_frei : g.benutzer_name,
            bild: `data:image/png;base64,${g.bild.toString("base64")}`,
            vorAenderung: g.vor_aenderung,
            pruefnummer: pruefnummerAus(g.bild_hash, g.inhalt_hash),
          }
        : null,
    };
  });
}

/** Hoechstens so gross -- ein gezeichnetes PNG aus SignaturePad hat wenige KB. Passt zum CHECK in 0087. */
export const UNTERSCHRIFT_BILD_MAX = 300_000;

/**
 * Eine Unterschrift speichern. Prueft, was die Datenbank nicht pruefen kann
 * (Organigramm, Rechte, Bildformat); Platz, Rolle, "erst nach dem
 * Abschliessen" und "einmal und nie wieder" sichert zusaetzlich 0087.
 */
export async function unterschriftSpeichern(
  client: PoolClient,
  e: {
    mandantId: string;
    benutzerId: string;
    darfAusfuellen: boolean;
    protokollId: string;
    definition: FormularDefinition;
    werte: Record<string, FeldWert>;
    abgeschlossen: boolean;
    baustein: string;
    platz: string;
    bildBase64: string;
    ort: string | null;
    name: string | null;
  }
): Promise<void> {
  if (!e.abgeschlossen) throw new BadRequestException("Unterschrieben wird erst nach dem Abschließen.");
  const treffer = sichtbarePlaetze(e.definition, e.werte).find(({ b, p }) => b.schluessel === e.baustein && p.id === e.platz);
  if (!treffer) throw new BadRequestException("Diesen Unterschriftsplatz gibt es in diesem Dokument nicht.");
  const { p } = treffer;
  if (p.nurPapier) throw new BadRequestException("Dieser Platz wird nur auf Papier unterschrieben.");

  if (istLeitungsRolle(p.rolle)) {
    const leitung = await leitungFuerStandort(client, await standortVonProtokoll(client, e.protokollId));
    if (!leitung[p.rolle as "einrichtungsleitung" | "bereichsleitung"].some((x) => x.id === e.benutzerId)) {
      throw new ForbiddenException(`Diesen Platz unterschreibt nur die ${platzBeschriftung(p)} selbst, in der eigenen Anmeldung.`);
    }
  } else if (!e.darfAusfuellen) {
    throw new ForbiddenException("Keine Berechtigung, Unterschriften zu erfassen.");
  }

  const kommaIndex = e.bildBase64.indexOf(",");
  const roh = e.bildBase64.startsWith("data:") && kommaIndex !== -1 ? e.bildBase64.slice(kommaIndex + 1) : e.bildBase64;
  const bild = Buffer.from(roh, "base64");
  if (bild.length === 0 || bild.length > UNTERSCHRIFT_BILD_MAX) throw new BadRequestException("Die Unterschrift ist leer oder zu groß.");
  // Nur PNG: der Renderer bettet es per embedPng ein, und der Inhalt muss zur Deklaration passen (datei.ts).
  if (erkenneBildTyp(bild) !== "image/png") throw new BadRequestException("Die Unterschrift muss ein PNG-Bild sein.");

  const name = p.rolle === "eigene" ? e.name?.trim() || null : null;
  const selbst = p.rolle === "mitarbeiter" || istLeitungsRolle(p.rolle);
  try {
    await client.query(
      `INSERT INTO protokoll_unterschrift
         (mandant_id, protokoll_id, baustein, platz, rolle, benutzer_id, erfasst_von, name_frei, ort, bild, bild_hash, inhalt_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        e.mandantId,
        e.protokollId,
        e.baustein,
        e.platz,
        p.rolle,
        selbst ? e.benutzerId : null,
        e.benutzerId,
        name,
        e.ort?.trim() || null,
        bild,
        createHash("sha256").update(bild).digest("hex"),
        inhaltHash(e.werte),
      ]
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new BadRequestException("Dieser Platz ist schon unterschrieben.");
    throw err;
  }
}
