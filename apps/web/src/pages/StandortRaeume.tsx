import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import type { RaumplanDto, RaumplanEtageDto, RaumplanPositionDto, StandortDto } from "@zimmerakte/shared";

type Zimmer = RaumplanEtageDto["zimmer"][number];
type Gemeinschaftsraum = RaumplanEtageDto["raeume"][number];
import { api } from "../api/client";
import { bildVerkleinern } from "../datei";
import { Modal } from "../components/Modal";
import { Zimmer as ZimmerVerwaltung } from "./Zimmer";
import { Seitenpanel } from "../components/Seitenpanel";
import { StandortReiter } from "../components/StandortReiter";
import { PRIORITAET_PILL_KLASSE } from "../components/AufgabeZeile";
import { AUFGABE_PRIORITAET_LABEL } from "@zimmerakte/shared";
import { formatDatum } from "../format";
import { Leerzustand } from "../components/Leerzustand";
import {
  IAbbrechen,
  IBaumAnsicht,
  IBearbeiten,
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

type Ansicht = "baum" | "grundriss" | "verwalten";
type Objektart = "zimmer" | "raum";

const ANSICHT_SPEICHER = "zimmerakte_raumplan_ansicht";

// Reine Anzeigepraeferenz dieses Geraets, wie Theme und Menue-Reihenfolge.
function ladeAnsicht(): Ansicht {
  try {
    const gespeichert = localStorage.getItem(ANSICHT_SPEICHER);
    return gespeichert === "grundriss" || gespeichert === "verwalten" ? gespeichert : "baum";
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
export function StandortRaeume({
  standortId,
  onStandortWaehlen,
}: {
  standortId: string;
  /** null = "Alle Standorte" (Uebersicht). */
  onStandortWaehlen: (id: string | null) => void;
}) {
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  useEffect(() => {
    api
      .standorteListe()
      .then((l) => setStandorte(l.filter((s) => s.aktiv)))
      .catch(() => {});
  }, []);
  const [plan, setPlan] = useState<RaumplanDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>(() => ladeAnsicht());
  const [aktiveEtage, setAktiveEtage] = useState<string | null>(null);
  // Seitenpanel: welche Karte geoeffnet ist. "detail" bleibt beim Schliessen
  // stehen, damit der Inhalt waehrend der Ausfahr-Animation nicht schon
  // verschwindet (siehe Seitenpanel.tsx: Panel bleibt immer im DOM).
  const [detail, setDetail] = useState<{ art: Objektart; id: string } | null>(null);
  const [panelOffen, setPanelOffen] = useState(false);
  const [zimmerNeuOffen, setZimmerNeuOffen] = useState(false);
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
    // "Verwalten" aendert Zimmer (anlegen, einziehen, ...) ausserhalb dieser
    // Komponente -- beim Zurueckwechseln den Plan neu holen, sonst zeigen
    // Baum und Grundriss den Stand von vor der Aenderung.
    if (a !== "verwalten") laden();
  }

  const etage = plan?.etagen.find((e) => e.etage === aktiveEtage) ?? null;

  const oeffneDetail = useCallback((art: Objektart, id: string) => {
    setDetail({ art, id });
    setPanelOffen(true);
  }, []);
  const schliesseDetail = useCallback(() => setPanelOffen(false), []);

  // Immer aus dem aktuellen Plan nachschlagen statt ein Objekt zu kopieren:
  // nach "Speichern"/Neuladen zeigt das Panel sonst veraltete Daten.
  let detailZimmer: { zimmer: Zimmer; etage: string } | null = null;
  let detailRaum: { raum: Gemeinschaftsraum; etage: string } | null = null;
  if (plan && detail) {
    for (const e of plan.etagen) {
      if (detail.art === "zimmer") {
        const z = e.zimmer.find((x) => x.id === detail.id);
        if (z) detailZimmer = { zimmer: z, etage: e.etage };
      } else {
        const r = e.raeume.find((x) => x.id === detail.id);
        if (r) detailRaum = { raum: r, etage: e.etage };
      }
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
        <div>
          <p className="zv-kontextzeile">{plan ? plan.standort.name : "Standort"}</p>
          <h2>Belegung</h2>
        </div>
        {ansicht !== "verwalten" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--zv-space-2)" }}>
            <button className="zv-btn" onClick={() => setZimmerNeuOffen(true)}>
              <INeu />
              Neues Zimmer
            </button>
            {plan?.darfBearbeiten && (
              <button className="zv-btn zv-btn-sekundaer" onClick={() => setRaumDialog("neu")}>
                <INeu />
                Gemeinschaftsraum
              </button>
            )}
          </div>
        )}
      </div>

      <StandortReiter
        eintraege={[{ id: null, label: "Alle Standorte" }, ...standorte.map((st) => ({ id: st.id, label: st.name }))]}
        aktiv={standortId}
        onWaehle={onStandortWaehlen}
      />

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
            <button
              role="radio"
              aria-checked={ansicht === "verwalten"}
              className={ansicht === "verwalten" ? "active" : ""}
              onClick={() => ansichtWaehlen("verwalten")}
            >
              <IZimmer />
              Verwalten
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

      {ansicht === "verwalten" && <ZimmerVerwaltung standortId={standortId} />}

      {plan && ansicht === "baum" && (
        <Raumbaum etagen={plan.etagen} onOeffnen={oeffneDetail} />
      )}

      {plan && ansicht === "grundriss" && etage && (
        <Raumgrundriss
          key={etage.etage}
          standortId={standortId}
          etage={etage}
          darfBearbeiten={plan.darfBearbeiten}
          onGeaendert={laden}
          onFehler={setFehler}
          onOeffnen={oeffneDetail}
        />
      )}

      {zimmerNeuOffen && plan && (
        <ZimmerNeuDialog
          standortId={standortId}
          etagen={plan.etagen.map((e) => e.etage)}
          standardEtage={aktiveEtage ?? "EG"}
          onClose={() => setZimmerNeuOffen(false)}
          onAngelegt={() => {
            setZimmerNeuOffen(false);
            laden();
          }}
        />
      )}

      <Seitenpanel offen={panelOffen} onSchliessen={schliesseDetail}>
        {detailZimmer && plan && (
          <ZimmerDetail
            zimmer={detailZimmer.zimmer}
            etage={detailZimmer.etage}
            standort={plan.standort.name}
            onVerwalten={() => {
              setPanelOffen(false);
              ansichtWaehlen("verwalten");
            }}
          />
        )}
        {detailRaum && plan && (
          <RaumDetail
            raum={detailRaum.raum}
            etage={detailRaum.etage}
            standort={plan.standort.name}
            darfBearbeiten={plan.darfBearbeiten}
            onBearbeiten={() => {
              setPanelOffen(false);
              setRaumDialog({ id: detailRaum!.raum.id, name: detailRaum!.raum.name, etage: detailRaum!.etage });
            }}
          />
        )}
      </Seitenpanel>

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
  onOeffnen,
}: {
  etagen: RaumplanEtageDto[];
  onOeffnen: (art: Objektart, id: string) => void;
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
                <button className="zv-raumknoten" onClick={() => onOeffnen("zimmer", z.id)} title="Details zum Zimmer">
                  <span className="zv-raumknoten-kopf">
                    <IZimmer />
                    Zimmer {z.nummer}
                    {belegungsPill(z.bewohner.length, z.kapazitaet)}
                  </span>
                  <span className="zv-raumknoten-sub">
                    {z.bewohner.length === 0 ? "frei" : z.bewohner.map((b) => b.name).join(", ")}
                  </span>
                </button>
              </div>
            ))}
            {e.raeume.map((r) => (
              <div key={r.id} className="zv-raumbaum-ast">
                <button
                  className="zv-raumknoten zv-raumknoten-gemeinschaft"
                  onClick={() => onOeffnen("raum", r.id)}
                  title="Details zum Raum"
                >
                  <span className="zv-raumknoten-kopf">
                    <IGemeinschaftsraum />
                    {r.name}
                    <span className="zv-pill zv-pill-info">Gemeinschaft</span>
                  </span>
                </button>
              </div>
            ))}
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
  onOeffnen,
}: {
  standortId: string;
  etage: RaumplanEtageDto;
  darfBearbeiten: boolean;
  onGeaendert: () => void;
  onFehler: (meldung: string | null) => void;
  onOeffnen: (art: Objektart, id: string) => void;
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
      await api.grundrissHochladen(standortId, etage.etage, await bildVerkleinern(datei));
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
            {bildUrl && (
              <img
                src={bildUrl}
                alt={`Grundriss ${etage.etage}`}
                draggable={false}
                onError={() =>
                  onFehler(
                    "Das Bild kann vom Browser nicht angezeigt werden (vermutlich zu viele Pixel). Bitte „Grundriss ersetzen“ und die Datei erneut hochladen."
                  )
                }
              />
            )}
            {karten.map((k) => {
              const pos = positionVon(k);
              if (!pos) return null;
              const key = schluessel(k.art, k.id);
              const klassen = [
                "zv-grundriss-karte",
                k.art === "raum" ? "zv-grundriss-karte-gemeinschaft" : "",
                anordnen ? "zv-grundriss-karte-bewegbar" : "zv-grundriss-karte-klickbar",
                zieht === key ? "zv-grundriss-karte-zieht" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={key}
                  className={klassen}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` } as CSSProperties}
                  // Ausserhalb des Anordnens ist die Karte ein Knopf (Details
                  // im Seitenpanel), beim Anordnen ein Ziehobjekt -- beides
                  // zugleich wuerde jedes Ziehen als Klick werten.
                  role={anordnen ? undefined : "button"}
                  tabIndex={anordnen ? undefined : 0}
                  onClick={anordnen ? undefined : () => onOeffnen(k.art, k.id)}
                  onKeyDown={
                    anordnen
                      ? undefined
                      : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOeffnen(k.art, k.id);
                          }
                        }
                  }
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

function Abschnitt({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="zv-detail-abschnitt">
      <h3>{titel}</h3>
      {children}
    </section>
  );
}

function ZimmerDetail({
  zimmer,
  etage,
  standort,
  onVerwalten,
}: {
  zimmer: Zimmer;
  etage: string;
  standort: string;
  onVerwalten: () => void;
}) {
  const belegt = zimmer.bewohner.length;
  return (
    <div>
      <h2 style={{ margin: 0 }}>Zimmer {zimmer.nummer}</h2>
      <p className="zv-sub" style={{ margin: "2px 0 var(--zv-space-4)" }}>
        {standort} · {etage}
      </p>

      <div className="zv-detail-kennzahlen">
        <div>
          <span className="zv-detail-label">Belegung</span>
          {belegungsPill(belegt, zimmer.kapazitaet)}
        </div>
        <div>
          <span className="zv-detail-label">Freie Plätze</span>
          <strong>{Math.max(0, zimmer.kapazitaet - belegt)}</strong>
        </div>
      </div>

      {zimmer.kapazitaetsantrag && (
        <div className="zv-hinweis zv-hinweis-info" style={{ marginTop: "var(--zv-space-3)" }}>
          Kapazitätsänderung von {zimmer.kapazitaetsantrag.alteKapazitaet} auf {zimmer.kapazitaetsantrag.neueKapazitaet}{" "}
          beantragt{zimmer.kapazitaetsantrag.beantragtVonName ? ` (${zimmer.kapazitaetsantrag.beantragtVonName})` : ""} –
          wartet auf Bestätigung.
        </div>
      )}

      <Abschnitt titel="Bewohner:innen">
        {belegt === 0 ? (
          <p className="zv-sub">Das Zimmer ist frei.</p>
        ) : (
          <ul className="zv-detail-liste">
            {zimmer.bewohner.map((b) => (
              <li key={b.klientId}>
                <strong>{b.name}</strong>
                <span className="zv-sub">
                  seit {formatDatum(b.einzug)}
                  {b.auszug && ` · Auszug geplant ${formatDatum(b.auszug)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Abschnitt>

      {zimmer.geplanteEinzuege.length > 0 && (
        <Abschnitt titel="Geplante Einzüge">
          <ul className="zv-detail-liste">
            {zimmer.geplanteEinzuege.map((g) => (
              <li key={g.klientId + g.einzug}>
                <strong>{g.name}</strong>
                <span className="zv-sub">ab {formatDatum(g.einzug)}</span>
              </li>
            ))}
          </ul>
        </Abschnitt>
      )}

      {zimmer.warteliste.length > 0 && (
        <Abschnitt titel="Warteliste">
          <ul className="zv-detail-liste">
            {zimmer.warteliste.map((w, i) => (
              <li key={w.name + i}>
                <strong>{w.name}</strong>
                <span className="zv-sub">eingetragen am {formatDatum(w.eingetragenAm)}</span>
              </li>
            ))}
          </ul>
        </Abschnitt>
      )}

      <Abschnitt titel="Offene Aufgaben">
        {zimmer.offeneAufgaben.length === 0 ? (
          <p className="zv-sub">Keine offenen Aufgaben für dieses Zimmer.</p>
        ) : (
          <ul className="zv-detail-liste">
            {zimmer.offeneAufgaben.map((a) => (
              <li key={a.id}>
                <strong>{a.titel}</strong>
                <span className="zv-sub">
                  <span className={`zv-pill ${PRIORITAET_PILL_KLASSE[a.prioritaet]}`}>
                    {AUFGABE_PRIORITAET_LABEL[a.prioritaet]}
                  </span>
                  {a.faelligAm && ` · fällig ${formatDatum(a.faelligAm)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Abschnitt>

      <button className="zv-btn zv-btn-sekundaer" onClick={onVerwalten} style={{ marginTop: "var(--zv-space-5)" }}>
        <IZimmer />
        Einzug, Auszug, Warteliste, Kapazität …
      </button>
    </div>
  );
}

function RaumDetail({
  raum,
  etage,
  standort,
  darfBearbeiten,
  onBearbeiten,
}: {
  raum: Gemeinschaftsraum;
  etage: string;
  standort: string;
  darfBearbeiten: boolean;
  onBearbeiten: () => void;
}) {
  return (
    <div>
      <h2 style={{ margin: 0 }}>{raum.name}</h2>
      <p className="zv-sub" style={{ margin: "2px 0 var(--zv-space-4)" }}>
        {standort} · {etage}
      </p>
      <span className="zv-pill zv-pill-info">Gemeinschaftsraum</span>
      <p className="zv-sub" style={{ marginTop: "var(--zv-space-3)" }}>
        Gemeinschaftsräume haben keine Bewohner:innen und zählen nicht als Wohnplatz.
      </p>
      {darfBearbeiten && (
        <button className="zv-btn zv-btn-sekundaer" onClick={onBearbeiten} style={{ marginTop: "var(--zv-space-3)" }}>
          <IBearbeiten />
          Bearbeiten
        </button>
      )}
    </div>
  );
}

function ZimmerNeuDialog({
  standortId,
  etagen,
  standardEtage,
  onClose,
  onAngelegt,
}: {
  standortId: string;
  etagen: string[];
  standardEtage: string;
  onClose: () => void;
  onAngelegt: () => void;
}) {
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerAnlegen({
        standortId,
        nummer: String(form.get("nummer") ?? "").trim(),
        etage: String(form.get("etage") ?? "").trim() || undefined,
        kapazitaet: Number(form.get("kapazitaet") ?? 1),
      });
      onAngelegt();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Zimmer konnte nicht angelegt werden.");
      setWirdGespeichert(false);
    }
  }

  return (
    <Modal titel="Neues Zimmer" onClose={onClose}>
      <form onSubmit={anlegen}>
        {formFehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {formFehler}
          </div>
        )}
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="neues-zimmer-nummer">Zimmernummer</label>
            <input id="neues-zimmer-nummer" name="nummer" placeholder="z. B. 101" required autoFocus />
          </div>
          <div className="zv-field">
            <label htmlFor="neues-zimmer-etage">Etage</label>
            <input id="neues-zimmer-etage" name="etage" list="neues-zimmer-etagen" defaultValue={standardEtage} />
            <datalist id="neues-zimmer-etagen">
              {etagen.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="zv-field">
          <label htmlFor="neues-zimmer-kapazitaet">Kapazität (Bewohner:innen)</label>
          <input id="neues-zimmer-kapazitaet" name="kapazitaet" type="number" min={1} max={12} defaultValue={1} />
        </div>
        <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
          <ISpeichern />
          {wirdGespeichert ? "Speichert…" : "Zimmer anlegen"}
        </button>
      </form>
    </Modal>
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
