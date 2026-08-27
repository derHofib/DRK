import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { BenutzerListEintragDto, BenutzerRolle } from "@zimmerakte/shared";
import { BENUTZER_ROLLE_LABEL } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { IFehler, IKopieren, ILeerMitarbeitende, INeu, IResetLink, ISpeichern } from "../components/icons";

export function Mitarbeitende() {
  const [benutzer, setBenutzer] = useState<BenutzerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ name: string; url: string; laeuftAbAm: string } | null>(null);
  const [kopiert, setKopiert] = useState(false);

  // Nur ein Anzeige-Hinweis -- der Server entscheidet ueber die Berechtigung
  // (siehe ROLLEN_MIT_BENUTZER_ANLEGEN in benutzer.service.ts).
  const darfAnlegen = tokenRolle() === "leitung";

  function laden() {
    api.benutzerListe().then(setBenutzer).catch((err) => setFehler(err.message));
  }

  useEffect(laden, []);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    try {
      await api.benutzerAnlegen({
        name: String(form.get("name")),
        email: String(form.get("email")),
        rolle: form.get("rolle") as BenutzerRolle,
        passwort: String(form.get("passwort")),
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Mitarbeiter konnte nicht angelegt werden.");
    }
  }

  async function passwortZuruecksetzen(b: BenutzerListEintragDto) {
    setFehler(null);
    setKopiert(false);
    try {
      const { token, laeuftAbAm } = await api.passwortResetErstellen(b.id);
      const url = `${window.location.origin}${window.location.pathname}?reset=${token}`;
      setResetLink({ name: b.name, url, laeuftAbAm });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Link konnte nicht erzeugt werden.");
    }
  }

  async function linkKopieren() {
    if (!resetLink) return;
    await navigator.clipboard.writeText(resetLink.url);
    setKopiert(true);
  }

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Mitarbeitende</h2>
        {darfAnlegen && (
          <button
            className="zv-btn"
            onClick={() => {
              setFormFehler(null);
              setFormularOffen(true);
            }}
          >
            <INeu />
            Neuer Mitarbeiter
          </button>
        )}
      </div>

      {formularOffen && (
        <Modal titel="Neuer Mitarbeiter" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Name</label>
                <input name="name" required autoFocus />
              </div>
              <div className="zv-field">
                <label>E-Mail</label>
                <input name="email" type="email" required />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Rolle</label>
                <select name="rolle" defaultValue="bezugsbetreuung">
                  <option value="bezugsbetreuung">Bezugsbetreuung</option>
                  <option value="springer">Springer</option>
                  <option value="verwaltung">Verwaltung</option>
                  <option value="leitung">Leitung</option>
                </select>
              </div>
              <div className="zv-field">
                <label>Initialpasswort</label>
                <input name="passwort" type="password" required minLength={8} />
              </div>
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Anlegen
            </button>
          </form>
        </Modal>
      )}

      {resetLink && (
        <Modal titel={`Passwort-Reset-Link — ${resetLink.name}`} onClose={() => setResetLink(null)}>
          <p className="zv-sub">
            Diesen Link auf einem beliebigen Weg (z. B. Teams, mündlich) an {resetLink.name} weitergeben. Der Link
            ist nur <strong>einmal einlösbar</strong> und läuft am{" "}
            {new Date(resetLink.laeuftAbAm).toLocaleString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            Uhr ab. {resetLink.name} vergibt das neue Passwort dabei selbst — es wird an keiner Stelle angezeigt oder
            gespeichert.
          </p>
          <div className="zv-field">
            <label htmlFor="reset-link-feld">Link (nur jetzt sichtbar)</label>
            <input id="reset-link-feld" readOnly value={resetLink.url} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <button className="zv-btn zv-btn-block" type="button" onClick={linkKopieren}>
            <IKopieren />
            {kopiert ? "Kopiert!" : "Link kopieren"}
          </button>
        </Modal>
      )}

      {benutzer.length === 0 ? (
        <Leerzustand icon={ILeerMitarbeitende}>Keine Mitarbeitenden gefunden.</Leerzustand>
      ) : (
        <div
          className="zv-karten-liste"
          style={{ "--zv-liste-spalten": darfAnlegen ? "1.3fr 1.6fr 1fr 1fr 1.6fr" : "1.3fr 1.6fr 1fr 1fr" } as CSSProperties}
        >
          <div className="zv-liste-kopf">
            <span>Name</span>
            <span>E-Mail</span>
            <span>Rolle</span>
            <span>Status</span>
            {darfAnlegen && <span></span>}
          </div>
          {benutzer.map((b) => (
            <div key={b.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{b.name}</span>
              <span className="zv-liste-zelle" data-label="E-Mail">
                <strong>{b.email}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Rolle">
                <span className="zv-pill">{BENUTZER_ROLLE_LABEL[b.rolle]}</span>
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <strong>{b.aktiv ? "Aktiv" : "Inaktiv"}</strong>
              </span>
              {darfAnlegen && (
                <span className="zv-liste-zelle-aktionen">
                  <button className="zv-link-btn" onClick={() => passwortZuruecksetzen(b)}>
                    <IResetLink />
                    Passwort zurücksetzen
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
