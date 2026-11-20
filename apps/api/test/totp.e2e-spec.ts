/**
 * Die Abnahmekriterien aus dem Bauplan-Nachtrag zu Phase 0 ("2FA-Erzwingung
 * ist NICHT Teil von Phase 0 -- siehe README"), jetzt nachgezogen: ein
 * Login mit aktivierter 2FA liefert kein Zugriffstoken direkt, sondern ein
 * kurzlebiges "pending"-Token, das erst zusammen mit einem gueltigen
 * TOTP-Code gegen ein echtes Zugriffstoken eingetauscht werden kann. Das
 * pending-Token selbst darf niemals als Zugriffstoken durchgehen, und ein
 * einmal akzeptierter Code darf kein zweites Mal funktionieren (Replay-
 * Schutz).
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from "otplib";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { kontoMitAlterRolle, raeumeKontoMitRolleAuf } from "./support/konto-mit-rolle";

const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();

function codeFuer(secret: string): Promise<string> {
  return new TOTP({ secret, crypto: cryptoPlugin, base32: base32Plugin }).generate();
}

/**
 * Code fuer die Zeitscheibe NACH der aktuellen. Der Server akzeptiert +-1
 * Zeitschritt (Uhrendrift, siehe ZEIT_TOLERANZ_SEKUNDEN in auth.service.ts),
 * also ist das ein gueltiger Code -- und weil er zu einem spaeteren Schritt
 * gehoert als der eben bei der Aktivierung verbrauchte, garantiert ein noch
 * nicht verbrauchter. Frueher wartete der Test dafuer real bis zur naechsten
 * 30-Sekunden-Scheibe (im Mittel ~30 s Laufzeit, der mit Abstand langsamste
 * Teil der Suite). Die Uhr wird dabei nicht gefaelscht: Server und Test
 * laufen beide auf der echten Systemzeit, nur der Code zielt einen Schritt
 * voraus, genau wie bei einer leicht vorgehenden Authenticator-App.
 */
function codeFuerNaechsteZeitscheibe(secret: string): Promise<string> {
  return new TOTP({ secret, crypto: cryptoPlugin, base32: base32Plugin }).generate({
    epoch: Math.floor(Date.now() / 1000) + 30,
  });
}

