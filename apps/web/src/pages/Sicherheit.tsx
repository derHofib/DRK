import { FormEvent, useEffect, useState } from "react";
import type { TotpEinrichtenResponse } from "@zimmerakte/shared";
import { api } from "../api/client";
import {
  I2faAus,
  I2faEin,
  IBestaetigen,
  IErfolg,
  IFehler,
  IPasswort,
  ISErledigt,
  ISOffen,
  ISicherheit,
  ISpeichern,
} from "../components/icons";

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
    </div>
  );
}
