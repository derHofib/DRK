/**
 * Die Akzentfarbe und die dunkle Grundfarbe sind Corporate Branding je
 * Traeger: sie gelten fuer alle Mitarbeitenden gleichzeitig, duerfen aber
 * nur von der Bereichsleitung gesetzt werden -- und sie duerfen unter
 * keinen Umstaenden ueber die Mandantengrenze hinweg sichtbar oder
 * aenderbar sein. Beide teilen sich denselben Endpunkt (PATCH /mandant/me)
 * und dieselbe Rollenpruefung, sind aber unabhaengige Spalten/Werte (siehe
 * migrations/0029: die dunkle Grundfarbe folgte bis dahin ungewollt dem
 * Farbton des Akzents).
 *
 * Wie die uebrigen Spezifikationen hier: ueber den echten HTTP-Pfad und
 * gegen eine echte PostgreSQL-Instanz. Zusaetzlich wird an zwei Stellen
 * bewusst UNTER der Anwendung geprueft (roher Client auf der App-Rolle),
 * weil die entscheidenden Zusicherungen dort liegen und nicht im
 * TypeScript: die spaltenscharfen GRANTs und die CHECK-Bedingungen aus
 * Migration 0019/0029 muessen auch dann halten, wenn ein kuenftiger
 * Codepfad an Controller und zod vorbeigeht.
 */
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

// Seit Migration 0021: DRK Rot statt Petrol.
const STANDARDFARBE = "#e3000f";
// Migration 0029.
const STANDARD_DUNKEL_GRUNDFARBE = "#10131a";

interface Testbenutzer {
  benutzerId: string;
  email: string;
  passwort: string;
}

interface Testmandant {
  mandantId: string;
  slug: string;
  bereichsleitung: Testbenutzer;
  einrichtungsleitung: Testbenutzer;
}

const PASSWORT = "correct horse battery staple";

async function legeBenutzerAn(
  admin: Client,
  mandantId: string,
  label: string,
  rolle: string
): Promise<Testbenutzer> {
  const email = `${label}-${randomUUID().slice(0, 8)}@beispiel.test`;
  // Niedrige Kostenstufe: Tests, kein Produktivsystem.
  const passwortHash = await bcrypt.hash(PASSWORT, 4);
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO benutzer (mandant_id, email, name, passwort_hash, rolle)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [mandantId, email, `Test ${rolle} ${label}`, passwortHash, rolle]
  );
  return { benutzerId: rows[0].id, email, passwort: PASSWORT };
}

async function seedMandant(admin: Client, label: string): Promise<Testmandant> {
  const slug = `brand-${label}-${randomUUID().slice(0, 8)}`;
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO mandant (name, slug) VALUES ($1, $2) RETURNING id",
    [`Testmandant ${label}`, slug]
  );
  const mandantId = rows[0].id;
  return {
    mandantId,
    slug,
    bereichsleitung: await legeBenutzerAn(admin, mandantId, `bereichsleitung-${label}`, "bereichsleitung"),
    einrichtungsleitung: await legeBenutzerAn(admin, mandantId, `einrichtungsleitung-${label}`, "einrichtungsleitung"),
  };
}

