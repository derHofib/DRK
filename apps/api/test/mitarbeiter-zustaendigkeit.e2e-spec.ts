/**
 * Zustaendigkeiten im Mitarbeiter-Detail (Rueckmeldung 29e0f19d, Konzept
 * /mnt/project-files/mitarbeiter-detail/):
 *   - Bezugsklient:innen einer Person, nur aktive (archivierte nicht);
 *   - wer eine Akte nicht oeffnen darf, sieht den Namen nicht, nur die Zahl;
 *   - Vertretungen in beide Richtungen, nur genehmigte, die laufen oder kommen
 *     -- beantragte und abgelaufene nicht; wer vertritt, bekommt die
 *     Bezugsklient:innen der vertretenen Person dazu;
 *   - der Umfang (welche Rechte) wird nie ausgeliefert;
 *   - die Kurzfassung in der Liste passt zum Detail;
 *   - Mandantentrennung: fremde Person = 404.
 *
 * Aufbau: Haus A und Haus B, je Klient:in ein Zimmer. Carla betreut KA (Haus A), KB (Haus B) und die
 * archivierte KX. Aylin sieht fest nur Haus A und betreut KC (Haus A). Aylin
 * vertritt Carla heute; Tom vertritt Aylin ab in 10 Tagen. Dazu je ein
 * beantragter und ein abgelaufener Fall, die nirgends auftauchen duerfen.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import type { BenutzerListEintragDto, MitarbeiterZustaendigkeitDto } from "@zimmerakte/shared";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle } from "./support/konto-mit-rolle";

describe("Mitarbeiter-Detail: Bezugsklient:innen und Vertretungen", () => {
  let app: INestApplication;
  let admin: Client;
  const passwort = "correct horse battery staple";
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();
    const suffix = randomUUID().slice(0, 8);
    const passwortHash = await bcrypt.hash(passwort, 4);
    const slugs: Record<string, string> = {};

    for (const m of ["eins", "zwei"]) {
      slugs[m] = `test-zust-${m}-${suffix}`;
      const { rows } = await admin.query<{ id: string }>("INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id", [
        `Testmandant Zuständigkeit ${m} ${suffix}`,
        slugs[m],
      ]);
      id[`m_${m}`] = rows[0].id;
    }
    const mandantId = id.m_eins;

    for (const name of ["A", "B"]) {
      const { rows } = await admin.query<{ id: string }>(
        "INSERT INTO standort (mandant_id, name, adresse) VALUES ($1, $2, 'Str. 1') RETURNING id",
        [mandantId, `Haus ${name}`]
      );
      id[`s${name}`] = rows[0].id;
    }

    id.gf = await kontoMitAlterRolle(admin, {
      mandantId, rolle: "bereichsleitung", email: `gf-${suffix}@beispiel.test`, name: "Geschäftsführung", passwortHash,
    });
    id.fremd = await kontoMitAlterRolle(admin, {
      mandantId: id.m_zwei, rolle: "bereichsleitung", email: `fremd-${suffix}@beispiel.test`, name: "Fremd", passwortHash,
    });
    for (const [kurz, name] of [["aylin", "Aylin"], ["carla", "Carla"], ["tom", "Tom"]]) {
      id[kurz] = await kontoMitAlterRolle(admin, {
        mandantId, rolle: "betreuer", email: `${kurz}-${suffix}@beispiel.test`, name, passwortHash,
      });
    }
    // Feste Sicht: Aylin sieht nur Haus A.
    await admin.query("INSERT INTO benutzer_standort (mandant_id, benutzer_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId, id.aylin, id.sA,
    ]);

    // Je Klient:in ein eigenes Zimmer (Kapazitaet 1).
    async function klient(kurz: string, standort: string, bezug: string, archiviert = false) {
      const { rows: z } = await admin.query<{ id: string }>(
        "INSERT INTO zimmer (mandant_id, standort_id, nummer) VALUES ($1, $2, $3) RETURNING id",
        [mandantId, standort, kurz]
      );
      const zimmer = z[0].id;
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO klient (mandant_id, vorname, nachname, geburtsdatum, aktenzeichen, amt)
         VALUES ($1, 'Klient', $2, '1990-01-01', $3, 'Testamt') RETURNING id`,
        [mandantId, kurz, `AZ-${kurz}-${suffix}`]
      );
      id[kurz] = rows[0].id;
      await admin.query("INSERT INTO belegung (mandant_id, zimmer_id, klient_id, einzug) VALUES ($1, $2, $3, '2024-01-01')", [
        mandantId, zimmer, rows[0].id,
      ]);
      await admin.query("INSERT INTO klient_stammdaten (mandant_id, klient_id, bezugsbetreuer_id) VALUES ($1, $2, $3)", [
        mandantId, rows[0].id, bezug,
      ]);
      if (archiviert) {
        await admin.query("UPDATE klient SET archiviert_am = now(), archiviert_von = $2 WHERE id = $1", [rows[0].id, id.gf]);
      }
    }
    await klient("KA", id.sA, id.carla);
    await klient("KB", id.sB, id.carla);
    await klient("KX", id.sA, id.carla, true);
    await klient("KC", id.sA, id.aylin);

    async function vertretung(vertreter: string, vertretener: string, von: string, bis: string, genehmigt: boolean) {
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO delegation (mandant_id, vertretener_benutzer_id, vertreter_benutzer_id, von, bis, status,
                                 erstellt_von, genehmigt_von, genehmigt_am)
         VALUES ($1, $2, $3, CURRENT_DATE + $4::int, CURRENT_DATE + $5::int, $6, $2,
                 CASE WHEN $7 THEN $3::uuid END, CASE WHEN $7 THEN now() END)
         RETURNING id`,
        [mandantId, vertretener, vertreter, von, bis, genehmigt ? "genehmigt" : "beantragt", genehmigt]
      );
      return rows[0].id;
    }
    id.d_laeuft = await vertretung(id.aylin, id.carla, "-1", "5", true);
    await admin.query("INSERT INTO delegation_standort (mandant_id, delegation_id, standort_id) VALUES ($1, $2, $3)", [
      mandantId, id.d_laeuft, id.sA,
    ]);
    id.d_kommt = await vertretung(id.tom, id.aylin, "10", "12", true);
    id.d_beantragt = await vertretung(id.tom, id.carla, "0", "3", false);
    id.d_abgelaufen = await vertretung(id.tom, id.carla, "-20", "-10", true);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    for (const kurz of ["gf", "aylin", "carla", "tom"]) {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ mandantSlug: slugs.eins, email: `${kurz}-${suffix}@beispiel.test`, passwort });
      t[kurz] = res.body.accessToken;
    }
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug: slugs.zwei, email: `fremd-${suffix}@beispiel.test`, passwort });
    t.fremd = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const get = (wer: string, pfad: string) => request(app.getHttpServer()).get(pfad).set("Authorization", `Bearer ${t[wer]}`);
  const detail = async (wer: string, person: string) => {
    const res = await get(wer, `/benutzer/${id[person]}/zustaendigkeiten`);
    expect(res.status).toBe(200);
    return res.body as MitarbeiterZustaendigkeitDto;
  };
  const namen = (l: { name: string }[]) => l.map((k) => k.name).sort();

  it("zeigt aktive Bezugsklient:innen, archivierte nicht", async () => {
    const d = await detail("gf", "carla");
    expect(namen(d.bezug.sichtbar)).toEqual(["Klient KA", "Klient KB"]);
    expect(d.bezug.verborgen).toBe(0);
    const ka = d.bezug.sichtbar.find((k) => k.klientId === id.KA)!;
    expect(ka).toMatchObject({ standortName: "Haus A", zimmerNummer: "KA" });
  });

  it("nennt Klient:innen ausserhalb der eigenen Sicht nur als Zahl", async () => {
    const d = await detail("aylin", "carla");
    expect(namen(d.bezug.sichtbar)).toEqual(["Klient KA"]);
    expect(d.bezug.verborgen).toBe(1);
    // Kein Name, keine ID des verborgenen Falls irgendwo in der Antwort.
    expect(JSON.stringify(d)).not.toContain(id.KB);
    expect(JSON.stringify(d)).not.toContain("Klient KB");
  });

  it("zeigt nur genehmigte, laufende oder kommende Vertretungen", async () => {
    const carla = await detail("tom", "carla");
    expect(carla.vertritt).toEqual([]);
    expect(carla.wirdVertretenVon.map((v) => v.delegationId)).toEqual([id.d_laeuft]);
    expect(carla.wirdVertretenVon[0]).toMatchObject({ benutzerId: id.aylin, name: "Aylin", laeuft: true, standorte: ["Haus A"], klienten: null });

    const aylin = await detail("tom", "aylin");
    expect(aylin.vertritt.map((v) => v.delegationId)).toEqual([id.d_laeuft]);
    expect(namen(aylin.vertritt[0].klienten!.sichtbar)).toEqual(["Klient KA", "Klient KB"]);
    expect(aylin.wirdVertretenVon.map((v) => v.delegationId)).toEqual([id.d_kommt]);
    expect(aylin.wirdVertretenVon[0].laeuft).toBe(false);

    const tom = await detail("gf", "tom");
    expect(tom.vertritt.map((v) => v.delegationId)).toEqual([id.d_kommt]);
  });

  it("liefert nie den Umfang der Vertretung", async () => {
    const roh = JSON.stringify(await detail("gf", "aylin"));
    expect(roh).not.toMatch(/umfang|sensible|rechte/i);
  });

  it("Liste: Kurzfassung passt zum Detail und zaehlt auch Verborgene", async () => {
    const res = await get("aylin", "/benutzer");
    expect(res.status).toBe(200);
    const liste = res.body as BenutzerListEintragDto[];
    const von = (kurz: string) => liste.find((b) => b.id === id[kurz])!.zustaendig;
    expect(von("carla").bezugsklienten).toBe(2);
    expect(von("carla").wirdVertretenVon.map((v) => v.name)).toEqual(["Aylin"]);
    expect(von("aylin").bezugsklienten).toBe(1);
    expect(von("aylin").vertritt.map((v) => v.name)).toEqual(["Carla"]);
    // Kommende Vertretung steht in der Liste noch nicht (nur laufende).
    expect(von("aylin").wirdVertretenVon).toEqual([]);
    expect(von("tom")).toEqual({ bezugsklienten: 0, vertritt: [], wirdVertretenVon: [] });
  });

  it("Mandantentrennung: Person eines anderen Traegers ist nicht auffindbar", async () => {
    expect((await get("fremd", `/benutzer/${id.carla}/zustaendigkeiten`)).status).toBe(404);
    const liste = (await get("fremd", "/benutzer")).body as BenutzerListEintragDto[];
    expect(liste.map((b) => b.id)).toEqual([id.fremd]);
  });

  it("lehnt eine ungueltige ID mit 400 ab", async () => {
    expect((await get("gf", "/benutzer/kein-uuid/zustaendigkeiten")).status).toBe(400);
  });
});
