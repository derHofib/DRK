import { FormEvent, useEffect, useState } from "react";
import type { HilfeplanDto, HilfeplanZielDto, TagesberichtDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import {
  IAbbrechen,
  IBearbeiten,
  IFehler,
  ILeerHilfeplan,
  ILoeschen,
  INeu,
  ISErledigt,
  ISOffen,
  ISpeichern,
} from "../../components/icons";
import { formatDatum } from "../../format";
import { Datumsfeld, Zeitraumfeld } from "../../components/Datumsfeld";

/**
 * Hilfeplan mit Zielen je Klient. Der Fortschritt eines Ziels wird nicht
 * ueberschrieben, sondern als neuer Verlaufseintrag angehaengt (optional mit
 * Verweis auf den Tagesbericht, der den Stand belegt) -- die Anzeige zeigt den
 * juengsten Stand, der Verlauf bleibt als Nachweis gegenueber dem Amt.
 */
export function HilfeplanTab({ klientId, onBerichtOeffnen }: { klientId: string; onBerichtOeffnen: () => void }) {
  const [plaene, setPlaene] = useState<HilfeplanDto[]>([]);
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [planFormular, setPlanFormular] = useState(false);

  function laden() {
    api.hilfeplaeneListe(klientId).then(setPlaene).catch((err) => setFehler(err.message));
    api.tagesberichteListe({ klientId }).then(setBerichte).catch(() => {});
  }
  useEffect(laden, [klientId]);

  // Jede Schreiboperation liefert den aktualisierten Plan zurueck.
  function ersetzen(plan: HilfeplanDto) {
    setFehler(null);
    setPlaene((alt) => alt.map((p) => (p.id === plan.id ? plan : p)));
  }
  function meldeFehler(err: unknown, fallback: string) {
    setFehler(err instanceof Error ? err.message : fallback);
  }

  async function planAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.hilfeplanAnlegen({
        klientId,
        von: String(form.get("von")),
        bis: String(form.get("bis") ?? "") || undefined,
        naechstesGespraech: String(form.get("gespraech") ?? "") || undefined,
        bemerkung: String(form.get("bemerkung") ?? "") || undefined,
      });
      setPlanFormular(false);
      formElement.reset();
      laden();
    } catch (err) {
      meldeFehler(err, "Hilfeplan konnte nicht angelegt werden.");
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
        <h3 style={{ margin: 0, fontSize: 15 }}>Hilfeplan und Ziele</h3>
        <button className="zv-btn" onClick={() => setPlanFormular((v) => !v)}>
          {planFormular ? <IAbbrechen /> : <INeu />}
          {planFormular ? "Abbrechen" : "Neuer Hilfeplan"}
        </button>
      </div>

      {planFormular && (
        <form className="zv-inline-form" onSubmit={planAnlegen}>
          <div className="zv-field-row">
            <Zeitraumfeld
              von={{ id: "hp-von", name: "von", label: "Von", required: true }}
              bis={{ id: "hp-bis", name: "bis", label: "Bis (optional)" }}
            />
            <div className="zv-field">
              <label htmlFor="hp-gespraech">Nächstes Hilfeplangespräch (optional)</label>
              <Datumsfeld id="hp-gespraech" name="gespraech" schnellwahl="faelligkeit" />
            </div>
          </div>
          <div className="zv-field">
            <label>Bemerkung (optional)</label>
            <textarea name="bemerkung" rows={2} maxLength={4000} />
          </div>
          <button className="zv-btn" type="submit">
            <ISpeichern />
            Anlegen
          </button>
        </form>
      )}

      {plaene.length === 0 ? (
        <Leerzustand icon={ILeerHilfeplan}>Noch kein Hilfeplan erfasst.</Leerzustand>
      ) : (
        plaene.map((plan) => (
          <PlanKarte
            key={plan.id}
            plan={plan}
            berichte={berichte}
            onGeaendert={ersetzen}
            onFehler={meldeFehler}
            onBerichtOeffnen={onBerichtOeffnen}
          />
        ))
      )}
    </div>
  );
}