describe("2FA-Erzwingung: TOTP-Setup, Login-Zweitschritt, Replay-Schutz", () => {
  let app: INestApplication;
  let admin: Client;

  let mandantId: string;
  let mandantSlug: string;
  let email: string;
  const passwort = "correct horse battery staple";

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    const suffix = randomUUID().slice(0, 8);
    mandantSlug = `test-totp-${suffix}`;
    email = `totp-${suffix}@beispiel.test`;
    const passwortHash = await bcrypt.hash(passwort, 4);

    const { rows: mandantRows } = await admin.query<{ id: string }>(
      "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
      [`Testmandant TOTP ${suffix}`, mandantSlug]
    );
    mandantId = mandantRows[0].id;

    await kontoMitAlterRolle(admin, {
      mandantId,
      rolle: "bereichsleitung",
      email,
      name: "TOTP Test",
      passwortHash,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await raeumeKontoMitRolleAuf(admin, mandantId);
    await admin.query("DELETE FROM benutzer WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM kassenbuchung_typ WHERE mandant_id = $1", [mandantId]);
    await admin.query("DELETE FROM mandant WHERE id = $1", [mandantId]);
    await admin.end();
    await app.close();
  });

  async function login() {
    return request(app.getHttpServer()).post("/auth/login").send({ mandantSlug, email, passwort });
  }

  it("liefert ohne aktivierte 2FA ein Zugriffstoken direkt", async () => {
    const res = await login();
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.totpErforderlich).toBeUndefined();
  });

  let secret: string;
  let accessToken: string;

  it("richtet 2FA ein (noch nicht aktiv) und liefert ein otpauth-URI", async () => {
    const loginRes = await login();
    accessToken = loginRes.body.accessToken;

    const res = await request(app.getHttpServer())
      .post("/auth/totp/einrichten")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    secret = res.body.secret;

    // Vor der Aktivierung bleibt der normale, einstufige Login unveraendert.
    const nochOhne2fa = await login();
    expect(nochOhne2fa.body.accessToken).toBeDefined();
  });

  it("lehnt die Aktivierung mit einem falschen Code ab", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/totp/aktivieren")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "000000" });
    expect(res.status).toBe(400);
  });

  it("aktiviert 2FA mit einem gueltigen Code", async () => {
    const code = await codeFuer(secret);
    const res = await request(app.getHttpServer())
      .post("/auth/totp/aktivieren")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code });
    expect(res.status).toBe(201);
    expect(res.body.aktiviert).toBe(true);
  });

  it("liefert nach Aktivierung beim Login ein pending-Token statt eines Zugriffstokens", async () => {
    const res = await login();
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.totpErforderlich).toBe(true);
    expect(typeof res.body.pendingToken).toBe("string");
  });

  it("lehnt den Zweitschritt mit falschem Code ab", async () => {
    const loginRes = await login();
    const res = await request(app.getHttpServer())
      .post("/auth/login/totp")
      .send({ pendingToken: loginRes.body.pendingToken, code: "000000" });
    expect(res.status).toBe(401);
  });

  it("verweigert einem pending-Token den Zugriff auf einen normalen, geschuetzten Endpunkt", async () => {
    const loginRes = await login();
    const res = await request(app.getHttpServer())
      .get("/mandant/me")
      .set("Authorization", `Bearer ${loginRes.body.pendingToken}`);
    expect(res.status).toBe(401);
  });

  it("tauscht pending-Token + gueltigen Code gegen ein echtes Zugriffstoken, das echte Zugriffstoken funktioniert danach",
    async () => {
      // Die Aktivierung eben hat schon einen Code fuer die aktuelle
      // Zeitscheibe verbraucht -- also den der naechsten nehmen.
      const loginRes = await login();
      const code = await codeFuerNaechsteZeitscheibe(secret);

      const res = await request(app.getHttpServer())
        .post("/auth/login/totp")
        .send({ pendingToken: loginRes.body.pendingToken, code });
      expect(res.status).toBe(201);
      expect(typeof res.body.accessToken).toBe("string");

      const meRes = await request(app.getHttpServer())
        .get("/mandant/me")
        .set("Authorization", `Bearer ${res.body.accessToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.id).toBe(mandantId);
  });

  it("lehnt denselben Code ein zweites Mal ab (Replay-Schutz)",
    async () => {
      // Der Test davor hat den Code der naechsten Zeitscheibe verbraucht; ohne
      // zu warten gibt es keinen spaeteren gueltigen mehr. Deshalb den
      // gespeicherten letzten Schritt zuruecksetzen (Testvorbereitung ueber
      // den Admin-Zugang, kein Eingriff in den Pruefpfad) -- danach muss der
      // aktuelle Code genau einmal funktionieren und beim zweiten Mal
      // abgelehnt werden.
      await admin.query("UPDATE benutzer SET totp_letzter_schritt = NULL WHERE mandant_id = $1", [mandantId]);

      const loginRes = await login();
      const code = await codeFuer(secret);

      const ersteRes = await request(app.getHttpServer())
        .post("/auth/login/totp")
        .send({ pendingToken: loginRes.body.pendingToken, code });
      expect(ersteRes.status).toBe(201);

      const zweiteRes = await request(app.getHttpServer())
        .post("/auth/login/totp")
        .send({ pendingToken: loginRes.body.pendingToken, code });
      expect(zweiteRes.status).toBe(401);
  });

  it("lehnt die Deaktivierung mit falschem Code ab", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/totp/deaktivieren")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "000000" });
    expect(res.status).toBe(400);
  });

  it("deaktiviert 2FA mit gueltigem Code, danach ist der Login wieder einstufig", async () => {
    const code = await codeFuer(secret);
    const res = await request(app.getHttpServer())
      .post("/auth/totp/deaktivieren")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code });
    expect(res.status).toBe(201);
    expect(res.body.aktiviert).toBe(false);

    const loginRes = await login();
    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.totpErforderlich).toBeUndefined();
  });
});
