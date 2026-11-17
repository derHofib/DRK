/**
 * GET /benutzer liefert je Konto farbIndex (benutzer.service.ts,
 * findeAlleImEigenenMandanten()): Position in der Anlagereihenfolge aller
 * Konten des Traegers, daraus folgt die Personenfarbe im Kalender
 * (apps/web/src/personFarbe.ts). Geprueft wird, was die Farbe stabil haelt:
 * Reihenfolge nach Anlage (nicht nach Name), lueckenlos ab 0, deaktivierte
 * Konten zaehlen mit, und ein zweiter Traeger zaehlt unabhaengig (RLS).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

describe("Benutzer: farbIndex", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);
  const mandanten: { id: string; slug: string }[] = [];

  async function mandantMitKonten(k: string, namen: string[]): Promise<{ slug: string; ids: string[] }> {
    const slug = `test-farbindex-${k}-${suffix}`;
    const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [`Farbindex ${k} ${suffix}`, slug]);
    mandanten.push({ id: rows[0].id, slug });
    const hash = await bcrypt.hash(passwort, 4);
    const ids: string[] = [];
    for (const [i, name] of namen.entries()) {
      // Erste Person mit Vollzugriff (zum Abrufen der Liste), die uebrigen ohne Rechte.
      ids.push(
        i === 0
          ? await kontoMitAlterRolle(admin, { mandantId: rows[0].id, rolle: "bereichsleitung", email: `${k}${i}-${suffix}@beispiel.test`, name, passwortHash: hash })
          : (
              await admin.query<{ id: string }>(
                "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, $3, $4) RETURNING id",
                [rows[0].id, `${k}${i}-${suffix}@beispiel.test`, name, hash]
              )
            ).rows[0].id
      );
      // Anlagezeitpunkte klar getrennt, unabhaengig von der Aufloesung der Uhr.
      await admin.query("UPDATE benutzer SET erstellt_am = now() - make_interval(mins => $2) WHERE id = $1", [ids[i], 100 - i]);
    }
    return { slug, ids };
  }

  async function liste(slug: string, email: string) {
    const login = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug: slug, email, passwort });
    const res = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    return res.body as { id: string; name: string; farbIndex: number }[];
  }

  let a: { slug: string; ids: string[] };
  let b: { slug: string; ids: string[] };

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    // Namen absichtlich NICHT alphabetisch in Anlagereihenfolge.
    a = await mandantMitKonten("a", ["Zora Zuerst", "Anton Zweiter", "Mia Dritte"]);
    b = await mandantMitKonten("b", ["Berta Einzige"]);
    // Deaktiviert zaehlt weiter mit: sonst verschoeben sich alle spaeteren Farben.
    await admin.query("UPDATE benutzer SET aktiv = false WHERE id = $1", [a.ids[1]]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    try {
      for (const m of mandanten) {
        await raeumeKontoMitRolleAuf(admin, m.id);
        await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [m.id]);
        await admin.query("DELETE FROM mandant WHERE id = $1", [m.id]);
      }
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("zaehlt nach Anlage, lueckenlos ab 0, deaktivierte Konten inklusive", async () => {
    const l = await liste(a.slug, `a0-${suffix}@beispiel.test`);
    const index = new Map(l.map((x) => [x.id, x.farbIndex]));
    expect(a.ids.map((id) => index.get(id))).toEqual([0, 1, 2]);
    // Die Liste selbst bleibt nach Namen sortiert -- der Index haengt nicht daran.
    expect(l.map((x) => x.name)).toEqual(["Anton Zweiter", "Mia Dritte", "Zora Zuerst"]);
  });

  it("jeder Traeger zaehlt fuer sich (RLS)", async () => {
    const l = await liste(b.slug, `b0-${suffix}@beispiel.test`);
    expect(l).toHaveLength(1);
    expect(l[0].farbIndex).toBe(0);
  });
});
