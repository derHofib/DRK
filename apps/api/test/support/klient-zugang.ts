/**
 * Test-Fixture: legt einen bereits eingeloesten Klient-Zugang direkt in der
 * DB an (statt ueber Einladungslink + Einloesen), damit Chat-/Kalender-Specs
 * nicht jedes Mal den ganzen Einladungsweg durchlaufen. Der Weg selbst ist in
 * klient-zugang.e2e-spec.ts abgedeckt.
 */
import { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";

export async function legeKlientZugangAn(
  admin: Client,
  params: { mandantId: string; klientId: string; email: string; passwortHash: string; eingeladenVon: string; aktiv?: boolean }
): Promise<void> {
  await admin.query(
    `INSERT INTO klient_zugang (mandant_id, klient_id, email, passwort_hash, aktiv, eingeladen_von)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.mandantId, params.klientId, params.email, params.passwortHash, params.aktiv ?? true, params.eingeladenVon]
  );
}

export async function klientToken(app: INestApplication, mandantSlug: string, email: string, passwort: string): Promise<string> {
  const res = await request(app.getHttpServer()).post("/auth/klient/login").send({ mandantSlug, email, passwort });
  if (res.status !== 201) throw new Error(`Klient-Login fehlgeschlagen: ${res.status}`);
  return res.body.accessToken as string;
}
