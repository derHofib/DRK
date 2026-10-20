import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import type { RaumplanDto, RaumplanEtageDto, RaumplanPositionDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { Leerzustand } from "../components/Leerzustand";
import {
  IAbbrechen,
  IBaumAnsicht,
  IFehler,
  IGemeinschaftsraum,
  IGrundrissAnsicht,
  IHochladen,
  ILeerStandorte,
  ILoeschen,
  INeu,
  ISpeichern,
  IVerschieben,
  IZimmer,
} from "../components/icons";

type Ansicht = "baum" | "grundriss";
type Objektart = "zimmer" | "raum";

const ANSICHT_SPEICHER = "zimmerakte_raumplan_ansicht";

// Reine Anzeigepraeferenz dieses Geraets, wie Theme und Menue-Reihenfolge.
function ladeAnsicht(): Ansicht {
  try {
    return localStorage.getItem(ANSICHT_SPEICHER) === "grundriss" ? "grundriss" : "baum";
  } catch {
    return "baum";
  }
}

function speichereAnsicht(a: Ansicht) {
  try {
    localStorage.setItem(ANSICHT_SPEICHER, a);
  } catch {
    // Nicht speichern zu koennen darf das Umschalten nicht verhindern.
  }
}

const schluessel = (art: Objektart, id: string) => `${art}:${id}`;

/**
 * Raumplan EINES Standorts (Unterpunkt unter "Standorte"): Etagen mit ihren
 * Zimmern und Gemeinschaftsraeumen, wahlweise als Baum (Etage links, Raeume
 * rechts abzweigend) oder auf einem hochgeladenen Grundriss, auf dem die
 * Karten frei platziert werden. Zimmer selbst werden weiterhin unter "Zimmer"
 * angelegt -- hier kommen nur die Gemeinschaftsraeume dazu, die dort keinen
 * Platz haben (sie zaehlen nicht als Wohnplatz, siehe Migration 0051).
 */
export function StandortRaeume({ standortId }: { standortId: string }) {
  const [plan, setPlan] = useState<RaumplanDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>(() => ladeAnsicht());
  const [aktiveEtage, setAktiveEtage] = useState<string | null>(null);
  const [raumDialog, setRaumDialog] = useState<{ id: string; name: string; etage: string } | "neu" | null>(null);

  const laden = useCallback(() => {
    api
      .raumplan(standortId)
      .then((p) => {
        setPlan(p);
        setFehler(null);
        // Die gewaehlte Etage behalten, solange es sie noch gibt.
        setAktiveEtage((a) => (a && p.etagen.some((e) => e.etage === a) ? a : (p.etagen[0]?.etage ?? null)));
      })
      .catch((err) => setFehler(err.message));
  }, [standortId]);

  useEffect(laden, [laden]);

  function ansichtWaehlen(a: Ansicht) {
    setAnsicht(a);
    speichereAnsicht(a);
  }

  const etage = plan?.etagen.find((e) => e.etage === aktiveEtage) ?? null;

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <div>
          <h2>{plan?.standort.name ?? "Standort"}</h2>
          <p className="zv-sub" style={{ margin: "2px 0 0" }}>
            Zimmer und Gemeinschaftsräume
          </p>
        </div>
        {plan?.darfBearbeiten && (
          <button className="zv-btn" onClick={() => setRaumDialog("neu")}>
            <INeu />
            Gemeinschaftsraum
          </button>
        )}
      </div>

      {plan && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--zv-space-3)", marginBottom: "var(--zv-space-4)" }}>
          <div className="zv-segmented" role="radiogroup" aria-label="Ansicht">
            <button
              role="radio"
              aria-checked={ansicht === "baum"}
              className={ansicht === "baum" ? "active" : ""}
              onClick={() => ansichtWaehlen("baum")}
            >
              <IBaumAnsicht />
              Baum
            </button>
            <button
              role="radio"
              aria-checked={ansicht === "grundriss"}
              className={ansicht === "grundriss" ? "active" : ""}
              onClick={() => ansichtWaehlen("grundriss")}
            >
              <IGrundrissAnsicht />
              Grundriss
            </button>
          </div>

          {ansicht === "grundriss" && plan.etagen.length > 0 && (
            <div className="zv-segmented" role="radiogroup" aria-label="Etage">
              {plan.etagen.map((e) => (
                <button
                  key={e.etage}
                  role="radio"
                  aria-checked={aktiveEtage === e.etage}
                  className={aktiveEtage === e.etage ? "active" : ""}
                  onClick={() => setAktiveEtage(e.etage)}
                >
                  {e.etage}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {plan && plan.etagen.length === 0 && !fehler && (
        <Leerzustand icon={ILeerStandorte}>
          An diesem Standort gibt es noch keine Zimmer oder Gemeinschaftsräume.
        </Leerzustand>
      )}

      {plan && ansicht === "baum" && (
        <Raumbaum etagen={plan.etagen} darfBearbeiten={plan.darfBearbeiten} onRaumKlick={setRaumDialog} />
      )}

      {plan && ansicht === "grundriss" && etage && (
        <Raumgrundriss
          key={etage.etage}
          standortId={standortId}
          etage={etage}
          darfBearbeiten={plan.darfBearbeiten}
          onGeaendert={laden}
          onFehler={setFehler}
        />
      )}

      {raumDialog && plan && (
        <RaumDialog
          standortId={standortId}
          raum={raumDialog === "neu" ? null : raumDialog}
          etagen={plan.etagen.map((e) => e.etage)}
          standardEtage={aktiveEtage ?? "EG"}
          onClose={() => setRaumDialog(null)}
          onGespeichert={() => {
            setRaumDialog(null);
            laden();
          }}
        />
      )}
    </div>
  );
}

function belegungsPill(belegt: number, kapazitaet: number) {
  const klasse = belegt === 0 ? "zv-pill-zugeordnet" : belegt >= kapazitaet ? "zv-pill-vergeben" : "zv-pill-teilweise";
  return <span className={`zv-pill ${klasse}`}>{belegt} / {kapazitaet}</span>;
}

function Raumbaum({
  etagen,
  darfBearbeiten,
  onRaumKlick,
}: {
  etagen: RaumplanEtageDto[];
  darfBearbeiten: boolean;
  onRaumKlick: (raum: { id: string; name: string; etage: string }) => void;
}) {
  return (
    <div className="zv-raumbaum">
      {etagen.map((e) => (
        <div key={e.etage} className="zv-raumbaum-zeile">
          <div className="zv-raumbaum-etage">
            <strong>{e.etage}</strong>
            <span>
              {e.zimmer.length} Zimmer · {e.raeume.length} {e.raeume.length === 1 ? "Raum" : "Räume"}
            </span>
          </div>
          <div className="zv-raumbaum-aeste">
            {e.zimmer.map((z) => (
              <div key={z.id} className="zv-raumbaum-ast">
                <div className="zv-raumknoten">
                  <span className="zv-raumknoten-kopf">
                    <IZimmer />
                    Zimmer {z.nummer}
                    {belegungsPill(z.bewohner.length, z.kapazitaet)}
                  </span>
                  <span className="zv-raumknoten-sub">
                    {z.bewohner.length === 0 ? "frei" : z.bewohner.map((b) => b.name).join(", ")}
                  </span>
                </div>
              </div>
            ))}
            {e.raeume.map((r) => {
              const inhalt = (
                <>
                  <span className="zv-raumknoten-kopf">
                    <IGemeinschaftsraum />
                    {r.name}
                    <span className="zv-pill zv-pill-info">Gemeinschaft</span>
                  </span>
                </>
              );
              return (
                <div key={r.id} className="zv-raumbaum-ast">
                  {darfBearbeiten ? (
                    <button
                      className="zv-raumknoten zv-raumknoten-gemeinschaft"
                      onClick={() => onRaumKlick({ id: r.id, name: r.name, etage: e.etage })}
                      title="Gemeinschaftsraum bearbeiten"
                    >
                      {inhalt}
                    </button>
                  ) : (
                    <div className="zv-raumknoten zv-raumknoten-gemeinschaft">{inhalt}</div>
                  )}
                </div>
              );
            })}
            {e.zimmer.length === 0 && e.raeume.length === 0 && (
              <div className="zv-raumbaum-ast">
                <div className="zv-raumknoten zv-raumknoten-gemeinschaft">
                  <span className="zv-raumknoten-sub">Keine Räume auf dieser Etage.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface Karte {
  art: Objektart;
  id: string;
  titel: string;
  sub: string;
}

function Raumgrundriss({
  standortId,
  etage,
  darfBearbeiten,
  onGeaendert,
  onFehler,
}: {
  standortId: string;
  etage: RaumplanEtageDto;
  darfBearbeiten: boolean;
  onGeaendert: () => void;
  onFehler: (meldung: string | null) => void;
}) {
  const [bildUrl, setBildUrl] = useState<string | null>(null);
  const [bildVersion, setBildVersion] = useState(0);
  const [anordnen, setAnordnen] = useState(false);
  // Entwurf nur waehrend des Anordnens: schluessel -> Position. Erst
  // "Speichern" schickt ihn ab, "Abbrechen" verwirft ihn.
  const [entwurf, setEntwurf] = useState<Record<string, RaumplanPositionDto>>({});
  const [zieht, setZieht] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const flaecheRef = useRef<HTMLDivElement>(null);
  const dateiRef = useRef<HTMLInputElement>(null);

  const karten: Karte[] = [
    ...etage.zimmer.map((z) => ({
      art: "zimmer" as const,
      id: z.id,
      titel: `Zimmer ${z.nummer}`,
      sub: z.bewohner.length === 0 ? "frei" : `${z.bewohner.length} / ${z.kapazitaet}`,
    })),
    ...etage.raeume.map((r) => ({ art: "raum" as const, id: r.id, titel: r.name, sub: "Gemeinschaft" })),
  ];
  const gespeichertePosition = (k: Karte) =>
    (k.art === "zimmer" ? etage.zimmer.find((z) => z.id === k.id)?.position : etage.raeume.find((r) => r.id === k.id)?.position) ?? null;

  useEffect(() => {
    if (!etage.hatGrundriss) {
      setBildUrl(null);
      return;
    }
    let abgebrochen = false;
    let url: string | null = null;
    api
      .grundrissUrl(standortId, etage.etage)
      .then((u) => {
        if (abgebrochen) URL.revokeObjectURL(u);
        else {
          url = u;
          setBildUrl(u);
        }
      })
      .catch((err) => !abgebrochen && onFehler(err.message));
    return () => {
      abgebrochen = true;
      if (url) URL.revokeObjectURL(url);
    };
    // onFehler ist ein State-Setter des Elternteils (stabil).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standortId, etage.etage, etage.hatGrundriss, bildVersion]);

  function positionVon(k: Karte): RaumplanPositionDto | null {
    return anordnen ? (entwurf[schluessel(k.art, k.id)] ?? null) : gespeichertePosition(k);
  }

  function anordnenStarten() {
    const start: Record<string, RaumplanPositionDto> = {};
    for (const k of karten) {
      const p = gespeichertePosition(k);
      if (p) start[schluessel(k.art, k.id)] = p;
    }
    setEntwurf(start);
    setAnordnen(true);
  }

  // Neue Karte auf freien Platz in einem Raster, damit mehrere nicht exakt
  // uebereinander landen -- verschoben wird danach per Ziehen.
  function aufPlanSetzen(k: Karte) {
    setEntwurf((alt) => {
      const n = Object.keys(alt).length;
      return { ...alt, [schluessel(k.art, k.id)]: { x: 12 + (n % 5) * 18, y: 12 + (Math.floor(n / 5) % 6) * 14 } };
    });
  }

  function vomPlanNehmen(k: Karte) {
    setEntwurf((alt) => {
      const neu = { ...alt };
      delete neu[schluessel(k.art, k.id)];
      return neu;
    });
  }

  function beiZiehen(e: ReactPointerEvent<HTMLDivElement>, key: string) {
    if (zieht !== key || !flaecheRef.current) return;
    const r = flaecheRef.current.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
    setEntwurf((alt) => ({ ...alt, [key]: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } }));
  }

  async function speichern() {
    setWirdGespeichert(true);
    onFehler(null);
    try {
      await api.raumplanPositionenSetzen(standortId, {
        etage: etage.etage,
        positionen: karten.flatMap((k) => {
          const p = entwurf[schluessel(k.art, k.id)];
          return p ? [{ art: k.art, id: k.id, x: p.x, y: p.y }] : [];
        }),
      });
      setAnordnen(false);
      onGeaendert();
    } catch (err) {
      onFehler(err instanceof Error ? err.message : "Plan konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function hochladen(datei: File | undefined) {
    if (!datei) return;
    onFehler(null);
    try {
      await api.grundrissHochladen(standortId, etage.etage, datei);
      setBildVersion((v) => v + 1);
      onGeaendert();
    } catch (err) {
      onFehler(err instanceof Error ? err.message : "Grundriss konnte nicht hochgeladen werden.");
    } finally {
      if (dateiRef.current) dateiRef.current.value = "";
    }
  }

  async function grundrissEntfernen() {
    onFehler(null);
    try {
      await api.grundrissLoeschen(standortId, etage.etage);
      setAnordnen(false);
      onGeaendert();
    } catch (err) {
      onFehler(err instanceof Error ? err.message : "Grundriss konnte nicht entfernt werden.");
    }
  }

  const nichtPlatziert = karten.filter((k) => !entwurf[schluessel(k.art, k.id)]);
  const ungesetzteAnzahl = karten.filter((k) => !gespeichertePosition(k)).length;

  return (
    <div>
      {darfBearbeiten && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--zv-space-2)", marginBottom: "var(--zv-space-3)" }}>
          <input
            ref={dateiRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => hochladen(e.target.files?.[0])}
          />
          {!anordnen && (
            <button className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => dateiRef.current?.click()}>
              <IHochladen />
              {etage.hatGrundriss ? "Grundriss ersetzen" : "Grundriss hochladen"}
            </button>
          )}
          {etage.hatGrundriss && !anordnen && (
            <>
              <button className="zv-btn zv-btn-klein" onClick={anordnenStarten}>
                <IVerschieben />
                Karten anordnen
              </button>
              <button className="zv-btn zv-btn-still zv-btn-klein" onClick={grundrissEntfernen}>
                <ILoeschen />
                Grundriss entfernen
              </button>
            </>
          )}
          {anordnen && (
            <>
              <button className="zv-btn zv-btn-klein" onClick={speichern} disabled={wirdGespeichert}>
                <ISpeichern />
                {wirdGespeichert ? "Speichert…" : "Speichern"}
              </button>
              <button className="zv-btn zv-btn-still zv-btn-klein" onClick={() => setAnordnen(false)} disabled={wirdGespeichert}>
                <IAbbrechen />
                Abbrechen
              </button>
            </>
          )}
        </div>
      )}

      {!etage.hatGrundriss ? (
        <Leerzustand icon={ILeerStandorte}>
          {darfBearbeiten
            ? `Für ${etage.etage} ist noch kein Grundriss hinterlegt. Laden Sie ein Bild (JPG, PNG oder WebP) hoch, um die Karten darauf anzuordnen.`
            : `Für ${etage.etage} ist noch kein Grundriss hinterlegt.`}
        </Leerzustand>
      ) : (
        <>
          <div className="zv-grundriss" ref={flaecheRef}>
            {bildUrl && <img src={bildUrl} alt={`Grundriss ${etage.etage}`} draggable={false} />}
            {karten.map((k) => {
              const pos = positionVon(k);
              if (!pos) return null;
              const key = schluessel(k.art, k.id);
              const klassen = [
                "zv-grundriss-karte",
                k.art === "raum" ? "zv-grundriss-karte-gemeinschaft" : "",
                anordnen ? "zv-grundriss-karte-bewegbar" : "",
                zieht === key ? "zv-grundriss-karte-zieht" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={key}
                  className={klassen}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` } as CSSProperties}
                  onPointerDown={
                    anordnen
                      ? (e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setZieht(key);
                        }
                      : undefined
                  }
                  onPointerMove={anordnen ? (e) => beiZiehen(e, key) : undefined}
                  onPointerUp={anordnen ? () => setZieht(null) : undefined}
                  onPointerCancel={anordnen ? () => setZieht(null) : undefined}
                >
                  <strong>{k.titel}</strong>
                  {k.sub}
                  {anordnen && (
                    <button
                      className="zv-grundriss-karte-entfernen"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => vomPlanNehmen(k)}
                      aria-label={`${k.titel} vom Plan nehmen`}
                      title="Vom Plan nehmen"
                    >
                      <IAbbrechen />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {anordnen ? (
            <>
              <p className="zv-sub" style={{ margin: "var(--zv-space-3) 0 0" }}>
                {nichtPlatziert.length === 0
                  ? "Alle Karten liegen auf dem Plan. Ziehen Sie sie an die richtige Stelle."
                  : "Noch nicht auf dem Plan – zum Platzieren antippen, danach ziehen:"}
              </p>
              <div className="zv-grundriss-ablage">
                {nichtPlatziert.map((k) => (
                  <button key={schluessel(k.art, k.id)} className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => aufPlanSetzen(k)}>
                    {k.art === "zimmer" ? <IZimmer /> : <IGemeinschaftsraum />}
                    {k.titel}
                  </button>
                ))}
              </div>
            </>
          ) : (
            darfBearbeiten &&
            ungesetzteAnzahl > 0 && (
              <p className="zv-sub" style={{ margin: "var(--zv-space-3) 0 0" }}>
                {ungesetzteAnzahl} {ungesetzteAnzahl === 1 ? "Karte liegt" : "Karten liegen"} noch nicht auf dem Plan
                („Karten anordnen“).
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

function RaumDialog({
  standortId,
  raum,
  etagen,
  standardEtage,
  onClose,
  onGespeichert,
}: {
  standortId: string;
  raum: { id: string; name: string; etage: string } | null;
  etagen: string[];
  standardEtage: string;
  onClose: () => void;
  onGespeichert: () => void;
}) {
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const etage = String(form.get("etage") ?? "").trim();
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      if (raum) await api.raumAktualisieren(standortId, raum.id, { name, etage });
      else await api.raumAnlegen(standortId, { name, etage });
      onGespeichert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      setWirdGespeichert(false);
    }
  }

  async function entfernen() {
    if (!raum) return;
    setWirdGespeichert(true);
    try {
      await api.raumAktualisieren(standortId, raum.id, { aktiv: false });
      onGespeichert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Entfernen fehlgeschlagen.");
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel={raum ? "Gemeinschaftsraum bearbeiten" : "Neuer Gemeinschaftsraum"} onClose={onClose}>
      <form onSubmit={speichern}>
        {formFehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {formFehler}
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="raum-name">Name</label>
          <input id="raum-name" name="name" defaultValue={raum?.name ?? ""} placeholder="z. B. Küche, Waschküche" required autoFocus />
        </div>
        <div className="zv-field">
          <label htmlFor="raum-etage">Etage</label>
          <input id="raum-etage" name="etage" list="raum-etagen" defaultValue={raum?.etage ?? standardEtage} required />
          <datalist id="raum-etagen">
            {etagen.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </div>
        <div className="zv-vorschau-zeile">
          <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
            <ISpeichern />
            {wirdGespeichert ? "Speichert…" : "Speichern"}
          </button>
          {raum && (
            <button className="zv-btn zv-btn-gefahr" type="button" onClick={entfernen} disabled={wirdGespeichert}>
              <ILoeschen />
              Entfernen
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
