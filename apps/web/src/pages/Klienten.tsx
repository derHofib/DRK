import { FormEvent, useEffect, useState } from "react";
import type { HzlRhythmus, KlientListEintragDto } from "@zimmerakte/shared";
import { HZL_RHYTHMUS_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { KlientDetail } from "./KlientDetail";

export function Klienten() {
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [ausgewaehlterKlientId, setAusgewaehlterKlientId] = useState<string | null>(null);

  function laden() {
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
  }

  useEffect(laden, []);

  if (ausgewaehlterKlientId) {
    return <KlientDetail klientId={ausgewaehlterKlientId} onZurueck={() => setAusgewaehlterKlientId(null)} />;
  }

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Formularelement vorab merken -- React setzt e.currentTarget nach dem
    // Event-Dispatch auf null zurueck, ein Zugriff nach einem await schlaegt
    // sonst fehl (siehe facebook/react#20544).
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
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
      formElement.reset();
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Klient konnte nicht angelegt werden.");
    }
  }

  return (
    <div>
      {fehler && <div className="zv-error">{fehler}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Klienten</h2>
        <button
          className="zv-btn"
          style={{ width: "auto", padding: "6px 14px" }}
          onClick={() => setFormularOffen((v) => !v)}
        >
          {formularOffen ? "Abbrechen" : "+ Neuer Klient"}
        </button>
      </div>

      {formularOffen && (
        <form className="zv-inline-form" onSubmit={anlegen}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label>Vorname</label>
              <input name="vorname" required />
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
          <button className="zv-btn" type="submit">
            Anlegen
          </button>
        </form>
      )}

      <table className="zv-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Aktenzeichen</th>
            <th>Amt</th>
            <th>HZL</th>
            <th>Zimmer</th>
          </tr>
        </thead>
        <tbody>
          {klienten.map((k) => (
            <tr key={k.id} onClick={() => setAusgewaehlterKlientId(k.id)} style={{ cursor: "pointer" }}>
              <td>
                {k.vorname} {k.nachname}
              </td>
              <td className="zv-mono">{k.aktenzeichen}</td>
              <td>{k.amt}</td>
              <td>{HZL_RHYTHMUS_LABEL[k.hzlRhythmus]}</td>
              <td>
                {k.aktuellesZimmer ? (
                  <span className="zv-pill zv-pill-vergeben">
                    {k.aktuellesZimmer.nummer} · {k.aktuellesZimmer.standortName}
                  </span>
                ) : (
                  <span className="zv-sub-inline">Kein Zimmer</span>
                )}
              </td>
            </tr>
          ))}
          {klienten.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--zv-text-faint)", padding: 16 }}>
                Keine Klienten erfasst.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
