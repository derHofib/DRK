import { FormEvent, useState } from "react";
import { api, setToken } from "../api/client";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mandantSlug, setMandantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [code, setCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladt, setLadt] = useState(false);

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

          {fehler && <div className="zv-error">{fehler}</div>}

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

          <button className="zv-btn" type="submit" disabled={ladt}>
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

        {fehler && <div className="zv-error">{fehler}</div>}

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
          <input
            id="passwort"
            type="password"
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
            required
          />
        </div>

        <button className="zv-btn" type="submit" disabled={ladt}>
          {ladt ? "Meldet an…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
