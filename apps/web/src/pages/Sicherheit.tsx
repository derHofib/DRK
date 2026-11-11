import { FormEvent, useEffect, useState } from "react";
import type { TotpEinrichtenResponse } from "@zimmerakte/shared";
import { api } from "../api/client";
import {
  I2faAus,
  I2faEin,
  IBestaetigen,
  IErfolg,
  IFehler,
  IGeraet,
  IPasswort,
  ISErledigt,
  ISOffen,
  ISicherheit,
  ISpeichern,
} from "../components/icons";

type GeraetEintrag = Awaited<ReturnType<typeof api.geraete>>[number];

/**
 * Kopplung der iPhone-App. Der QR-Code enthaelt ein Einmal-Token, das nach 5
 * Minuten verfaellt -- deshalb wird er nur auf Knopfdruck erzeugt und nach
 * Ablauf ausgeblendet, statt dauerhaft auf einem Bildschirm zu stehen, den
 * andere sehen koennten.
 */
function GeraeteKoppeln() {
  const [geraete, setGeraete] = useState<GeraetEintrag[]>([]);
  const [kopplung, setKopplung] = useState<{ qrCodeDataUrl: string; laeuftAbAm: string } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  function laden() {
    api.geraete().then(setGeraete).catch(() => setFehler("Geräte konnten nicht geladen werden."));
  }
  useEffect(laden, []);

  useEffect(() => {
    if (!kopplung) return;
    const rest = new Date(kopplung.laeuftAbAm).getTime() - Date.now();
    const timer = setTimeout(() => {
      setKopplung(null);
      laden();
    }, Math.max(rest, 0));
    return () => clearTimeout(timer);
  }, [kopplung]);

  async function erzeugen() {
    setFehler(null);
    try {
      setKopplung(await api.geraeteKopplungErstellen());
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kopplungscode konnte nicht erzeugt werden.");
    }
  }

  async function sperren(id: string) {
    setFehler(null);
    try {
      await api.geraetSperren(id);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Gerät konnte nicht gesperrt werden.");
    }
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>
        <IGeraet />
        App koppeln
      </h3>
      <p className="zv-sub">
        Öffne die Zimmerakte-App auf dem iPhone und scanne den Code. Er gilt 5 Minuten und nur einmal.
      </p>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {kopplung ? (
        <img src={kopplung.qrCodeDataUrl} alt="QR-Code zum Koppeln der App" style={{ width: 200, height: 200 }} />
      ) : (
        <button className="zv-btn" onClick={erzeugen}>
          <IGeraet />
          Code erzeugen
        </button>
      )}
      {geraete.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {geraete.map((g) => (
            <li key={g.id}>
              <strong>{g.name}</strong>{" "}
              <span className="zv-sub">
                {g.gesperrtAm ? "gesperrt" : `zuletzt aktiv ${new Date(g.zuletztGesehenAm).toLocaleDateString("de-DE")}`}
              </span>{" "}
              {!g.gesperrtAm && (
                <button className="zv-link-btn" onClick={() => sperren(g.id)}>
                  Sperren
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PasswortAendern() {
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function aendern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFehler(null);
    setErfolg(null);
    setWirdGespeichert(true);
    try {
      await api.passwortAendern(String(form.get("aktuellesPasswort")), String(form.get("neuesPasswort")));
      formElement.reset();
      setErfolg("Passwort geändert.");
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Passwort konnte nicht geändert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>
        <IPasswort />
        Passwort ändern
      </h3>
      <p className="zv-sub">Gilt nur für dein eigenes Konto.</p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}

      <form onSubmit={aendern}>
        <div className="zv-field">
          <label>Aktuelles Passwort</label>
          <input name="aktuellesPasswort" type="password" autoComplete="current-password" required />
        </div>
        <div className="zv-field">
          <label>Neues Passwort</label>
          <input name="neuesPasswort" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : "Passwort ändern"}
        </button>
      </form>
    </section>
  );
}

export function Sicherheit() {
  const [aktiviert, setAktiviert] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<TotpEinrichtenResponse | null>(null);
  const [deaktivierenOffen, setDeaktivierenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);

  function ladeStatus() {
    api.totpStatus().then((r) => setAktiviert(r.aktiviert)).catch((err) => setFehler(err.message));
  }

  useEffect(ladeStatus, []);

  async function einrichten() {
    setFehler(null);
    setErfolg(null);
    try {
      setSetup(await api.totpEinrichten());
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Einrichtung konnte nicht gestartet werden.");
    }
  }

  async function aktivieren(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFehler(null);
    try {
      await api.totpAktivieren(String(form.get("code")));
      setSetup(null);
      setErfolg("Zwei-Faktor-Anmeldung ist jetzt aktiv.");
      ladeStatus();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Code ungültig.");
    }
  }

  async function deaktivieren(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFehler(null);
    try {
      await api.totpDeaktivieren(String(form.get("code")));
      setDeaktivierenOffen(false);
      formElement.reset();
      setErfolg("Zwei-Faktor-Anmeldung wurde deaktiviert.");
      ladeStatus();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Code ungültig.");
    }
  }

  return (
    <div className="zv-card zv-card-weit">
      <PasswortAendern />

      <section className="zv-einstellungen-abschnitt">
        <h3>
          <ISicherheit />
          Zwei-Faktor-Anmeldung (2FA)
        </h3>
        <p className="zv-sub">Schützt dein persönliches Konto zusätzlich zum Passwort.</p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}

      {aktiviert === null && <p className="zv-sub">Lädt…</p>}

      {aktiviert === true && !deaktivierenOffen && (
        <div>
          <p className="zv-sub">
            <span className="zv-pill zv-pill-ok">
              <ISErledigt />
              Aktiv
            </span>
          </p>
          <button className="zv-link-btn" onClick={() => setDeaktivierenOffen(true)}>
            <I2faAus />
            2FA deaktivieren
          </button>
        </div>
      )}

      {aktiviert === true && deaktivierenOffen && (
        <form className="zv-inline-form" onSubmit={deaktivieren}>
          <div className="zv-field">
            <label>Code aus der Authenticator-App zur Bestätigung</label>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
          </div>
          <button className="zv-btn zv-btn-gefahr" type="submit">
            <I2faAus />
            Deaktivieren
          </button>
        </form>
      )}

      {aktiviert === false && !setup && (
        <div>
          <p className="zv-sub">
            <span className="zv-pill zv-pill-offen">
              <ISOffen />
              Nicht aktiv
            </span>
          </p>
          <button className="zv-btn" onClick={einrichten}>
            <I2faEin />
            2FA einrichten
          </button>
        </div>
      )}

      {setup && (
        <div>
          <p className="zv-sub">
            Mit einer Authenticator-App (z. B. Google Authenticator, Authy) scannen oder den Code manuell eintragen:
          </p>
          <img src={setup.qrCodeDataUrl} alt="QR-Code für 2FA-Einrichtung" style={{ width: 180, height: 180 }} />
          <p className="zv-mono" style={{ fontSize: 12.5, wordBreak: "break-all", marginBottom: 14 }}>
            {setup.secret}
          </p>
          <form onSubmit={aktivieren}>
            <div className="zv-field">
              <label>Code aus der App zur Bestätigung</label>
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </div>
            <button className="zv-btn" type="submit">
              <IBestaetigen />
              Aktivieren
            </button>
          </form>
        </div>
      )}
      </section>

      <GeraeteKoppeln />
    </div>
  );
}