function PlanKarte({
  plan,
  berichte,
  onGeaendert,
  onFehler,
  onBerichtOeffnen,
}: {
  plan: HilfeplanDto;
  berichte: TagesberichtDto[];
  onGeaendert: (p: HilfeplanDto) => void;
  onFehler: (err: unknown, fallback: string) => void;
  onBerichtOeffnen: () => void;
}) {
  const [zielFormular, setZielFormular] = useState(false);
  const [gespraechBearbeiten, setGespraechBearbeiten] = useState(false);

  async function zielAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    try {
      onGeaendert(
        await api.hilfeplanZielAnlegen(plan.id, {
          titel: String(form.get("titel")),
          beschreibung: String(form.get("beschreibung") ?? "") || undefined,
          faelligAm: String(form.get("faellig") ?? "") || undefined,
        })
      );
      setZielFormular(false);
      formElement.reset();
    } catch (err) {
      onFehler(err, "Ziel konnte nicht angelegt werden.");
    }
  }

  async function gespraechSpeichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const wert = String(new FormData(e.currentTarget).get("gespraech") ?? "");
    try {
      onGeaendert(await api.hilfeplanAendern(plan.id, { naechstesGespraech: wert || null }));
      setGespraechBearbeiten(false);
    } catch (err) {
      onFehler(err, "Termin konnte nicht gespeichert werden.");
    }
  }

  const offen = plan.ziele.filter((z) => !z.verworfen);
  const verworfen = plan.ziele.filter((z) => z.verworfen);
  const erreicht = offen.filter((z) => z.erreicht).length;

  return (
    <section className="zv-hilfeplan" aria-label={`Hilfeplan ab ${formatDatum(plan.von)}`}>
      <header className="zv-hilfeplan-kopf">
        <div>
          <strong>
            {formatDatum(plan.von)} – {plan.bis ? formatDatum(plan.bis) : "offen"}
          </strong>
          <div className="zv-hilfeplan-meta">
            {offen.length > 0 ? `${erreicht} von ${offen.length} Zielen erreicht` : "Noch keine Ziele"}
          </div>
        </div>
        <div className="zv-hilfeplan-gespraech">
          {gespraechBearbeiten ? (
            <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={gespraechSpeichern}>
              <Datumsfeld
                name="gespraech"
                defaultValue={plan.naechstesGespraech ?? ""}
                aria-label="Nächstes Hilfeplangespräch"
                groesse="kompakt"
                schnellwahl="faelligkeit"
              />
              <button className="zv-link-btn" type="submit">
                <ISpeichern />
                Speichern
              </button>
            </form>
          ) : (
            <>
              <span className="zv-hilfeplan-meta">Nächstes Gespräch: </span>
              <strong>{plan.naechstesGespraech ? formatDatum(plan.naechstesGespraech) : "nicht festgelegt"}</strong>
              <button className="zv-link-btn" onClick={() => setGespraechBearbeiten(true)}>
                <IBearbeiten />
                Ändern
              </button>
            </>
          )}
        </div>
      </header>
      {plan.bemerkung && <p className="zv-hilfeplan-bemerkung">{plan.bemerkung}</p>}

      {offen.map((z) => (
        <ZielKarte key={z.id} ziel={z} berichte={berichte} onGeaendert={onGeaendert} onFehler={onFehler} onBerichtOeffnen={onBerichtOeffnen} />
      ))}
      {verworfen.length > 0 && (
        <details className="zv-hilfeplan-verworfen">
          <summary>Verworfene Ziele ({verworfen.length})</summary>
          {verworfen.map((z) => (
            <ZielKarte key={z.id} ziel={z} berichte={berichte} onGeaendert={onGeaendert} onFehler={onFehler} onBerichtOeffnen={onBerichtOeffnen} />
          ))}
        </details>
      )}

      {zielFormular ? (
        <form className="zv-inline-form" onSubmit={zielAnlegen}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label>Ziel</label>
              <input name="titel" required maxLength={300} />
            </div>
            <div className="zv-field">
              <label htmlFor={`hp-ziel-faellig-${plan.id}`}>Fällig am (optional)</label>
              <Datumsfeld id={`hp-ziel-faellig-${plan.id}`} name="faellig" schnellwahl="faelligkeit" />
            </div>
          </div>
          <div className="zv-field">
            <label>Beschreibung (optional)</label>
            <textarea name="beschreibung" rows={2} maxLength={4000} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="zv-btn" type="submit">
              <ISpeichern />
              Ziel anlegen
            </button>
            <button className="zv-btn" type="button" onClick={() => setZielFormular(false)}>
              <IAbbrechen />
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <button className="zv-link-btn" onClick={() => setZielFormular(true)}>
          <INeu />
          Ziel hinzufügen
        </button>
      )}
    </section>
  );
}

