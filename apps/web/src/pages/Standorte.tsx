import { CSSProperties, FormEvent, useCallback, useEffect, useState } from "react";
import {
  STANDORT_ANGEBOTSFORM_LABEL,
  STANDORT_ANGEBOTSFORM_RECHTSGRUNDLAGE,
  type StandortAngebotsform,
  type StandortListenEintragDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { ExportMenue } from "../components/ExportMenue";
import { Modal } from "../components/Modal";
import { Leerzustand } from "../components/Leerzustand";
import { IFehler, IInfo, ILeerStandorte, INeu, ISpeichern, IStandort, IVor } from "../components/icons";
import type { ListenExport } from "../export/listenExport";
import { StandortSteckbrief } from "./StandortSteckbrief";

/**
 * Standorte des Traegers (Organisatorisch). Die Liste zeigt, was man zum
 * Vergleichen braucht -- Angebotsform, Plaetze, Leitung, Telefon -- und
 * oeffnet per Klick auf die Zeile den Steckbrief. "Bearbeiten" und
 * "Deaktivieren" stehen dort statt je Zeile: vorher waren sie zweimal so
 * laut wie der Inhalt (Konzept standort-daten, 4.1).
 *
 * Plaetze und Leitung werden nicht eingetragen, sondern vom Server aus
 * Zimmern und Organigramm abgeleitet.
 */
export function Standorte({
  oeffneStandortId,
  onOrganigramm,
}: {
  oeffneStandortId?: string;
  onOrganigramm?: () => void;
}) {
  const [standorte, setStandorte] = useState<StandortListenEintragDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuFormularOffen, setNeuFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const [offenerStandort, setOffenerStandort] = useState<string | null>(oeffneStandortId ?? null);

  const laden = useCallback(() => {
    api
      .standorteVerwaltung()
      .then(setStandorte)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Standorte konnten nicht geladen werden."));
  }, []);
  useEffect(laden, [laden]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      const angebotsform = String(form.get("angebotsform") ?? "");
      const neu = await api.standortAnlegen({
        name: String(form.get("name") ?? "").trim(),
        angebotsform: (angebotsform || null) as StandortAngebotsform | null,
        strasse: String(form.get("strasse") ?? "").trim(),
        plz: String(form.get("plz") ?? "").trim() || null,
        ort: String(form.get("ort") ?? "").trim() || null,
      });
      setNeuFormularOffen(false);
      laden();
      // Kurz anlegen, dann gleich im Steckbrief weiter: dort steht, was noch fehlt.
      setOffenerStandort(neu.id);
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Standort konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  if (offenerStandort) {
    return (
      <StandortSteckbrief
        standortId={offenerStandort}
        zurueckLabel="Zurück zu Standorte"
        onZurueck={() => setOffenerStandort(null)}
        onGeaendert={laden}
        onOrganigramm={onOrganigramm}
      />
    );
  }

  const aktive = (standorte ?? []).filter((s) => s.aktiv);
  const belegt = aktive.reduce((n, s) => n + s.plaetzeBelegt, 0);
  const eingerichtet = aktive.reduce((n, s) => n + s.plaetzeEingerichtet, 0);

  function angebotText(s: StandortListenEintragDto): string | null {
    if (!s.angebotsform) return null;
    return [STANDORT_ANGEBOTSFORM_LABEL[s.angebotsform], STANDORT_ANGEBOTSFORM_RECHTSGRUNDLAGE[s.angebotsform]].filter(Boolean).join(" · ");
  }
  function leitungText(s: StandortListenEintragDto): string {
    return s.leitung.length > 0 ? s.leitung.map((l) => l.name).join(", ") : "keine Leitung im Organigramm";
  }

  // Einrichtungsverzeichnis, z. B. fuer Aemter. Kostenstelle und IK-Nummer
  // sind bewusst nicht dabei: die Liste liefert sie gar nicht erst.
  const exportListe = (): ListenExport => ({
    titel: "Standorte",
    dateiname: "standorte",
    spalten: [
      { titel: "Standort", breite: 3 },
      { titel: "Angebotsform", breite: 3 },
      { titel: "Anschrift", breite: 4 },
      { titel: "Plätze belegt", breite: 1 },
      { titel: "Plätze eingerichtet", breite: 1 },
      { titel: "Leitung", breite: 3 },
      { titel: "Telefon", breite: 2 },
      { titel: "Status", breite: 1 },
    ],
    zeilen: (standorte ?? []).map((s) => [
      s.name,
      angebotText(s) ?? "",
      s.adresse,
      String(s.plaetzeBelegt),
      String(s.plaetzeEingerichtet),
      s.leitung.map((l) => l.name).join(", "),
      s.telefon ?? "",
      s.aktiv ? "Aktiv" : "Inaktiv",
    ]),
  });

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf zv-standorte-kopf">
        <p className="zv-sub">
          {aktive.length === 1 ? "1 aktiver Standort" : `${aktive.length} aktive Standorte`} · {belegt} von {eingerichtet} Plätzen belegt
        </p>
        <div className="zv-standorte-aktionen">
          <ExportMenue erzeuge={exportListe} />
          <button className="zv-btn" onClick={() => { setFormFehler(null); setNeuFormularOffen(true); }}>
            <INeu />
            Neuer Standort
          </button>
        </div>
      </div>

      {standorte && standorte.length === 0 && !fehler ? (
        <Leerzustand
          icon={ILeerStandorte}
          aktion={<button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => { setFormFehler(null); setNeuFormularOffen(true); }}>Standort anlegen</button>}
        >
          Noch keine Standorte angelegt.
        </Leerzustand>
      ) : (
        standorte && (
          <>
            <div
              className="zv-karten-liste zv-standorte-liste"
              style={{ "--zv-liste-spalten": "minmax(0, 2.4fr) minmax(0, 2fr) minmax(0, 0.8fr) minmax(0, 1.5fr) minmax(0, 1.3fr) minmax(0, 1.4fr) 20px" } as CSSProperties}
            >
              <div className="zv-liste-kopf">
                <span>Standort</span>
                <span>Anschrift</span>
                <span>Plätze</span>
                <span>Leitung</span>
                <span>Telefon</span>
                <span>Status</span>
                <span></span>
              </div>
              {standorte.map((s) => (
                <div
                  key={s.id}
                  className={`zv-info-karte zv-info-karte-klickbar${s.aktiv ? "" : " zv-standort-inaktiv"}`}
                  onClick={() => setOffenerStandort(s.id)}
                >
                  <span className="zv-liste-zelle-titel">
                    {/* Der eigentliche Knopf fuer Tastatur und Screenreader; die Zeile ist nur die grosse Klickflaeche. */}
                    <button type="button" className="zv-standort-name" onClick={(e) => { e.stopPropagation(); setOffenerStandort(s.id); }}>
                      <IStandort />
                      {s.name}
                    </button>
                    <span className="zv-standort-angebot">{angebotText(s) ?? "Angebotsform fehlt"}</span>
                  </span>
                  <span className="zv-liste-zelle" data-label="Anschrift">
                    {s.adresse}
                  </span>
                  <span className="zv-liste-zelle" data-label="Plätze">
                    {s.aktiv && s.plaetzeEingerichtet > 0 ? (
                      <span className="zv-standort-plaetze">
                        <strong>
                          {s.plaetzeBelegt} / {s.plaetzeEingerichtet}
                        </strong>
                        <span>{Math.max(0, s.plaetzeEingerichtet - s.plaetzeBelegt)} frei</span>
                      </span>
                    ) : (
                      "–"
                    )}
                  </span>
                  <span className="zv-liste-zelle" data-label="Leitung">
                    {s.leitung.length > 0 ? <strong>{leitungText(s)}</strong> : leitungText(s)}
                  </span>
                  <span className="zv-liste-zelle" data-label="Telefon">
                    {s.telefon ?? "–"}
                  </span>
                  <span className="zv-liste-zelle zv-standort-status" data-label="Status">
                    <span className={`zv-pill ${s.aktiv ? "zv-pill-zugeordnet" : "zv-pill-neutral"}`}>{s.aktiv ? "Aktiv" : "Inaktiv"}</span>
                    {s.fehlendeAngaben.length > 0 && (
                      <span className="zv-pill zv-pill-frist">
                        {s.fehlendeAngaben.length === 1 ? "1 Angabe fehlt" : `${s.fehlendeAngaben.length} Angaben fehlen`}
                      </span>
                    )}
                  </span>
                  <span className="zv-liste-zelle-aktionen zv-standort-pfeil" aria-hidden="true">
                    <IVor />
                  </span>
                </div>
              ))}
            </div>
            <p className="zv-sub zv-standorte-fuss">
              <IInfo />
              Plätze und Leitung werden nicht eingetragen, sondern aus Zimmern und Organigramm abgeleitet.
            </p>
          </>
        )
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
              <label htmlFor="standort-angebotsform">Angebotsform</label>
              <select id="standort-angebotsform" name="angebotsform" defaultValue="">
                <option value="">Später festlegen</option>
                {Object.entries(STANDORT_ANGEBOTSFORM_LABEL).map(([wert, label]) => (
                  <option key={wert} value={wert}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="standort-strasse">Straße und Hausnummer</label>
              <input id="standort-strasse" name="strasse" autoComplete="street-address" required />
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="standort-plz">PLZ</label>
                <input id="standort-plz" name="plz" inputMode="numeric" pattern="[0-9]{5}" title="Fünf Ziffern" maxLength={5} required />
              </div>
              <div className="zv-field">
                <label htmlFor="standort-ort">Ort</label>
                <input id="standort-ort" name="ort" required />
              </div>
            </div>
            <p className="zv-sub">Telefon, Bereitschaft und alles Weitere folgen danach im Steckbrief.</p>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Standort anlegen"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
