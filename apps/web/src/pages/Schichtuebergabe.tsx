import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  DIENST_LABEL,
  Dienst,
  KlientListEintragDto,
  SchichtuebergabeDto,
  StandortDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { UebergabeAnzeige } from "../components/UebergabeAnzeige";
import { IFehler, INeu, ISpeichern, IUebergabe } from "../components/icons";

const ENTWURF_SCHLUESSEL = "zv-schichtuebergabe-entwurf";

interface EntwurfPunkt {
  text: string;
  bezug: string; // "" | "klient:<id>" | "zimmer:<id>"
}
interface Entwurf {
  standortId: string;
  dienst: Dienst;
  punkte: EntwurfPunkt[];
}

/**
 * Entwurf bis zum Senden nur im Browser dieses Geraets (localStorage), nie
 * auf dem Server: eine Uebergabe wird erst mit dem Senden zum Objekt in der
 * Datenbank (und danach unveraenderlich). Dass der Text die Eingabe ueber
 * einen Seitenwechsel oder Akkuausfall rettet, ist eine vom Nutzer gewollte
 * Funktion dieses Geraets (TTDSG §25 Abs. 2 Nr. 2) -- kein Tracking. Weil
 * der Freitext Gesundheitsdaten enthalten kann, wird der Entwurf beim Senden
 * und beim Abmelden geloescht (entwurfLoeschen, Shell.tsx/App.tsx).
 */
export function entwurfLoeschen() {
  try {
    localStorage.removeItem(ENTWURF_SCHLUESSEL);
  } catch {
    // egal
  }
}

function entwurfLesen(): Entwurf | null {
  try {
    const roh = JSON.parse(localStorage.getItem(ENTWURF_SCHLUESSEL) ?? "null") as Entwurf | null;
    if (!roh || !Array.isArray(roh.punkte)) return null;
    return roh;
  } catch {
    return null;
  }
}

/** Vorschlag fuer den Dienst, der gerade uebergibt -- aenderbar. */
function dienstNachUhrzeit(): Dienst {
  const h = new Date().getHours();
  if (h >= 5 && h < 13) return "frueh";
  if (h >= 13 && h < 21) return "spaet";
  return "nacht";
}

