import { FormEvent, useEffect, useState } from "react";
import { ApiFehler, api } from "../../api/client";
import { IBestaetigen, IErfolg, IFehler, ISichtbar, IVerborgen } from "../../components/icons";
import { MarkenZeichen } from "../../components/MarkenZeichen";

const LINK_UNGUELTIG =
  "Der Link ist ungültig oder abgelaufen. Bitte fordere bei deiner Betreuung einen neuen Link an.";

/**
 * E-Mail-Adresse des Klient-Zugangs aendern. Die Seite zeigt vorab die
 * maskierte bisherige Adresse (damit man erkennt, dass der Link zum eigenen
 * Zugang gehoert) und verlangt das Passwort: gerät der Link in falsche Haende,
 * reicht er allein nicht.
 */
export function KlientEmailAendern({ token, onFertig }: { token: string; onFertig: () => void }) {
  const [maskiert, setMaskiert] = useState<string | null>(null);
  const [linkFehler, setLinkFehler] = useState<string | null>(null);
  const [neueEmail, setNeueEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [sichtbar, setSichtbar] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladt, setLadt] = useState(false);
  const [erledigt, setErledigt] = useState(false);

  useEffect(() => {
    api
      .klientEmailAendernPruefen(token)
      .then((r) => setMaskiert(r.emailMaskiert))
      .catch((err) => setLinkFehler(err instanceof ApiFehler && err.status === 404 ? LINK_UNGUELTIG : err instanceof Error ? err.message : LINK_UNGUELTIG));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    setLadt(true);
    try {
      await api.klientEmailAendernEinloesen(token, neueEmail.trim(), passwort);
      setErledigt(true);
    } catch (err) {
      if (err instanceof ApiFehler && err.status === 409) {
        setFehler("Diese E-Mail-Adresse ist bereits vergeben. Bitte nimm eine andere.");
      } else if (err instanceof ApiFehler && err.status === 401) {
        setFehler("Das Passwort stimmt nicht oder der Link ist nicht mehr gültig. Prüfe dein Passwort. Klappt es weiter nicht, fordere bei deiner Betreuung einen neuen Link an.");
      } else {
        setFehler(err instanceof Error ? err.message : "Die Adresse konnte nicht geändert werden.");
      }
    } finally {
      setLadt(false);
    }
  }

  const kopf = (
    <h1>
      <MarkenZeichen iconGroesse={26} />
    </h1>
  );

  if (erledigt) {
    return (
      <div className="zv-shell">
        <div className="zv-card">
          {kopf}
          <p className="zv-sub">E-Mail-Adresse geändert</p>
          <div className="zv-hinweis zv-hinweis-erfolg">
            <IErfolg />
            Deine neue E-Mail-Adresse ist gespeichert. Melde dich ab jetzt damit an.
          </div>
          <button className="zv-btn zv-btn-block" style={{ marginTop: 14 }} onClick={onFertig}>
            Zur Anmeldung
          </button>
        </div>
      </div>
    );
  }

  if (linkFehler) {
    return (
      <div className="zv-shell">
        <div className="zv-card">
          {kopf}
          <p className="zv-sub">E-Mail-Adresse ändern</p>
          <div className="zv-hinweis zv-hinweis-fehler" role="alert">
            <IFehler />
            {linkFehler}
          </div>
          <button className="zv-btn zv-btn-sekundaer zv-btn-block" style={{ marginTop: 14 }} onClick={onFertig}>
            Zur Anmeldung
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="zv-shell">
      <form className="zv-card" onSubmit={submit}>
        {kopf}
        <p className="zv-sub">E-Mail-Adresse ändern</p>
        {maskiert === null ? (
          <p className="zv-sub">Link wird geprüft…</p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Bisherige Adresse: <strong>{maskiert}</strong>
            </p>

            {fehler && (
              <div className="zv-hinweis zv-hinweis-fehler" role="alert">
                <IFehler />
                {fehler}
              </div>
            )}

            <div className="zv-field">
              <label htmlFor="neueEmail">Neue E-Mail-Adresse</label>
              <input id="neueEmail" type="email" value={neueEmail} onChange={(e) => setNeueEmail(e.target.value)} autoComplete="email" autoFocus required />
            </div>
            <div className="zv-field">
              <label htmlFor="passwort">Dein Passwort</label>
              <div style={{ position: "relative" }}>
                <input
                  id="passwort"
                  type={sichtbar ? "text" : "password"}
                  value={passwort}
                  onChange={(e) => setPasswort(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                  required
                />
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

            <button className="zv-btn zv-btn-block" type="submit" disabled={ladt}>
              <IBestaetigen />
              {ladt ? "Speichert…" : "Adresse ändern"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
