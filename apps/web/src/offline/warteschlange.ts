import { useEffect, useState } from "react";
import { ApiFehler, api, tokenBenutzerId, type KassenbuchungAnlegenPayload } from "../api/client";

/**
 * Offline-Warteschlange fuer Kassenbuchungen (Bauplan Phase 4).
 *
 * Im Treppenhaus gibt es keinen Empfang, das Bargeld wird trotzdem
 * ausgegeben und quittiert. Die Buchung samt Unterschrift landet deshalb
 * ZUERST hier und erst danach im Netz -- auch wenn gerade Verbindung besteht:
 * bricht die Verbindung mitten in der Anfrage ab, weiss der Client nicht, ob
 * der Server committet hat. Mit dem Eintrag hier und seinem festen
 * Idempotenzschluessel ist das egal: er wird so lange erneut gesendet, bis
 * eine Antwort kommt, und der Server legt fuer denselben Schluessel
 * hoechstens eine Buchung an (Migration 0062).
 *
 * localStorage statt IndexedDB: Eintraege sind wenige und klein (eine
 * Unterschrift als PNG ist ein paar KB), und dieselbe synchrone API nutzen
 * Entwurf und Befehlspalette schon. Gespeichert werden nur IDs, Betrag,
 * Datum, Zweck und die Unterschrift -- keine Namen; die zeigt die Oberflaeche
 * aus dem, was sie ohnehin geladen hat.
 *
 * Das ist eine bewusste Ausnahme von "der Service Worker cacht keine
 * Geschaeftsdaten" (README): ohne sie ginge eine quittierte Barauszahlung
 * verloren, sobald jemand im Funkloch auf Speichern tippt. Die Eintraege
 * leben nur bis zur Bestaetigung durch den Server (TTDSG §25 Abs. 2 Nr. 2:
 * fuer die gewuenschte Funktion unbedingt erforderlich).
 *
 * Beim Abmelden bleiben sie absichtlich liegen: das Geld ist ausgegeben, der
 * Beleg darf nicht mit der Sitzung verschwinden. Jeder Eintrag gehoert der
 * Person, die ihn erfasst hat, und nur deren Sitzung sendet ihn -- meldet
 * sich auf dem Geraet jemand anderes an, wuerde der Server ihn sonst unter
 * dem falschen Namen buchen (gebucht_von).
 */

export interface WarteschlangenEintrag {
  /** Idempotency-Key, beim Erfassen erzeugt und danach nie mehr geaendert. */
  schluessel: string;
  benutzerId: string;
  erfasstAm: string;
  payload: KassenbuchungAnlegenPayload;
  /**
   * "abgelehnt": der Server hat inhaltlich nein gesagt (z. B. HZL dieser Woche
   * inzwischen von jemand anderem gebucht, Recht entzogen). Ein weiterer
   * Versuch aendert daran nichts -- der Eintrag bleibt sichtbar, bis die
   * Person ihn verwirft, weil das Geld trotzdem ausgegeben wurde.
   */
  status: "wartet" | "abgelehnt";
  fehler?: string;
}

const SCHLUESSEL = "zv-kassenbuch-warteschlange";

function allesLesen(): WarteschlangenEintrag[] {
  try {
    const roh = JSON.parse(localStorage.getItem(SCHLUESSEL) ?? "[]") as unknown;
    return Array.isArray(roh) ? roh.filter((e) => typeof e?.schluessel === "string" && typeof e?.benutzerId === "string") : [];
  } catch {
    return [];
  }
}

const beobachter = new Set<() => void>();

function allesSchreiben(eintraege: WarteschlangenEintrag[]) {
  // Kein try/catch: scheitert das Speichern (Speicher voll, Privatmodus),
  // muss der Aufrufer davon erfahren, statt eine Auszahlung zu bestaetigen,
  // die nirgends steht.
  if (eintraege.length === 0) localStorage.removeItem(SCHLUESSEL);
  else localStorage.setItem(SCHLUESSEL, JSON.stringify(eintraege));
  beobachter.forEach((f) => f());
}

/** Nur die Eintraege der angemeldeten Person. */
export function eigeneEintraege(): WarteschlangenEintrag[] {
  const ich = tokenBenutzerId();
  return ich ? allesLesen().filter((e) => e.benutzerId === ich) : [];
}

export function einreihen(payload: KassenbuchungAnlegenPayload): WarteschlangenEintrag {
  const benutzerId = tokenBenutzerId();
  if (!benutzerId) throw new Error("Nicht angemeldet.");
  const eintrag: WarteschlangenEintrag = {
    schluessel: crypto.randomUUID(),
    benutzerId,
    erfasstAm: new Date().toISOString(),
    payload,
    status: "wartet",
  };
  allesSchreiben([...allesLesen(), eintrag]);
  return eintrag;
}

export function entfernen(schluessel: string) {
  allesSchreiben(allesLesen().filter((e) => e.schluessel !== schluessel));
}

function ablehnen(schluessel: string, fehler: string) {
  allesSchreiben(allesLesen().map((e) => (e.schluessel === schluessel ? { ...e, status: "abgelehnt" as const, fehler } : e)));
}

