/**
 * GET /delegationen/meine (Organigramm-Plan, Lieferreihenfolge Schritt 6):
 * zeigt Delegationen, an denen der aufrufende Benutzer als Vertretener
 * ODER als Vertreter beteiligt ist. Nur @Authenticated(), kein
 * @ErfordertRecht() -- die eigene Delegation zu sehen ist kein
 * Rechte-Engine-Fall (analog "nur eigene Aufgaben", siehe
 * delegation.controller.ts).
 *
 * effektiverStatus ist abgeleitet, nicht gespeichert (CLAUDE.md Regel 4,
 * siehe Kommentar auf der Tabelle in migrations/0043_delegation.sql) --
 * dieser Test deckt alle fuenf Faelle ab: beantragt, genehmigt (von in der
 * Zukunft), aktiv (heute zwischen von/bis), abgelaufen (bis in der
 * Vergangenheit), widerrufen.
 *
 * Braucht keine org_position/account_typ -- die Delegationen werden direkt
 * per SQL angelegt (wie delegation_recht in rechte-engine.e2e-spec.ts),
 * der Login laeuft trotzdem ueber HTTP/AppModule, damit @Authenticated()
 * wirklich end-to-end geprueft ist.
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

describe("Delegation: GET /delegationen/meine", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;

  let vertretenerId: string;
  let vertreterId: string;
  let vertretenerName: string;
  let vertreterName: string;

  let delegationBeantragtId: string;
  let delegationGenehmigtKuenftigId: string;
  let delegationAktivId: string;
  let delegationAbgelaufenId: string;
  let delegationWiderrufenId: string;

  let tokenVertretener: string;
  let tokenVertreter: string;
  let tokenUnbeteiligt: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-delegation-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Delegation ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    async function neuerBenutzer(label: string): Promise<{ id: string; email: string; name: string }> {
      const email = `${label}-${suffix}@delegation-check.test`;
      const name = `Testperson ${label}`;
      const id = await kontoMitAlterRolle(admin, {
        mandantId,
        rolle: "betreuer",
        email,
        name,
        passwortHash,
      });
      return { id, email, name };
    }

    const vertretener = await neuerBenutzer("vertretener");
    const vertreter = await neuerBenutzer("vertreter");
    const unbeteiligt = await neuerBenutzer("unbeteiligt");
    vertretenerId = vertretener.id;
    vertreterId = vertreter.id;
    vertretenerName = vertretener.name;
    vertreterName = vertreter.name;

    const heute = new Date();
    const tageAb = (tage: number) => {
      const d = new Date(heute.getTime() + tage * 86400000);
      return d.toISOString().slice(0, 10);
    };

    async function delegationAnlegen(opts: {
      status: "beantragt" | "genehmigt" | "widerrufen";
      von: string;
      bis: string;
    }): Promise<string> {
      const genehmigtSpalten = opts.status !== "beantragt" ? ", genehmigt_von, genehmigt_am" : "";
      const genehmigtWerte = opts.status !== "beantragt" ? ", $2, now()" : "";
      const widerrufenSpalten = opts.status === "widerrufen" ? ", widerrufen_von, widerrufen_am" : "";
      const widerrufenWerte = opts.status === "widerrufen" ? ", $2, now()" : "";
      const { rows } = await admin.query<{ id: string }>(
        `INSERT INTO delegation (mandant_id, vertretener_benutzer_id, vertreter_benutzer_id, von, bis, status, erstellt_von${genehmigtSpalten}${widerrufenSpalten})
         VALUES ($1, $2, $3, $4, $5, $6, $2${genehmigtWerte}${widerrufenWerte})
         RETURNING id`,
        [mandantId, vertretenerId, vertreterId, opts.von, opts.bis, opts.status]
      );
      return rows[0].id;
    }

    delegationBeantragtId = await delegationAnlegen({ status: "beantragt", von: tageAb(1), bis: tageAb(10) });
    // genehmigt, von liegt in der Zukunft -> effektiverStatus bleibt "genehmigt".
    delegationGenehmigtKuenftigId = await delegationAnlegen({ status: "genehmigt", von: tageAb(5), bis: tageAb(10) });
    // genehmigt, heute liegt zwischen von und bis -> "aktiv".
    delegationAktivId = await delegationAnlegen({ status: "genehmigt", von: tageAb(-2), bis: tageAb(2) });
    // genehmigt, bis liegt in der Vergangenheit -> "abgelaufen".
    delegationAbgelaufenId = await delegationAnlegen({ status: "genehmigt", von: tageAb(-10), bis: tageAb(-1) });
    delegationWiderrufenId = await delegationAnlegen({ status: "widerrufen", von: tageAb(-5), bis: tageAb(5) });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(email: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
      return res.body.accessToken as string;
    }
    tokenVertretener = await login(vertretener.email);
    tokenVertreter = await login(vertreter.email);
    tokenUnbeteiligt = await login(unbeteiligt.email);
  });

  afterAll(async () => {
    try {
      await admin.query("DELETE FROM delegation WHERE mandant_id = $1", [mandantId]);
      await raeumeKontoMitRolleAuf(admin, mandantId);
      await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM org_unit WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    } finally {
      await admin.end();
      await app.close();
    }
  });

  function meine(token: string) {
    return request(app.getHttpServer()).get("/delegationen/meine").set("Authorization", `Bearer ${token}`);
  }

  function findeZeile(body: any[], id: string) {
    return body.find((d: any) => d.id === id);
  }

  it("Vertretener sieht alle fuenf Delegationen mit korrektem effektivenStatus und den Namen beider Seiten", async () => {
    const res = await meine(tokenVertretener);
    expect(res.status).toBe(200);

    expect(findeZeile(res.body, delegationBeantragtId)).toMatchObject({
      vertretenerBenutzerId: vertretenerId,
      vertretenerName,
      vertreterBenutzerId: vertreterId,
      vertreterName,
      status: "beantragt",
      effektiverStatus: "beantragt",
    });
    expect(findeZeile(res.body, delegationGenehmigtKuenftigId)).toMatchObject({
      status: "genehmigt",
      effektiverStatus: "genehmigt",
    });
    expect(findeZeile(res.body, delegationAktivId)).toMatchObject({
      status: "genehmigt",
      effektiverStatus: "aktiv",
    });
    expect(findeZeile(res.body, delegationAbgelaufenId)).toMatchObject({
      status: "genehmigt",
      effektiverStatus: "abgelaufen",
    });
    expect(findeZeile(res.body, delegationWiderrufenId)).toMatchObject({
      status: "widerrufen",
      effektiverStatus: "widerrufen",
    });
  });

  it("Vertreter sieht dieselben fuenf Zeilen (andere Blickrichtung derselben Delegation)", async () => {
    const res = await meine(tokenVertreter);
    expect(res.status).toBe(200);
    const ids = res.body.map((d: any) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        delegationBeantragtId,
        delegationGenehmigtKuenftigId,
        delegationAktivId,
        delegationAbgelaufenId,
        delegationWiderrufenId,
      ])
    );
    expect(findeZeile(res.body, delegationAktivId)).toMatchObject({ effektiverStatus: "aktiv" });
  });

  it("eine unbeteiligte dritte Person sieht keine dieser Delegationen", async () => {
    const res = await meine(tokenUnbeteiligt);
    expect(res.status).toBe(200);
    const ids = res.body.map((d: any) => d.id);
    expect(ids).not.toContain(delegationBeantragtId);
    expect(ids).not.toContain(delegationGenehmigtKuenftigId);
    expect(ids).not.toContain(delegationAktivId);
    expect(ids).not.toContain(delegationAbgelaufenId);
    expect(ids).not.toContain(delegationWiderrufenId);
  });

  it("ohne Token -> 401", async () => {
    const res = await request(app.getHttpServer()).get("/delegationen/meine");
    expect(res.status).toBe(401);
  });
});
