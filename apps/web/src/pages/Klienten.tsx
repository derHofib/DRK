import { FormEvent, useEffect, useState } from "react";
import type { HzlRhythmus, KlientListEintragDto } from "@zimmerakte/shared";
import { HZL_RHYTHMUS_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { IFehler, ILeerKlienten, INeu, ISpeichern } from "../components/icons";
import { KlientDetail } from "./KlientDetail";

export function Klienten() {
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [ausgewaehlterKlientId, setAusgewaehlterKlientId] = useState<string | null>(null);

  function laden() {
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
  }

  useEffect(laden, []);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Formularelement vorab merken -- React setzt e.currentTarget nach dem
    // Event-Dispatch auf null zurueck, ein Zugriff nach einem await schlaegt
    // sonst fehl (siehe facebook/react#20544).
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFormFehler(null);
    try {
      await api.klientAnlegen({
        vorname: String(form.get("vorname")),
        nachname: String(form.get("nachname")),
        geburtsdatum: String(form.get("geburtsdatum")),
        aktenzeichen: String(form.get("aktenzeichen")),
        amt: String(form.get("amt")),
        hzlRhythmus: form.get("hzlRhythmus") as HzlRhythmus,
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Klient konnte nicht angelegt werden.");
    }
  }

  return (
    <div className={`zv-master-detail${ausgewaehlterKlientId ? " zv-detail-aktiv" : ""}`}>
      <div className="zv-master-liste">
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}

        <div className="zv-seiten-kopf">
          <h2>Klienten</h2>
          <button
            className="zv-btn"
            onClick={() => {
              setFormFehler(null);
              setFormularOffen(true);
            }}
          >
            <INeu />
            Neuer Klient
          </button>
        </div>

        {formularOffen && (
          <Modal titel="Neuer Klient" onClose={() => setFormularOffen(false)}>
            <form onSubmit={anlegen}>
              {formFehler && (
                <div className="zv-hinweis zv-hinweis-fehler">
                  <IFehler />
                  {formFehler}
                </div>
              )}
              <div className="zv-field-row">
                <div className="zv-field">
                  <label>Vorname</label>
                  <input name="vorname" required autoFocus />
                </div>
                <div className="zv-field">
                  <label>Nachname</label>
                  <input name="nachname" required />
                </div>
              </div>
              <div className="zv-field-row">
                <div className="zv-field">
                  <label>Geburtsdatum</label>
                  <input name="geburtsdatum" type="date" required />
                </div>
                <div className="zv-field">
                  <label>Aktenzeichen</label>
                  <input name="aktenzeichen" required />
                </div>
              </div>
              <div className="zv-field-row">
                <div className="zv-field">
                  <label>Amtszuordnung</label>
                  <input name="amt" required />
                </div>
                <div className="zv-field">
                  <label>HZL-Rhythmus</label>
                  <select name="hzlRhythmus" defaultValue="monatlich">
                    <option value="monatlich">Monatlich</option>
                    <option value="woechentlich">Wöchentlich</option>
                  </select>
                </div>
              </div>
              <button className="zv-btn zv-btn-block" type="submit">
                <ISpeichern />
                Anlegen
              </button>
            </form>
          </Modal>
        )}

        {klienten.length === 0 ? (
          <Leerzustand icon={ILeerKlienten}>Keine Klienten erfasst.</Leerzustand>
        ) : (
          <div className="zv-karten-liste">
            {klienten.map((k) => (
              <div
                key={k.id}
                className={`zv-info-karte zv-info-karte-klickbar${ausgewaehlterKlientId === k.id ? " zv-info-karte-aktiv" : ""}`}
                onClick={() => setAusgewaehlterKlientId(k.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setAusgewaehlterKlientId(k.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="zv-info-karte-kopf">
                  <span className="zv-info-karte-titel">
                    {k.vorname} {k.nachname}
                  </span>
                  {k.aktuellesZimmer ? (
                    <span className="zv-pill zv-pill-vergeben">
                      {k.aktuellesZimmer.nummer} · {k.aktuellesZimmer.standortName}
                    </span>
                  ) : (
                    <span className="zv-sub-inline">Kein Zimmer</span>
                  )}
                </div>
                <div className="zv-info-karte-felder">
                  <span>
                    Aktenzeichen <strong className="zv-mono">{k.aktenzeichen}</strong>
                  </span>
                  <span>
                    Amt <strong>{k.amt}</strong>
                  </span>
                  <span>
                    HZL <strong>{HZL_RHYTHMUS_LABEL[k.hzlRhythmus]}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {ausgewaehlterKlientId && (
        <div className="zv-master-panel">
          <KlientDetail klientId={ausgewaehlterKlientId} onZurueck={() => setAusgewaehlterKlientId(null)} />
        </div>
      )}
    </div>
  );
}
