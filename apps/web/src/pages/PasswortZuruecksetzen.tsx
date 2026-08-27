import { FormEvent, useState } from "react";
import { api } from "../api/client";
import { IBestaetigen, IErfolg, IFehler, ISichtbar, IVerborgen } from "../components/icons";

/**
 * Zweite Haelfte des "Leitung stoesst Reset an, sieht aber nur einen
 * Link"-Flusses: wer hier landet, ist per Definition ausgesperrt und daher
 * NICHT eingeloggt -- diese Seite laeuft unabhaengig vom normalen
 * Login/Shell-Zustand (siehe App.tsx). Das neue Passwort waehlt aus-
 * schliesslich die Person selbst, die den Link geoeffnet hat.
 */
export function PasswortZuruecksetzen({ token }: { token: string }) {
  const [neuesPasswort, setNeuesPasswort] = useState("");
  const [wiederholung, setWiederholung] = useState("");
  const [sichtbar, setSichtbar] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladt, setLadt] = useState(false);
  const [erledigt, setErledigt] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (neuesPasswort !== wiederholung) {
      setFehler("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setLadt(true);
    try {
      await api.passwortResetEinloesen(token, neuesPasswort);
      setErledigt(true);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Link ungültig oder abgelaufen.");
    } finally {
      setLadt(false);
    }
  }

  // Entfernt den Token aus der URL, bevor es zur normalen Anmeldung geht --
  // der Token ist ohnehin schon verbraucht, aber ein Lesezeichen auf diese
  // URL soll trotzdem nicht dauerhaft ein (totes) Reset-Formular zeigen.
  function zurAnmeldung() {
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    window.history.replaceState({}, "", url.toString());
    window.location.reload();
  }

  if (erledigt) {
    return (
      <div className="zv-shell">
        <div className="zv-card">
          <h1>Zimmerakte</h1>
          <p className="zv-sub">Neues Passwort gesetzt</p>
          <div className="zv-hinweis zv-hinweis-erfolg">
            <IErfolg />
            Dein Passwort wurde geändert. Du kannst dich jetzt damit anmelden.
          </div>
          <button className="zv-btn zv-btn-block" style={{ marginTop: 14 }} onClick={zurAnmeldung}>
            Zur Anmeldung
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="zv-shell">
      <form className="zv-card" onSubmit={submit}>
        <h1>Zimmerakte</h1>
        <p className="zv-sub">Neues Passwort festlegen</p>

        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}

        <div className="zv-field">
          <label htmlFor="neuesPasswort">Neues Passwort</label>
          <div style={{ position: "relative" }}>
            <input
              id="neuesPasswort"
              type={sichtbar ? "text" : "password"}
              value={neuesPasswort}
              onChange={(e) => setNeuesPasswort(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              style={{ paddingRight: 44 }}
              autoFocus
              required
            />
            {/* Rein ikonisch, deshalb zwingend mit aria-label. */}
            <button
              type="button"
              className="zv-icon-btn"
              style={{ position: "absolute", right: 3, top: 3 }}
              onClick={() => setSichtbar((s) => !s)}
              aria-label={sichtbar ? "Passwort verbergen" : "Passwort anzeigen"}
              title={sichtbar ? "Passwort verbergen" : "Passwort anzeigen"}
            >
              {sichtbar ? <IVerborgen /> : <ISichtbar />}
            </button>
          </div>
        </div>

        <div className="zv-field">
          <label htmlFor="wiederholung">Neues Passwort wiederholen</label>
          <input
            id="wiederholung"
            type={sichtbar ? "text" : "password"}
            value={wiederholung}
            onChange={(e) => setWiederholung(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <button className="zv-btn zv-btn-block" type="submit" disabled={ladt}>
          <IBestaetigen />
          {ladt ? "Speichert…" : "Passwort festlegen"}
        </button>
      </form>
    </div>
  );
}
