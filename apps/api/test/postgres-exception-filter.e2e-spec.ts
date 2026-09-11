/**
 * Chaos-Test-Fund: keiner der Controller validiert seine :id-Parameter
 * einzeln (kein ParseUUIDPipe an @Param()). Eine syntaktisch ungueltige
 * UUID (z.B. GET /klienten/keine-uuid) erreicht Postgres unveraendert und
 * loest dort SQLSTATE 22P02 ("invalid input syntax for type uuid") aus --
 * ohne Uebersetzung kommt das als unbehandelter 500 zurueck, obwohl es ein
 * Eingabefehler des Aufrufers ist, kein Serverfehler.
 *
 * Der Fix sitzt bewusst zentral in einem einzigen globalen Filter
 * (common/postgres-exception.filter.ts), nicht an jedem einzelnen @Param()
 * -- das waere an ueber 15 Stellen zu wiederholen und bei jedem neuen
 * Endpunkt erneut zu vergessen. Dieser Test prueft deshalb absichtlich
 * mehrere, unterschiedliche Controller (Pfad- UND Query-Parameter), um zu
 * zeigen, dass der Filter wirklich global greift und nicht nur zufaellig an
 * der einen Stelle, die im Bugreport genannt wurde.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Globaler Filter: ungueltiges UUID-Format wird 400 statt 500", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let token: string;

  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-uuid-filter-${suffix}`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant UUID-Filter ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await admin.query(
      `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
       VALUES ($1, $2, 'Bereichsleitung Test', $3, 'bereichsleitung')`,
      [mandantId, `bereichsleitung-${suffix}@beispiel.test`, passwortHash]
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug, email: `bereichsleitung-${suffix}@beispiel.test`, passwort });
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  function get(path: string) {
    return request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${token}`);
  }
  function patch(path: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer()).patch(path).set("Authorization", `Bearer ${token}`).send(body);
  }
  function post(path: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer()).post(path).set("Authorization", `Bearer ${token}`).send(body);
  }

  it("GET /klienten/:id mit einer syntaktisch ungueltigen ID liefert 400, nicht 500", async () => {
    const res = await get("/klienten/keine-uuid");
    expect(res.status).toBe(400);
  });

  it("GET /klienten/:id mit einer wohlgeformten, aber nicht existierenden UUID liefert weiterhin 404 (Regressionsschutz)", async () => {
    const res = await get(`/klienten/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it("PATCH /zimmer/:id mit einer syntaktisch ungueltigen ID liefert 400, nicht 500", async () => {
    const res = await patch("/zimmer/undefined", { nummer: "999" });
    expect(res.status).toBe(400);
  });

  it("PATCH /aufgaben/:id mit einer syntaktisch ungueltigen ID liefert 400, nicht 500", async () => {
    const res = await patch("/aufgaben/null", { titel: "Test" });
    expect(res.status).toBe(400);
  });

  it("POST /tagesberichte/:id/tags (verschachtelter Pfad-Parameter) liefert bei ungueltiger ID 400, nicht 500", async () => {
    const res = await post("/tagesberichte/nicht-vorhanden/tags", { name: "Testtag" });
    expect(res.status).toBe(400);
  });

  it("GET /kostenuebernahmen?klientId=... (Query-Parameter, nicht nur :id-Pfade) liefert bei ungueltiger ID 400, nicht 500", async () => {
    const res = await get("/kostenuebernahmen?klientId=keine-uuid");
    expect(res.status).toBe(400);
  });

  it("ein ganz normaler 403/404-Fehlerpfad bleibt vom neuen Filter unberuehrt (Regressionsschutz)", async () => {
    // Unbekannte, aber wohlgeformte ID -- muss weiterhin die gewohnte
    // NotFoundException liefern, nicht durch den neuen @Catch()-Filter
    // (der alles andere unveraendert an BaseExceptionFilter durchreicht)
    // verschluckt oder veraendert werden.
    const res = await patch(`/kostenuebernahmen/${randomUUID()}/beenden`, { bis: "2026-01-01" });
    expect(res.status).toBe(404);
  });
});
