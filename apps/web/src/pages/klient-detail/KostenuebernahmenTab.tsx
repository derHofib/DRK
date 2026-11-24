import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { KostenuebernahmeDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import {
  IAbbrechen,
  IBeenden,
  IFehler,
  ILeerKostenuebernahmen,
  INeu,
  ISOffen,
  ISpeichern,
} from "../../components/icons";
import { formatDatum } from "../../format";
import { Datumsfeld, Zeitraumfeld } from "../../components/Datumsfeld";

export function KostenuebernahmenTab({ klientId }: { klientId: string }) {
  const [liste, setListe] = useState<KostenuebernahmeDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [beendenId, setBeendenId] = useState<string | null>(null);

  function laden() {
    api.kostenuebernahmenListe(klientId).then(setListe).catch((err) => setFehler(err.message));
  }
  useEffect(laden, [klientId]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const bis = String(form.get("bis") ?? "");
    try {
      await api.kostenuebernahmeAnlegen({
        klientId,
        amt: String(form.get("amt")),
        von: String(form.get("von")),
        bis: bis || undefined,
      });
      setFormularOffen(false);
      formElement.reset();
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zeitraum konnte nicht angelegt werden.");
    }
  }

  async function beenden(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.kostenuebernahmeBeenden(id, String(form.get("bis")));
      setBeendenId(null);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zeitraum konnte nicht beendet werden.");
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Kostenübernahme-Zeiträume</h3>
        <button
          className="zv-btn"
          onClick={() => setFormularOffen((v) => !v)}
        >
          {formularOffen ? <IAbbrechen /> : <INeu />}
          {formularOffen ? "Abbrechen" : "Neuer Zeitraum"}
        </button>
      </div>

      {formularOffen && (
        <form className="zv-inline-form" onSubmit={anlegen}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label htmlFor="ku-amt">Amt</label>
              <input id="ku-amt" name="amt" required />
            </div>
            <Zeitraumfeld
              von={{ id: "ku-von", name: "von", label: "Von", required: true }}
              bis={{ id: "ku-bis", name: "bis", label: "Bis (optional)" }}
            />
          </div>
          <button className="zv-btn" type="submit">
            <ISpeichern />
            Anlegen
          </button>
        </form>
      )}

      {liste.length === 0 ? (
        <Leerzustand icon={ILeerKostenuebernahmen}>Noch keine Kostenübernahme erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1.6fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Amt</span>
            <span>Von</span>
            <span>Bis</span>
            <span></span>
          </div>
          {liste.map((k) => (
            <div key={k.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{k.amt}</span>
              <span className="zv-liste-zelle" data-label="Von">
                <strong>{formatDatum(k.von)}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Bis">
                {k.bis ? (
                  <strong>{formatDatum(k.bis)}</strong>
                ) : (
                  <span className="zv-pill zv-pill-offen">
                    <ISOffen />
                    Offen
                  </span>
                )}
              </span>
              <span className={`zv-liste-zelle-aktionen${k.bis !== null ? " zv-liste-zelle-aktionen-leer" : ""}`}>
                {k.bis === null &&
                  (beendenId === k.id ? (
                    <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={(e) => beenden(e, k.id)}>
                      <Datumsfeld name="bis" required aria-label="Kostenübernahme endet am" groesse="kompakt" schnellwahl="heute" />
                      <button className="zv-link-btn" type="submit">
                        <ISpeichern />
                        Speichern
                      </button>
                    </form>
                  ) : (
                    <button className="zv-link-btn" onClick={() => setBeendenId(k.id)}>
                      <IBeenden />
                      Beenden
                    </button>
                  ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
