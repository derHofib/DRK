import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Verschluesselt kleine Geheimnisse (aktuell: benutzer.totp_secret) an der
 * Anwendungsschicht, bevor sie in die Datenbank gehen -- siehe Kommentar
 * auf der Spalte in migrations/0004_benutzer.sql: "kein Klartext-Vertrauen
 * ins Schema". Ein DB-Dump oder ein Lesezugriff mit der Migrations-Rolle
 * allein reicht damit nicht, um TOTP-Codes faelschen zu koennen.
 *
 * AES-256-GCM (authentisiert) statt z.B. AES-CBC, damit eine manipulierte
 * Chiffre beim Entschluesseln auffliegt, statt still falsche Bytes zu
 * liefern.
 */
const ALGORITHMUS = "aes-256-gcm";

function schluessel(): Buffer {
  const roh = process.env.TOTP_ENCRYPTION_KEY;
  if (!roh) {
    throw new Error("TOTP_ENCRYPTION_KEY ist nicht gesetzt -- siehe .env.example.");
  }
  const key = Buffer.from(roh, "base64");
  if (key.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY muss, base64-dekodiert, genau 32 Bytes lang sein.");
  }
  return key;
}

export function verschluesseln(klartext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHMUS, schluessel(), iv);
  const chiffre = Buffer.concat([cipher.update(klartext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, chiffre].map((b) => b.toString("base64")).join(".");
}

export function entschluesseln(gespeichert: string): string {
  const [ivB64, authTagB64, chiffreB64] = gespeichert.split(".");
  if (!ivB64 || !authTagB64 || !chiffreB64) {
    throw new Error("Ungültiges Format eines verschlüsselten Geheimnisses.");
  }
  const decipher = createDecipheriv(ALGORITHMUS, schluessel(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const klartext = Buffer.concat([decipher.update(Buffer.from(chiffreB64, "base64")), decipher.final()]);
  return klartext.toString("utf8");
}