describe("Akzentfarbe je Mandant (Branding)", () => {
  let app: INestApplication;
  let admin: Client;
  let mandantA: Testmandant;
  let mandantB: Testmandant;

  beforeAll(async () => {
    if (!process.env.MIGRATIONS_DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error(
        "MIGRATIONS_DATABASE_URL und APP_DATABASE_URL muessen gesetzt sein (siehe .env.example)."
      );
    }
    admin = new Client({ connectionString: process.env.MIGRATIONS_DATABASE_URL });
    await admin.connect();

    mandantA = await seedMandant(admin, "a");
    mandantB = await seedMandant(admin, "b");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM benutzer WHERE mandant_id IN ($1, $2)", [
      mandantA.mandantId,
      mandantB.mandantId,
    ]);
    await admin.query("DELETE FROM mandant WHERE id IN ($1, $2)", [
      mandantA.mandantId,
      mandantB.mandantId,
    ]);
    await admin.end();
    await app.close();
  });

  async function login(m: Testmandant, benutzer: Testbenutzer): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ mandantSlug: m.slug, email: benutzer.email, passwort: benutzer.passwort });
    expect(res.status).toBe(201);
    return res.body.accessToken;
  }

  const hole = (token: string) =>
    request(app.getHttpServer()).get("/mandant/me").set("Authorization", `Bearer ${token}`);

  const setze = (token: string, akzentfarbe: unknown) =>
    request(app.getHttpServer())
      .patch("/mandant/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ akzentfarbe });

  const setzeDunkelGrundfarbe = (token: string, dunkelGrundfarbe: unknown) =>
    request(app.getHttpServer())
      .patch("/mandant/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ dunkelGrundfarbe });

  it("legt neue Mandanten mit der Standardfarbe an", async () => {
    const res = await hole(await login(mandantA, mandantA.bereichsleitung));
    expect(res.status).toBe(200);
    expect(res.body.akzentfarbe).toBe(STANDARDFARBE);
    expect(res.body.dunkelGrundfarbe).toBe(STANDARD_DUNKEL_GRUNDFARBE);
  });

  it("uebernimmt eine von der Bereichsleitung gesetzte Farbe dauerhaft", async () => {
    const token = await login(mandantA, mandantA.bereichsleitung);

    const gesetzt = await setze(token, "#a8a4f0");
    expect(gesetzt.status).toBe(200);
    expect(gesetzt.body.akzentfarbe).toBe("#a8a4f0");

    // Nicht nur der Antwortkoerper -- auch ein frischer Abruf.
    const erneut = await hole(token);
    expect(erneut.body.akzentfarbe).toBe("#a8a4f0");
  });

  it("haelt die Farben zweier Mandanten strikt getrennt", async () => {
    const tokenA = await login(mandantA, mandantA.bereichsleitung);
    const tokenB = await login(mandantB, mandantB.bereichsleitung);

    expect((await setze(tokenA, "#79c7a8")).status).toBe(200);
    expect((await setze(tokenB, "#f2a0b5")).status).toBe(200);

    // Beide Richtungen pruefen, samt Gegenprobe.
    const a = await hole(tokenA);
    const b = await hole(tokenB);
    expect(a.body.akzentfarbe).toBe("#79c7a8");
    expect(a.body.akzentfarbe).not.toBe("#f2a0b5");
    expect(b.body.akzentfarbe).toBe("#f2a0b5");
    expect(b.body.akzentfarbe).not.toBe("#79c7a8");
  });

  it("weist eine Rolle ohne Branding-Recht mit 403 ab und aendert nichts", async () => {
    const bereichsleitung = await login(mandantA, mandantA.bereichsleitung);
    await setze(bereichsleitung, "#5ec4c0");

    const einrichtungsleitung = await login(mandantA, mandantA.einrichtungsleitung);
    const abgewiesen = await setze(einrichtungsleitung, "#efce72");
    expect(abgewiesen.status).toBe(403);

    // Der Statuscode allein genuegt nicht -- der Wert muss unveraendert sein.
    const danach = await hole(bereichsleitung);
    expect(danach.body.akzentfarbe).toBe("#5ec4c0");
  });

  describe("Eingabepruefung", () => {
    const ungueltig: [string, unknown][] = [
      ["Wortlaut statt Hex", "rot"],
      ["zu kurz", "#12345"],
      ["keine Hexziffern", "#GGGGGG"],
      ["SQL-Anhaengsel", "#5ec4c0; DROP TABLE mandant"],
      ["sehr lang", `#${"a".repeat(400)}`],
      ["Zahl statt Zeichenkette", 12345],
      ["fehlend", undefined],
    ];

    it.each(ungueltig)("lehnt %s mit 400 ab", async (_label, wert) => {
      const token = await login(mandantA, mandantA.bereichsleitung);
      await setze(token, "#5ec4c0");

      const res = await setze(token, wert);
      expect(res.status).toBe(400);

      const danach = await hole(token);
      expect(danach.body.akzentfarbe).toBe("#5ec4c0");
    });

    it("nimmt Grossschreibung an und speichert klein", async () => {
      const token = await login(mandantA, mandantA.bereichsleitung);
      const res = await setze(token, "#5EC4C0");
      expect(res.status).toBe(200);
      // Die CHECK-Bedingung laesst nur Kleinbuchstaben zu -- ohne
      // Normalisierung im Controller waere das hier ein 500 aus der
      // Datenbank statt eines gespeicherten Wertes.
      expect(res.body.akzentfarbe).toBe("#5ec4c0");
    });
  });

  describe("dunkle Grundfarbe (unabhängig vom Akzent, Migration 0029)", () => {
    it("uebernimmt eine gesetzte Grundfarbe dauerhaft, ohne die Akzentfarbe zu beruehren", async () => {
      const token = await login(mandantA, mandantA.bereichsleitung);
      await setze(token, "#a8a4f0");

      const gesetzt = await setzeDunkelGrundfarbe(token, "#0d1913");
      expect(gesetzt.status).toBe(200);
      expect(gesetzt.body.dunkelGrundfarbe).toBe("#0d1913");
      // Die Gegenprobe zum eigentlichen Anliegen dieser Migration: das
      // Setzen der Grundfarbe darf die unabhaengige Akzentfarbe nicht
      // veraendern.
      expect(gesetzt.body.akzentfarbe).toBe("#a8a4f0");

      const erneut = await hole(token);
      expect(erneut.body.dunkelGrundfarbe).toBe("#0d1913");
    });

    it("haelt die Grundfarben zweier Mandanten strikt getrennt", async () => {
      const tokenA = await login(mandantA, mandantA.bereichsleitung);
      const tokenB = await login(mandantB, mandantB.bereichsleitung);

      expect((await setzeDunkelGrundfarbe(tokenA, "#16121f")).status).toBe(200);
      expect((await setzeDunkelGrundfarbe(tokenB, "#141414")).status).toBe(200);

      const a = await hole(tokenA);
      const b = await hole(tokenB);
      expect(a.body.dunkelGrundfarbe).toBe("#16121f");
      expect(a.body.dunkelGrundfarbe).not.toBe("#141414");
      expect(b.body.dunkelGrundfarbe).toBe("#141414");
      expect(b.body.dunkelGrundfarbe).not.toBe("#16121f");
    });

    it("weist eine Rolle ohne Branding-Recht mit 403 ab und aendert nichts", async () => {
      const bereichsleitung = await login(mandantA, mandantA.bereichsleitung);
      await setzeDunkelGrundfarbe(bereichsleitung, "#16151a");

      const einrichtungsleitung = await login(mandantA, mandantA.einrichtungsleitung);
      const abgewiesen = await setzeDunkelGrundfarbe(einrichtungsleitung, "#141414");
      expect(abgewiesen.status).toBe(403);

      const danach = await hole(bereichsleitung);
      expect(danach.body.dunkelGrundfarbe).toBe("#16151a");
    });

    it("lehnt einen ungueltigen Hex-Wert mit 400 ab", async () => {
      const token = await login(mandantA, mandantA.bereichsleitung);
      const res = await setzeDunkelGrundfarbe(token, "nicht-hex");
      expect(res.status).toBe(400);
    });

    it("lehnt einen leeren Body (weder akzentfarbe noch dunkelGrundfarbe) mit 400 ab", async () => {
      const token = await login(mandantA, mandantA.bereichsleitung);
      const res = await request(app.getHttpServer())
        .patch("/mandant/me")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  /**
   * Diese beiden Faelle umgehen die Anwendung bewusst: sie pruefen die
   * Zusicherungen der Datenbank selbst. Ohne sie wuerde ein spaeteres
   * Entfernen von REVOKE/GRANT oder der CHECK-Bedingung unbemerkt bleiben,
   * solange der Controller noch richtig liegt.
   */
  describe("Zusicherungen der Datenbank (unterhalb der Anwendung)", () => {
    let appRolle: Client;

    beforeAll(async () => {
      appRolle = new Client({ connectionString: process.env.APP_DATABASE_URL });
      await appRolle.connect();
    });

    afterAll(async () => {
      await appRolle.end();
    });

    async function alsMandant<T>(mandantId: string, fn: () => Promise<T>): Promise<T> {
      await appRolle.query("BEGIN");
      await appRolle.query("SELECT set_config('app.mandant_id', $1, true)", [mandantId]);
      try {
        return await fn();
      } finally {
        await appRolle.query("ROLLBACK");
      }
    }

    it("erlaubt der App-Rolle NUR die Spalten akzentfarbe und dunkel_grundfarbe", async () => {
      await alsMandant(mandantA.mandantId, async () => {
        await expect(
          appRolle.query("UPDATE mandant SET akzentfarbe = '#123456'")
        ).resolves.toBeTruthy();
      });
      await alsMandant(mandantA.mandantId, async () => {
        await expect(
          appRolle.query("UPDATE mandant SET dunkel_grundfarbe = '#101010'")
        ).resolves.toBeTruthy();
      });

      // slug ist der Login-Pfad: koennte die App-Rolle ihn aendern, liesse
      // sich damit der Anmeldeweg eines anderen Traegers kapern.
      for (const spalte of ["slug = 'gekapert'", "name = 'Fremd'", "aktiv = false"]) {
        await alsMandant(mandantA.mandantId, async () => {
          await expect(appRolle.query(`UPDATE mandant SET ${spalte}`)).rejects.toThrow(
            /permission denied/i
          );
        });
      }
    });

    it("setzt die CHECK-Bedingung auch ohne die zod-Pruefung durch", async () => {
      for (const wert of ["nicht-hex", "#ABCDEF", "#12345"]) {
        await alsMandant(mandantA.mandantId, async () => {
          await expect(
            appRolle.query("UPDATE mandant SET akzentfarbe = $1", [wert])
          ).rejects.toThrow(/check constraint/i);
        });
        await alsMandant(mandantA.mandantId, async () => {
          await expect(
            appRolle.query("UPDATE mandant SET dunkel_grundfarbe = $1", [wert])
          ).rejects.toThrow(/check constraint/i);
        });
      }
    });
  });
});
