import { FormEvent, useEffect, useState } from "react";
import type { BelegungsverlaufEintragDto, StandortDto, ZimmerListEintragDto } from "@zimmerakte/shared";
import { ZIMMERSTATUS_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IAbbrechen,
  IAufklappen,
  IBearbeiten,
  IFehler,
  ILeerVerlauf,
  ILeerZimmer,
  INeu,
  ISpeichern,
  ISVergeben,
  ISZugeordnet,
  IStandort,
  IVerlauf,
  IZuklappen,
} from "../components/icons";

/** Sentinel-Wert im Standort-Select fuer "einen neuen Standort anlegen". */
const NEUER_STANDORT = "__neu__";

const STATUS_ICON = {
  vergeben: ISVergeben,
  zugeordnet: ISZugeordnet,
} as const;

/**
 * Zeigt bewusst nur, was die API tatsächlich zurückgibt -- "status" wird
 * hier nie berechnet, nur anzeigt. Die Ableitung passiert serverseitig
 * (siehe zimmer.service.ts), das Frontend ist hier absichtlich dumm.
 */
export function Zimmer() {
  const [zimmer, setZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenesZimmer, setOffenesZimmer] = useState<string | null>(null);
  const [verlauf, setVerlauf] = useState<BelegungsverlaufEintragDto[]>([]);

  const [formularOffen, setFormularOffen] = useState(false);
  const [standortAuswahl, setStandortAuswahl] = useState<string>(NEUER_STANDORT);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const [bearbeitetesZimmer, setBearbeitetesZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [bearbeitenFehler, setBearbeitenFehler] = useState<string | null>(null);

  function ladeZimmer() {
    api.zimmerListe().then(setZimmer).catch((err) => setFehler(err.message));
  }

  function ladeStandorte() {
    api
      .standorteListe()
      .then((liste) => {
        setStandorte(liste);
        // Gibt es schon mindestens einen AKTIVEN Standort, ist er beim
        // Oeffnen des Formulars vorausgewaehlt -- "neuen Standort anlegen"
        // bleibt ueber das Select trotzdem erreichbar, ist nur nicht mehr
        // die Vorgabe. Ein deaktivierter Standort taucht im Select gar
        // nicht erst auf (siehe unten), darf also auch nicht vorausgewaehlt
        // werden.
        const ersterAktiver = liste.find((s) => s.aktiv);
        if (ersterAktiver) setStandortAuswahl(ersterAktiver.id);
      })
      .catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    ladeZimmer();
    ladeStandorte();
  }, []);

  function formularOeffnen() {
    setFormFehler(null);
    setFormularOffen(true);
  }

  async function zimmerAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const nummer = String(form.get("nummer") ?? "").trim();
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      let standortId = standortAuswahl;
      if (standortId === NEUER_STANDORT) {
        const name = String(form.get("standortName") ?? "").trim();
        const adresse = String(form.get("standortAdresse") ?? "").trim();
        const neuerStandort = await api.standortAnlegen({ name, adresse });
        standortId = neuerStandort.id;
      }
      await api.zimmerAnlegen({ standortId, nummer });
      setFormularOffen(false);
      ladeZimmer();
      ladeStandorte();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Zimmer konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function zimmerBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bearbeitetesZimmer) return;
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setBearbeitenFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerAktualisieren(bearbeitetesZimmer.id, {
        nummer: String(form.get("nummer") ?? "").trim(),
      });
      setBearbeitetesZimmer(null);
      ladeZimmer();
    } catch (err) {
      setBearbeitenFehler(err instanceof Error ? err.message : "Zimmer konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function zimmerDeaktivieren(zimmerId: string) {
    try {
      await api.zimmerDeaktivieren(zimmerId);
      ladeZimmer();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zimmer konnte nicht deaktiviert werden.");
    }
  }

  async function verlaufAnzeigen(zimmerId: string) {
    if (offenesZimmer === zimmerId) {
      setOffenesZimmer(null);
      return;
    }
    setOffenesZimmer(zimmerId);
    try {
      setVerlauf(await api.belegungsverlauf(zimmerId));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Belegungsverlauf konnte nicht geladen werden.");
    }
  }

  const gruppen = zimmer.reduce<Record<string, ZimmerListEintragDto[]>>((acc, z) => {
    (acc[z.standortName] ??= []).push(z);
    return acc;
  }, {});

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Zimmer</h2>
        <button className="zv-btn" onClick={formularOeffnen}>
          <INeu />
          Neues Zimmer
        </button>
      </div>

      {Object.entries(gruppen).map(([standortName, raum]) => (
        <div key={standortName} style={{ marginBottom: 28 }}>
          <div className="zv-seiten-kopf">
            <h2>
              <IStandort style={{ verticalAlign: "-3px", marginRight: 6 }} />
              {standortName}
            </h2>
          </div>
          <div className="zv-room-grid">
            {raum.map((z) => {
              const StatusIcon = STATUS_ICON[z.status];
              return (
              <div key={z.id} className="zv-room-card">
                <div className="zv-room-head">
                  <span className="zv-room-nummer">{z.nummer}</span>
                  <span className={`zv-pill zv-pill-${z.status}`}>
                    <StatusIcon />
                    {ZIMMERSTATUS_LABEL[z.status]}
                  </span>
                </div>
                {z.aktuellerKlient ? (
                  <div className="zv-room-klient">
                    {z.aktuellerKlient.name}
                    <span className="zv-sub-inline">seit {z.aktuellerKlient.einzug}</span>
                  </div>
                ) : (
                  <div className="zv-room-klient zv-sub-inline">Kein Klient zugeordnet</div>
                )}
                <div className="zv-vorschau-zeile">
                  <button className="zv-link-btn" onClick={() => verlaufAnzeigen(z.id)}>
                    {offenesZimmer === z.id ? <IZuklappen /> : <IVerlauf />}
                    {offenesZimmer === z.id ? "Verlauf ausblenden" : "Belegungsverlauf"}
                    {offenesZimmer !== z.id && <IAufklappen />}
                  </button>
                  <button
                    className="zv-link-btn"
                    onClick={() => {
                      setBearbeitenFehler(null);
                      setBearbeitetesZimmer(z);
                    }}
                  >
                    <IBearbeiten />
                    Bearbeiten
                  </button>
                  {z.status === "zugeordnet" && (
                    <button className="zv-link-btn" onClick={() => zimmerDeaktivieren(z.id)}>
                      Deaktivieren
                    </button>
                  )}
                </div>

                {offenesZimmer === z.id && (
                  <ul className="zv-verlauf-liste">
                    {verlauf.map((v) => (
                      <li key={v.id}>
                        <strong>{v.name}</strong>
                        <span className="zv-sub-inline">
                          {v.einzug} – {v.auszug ?? "heute"}
                        </span>
                      </li>
                    ))}
                    {verlauf.length === 0 && <li className="zv-sub-inline">Noch keine Belegung erfasst.</li>}
                  </ul>
                )}
              </div>
              );
            })}
          </div>
        </div>
      ))}

      {zimmer.length === 0 && !fehler && (
        <Leerzustand icon={ILeerZimmer}>Noch keine Zimmer angelegt.</Leerzustand>
      )}

      {formularOffen && (
        <Modal titel="Neues Zimmer" onClose={() => setFormularOffen(false)}>
          <form onSubmit={zimmerAnlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}

            <div className="zv-field">
              <label htmlFor="zimmer-standort">Standort</label>
              <select
                id="zimmer-standort"
                value={standortAuswahl}
                onChange={(e) => setStandortAuswahl(e.target.value)}
              >
                {standorte
                  .filter((s) => s.aktiv)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                <option value={NEUER_STANDORT}>+ Neuen Standort anlegen…</option>
              </select>
            </div>

            {standortAuswahl === NEUER_STANDORT && (
              <div className="zv-field-row">
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-name">Name des Standorts</label>
                  <input id="zimmer-standort-name" name="standortName" placeholder="z. B. Wohnheim Nordstraße" required autoFocus />
                </div>
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-adresse">Adresse</label>
                  <input id="zimmer-standort-adresse" name="standortAdresse" placeholder="Straße, PLZ Ort" required />
                </div>
              </div>
            )}

            <div className="zv-field">
              <label htmlFor="zimmer-nummer">Zimmernummer</label>
              <input
                id="zimmer-nummer"
                name="nummer"
                placeholder="z. B. 101"
                required
                autoFocus={standortAuswahl !== NEUER_STANDORT}
              />
            </div>

            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Zimmer anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {bearbeitetesZimmer && (
        <Modal titel="Zimmer bearbeiten" onClose={() => setBearbeitetesZimmer(null)}>
          <form onSubmit={zimmerBearbeiten}>
            {bearbeitenFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {bearbeitenFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="zimmer-bearbeiten-nummer">Zimmernummer</label>
              <input
                id="zimmer-bearbeiten-nummer"
                name="nummer"
                defaultValue={bearbeitetesZimmer.nummer}
                required
                autoFocus
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
                onClick={() => setBearbeitetesZimmer(null)}
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