/**
 * Ob ein Fehler endgueltig ist. Alles ohne HTTP-Status (fetch scheitert
 * offline mit TypeError, die Raten-Schranke kommt als einfacher Error) und
 * jeder 5xx ist voruebergehend: spaeter nochmal. 401 ebenso -- die Sitzung
 * ist abgelaufen, nach der neuen Anmeldung geht es weiter. Jeder andere 4xx
 * ist die Antwort des Servers auf genau diesen Inhalt; dieselbe Anfrage noch
 * einmal bekaeme dieselbe Antwort.
 */
export function istEndgueltig(err: unknown): err is ApiFehler {
  return err instanceof ApiFehler && err.status >= 400 && err.status < 500 && err.status !== 401;
}

export type SendeErgebnis = "gebucht" | "wartet" | "abgelehnt";

// Schluessel, fuer die in diesem Tab gerade eine Anfrage laeuft. Das Formular
// sendet direkt nach dem Einreihen selbst (es braucht das Ergebnis fuer die
// Fehlermeldung), und das Einreihen weckt zugleich useAutomatischUebertragen --
// ohne diese Menge ginge derselbe Eintrag zweimal parallel raus. Der Server
// wuerde das abfangen, aber eine vermeidbare Doppelsendung ist keine Probe,
// auf die man sich im Normalbetrieb verlassen sollte.
const imFlug = new Set<string>();

/** Ein einzelner Versuch fuer einen Eintrag. Wirft nie. */
export async function senden(eintrag: WarteschlangenEintrag): Promise<{ ergebnis: SendeErgebnis; fehler?: unknown }> {
  imFlug.add(eintrag.schluessel);
  try {
    await api.kassenbuchungAnlegen(eintrag.payload, eintrag.schluessel);
    entfernen(eintrag.schluessel);
    return { ergebnis: "gebucht" };
  } catch (err) {
    if (istEndgueltig(err)) {
      ablehnen(eintrag.schluessel, err.message);
      return { ergebnis: "abgelehnt", fehler: err };
    }
    return { ergebnis: "wartet", fehler: err };
  } finally {
    imFlug.delete(eintrag.schluessel);
  }
}

// Ein Lauf zur Zeit je Tab: "online"-Ereignis, Intervall und der Knopf
// "Jetzt übertragen" koennen gleichzeitig ausloesen, sie teilen sich dann
// denselben Lauf. Zwischen Tabs gibt es keine Sperre -- dort faengt der
// Idempotenzschluessel doppelte Sendungen ab, und das ist die Garantie, auf
// die es ankommt.
let laufend: Promise<void> | null = null;

async function lauf(): Promise<void> {
  for (const eintrag of eigeneEintraege().filter((e) => e.status === "wartet" && !imFlug.has(e.schluessel))) {
    const { ergebnis } = await senden(eintrag);
    // Keine Verbindung: die uebrigen Eintraege scheitern genauso.
    if (ergebnis === "wartet") break;
  }
}

export function uebertragen(): Promise<void> {
  if (laufend) return laufend;
  // Freigeben per .finally() am fertigen Promise, NICHT per try/finally im
  // async-Rumpf: gibt es nichts zu senden, laeuft der Rumpf ohne ein einziges
  // await durch, sein finally setzte laufend = null noch VOR der Zuweisung
  // hier -- und die Sperre bliebe fuer immer stehen. Genau so im Browser
  // gemessen (scripts/offline-pruefung.mjs): nach dem ersten Offline-Speichern
  // ging bis zum Neuladen kein Versuch mehr raus.
  laufend = lauf().finally(() => {
    laufend = null;
  });
  return laufend;
}

/**
 * Eintraege der angemeldeten Person, live -- auch wenn ein anderer Tab sie
 * aendert ("storage"-Ereignis).
 */
export function useWarteschlange(): WarteschlangenEintrag[] {
  const [eintraege, setEintraege] = useState(eigeneEintraege);
  useEffect(() => {
    const neu = () => setEintraege(eigeneEintraege());
    const ausAnderemTab = (e: StorageEvent) => {
      if (e.key === SCHLUESSEL) neu();
    };
    beobachter.add(neu);
    window.addEventListener("storage", ausAnderemTab);
    return () => {
      beobachter.delete(neu);
      window.removeEventListener("storage", ausAnderemTab);
    };
  }, []);
  return eintraege;
}

const INTERVALL_MS = 30_000;

/**
 * Sendet automatisch: beim Start (also auch nach einer neuen Anmeldung),
 * sobald der Browser wieder online meldet, und alle 30 s, solange etwas
 * wartet -- "online" allein reicht nicht, der Browser meldet es auch bei
 * einem WLAN ohne Internet.
 */
export function useAutomatischUebertragen(eintraege: WarteschlangenEintrag[]) {
  const wartet = eintraege.some((e) => e.status === "wartet");
  useEffect(() => {
    if (!wartet) return;
    void uebertragen();
    const online = () => void uebertragen();
    window.addEventListener("online", online);
    const takt = window.setInterval(() => void uebertragen(), INTERVALL_MS);
    return () => {
      window.removeEventListener("online", online);
      window.clearInterval(takt);
    };
  }, [wartet]);
}
