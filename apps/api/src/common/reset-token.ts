import { createHash, randomBytes } from "node:crypto";

/**
 * Gemeinsam von benutzer.service.ts (Token erzeugen) und auth.service.ts
 * (Token einloesen) genutzt, damit beide Seiten garantiert denselben Hash
 * fuer denselben Roh-Token berechnen.
 *
 * Reset-Tokens sind zufaellig und hochentropisch (256 Bit) -- ein einfacher,
 * schneller Hash reicht hier, anders als bei Passwoertern selbst braucht es
 * kein absichtlich langsames bcrypt gegen Bruteforce (der Suchraum macht
 * das ohnehin aussichtslos). SHA-256 macht den gespeicherten Wert nur
 * wertlos, falls die Datenbank je ausgelesen wird -- der Roh-Token selbst
 * wird nirgends gespeichert.
 */
export function neuerResetToken(): string {
  return randomBytes(32).toString("hex");
}

export function resetTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
