/**
 * Migration 0067/0068: Sammelrang + Zusammenfuehren mehrfacher
 * "Mitarbeiter"-Positionen je Person, und Rang ändern MIT Standorten.
 *
 * Kern ist der Vorher/Nachher-Vergleich der Rechte-Engine: nach dem
 * Zusammenfuehren muessen die erlaubten Einheiten je Recht und Scope
 * identisch sein -- insbesondere bei "subtree", das von einer Sammelposition
 * am Traeger aus sonst ALLES treffen wuerde.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { RechteService } from "../src/rechte/rechte.service";
import { tenantContextStorage } from "../src/common/tenant-context";

const MIGRATION = readFileSync(join(__dirname, "..", "migrations", "0068_mitarbeiter_zusammenfuehren.sql"), "utf8");

describe("Mitarbeiter zusammenführen und Standorte setzen", () => {
  let app: INestApplication;
  let admin: Client;
  let rechte: RechteService;
  let mandantId: string;
  let mandantSlug: string;
  const passwort = "correct horse battery staple";
  const suffix = randomUUID().slice(0, 8);

  let traegerId: string;
  let einrichtungen: string[] = []; // A, B, C
  let felix: string;
  let anna: string;
  let mitarbeiterTypId: string;
  let tokenGf: string;

  const email = (k: string) => `${k}-${suffix}@zusammen.test`;

  const rechteVon = async (benutzerId: string, modul: string, aktion: string) =>
    new Set(
      await tenantContextStorage.run({ mandantId, benutzerId }, () => rechte.ermittleErlaubteOrgUnitIds(modul, aktion))
    );

  async function neuerBenutzer(label: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO benutzer (mandant_id, email, name, passwort_hash) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, email(label), label, await bcrypt.hash(passwort, 4)]
    );
    return rows[0].id;
  }

  async function neuePosition(orgUnitId: string, titel: string, typId: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO org_position (mandant_id, org_unit_id, titel, account_typ_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [mandantId, orgUnitId, titel, typId]
    );
    return rows[0].id;
  }

  async function besetze(positionId: string, benutzerId: string) {
    await admin.query("INSERT INTO org_position_besetzung (mandant_id, position_id, benutzer_id) VALUES ($1, $2, $3)", [
      mandantId,
      positionId,
      benutzerId,
    ]);
  }

  const laufendeBesetzungen = async (benutzerId: string) =>
    (
      await admin.query<{ position_id: string }>(
        `SELECT position_id FROM org_position_besetzung WHERE benutzer_id = $1
         AND gueltig_ab <= CURRENT_DATE AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)`,
        [benutzerId]
      )
    ).rows.map((r) => r.position_id);

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    mandantSlug = `test-zusammen-${suffix}`;
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Zusammen ${suffix}`, mandantSlug]
    );
    mandantId = rows[0].id;
    traegerId = (
      await admin.query<{ id: string }>("SELECT id FROM org_unit WHERE mandant_id = $1 AND typ = 'traeger'", [mandantId])
    ).rows[0].id;

    const { rows: standorte } = await admin.query<{ id: string }>(
      "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1,'Haus A','x'),($1,'Haus B','x'),($1,'Haus C','x') RETURNING id, name",
      [mandantId]
    );
    const { rows: units } = await admin.query<{ id: string; name: string }>(
      "SELECT id, name FROM org_unit WHERE mandant_id = $1 AND typ = 'einrichtung' ORDER BY name",
      [mandantId]
    );
    einrichtungen = units.map((u) => u.id);
    expect(standorte).toHaveLength(3);

    const gfTyp = (
      await admin.query<{ id: string }>(
        "INSERT INTO account_typ (mandant_id, name, ist_system, ist_vollzugriff) VALUES ($1,'Geschäftsführung',true,true) RETURNING id",
        [mandantId]
      )
    ).rows[0].id;
    mitarbeiterTypId = (
      await admin.query<{ id: string }>(
        "INSERT INTO account_typ (mandant_id, name, ist_system, ist_vollzugriff) VALUES ($1,'Mitarbeiter',true,false) RETURNING id",
        [mandantId]
      )
    ).rows[0].id;
    // Ein "subtree"-Recht ist der Gefahrenfall: von der Wurzel aus alles.
    for (const [modul, aktion, scope] of [
      ["klienten", "ansehen", "einrichtung"],
      ["zimmer", "ansehen", "subtree"],
    ]) {
      await admin.query(
        "INSERT INTO account_typ_recht (mandant_id, account_typ_id, modul, aktion, scope, erlaubt) VALUES ($1,$2,$3,$4,$5,true)",
        [mandantId, mitarbeiterTypId, modul, aktion, scope]
      );
    }

    const gf = await neuerBenutzer("gf");
    await besetze(await neuePosition(traegerId, "Geschäftsführung", gfTyp), gf);

    // Felix: je Haus eine Mitarbeiter-Position (der Ist-Zustand).
    felix = await neuerBenutzer("felix");
    for (const einheit of einrichtungen) await besetze(await neuePosition(einheit, "Mitarbeiter", mitarbeiterTypId), felix);
    // Anna: nur Haus A, eine Besetzung -- wird nicht angefasst.
    anna = await neuerBenutzer("anna");
    await besetze(await neuePosition(einrichtungen[0], "Mitarbeiter", mitarbeiterTypId), anna);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rechte = app.get(RechteService);
    tokenGf = (
      await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email: email("gf"), passwort })
    ).body.accessToken;
  });

  afterAll(async () => {
    try {
      await admin.query("ALTER TABLE org_position_besetzung DISABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
      await admin.query("DELETE FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_position WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ_recht WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM account_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM standort WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
      await admin.query("ALTER TABLE org_position_besetzung ENABLE TRIGGER org_position_besetzung_vollzugriff_schutz");
    } finally {
      await admin.end();
      await app.close();
    }
  });

  it("Migration 0068: Felix hat danach EINE Besetzung, dieselben Rechte wie vorher, Annas Stand ist unberührt", async () => {
    const vorherEinrichtung = await rechteVon(felix, "klienten", "ansehen");
    const vorherSubtree = await rechteVon(felix, "zimmer", "ansehen");
    expect(vorherEinrichtung).toEqual(new Set(einrichtungen));
    const annaVorher = await laufendeBesetzungen(anna);

    await admin.query(MIGRATION);

    const besetzungen = await laufendeBesetzungen(felix);
    expect(besetzungen).toHaveLength(1);
    const { rows: pos } = await admin.query<{ ist_sammelrang: boolean; soll_besetzung: number | null; org_unit_id: string }>(
      "SELECT ist_sammelrang, soll_besetzung, org_unit_id FROM org_position WHERE id = $1",
      [besetzungen[0]]
    );
    expect(pos[0]).toEqual({ ist_sammelrang: true, soll_besetzung: null, org_unit_id: traegerId });

    expect(await rechteVon(felix, "klienten", "ansehen")).toEqual(vorherEinrichtung);
    // Gefahrenfall: subtree darf nicht vom Traeger aus den ganzen Mandanten treffen.
    const nachherSubtree = await rechteVon(felix, "zimmer", "ansehen");
    expect(nachherSubtree).toEqual(vorherSubtree);
    expect(nachherSubtree.has(traegerId)).toBe(false);

    expect(await laufendeBesetzungen(anna)).toEqual(annaVorher);

    // Historie bleibt, leer gewordene Positionen sind deaktiviert, Annas nicht.
    const { rows: alt } = await admin.query<{ aktiv: boolean; n: number }>(
      `SELECT p.aktiv, count(b.*)::int AS n FROM org_position p
       LEFT JOIN org_position_besetzung b ON b.position_id = p.id AND b.benutzer_id = $1
       WHERE p.mandant_id = $2 AND p.titel = 'Mitarbeiter' AND NOT p.ist_sammelrang AND b.id IS NOT NULL
       GROUP BY p.id`,
      [felix, mandantId]
    );
    expect(alt).toHaveLength(3);
    expect(alt.every((p) => p.aktiv === false && p.n === 1)).toBe(true);
    const { rows: annaPos } = await admin.query<{ aktiv: boolean }>(
      "SELECT aktiv FROM org_position WHERE id = $1",
      [annaVorher[0]]
    );
    expect(annaPos[0].aktiv).toBe(true);
  });

  it("zweiter Lauf der Migration ändert nichts mehr", async () => {
    const vorher = await admin.query("SELECT count(*)::int AS n FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
    await admin.query(MIGRATION);
    const nachher = await admin.query("SELECT count(*)::int AS n FROM org_position_besetzung WHERE mandant_id = $1", [mandantId]);
    expect(nachher.rows[0].n).toBe(vorher.rows[0].n);
  });

  it("Sammelrang ohne Standorte gilt fail closed: keine einheitsbezogenen Rechte, auch nicht über den Träger", async () => {
    const res = await request(app.getHttpServer())
      .put(`/benutzer/${felix}/position`)
      .set("Authorization", `Bearer ${tokenGf}`)
      .send({ accountTypId: mitarbeiterTypId, einheitIds: [] });
    expect(res.status).toBe(200);
    expect(await rechteVon(felix, "klienten", "ansehen")).toEqual(new Set());
    expect(await rechteVon(felix, "zimmer", "ansehen")).toEqual(new Set());
  });

  it("Rang ändern mit Standorten: ersetzt den Stand, Liste nennt die Einrichtungen", async () => {
    const [a, b, c] = einrichtungen;
    const res = await request(app.getHttpServer())
      .put(`/benutzer/${felix}/position`)
      .set("Authorization", `Bearer ${tokenGf}`)
      .send({ accountTypId: mitarbeiterTypId, einheitIds: [b, c] });
    expect(res.status).toBe(200);
    expect(await rechteVon(felix, "klienten", "ansehen")).toEqual(new Set([b, c]));
    expect(await laufendeBesetzungen(felix)).toHaveLength(1);

    const liste = await request(app.getHttpServer()).get("/benutzer").set("Authorization", `Bearer ${tokenGf}`);
    const eintrag = liste.body.find((x: { id: string }) => x.id === felix);
    expect(new Set(eintrag.einheitIds)).toEqual(new Set([b, c]));
    expect(liste.body.find((x: { id: string }) => x.id === anna).einheitIds).toEqual([a]);

    // Anna auf dieselbe Sammelposition: bekommt Felix' Standorte nicht.
    const res2 = await request(app.getHttpServer())
      .put(`/benutzer/${anna}/position`)
      .set("Authorization", `Bearer ${tokenGf}`)
      .send({ accountTypId: mitarbeiterTypId, einheitIds: [a] });
    expect(res2.status).toBe(200);
    expect(await rechteVon(anna, "klienten", "ansehen")).toEqual(new Set([a]));
    expect(await rechteVon(felix, "klienten", "ansehen")).toEqual(new Set([b, c]));
  });

  it("Standort, der keine Einrichtung ist -> 400", async () => {
    const res = await request(app.getHttpServer())
      .put(`/benutzer/${felix}/position`)
      .set("Authorization", `Bearer ${tokenGf}`)
      .send({ accountTypId: mitarbeiterTypId, einheitIds: [traegerId] });
    expect(res.status).toBe(400);
  });
});
