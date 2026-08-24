import { FormEvent, useState } from "react";
import { api, setToken } from "../api/client";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mandantSlug, setMandantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladt, setLadt] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    setLadt(true);
    try {
      const { accessToken } = await api.login({ mandantSlug, email, passwort });
      setToken(accessToken);
      onLoggedIn();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setLadt(false);
    }
  }

  return (
    <div className="zv-shell">
      <form className="zv-card" onSubmit={submit}>
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
