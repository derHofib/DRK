import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { StandortDto } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { Modal } from "../components/Modal";
import { Leerzustand } from "../components/Leerzustand";
import {
  IAbbrechen,
  IBearbeiten,
  IFehler,
  ILeerStandorte,
  INeu,
  ISpeichern,
  IStandort,
} from "../components/icons";

/**
 * Verwaltung der Standorte (Haeuser) eines Traegers -- bislang konnte ein
 * Standort nur nebenbei beim Zimmer-Anlegen entstehen, nie mehr geaendert
 * oder deaktiviert werden. "Deaktivieren" ist bewusst kein Loeschen: siehe
 * standort.service.ts, aktualisieren() fuer die Begruendung.
 */
export function Standorte() {
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuFormularOffen, setNeuFormularOffen] = useState(false);
  const [bearbeiteterStandort, setBearbeiteterStandort] = useState<StandortDto | null>(null);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  // Nur ein Anzeige-Hinweis -- der Server entscheidet ueber die Berechtigung
  // (siehe ROLLEN_MIT_STANDORT_ANLEGEN in standort.service.ts).
  const darfAnlegen = tokenRolle() === "bereichsleitung";

  function laden() {
    api.standorteListe().then(setStandorte).catch((err) => setFehler(err.message));
  }

  useEffect(laden, []);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.standortAnlegen({
        name: String(form.get("name") ?? "").trim(),
        adresse: String(form.get("adresse") ?? "").trim(),
      });
      setNeuFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Standort konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function bearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bearbeiteterStandort) return;
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.standortAktualisieren(bearbeiteterStandort.id, {
        name: String(form.get("name") ?? "").trim(),
        adresse: String(form.get("adresse") ?? "").trim(),
      });
      setBearbeiteterStandort(null);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Standort konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function aktivSchalten(standort: StandortDto) {
    try {
      await api.standortAktualisieren(standort.id, { aktiv: !standort.aktiv });
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Standort konnte nicht geändert werden.");
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
        <h2>Standorte</h2>
        {darfAnlegen && (
          <button className="zv-btn" onClick={() => { setFormFehler(null); setNeuFormularOffen(true); }}>
            <INeu />
            Neuer Standort
          </button>
        )}
      </div>

      {standorte.length === 0 && !fehler ? (
        <Leerzustand icon={ILeerStandorte}>Noch keine Standorte angelegt.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 2fr 1fr 1.6fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Name</span>
            <span>Adresse</span>
            <span>Status</span>
            <span></span>
          </div>
          {standorte.map((s) => (
            <div key={s.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">
                <IStandort style={{ verticalAlign: "-3px", marginRight: 6 }} />
                {s.name}
              </span>
              <span className="zv-liste-zelle" data-label="Adresse">
                {s.adresse}
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <span className={`zv-pill ${s.aktiv ? "zv-pill-zugeordnet" : "zv-pill-neutral"}`}>
                  {s.aktiv ? "Aktiv" : "Inaktiv"}
                </span>
              </span>
              <span className="zv-liste-zelle-aktionen">
                <button className="zv-link-btn" onClick={() => { setFormFehler(null); setBearbeiteterStandort(s); }}>
                  <IBearbeiten />
                  Bearbeiten
                </button>
                <button className="zv-link-btn" onClick={() => aktivSchalten(s)}>
                  {s.aktiv ? "Deaktivieren" : "Aktivieren"}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {neuFormularOffen && (
        <Modal titel="Neuer Standort" onClose={() => setNeuFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="standort-name">Name</label>
              <input id="standort-name" name="name" placeholder="z. B. Wohnheim Nordstraße" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="standort-adresse">Adresse</label>
              <input id="standort-adresse" name="adresse" placeholder="Straße, PLZ Ort" required />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Standort anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {bearbeiteterStandort && (
        <Modal titel="Standort bearbeiten" onClose={() => setBearbeiteterStandort(null)}>
          <form onSubmit={bearbeiten}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="standort-bearbeiten-name">Name</label>
              <input
                id="standort-bearbeiten-name"
                name="name"
                defaultValue={bearbeiteterStandort.name}
                required
                autoFocus
              />
            </div>
            <div className="zv-field">
              <label htmlFor="standort-bearbeiten-adresse">Adresse</label>
              <input
                id="standort-bearbeiten-adresse"
                name="adresse"
                defaultValue={bearbeiteterStandort.adresse}
                required
              />
            </div>
            <div className="zv-vorschau-zeile">
              <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
                <ISpeichern />
                {wirdGespeichert ? "Speichert…" : "Speichern"}
              </button>
              <button
                className="zv-btn zv-btn-still"
                type="button"
                onClick={() => setBearbeiteterStandort(null)}
              >
                <IAbbrechen />
                Abbrechen
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
