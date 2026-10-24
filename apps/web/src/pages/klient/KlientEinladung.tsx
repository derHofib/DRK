import { FormEvent, useState } from "react";
import { ApiFehler, api } from "../../api/client";
import { IBestaetigen, IErfolg, IFehler, ISichtbar, IVerborgen } from "../../components/icons";
import { MarkenZeichen } from "../../components/MarkenZeichen";

const LINK_UNGUELTIG =
  "Der Link ist ungültig oder abgelaufen. Bitte fordere bei deiner Betreuung einen neuen Link an.";

/**
 * Einladungslink einloesen: laeuft wie die Reset-Seite unabhaengig vom
 * Login-Zustand (siehe App.tsx). Das Passwort waehlt nur die Person selbst,
 * die den Link oeffnet.
 */
export function KlientEinladung({ token, onFertig }: { token: string; onFertig: () => void }) {
  const [neuesPasswort, setNeuesPasswort] = useState("");
  const [wiederholung, setWiederholung] = useState("");
  const [sichtbar, setSichtbar] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladt, setLadt] = useState(false);
  const [erledigt, setErledigt] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (neuesPasswort.length < 8) {
      setFehler("Das Passwort braucht mindestens 8 Zeichen.");
      return;
    }
    if (neuesPasswort !== wiederholung) {
      setFehler("Die beiden Passwörter sind nicht gleich.");
      return;
    }
    setLadt(true);
    try {
      await api.klientEinladungEinloesen(token, neuesPasswort);
      setErledigt(true);
    } catch (err) {
      // 401 = Link unbekannt, abgelaufen oder schon benutzt (der Server unterscheidet das bewusst nicht).
      setFehler(err instanceof ApiFehler && err.status === 401 ? LINK_UNGUELTIG : err instanceof Error ? err.message : LINK_UNGUELTIG);
    } finally {
      setLadt(false);
    }
  }

  if (erledigt) {
    return (
      <div className="zv-shell">
        <div className="zv-card">
          <h1>
            <MarkenZeichen iconGroesse={26} />
          </h1>
          <p className="zv-sub">Passwort festgelegt</p>
          <div className="zv-hinweis zv-hinweis-erfolg">
            <IErfolg />
            Dein Passwort ist gespeichert. Du kannst dich jetzt anmelden. Die Träger-Kennung steht in deiner Einladung oder du fragst deine Betreuung.
          </div>
          <button className="zv-btn zv-btn-block" style={{ marginTop: 14 }} onClick={onFertig}>
            Zur Anmeldung
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="zv-shell">
      <form className="zv-card" onSubmit={submit}>
        <h1>
          <MarkenZeichen iconGroesse={26} />
        </h1>
        <p className="zv-sub">Passwort festlegen</p>
        <p style={{ marginTop: 0 }}>Willkommen. Wähle ein Passwort für deinen Zugang. Es braucht mindestens 8 Zeichen.</p>

        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler" role="alert">
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
          <label htmlFor="wiederholung">Passwort noch einmal</label>
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
