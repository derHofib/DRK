/**
 * POST /delegationen, PATCH /delegationen/:id/genehmigen,
 * PATCH /delegationen/:id/widerrufen (Organigramm-Plan, Lieferreihenfolge
 * Schritt 6, Schreibseite der Delegation nach delegation-lesen.e2e-spec.ts).
 *
 * Fachliches Design (nicht neu diskutiert, siehe delegation.service.ts):
 *  - anlegen(): NUR die vertretene Person selbst kann eine Delegation
 *    anlegen -- vertretener_benutzer_id = erstellt_von = der aufrufende
 *    Benutzer, vertreterBenutzerId kommt aus dem Body.
 *  - genehmigen(): Vier-Augen-Entscheidungsmuster von
 *    kassenbuchung.service.ts::stornoEntscheiden() -- nur die im Antrag
 *    benannte vertreter_benutzer_id darf genehmigen, erzwungen sowohl im
 *    Service (403, verstaendliche Meldung) als auch im DB-Trigger
 *    delegation_vier_augen_pruefen() (migrations/0046, SQLSTATE ZA003, die
 *    harte Grenze darunter).
 *  - widerrufen(): beide Seiten duerfen (Widerruf ist die "sichere
 *    Richtung"), kein Vier-Augen-Prinzip noetig.
 *
 * Alle drei Endpunkte sind bewusst NUR mit @Authenticated() gegated (kein
 * @ErfordertRecht()) -- die Fixtures brauchen deshalb kein
 * account_typ/org_position: genau wie delegation-lesen.e2e-spec.ts reicht
 * ein einfacher benutzer-Datensatz (rolle ist NOT NULL in der Tabelle,
 * ihr Wert spielt hier aber keine Rolle) plus Login per HTTP, um
 * @Authenticated() wirklich end-to-end zu pruefen.
 *
 * Laeuft gegen eine echte PostgreSQL-Instanz mit angewendeten Migrationen
 * (kein Mock) -- der Trigger aus Migration 0046 laesst sich nicht sinnvoll
 * mocken.
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

const DELEGATION_VIER_AUGEN_VERLETZT = "ZA003";

describe("Delegation: anlegen/genehmigen/widerrufen", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;

  let vertretenerId: string;
  let vertreterId: string;
  let unbeteiligtId: string;

  let tokenVertretener: string;
  let tokenVertreter: string;
  let tokenUnbeteiligt: string;

  const passwort = "correct horse battery staple";

  async function neuerBenutzer(label: string): Promise<{ id: string; email: string; name: string }> {
    const suffix = randomUUID().slice(0, 8);
    const email = `${label}-${suffix}@delegation-schreiben.test`;
    const name = `Testperson ${label}`;
    const passwortHash = await bcrypt.hash(passwort, 4);
    const id = await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "betreuer",
      email,
      name,
      passwortHash,
    });
    return { id, email, name };
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
    return res.body.accessToken as string;
  }

  function heutePlus(tage: number): string {
    return new Date(Date.now() + tage * 86400000).toISOString().slice(0, 10);
  }

  function post(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/delegationen").set("Authorization", `Bearer ${token}`).send(body);
  }

  function genehmigen(token: string, id: string) {
    return request(app.getHttpServer()).patch(`/delegationen/${id}/genehmigen`).set("Authorization", `Bearer ${token}`);
  }

  function widerrufen(token: string, id: string) {
    return request(app.getHttpServer()).patch(`/delegationen/${id}/widerrufen`).set("Authorization", `Bearer ${token}`);
  }

  async function auditEintraege(aktion: string, objektId: string) {
    const { rows } = await admin.query(
      `SELECT * FROM audit_log WHERE mandant_id = $1 AND modul = 'delegation' AND aktion = $2 AND objekt_id = $3`,
      [mandantId, aktion, objektId]
    );
    return rows;
  }

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error("MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example).");
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-delegation-schreiben-${suffix}`;
    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant Delegation Schreiben ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    const vertretener = await neuerBenutzer("vertretener");
    const vertreter = await neuerBenutzer("vertreter");
    const unbeteiligt = await neuerBenutzer("unbeteiligt");
    vertretenerId = vertretener.id;
    vertreterId = vertreter.id;
    unbeteiligtId = unbeteiligt.id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    tokenVertretener = await login(vertretener.email);
    tokenVertreter = await login(vertreter.email);
    tokenUnbeteiligt = await login(unbeteiligt.email);
  });

  afterAll(async () => {
    try {
      await admin.query("DELETE FROM audit_log WHERE mandant_id = $1", [mandantId]);
      await admin.query("DELETE FROM delegation_recht WHERE mandant_id = $1", [mandantId]);
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

  it("Vertretene legt eine Delegation an (umfang=alle) -> status=beantragt, erstellt_von/vertretener_benutzer_id = sie selbst", async () => {
    const res = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      vertretenerBenutzerId: vertretenerId,
      vertreterBenutzerId: vertreterId,
      umfang: "alle",
      status: "beantragt",
      effektiverStatus: "beantragt",
    });

    const { rows } = await admin.query("SELECT erstellt_von FROM delegation WHERE id = $1", [res.body.id]);
    expect(rows[0].erstellt_von).toBe(vertretenerId);

    const eintraege = await auditEintraege("anlegen", res.body.id);
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].benutzer_id).toBe(vertretenerId);
  });

  it("Vertreter genehmigt die eigene (als Vertretung benannte) Delegation -> status=genehmigt, mit audit_log-Eintrag", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;

    const res = await genehmigen(tokenVertreter, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: "genehmigt" });

    const { rows } = await admin.query("SELECT genehmigt_von FROM delegation WHERE id = $1", [id]);
    expect(rows[0].genehmigt_von).toBe(vertreterId);

    const eintraege = await auditEintraege("genehmigen", id);
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].benutzer_id).toBe(vertreterId);
  });

  it("GEGENPROBE Vier-Augen (Service-Ebene): die Vertretene selbst versucht, die EIGENE Anfrage zu genehmigen -> 403", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;

    const res = await genehmigen(tokenVertretener, id);
    expect(res.status).toBe(403);

    const { rows } = await admin.query("SELECT status FROM delegation WHERE id = $1", [id]);
    expect(rows[0].status).toBe("beantragt");
  });

  it("GEGENPROBE auf DB-Ebene: ein roher UPDATE als App-Rolle mit genehmigt_von <> vertreter_benutzer_id scheitert mit SQLSTATE ZA003", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;

    const appClient = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await expect(
        appClient.query(
          `UPDATE delegation SET status = 'genehmigt', genehmigt_von = $1, genehmigt_am = now() WHERE id = $2`,
          [unbeteiligtId, id]
        )
      ).rejects.toMatchObject({ code: DELEGATION_VIER_AUGEN_VERLETZT });
      await appClient.query("ROLLBACK");
    } finally {
      await appClient.end();
    }

    // Beleg, dass der Trigger wirklich nur den falschen Genehmiger ablehnt,
    // nicht jeden UPDATE-Versuch (Gegenprobe zur Gegenprobe): derselbe
    // UPDATE mit dem RICHTIGEN genehmigt_von geht durch.
    const appClient2 = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appClient2.connect();
    try {
      await appClient2.query("BEGIN");
      await appClient2.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      await appClient2.query(
        `UPDATE delegation SET status = 'genehmigt', genehmigt_von = $1, genehmigt_am = now() WHERE id = $2`,
        [vertreterId, id]
      );
      await appClient2.query("ROLLBACK");
    } finally {
      await appClient2.end();
    }
  });

  it('umfang="auswahl" mit einem manage-permissions-Eintrag in rechte -> 400 bereits auf Service-Ebene (vor jedem DB-Insert)', async () => {
    const vorherAnzahl = (await admin.query("SELECT count(*) FROM delegation WHERE mandant_id = $1", [mandantId])).rows[0]
      .count;

    const res = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "auswahl",
      rechte: [{ modul: "organigramm", aktion: "manage-permissions" }],
    });
    expect(res.status).toBe(400);

    const nachherAnzahl = (await admin.query("SELECT count(*) FROM delegation WHERE mandant_id = $1", [mandantId])).rows[0]
      .count;
    expect(nachherAnzahl).toBe(vorherAnzahl);
  });

  it('umfang="auswahl" mit leerem rechte-Array -> 400', async () => {
    const res = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "auswahl",
      rechte: [],
    });
    expect(res.status).toBe(400);
  });

  it('umfang="auswahl" mit einem delegierbaren Recht -> 201, delegation_recht-Zeile wird angelegt', async () => {
    const res = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "auswahl",
      rechte: [{ modul: "klienten", aktion: "lesen-akte" }],
    });
    expect(res.status).toBe(201);

    const { rows } = await admin.query("SELECT modul, aktion FROM delegation_recht WHERE delegation_id = $1", [res.body.id]);
    expect(rows).toEqual([{ modul: "klienten", aktion: "lesen-akte" }]);
  });

  it("dritte, unbeteiligte Person versucht zu genehmigen -> 403", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;

    const res = await genehmigen(tokenUnbeteiligt, id);
    expect(res.status).toBe(403);
  });

  it("dritte, unbeteiligte Person versucht zu widerrufen -> 403", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;

    const res = await widerrufen(tokenUnbeteiligt, id);
    expect(res.status).toBe(403);

    const { rows } = await admin.query("SELECT status FROM delegation WHERE id = $1", [id]);
    expect(rows[0].status).toBe("beantragt");
  });

  it("Widerruf durch die vertretene Person -> status=widerrufen, mit audit_log-Eintrag", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;

    const res = await widerrufen(tokenVertretener, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: "widerrufen" });

    const { rows } = await admin.query("SELECT widerrufen_von FROM delegation WHERE id = $1", [id]);
    expect(rows[0].widerrufen_von).toBe(vertretenerId);

    const eintraege = await auditEintraege("widerrufen", id);
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].benutzer_id).toBe(vertretenerId);
  });

  it("Widerruf durch die Vertretung (vertreter_benutzer_id) -> status=widerrufen", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;

    const res = await widerrufen(tokenVertreter, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: "widerrufen" });

    const { rows } = await admin.query("SELECT widerrufen_von FROM delegation WHERE id = $1", [id]);
    expect(rows[0].widerrufen_von).toBe(vertreterId);
  });

  it("ein bereits widerrufene Delegation erneut widerrufen -> 409", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;
    await widerrufen(tokenVertretener, id);

    const res = await widerrufen(tokenVertretener, id);
    expect(res.status).toBe(409);
  });

  it("ein bereits genehmigter Antrag erneut genehmigen -> 404 (nicht gefunden oder bereits entschieden)", async () => {
    const angelegt = await post(tokenVertretener, {
      vertreterBenutzerId: vertreterId,
      von: heutePlus(1),
      bis: heutePlus(10),
      umfang: "alle",
    });
    const id = angelegt.body.id;
    await genehmigen(tokenVertreter, id);

    const res = await genehmigen(tokenVertreter, id);
    expect(res.status).toBe(404);
  });

  it("ohne Token -> 401 fuer alle drei Endpunkte", async () => {
    const resAnlegen = await request(app.getHttpServer())
      .post("/delegationen")
      .send({ vertreterBenutzerId: vertreterId, von: heutePlus(1), bis: heutePlus(10), umfang: "alle" });
    expect(resAnlegen.status).toBe(401);

    const resGenehmigen = await request(app.getHttpServer()).patch(`/delegationen/${randomUUID()}/genehmigen`);
    expect(resGenehmigen.status).toBe(401);

    const resWiderrufen = await request(app.getHttpServer()).patch(`/delegationen/${randomUUID()}/widerrufen`);
    expect(resWiderrufen.status).toBe(401);
  });
});
