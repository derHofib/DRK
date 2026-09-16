import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { KassenbuchungTypDto } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { Modal } from "../components/Modal";
import { Leerzustand } from "../components/Leerzustand";
import {
  IAbbrechen,
  IAktivieren,
  IBearbeiten,
  IDeaktivieren,
  IFehler,
  IKassenbuch,
  ILeerKassenbuch,
  INeu,
  ISpeichern,
} from "../components/icons";

const ROLLEN_MIT_VERWALTEN = new Set(["bereichsleitung", "einrichtungsleitung"]);

/**
 * Verwaltung der Kassenbuch-Typen eines Traegers -- bislang eine feste
 * Dreier-Auswahl (HZL/Einzahlung/Sonstiges), seit Migration 0035 frei durch
 * die Leitung erweiterbar. "Deaktivieren" ist bewusst kein Loeschen (siehe
 * kassenbuchung-typ.service.ts, aktualisieren()): bestehende Buchungen mit
 * diesem Typ bleiben unangetastet, er verschwindet nur aus der Auswahl beim
 * Anlegen einer neuen Buchung. Der Systemtyp "HZL" ist hier bewusst ohne
 * Bearbeiten/Deaktivieren-Aktion dargestellt -- daran haengt die
 * Wochenuebersicht und die Sperre gegen doppelte HZL-Auszahlung je
 * Klient/Kalenderwoche.
 */
export function KassenbuchTypen() {
  const [typen, setTypen] = useState<KassenbuchungTypDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuFormularOffen, setNeuFormularOffen] = useState(false);
  const [bearbeiteterTyp, setBearbeiteterTyp] = useState<KassenbuchungTypDto | null>(null);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  // Nur ein Anzeige-Hinweis -- der Server entscheidet ueber die
  // Berechtigung (siehe ROLLEN_MIT_KASSENBUCHUNG_TYP_VERWALTEN).
  const darfVerwalten = ROLLEN_MIT_VERWALTEN.has(tokenRolle() ?? "");

  function laden() {
    api.kassenbuchungTypenListe().then(setTypen).catch((err) => setFehler(err.message));
  }

  useEffect(laden, []);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.kassenbuchungTypAnlegen({
        bezeichnung: String(form.get("bezeichnung") ?? "").trim(),
        kommentarPflicht: form.get("kommentarPflicht") === "on",
      });
      setNeuFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Kassenbuch-Typ konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function bearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bearbeiteterTyp) return;
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.kassenbuchungTypAktualisieren(bearbeiteterTyp.id, {
        bezeichnung: String(form.get("bezeichnung") ?? "").trim(),
        kommentarPflicht: form.get("kommentarPflicht") === "on",
      });
      setBearbeiteterTyp(null);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Kassenbuch-Typ konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function aktivSchalten(typ: KassenbuchungTypDto) {
    try {
      await api.kassenbuchungTypAktualisieren(typ.id, { aktiv: !typ.aktiv });
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kassenbuch-Typ konnte nicht geändert werden.");
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
        <h2>Kassenbuch-Typen</h2>
        {darfVerwalten && (
          <button
            className="zv-btn"
            onClick={() => {
              setFormFehler(null);
              setNeuFormularOffen(true);
            }}
          >
            <INeu />
            Neuer Typ
          </button>
        )}
      </div>
      <p className="zv-sub" style={{ marginTop: -8, marginBottom: 16 }}>
        Legt fest, welche Typen beim Anlegen einer Kassenbuchung zur Auswahl stehen. Ist „Verwendungszweck
        Pflicht" nicht angehakt, heißt das Feld an einer Buchung dieses Typs „Kommentar" und ist optional.
      </p>

      {typen.length === 0 && !fehler ? (
        <Leerzustand icon={ILeerKassenbuch}>Noch keine Kassenbuch-Typen angelegt.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1.6fr 1fr 1.6fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Bezeichnung</span>
            <span>Feld</span>
            <span>Status</span>
            <span></span>
          </div>
          {typen.map((t) => (
            <div key={t.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">
                <IKassenbuch style={{ verticalAlign: "-3px", marginRight: 6 }} />
                {t.bezeichnung}
                {t.istHzl && <span className="zv-sub-inline">Systemtyp</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Feld">
                {t.kommentarPflicht ? "Verwendungszweck (Pflicht)" : "Kommentar (optional)"}
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <span className={`zv-pill ${t.aktiv ? "zv-pill-zugeordnet" : "zv-pill-neutral"}`}>
                  {t.aktiv ? "Aktiv" : "Inaktiv"}
                </span>
              </span>
              <span className="zv-liste-zelle-aktionen">
                {darfVerwalten && !t.istHzl && (
                  <>
                    <button
                      className="zv-link-btn"
                      onClick={() => {
                        setFormFehler(null);
                        setBearbeiteterTyp(t);
                      }}
                    >
                      <IBearbeiten />
                      Bearbeiten
                    </button>
                    <button className="zv-link-btn" onClick={() => aktivSchalten(t)}>
                      {t.aktiv ? (
                        <>
                          <IDeaktivieren />
                          Deaktivieren
                        </>
                      ) : (
                        <>
                          <IAktivieren />
                          Aktivieren
                        </>
                      )}
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {neuFormularOffen && (
        <Modal titel="Neuer Kassenbuch-Typ" onClose={() => setNeuFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="typ-bezeichnung">Bezeichnung</label>
              <input id="typ-bezeichnung" name="bezeichnung" placeholder="z. B. Fahrtkosten" required autoFocus />
            </div>
            <label className="zv-checkbox-zeile">
              <input type="checkbox" name="kommentarPflicht" defaultChecked />
              Verwendungszweck ist Pflicht (sonst „Kommentar", optional)
            </label>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Typ anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {bearbeiteterTyp && (
        <Modal titel="Kassenbuch-Typ bearbeiten" onClose={() => setBearbeiteterTyp(null)}>
          <form onSubmit={bearbeiten}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="typ-bearbeiten-bezeichnung">Bezeichnung</label>
              <input
                id="typ-bearbeiten-bezeichnung"
                name="bezeichnung"
                defaultValue={bearbeiteterTyp.bezeichnung}
                required
                autoFocus
              />
            </div>
            <label className="zv-checkbox-zeile">
              <input type="checkbox" name="kommentarPflicht" defaultChecked={bearbeiteterTyp.kommentarPflicht} />
              Verwendungszweck ist Pflicht (sonst „Kommentar", optional)
            </label>
            <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
              <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
                <ISpeichern />
                {wirdGespeichert ? "Speichert…" : "Speichern"}
              </button>
              <button className="zv-btn zv-btn-still" type="button" onClick={() => setBearbeiteterTyp(null)}>
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