export function Schichtuebergabe() {
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [zimmer, setZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [liste, setListe] = useState<SchichtuebergabeDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [keineBerechtigung, setKeineBerechtigung] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [sendet, setSendet] = useState(false);

  const gespeichert = useMemo(entwurfLesen, []);
  const [standortId, setStandortId] = useState(gespeichert?.standortId ?? "");
  const [dienst, setDienst] = useState<Dienst>(gespeichert?.dienst ?? dienstNachUhrzeit());
  const [punkte, setPunkte] = useState<EntwurfPunkt[]>(gespeichert?.punkte ?? []);
  const [eingabe, setEingabe] = useState("");
  const [bezug, setBezug] = useState("");

  useEffect(() => {
    const an = () => setOnline(true);
    const aus = () => setOnline(false);
    window.addEventListener("online", an);
    window.addEventListener("offline", aus);
    return () => {
      window.removeEventListener("online", an);
      window.removeEventListener("offline", aus);
    };
  }, []);

  const laden = useCallback(() => {
    api
      .schichtuebergabenListe()
      .then((l) => {
        setListe(l);
        setFehler(null);
      })
      .catch((err: Error) => {
        if (/Berechtigung/.test(err.message)) setKeineBerechtigung(true);
        else setFehler(err.message);
      });
  }, []);

  useEffect(() => {
    laden();
    api.standorteListe().then((s) => {
      const aktive = s.filter((x) => x.aktiv);
      setStandorte(aktive);
      setStandortId((alt) => (alt && aktive.some((x) => x.id === alt) ? alt : (aktive[0]?.id ?? "")));
    }).catch(() => {});
    api.klientenListe().then(setKlienten).catch(() => {});
    api.zimmerListe().then(setZimmer).catch(() => {});
  }, [laden]);

  // Autosave: jede Aenderung am Entwurf, ohne Entprellen -- die Eintraege sind klein.
  useEffect(() => {
    try {
      if (punkte.length === 0) localStorage.removeItem(ENTWURF_SCHLUESSEL);
      else localStorage.setItem(ENTWURF_SCHLUESSEL, JSON.stringify({ standortId, dienst, punkte } satisfies Entwurf));
    } catch {
      // Ohne localStorage geht der Entwurf bei einem Neuladen verloren -- mehr nicht.
    }
  }, [standortId, dienst, punkte]);

  const standortName = standorte.find((s) => s.id === standortId)?.name;
  const klientenHier = klienten.filter((k) => k.aktuellesZimmer && k.aktuellesZimmer.standortName === standortName);
  const zimmerHier = zimmer.filter((z) => z.standortId === standortId);

  function bezugsText(b: string): string | null {
    if (b.startsWith("klient:")) {
      const k = klienten.find((x) => x.id === b.slice(7));
      return k ? `${k.vorname} ${k.nachname}` : null;
    }
    if (b.startsWith("zimmer:")) {
      const z = zimmer.find((x) => x.id === b.slice(7));
      return z ? `Zimmer ${z.nummer}` : null;
    }
    return null;
  }

  // Enter fuegt den Punkt hinzu und lässt den Cursor im Feld -- die schnelle
  // Eingabe am Ende der Schicht, auch mit einer Hand am Handy.
  function punktHinzufuegen(e: FormEvent) {
    e.preventDefault();
    const text = eingabe.trim();
    if (!text) return;
    setPunkte((alt) => [...alt, { text, bezug }]);
    setEingabe("");
    setBezug("");
  }

  async function senden() {
    if (punkte.length === 0 || !standortId) return;
    setSendet(true);
    setFehler(null);
    try {
      await api.schichtuebergabeAnlegen({
        standortId,
        dienst,
        punkte: punkte.map((p) => ({
          text: p.text,
          klientId: p.bezug.startsWith("klient:") ? p.bezug.slice(7) : undefined,
          zimmerId: p.bezug.startsWith("zimmer:") ? p.bezug.slice(7) : undefined,
        })),
      });
      entwurfLoeschen();
      setPunkte([]);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Die Übergabe konnte nicht gesendet werden.");
    } finally {
      setSendet(false);
    }
  }

  if (keineBerechtigung) {
    return (
      <div>
        <div className="zv-seiten-kopf">
          <h2>Schichtübergabe</h2>
        </div>
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          Für Schichtübergaben fehlt die Berechtigung.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="zv-seiten-kopf">
        <div>
          <h2>Schichtübergabe</h2>
          <p className="zv-sub" style={{ margin: "2px 0 0" }}>
            Was die nächste Schicht wissen muss. Nach dem Senden unveränderlich, Ergänzungen als Nachtrag.
          </p>
        </div>
      </div>

      {!online && (
        <div className="zv-hinweis" role="status">
          Offline – der Entwurf bleibt auf diesem Gerät, gesendet werden kann erst mit Verbindung.
        </div>
      )}
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
          <button type="button" className="zv-link-btn" onClick={laden}>
            Erneut laden
          </button>
        </div>
      )}

      <section className="zv-card zv-card-weit" aria-labelledby="uebergabe-neu" style={{ marginBottom: 20 }}>
        <h3 id="uebergabe-neu" style={{ fontSize: 15, margin: "0 0 12px" }}>
          Neue Übergabe
        </h3>
        <div className="zv-uebergabe-kopfzeile">
          <label>
            Standort
            <select value={standortId} onChange={(e) => setStandortId(e.target.value)}>
              {standorte.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dienst
            <select value={dienst} onChange={(e) => setDienst(e.target.value as Dienst)}>
              {(Object.keys(DIENST_LABEL) as Dienst[]).map((d) => (
                <option key={d} value={d}>
                  {DIENST_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {punkte.length > 0 && (
          <ol className="zv-uebergabe-entwurf" aria-label="Punkte im Entwurf">
            {punkte.map((p, i) => (
              <li key={i}>
                <span>
                  {p.text}
                  {bezugsText(p.bezug) && <span className="zv-uebergabe-bezug"> · {bezugsText(p.bezug)}</span>}
                </span>
                <button
                  type="button"
                  className="zv-link-btn"
                  aria-label={`Punkt ${i + 1} entfernen`}
                  onClick={() => setPunkte((alt) => alt.filter((_, j) => j !== i))}
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ol>
        )}

        <form onSubmit={punktHinzufuegen} className="zv-uebergabe-eingabe">
          <label htmlFor="uebergabe-punkt" className="zv-sub-inline" style={{ margin: 0 }}>
            Punkt (Enter fügt hinzu)
          </label>
          <div className="zv-uebergabe-nachtrag-zeile">
            <input
              id="uebergabe-punkt"
              value={eingabe}
              maxLength={1000}
              onChange={(e) => setEingabe(e.target.value)}
              placeholder="z. B. Frau M. hat das Abendessen ausgelassen"
              autoComplete="off"
              enterKeyHint="done"
            />
            <select aria-label="Bezug (optional)" value={bezug} onChange={(e) => setBezug(e.target.value)}>
              <option value="">Ohne Bezug</option>
              <optgroup label="Klient:innen">
                {klientenHier.map((k) => (
                  <option key={k.id} value={`klient:${k.id}`}>
                    {k.vorname} {k.nachname}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Zimmer">
                {zimmerHier.map((z) => (
                  <option key={z.id} value={`zimmer:${z.id}`}>
                    Zimmer {z.nummer}
                  </option>
                ))}
              </optgroup>
            </select>
            <button type="submit" className="zv-btn zv-btn-sekundaer" disabled={eingabe.trim() === ""}>
              <INeu />
              Hinzufügen
            </button>
          </div>
        </form>

        <div className="zv-uebergabe-senden">
          <button type="button" className="zv-btn" disabled={punkte.length === 0 || !standortId || sendet || !online} onClick={() => void senden()}>
            <ISpeichern />
            {sendet ? "Sendet…" : `Übergabe senden (${punkte.length})`}
          </button>
          {punkte.length > 0 && <span className="zv-sub-inline">Entwurf wird auf diesem Gerät gesichert.</span>}
        </div>
      </section>

      <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>Verlauf</h3>
      {liste === null && !fehler && <p role="status">Lädt…</p>}
      {liste !== null && liste.length === 0 && <Leerzustand icon={IUebergabe}>Noch keine Übergabe gesendet.</Leerzustand>}
      {liste?.map((u) => (
        <UebergabeAnzeige key={u.id} uebergabe={u} onAktualisieren={laden} nachtragFeld />
      ))}
    </div>
  );
}
