import { FormEvent, useState } from "react";
import { api, setToken } from "../api/client";
import {
  IAnmelden,
  IBestaetigen,
  IFehler,
  ISichtbar,
  IVerborgen,
  IZurueck,
} from "../components/icons";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mandantSlug, setMandantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [code, setCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladt, setLadt] = useState(false);
  const [passwortSichtbar, setPasswortSichtbar] = useState(false);

  async function submitPasswort(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    setLadt(true);
    try {
      const ergebnis = await api.login({ mandantSlug, email, passwort });
      if ("totpErforderlich" in ergebnis) {
        setPendingToken(ergebnis.pendingToken);
      } else {
        setToken(ergebnis.accessToken);
        onLoggedIn();
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setLadt(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setFehler(null);
    setLadt(true);
    try {
      const { accessToken } = await api.loginTotp(pendingToken, code);
      setToken(accessToken);
      onLoggedIn();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Code ungültig.");
    } finally {
      setLadt(false);
    }
  }

  if (pendingToken) {
    return (
      <div className="zv-shell">
        <form className="zv-card" onSubmit={submitCode}>
          <h1>Zimmerakte</h1>
          <p className="zv-sub">Zwei-Faktor-Bestätigung</p>

          {fehler && (
            <div className="zv-hinweis zv-hinweis-fehler">
              <IFehler />
              {fehler}
            </div>
          )}

          <div className="zv-field">
            <label htmlFor="code">Code aus der Authenticator-App</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
          </div>

          <button className="zv-btn zv-btn-block" type="submit" disabled={ladt}>
            <IBestaetigen />
            {ladt ? "Prüft…" : "Bestätigen"}
          </button>
          <button
            type="button"
            className="zv-link-btn"
            style={{ marginTop: 10 }}
            onClick={() => {
              setPendingToken(null);
              setCode("");
              setFehler(null);
            }}
          >
            <IZurueck />
            Zurück zur Anmeldung
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="zv-shell">
      <form className="zv-card" onSubmit={submitPasswort}>
        <h1>Zimmerakte</h1>
        <p className="zv-sub">Anmeldung</p>

        {fehler && (
            <div className="zv-hinweis zv-hinweis-fehler">
              <IFehler />
              {fehler}
            </div>
          )}

        <div className="zv-field">
          <label htmlFor="mandantSlug">Träger-Kennung</label>
          <input
            id="mandantSlug"
            value={mandantSlug}
            onChange={(e) => setMandantSlug(e.target.value)}
            placeholder="z. B. drk-musterverband"
            required
          />
        </div>
        <div className="zv-field">
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="zv-field">
          <label htmlFor="passwort">Passwort</label>
          <div style={{ position: "relative" }}>
            <input
              id="passwort"
              type={passwortSichtbar ? "text" : "password"}
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              style={{ paddingRight: 44 }}
              required
            />
            {/* Rein ikonisch, deshalb zwingend mit aria-label. */}
            <button
              type="button"
              className="zv-icon-btn"
              style={{ position: "absolute", right: 3, top: 3 }}
              onClick={() => setPasswortSichtbar((s) => !s)}
              aria-label={passwortSichtbar ? "Passwort verbergen" : "Passwort anzeigen"}
              title={passwortSichtbar ? "Passwort verbergen" : "Passwort anzeigen"}
            >
              {passwortSichtbar ? <IVerborgen /> : <ISichtbar />}
            </button>
          </div>
        </div>

        <button className="zv-btn zv-btn-block" type="submit" disabled={ladt}>
          <IAnmelden />
          {ladt ? "Meldet an…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