function ZielKarte({
  ziel,
  berichte,
  onGeaendert,
  onFehler,
  onBerichtOeffnen,
}: {
  ziel: HilfeplanZielDto;
  berichte: TagesberichtDto[];
  onGeaendert: (p: HilfeplanDto) => void;
  onFehler: (err: unknown, fallback: string) => void;
  onBerichtOeffnen: () => void;
}) {
  const [fortschrittOffen, setFortschrittOffen] = useState(false);
  const [wert, setWert] = useState(ziel.fortschritt);

  async function erfassen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      onGeaendert(
        await api.hilfeplanVerlaufErfassen(ziel.id, {
          fortschritt: wert,
          notiz: String(form.get("notiz") ?? "") || undefined,
          tagesberichtId: String(form.get("bericht") ?? "") || undefined,
        })
      );
      setFortschrittOffen(false);
    } catch (err) {
      onFehler(err, "Fortschritt konnte nicht gespeichert werden.");
    }
  }

  async function verwerfen(verworfen: boolean) {
    try {
      onGeaendert(await api.hilfeplanZielAendern(ziel.id, { verworfen }));
    } catch (err) {
      onFehler(err, "Ziel konnte nicht geändert werden.");
    }
  }

  return (
    <article className={`zv-ziel${ziel.verworfen ? " zv-ziel-verworfen" : ""}`}>
      <div className="zv-ziel-kopf">
        <span className="zv-ziel-titel">{ziel.titel}</span>
        {ziel.erreicht && (
          <span className="zv-pill zv-pill-erledigt">
            <ISErledigt />
            Erreicht
          </span>
        )}
        {ziel.ueberfaellig && (
          <span className="zv-pill zv-pill-achtung">
            <ISOffen />
            Überfällig
          </span>
        )}
        {ziel.verworfen && <span className="zv-pill">Verworfen</span>}
        {ziel.faelligAm && !ziel.erreicht && !ziel.verworfen && (
          <span className="zv-ziel-faellig">fällig {formatDatum(ziel.faelligAm)}</span>
        )}
      </div>
      {ziel.beschreibung && <p className="zv-ziel-beschreibung">{ziel.beschreibung}</p>}

      <div className="zv-ziel-fortschritt">
        <progress max={100} value={ziel.fortschritt} aria-label={`Fortschritt ${ziel.titel}`} />
        <span className="zv-mono">{ziel.fortschritt} %</span>
      </div>

      {!ziel.verworfen && (
        <div className="zv-ziel-aktionen">
          {!fortschrittOffen && (
            <button
              className="zv-link-btn"
              onClick={() => {
                setWert(ziel.fortschritt);
                setFortschrittOffen(true);
              }}
            >
              <IBearbeiten />
              Fortschritt eintragen
            </button>
          )}
          <button className="zv-link-btn" onClick={() => verwerfen(true)}>
            <ILoeschen />
            Verwerfen
          </button>
        </div>
      )}
      {ziel.verworfen && (
        <button className="zv-link-btn" onClick={() => verwerfen(false)}>
          Wieder aufnehmen
        </button>
      )}

      {fortschrittOffen && (
        <form className="zv-inline-form" onSubmit={erfassen}>
          <div className="zv-field">
            <label>
              Stand: <span className="zv-mono">{wert} %</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={wert}
              onChange={(e) => setWert(Number(e.target.value))}
            />
          </div>
          <div className="zv-field">
            <label>Notiz (optional)</label>
            <input name="notiz" maxLength={2000} />
          </div>
          <div className="zv-field">
            <label>Belegt durch Tagesbericht (optional)</label>
            <select name="bericht" defaultValue="">
              <option value="">Kein Bezug</option>
              {berichte.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatDatum(b.datum)} – {b.text.slice(0, 60)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="zv-btn" type="submit">
              <ISpeichern />
              Speichern
            </button>
            <button className="zv-btn" type="button" onClick={() => setFortschrittOffen(false)}>
              <IAbbrechen />
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {ziel.verlauf.length > 0 && (
        <details className="zv-ziel-verlauf">
          <summary>Verlauf ({ziel.verlauf.length})</summary>
          <ul>
            {ziel.verlauf.map((v) => (
              <li key={v.id}>
                <span className="zv-mono">{v.fortschritt} %</span> · {new Date(v.erstelltAm).toLocaleDateString("de-DE")}
                {v.erstelltVonName ? ` · ${v.erstelltVonName}` : ""}
                {v.notiz ? ` — ${v.notiz}` : ""}
                {v.tagesbericht && (
                  <>
                    {" · "}
                    <button className="zv-link-btn" onClick={onBerichtOeffnen}>
                      Tagesbericht vom {formatDatum(v.tagesbericht.datum)}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
