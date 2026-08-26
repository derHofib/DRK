import { FormEvent, useEffect, useState } from "react";
import type { BenutzerListEintragDto, BenutzerRolle } from "@zimmerakte/shared";
import { BENUTZER_ROLLE_LABEL } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { IFehler, ILeerMitarbeitende, INeu, ISpeichern } from "../components/icons";

export function Mitarbeitende() {
  const [benutzer, setBenutzer] = useState<BenutzerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);

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

      {benutzer.length === 0 ? (
        <Leerzustand icon={ILeerMitarbeitende}>Keine Mitarbeitenden gefunden.</Leerzustand>
      ) : (
        <div className="zv-karten-liste">
          {benutzer.map((b) => (
            <div key={b.id} className="zv-info-karte">
              <div className="zv-info-karte-kopf">
                <span className="zv-info-karte-titel">{b.name}</span>
                <span className="zv-pill">{BENUTZER_ROLLE_LABEL[b.rolle]}</span>
              </div>
              <div className="zv-info-karte-felder">
                <span>
                  E-Mail <strong>{b.email}</strong>
                </span>
                <span>
                  Status <strong>{b.aktiv ? "Aktiv" : "Inaktiv"}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
