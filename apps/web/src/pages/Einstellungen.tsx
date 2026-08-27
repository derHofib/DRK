import { useEffect, useRef, useState } from "react";
import {
  AKZENTFARBE_MUSTER,
  PASTELL_PALETTEN,
  type MandantDto,
} from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { useTheme } from "../theme/ThemeProvider";
import { ThemeAuswahl } from "../components/ThemeToggle";
import { Sicherheit } from "./Sicherheit";
import { Standorte } from "./Standorte";
import {
  IBestaetigen,
  IDarstellung,
  IErfolg,
  IFehler,
  ISicherheit,
  ISpeichern,
  IStandort,
  IZuruecksetzen,
} from "../components/icons";

type Bereich = "darstellung" | "standorte" | "sicherheit";

export function Einstellungen({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto | null;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  const [bereich, setBereich] = useState<Bereich>("darstellung");

  return (
    <div>
      <div className="zv-tabbar" style={{ padding: 0, marginBottom: 24 }}>
        <button
          className={bereich === "darstellung" ? "active" : ""}
          onClick={() => setBereich("darstellung")}
        >
          <IDarstellung />
          Darstellung
        </button>
        <button
          className={bereich === "standorte" ? "active" : ""}
          onClick={() => setBereich("standorte")}
        >
          <IStandort />
          Standorte
        </button>
        <button
          className={bereich === "sicherheit" ? "active" : ""}
          onClick={() => setBereich("sicherheit")}
        >
          <ISicherheit />
          Sicherheit
        </button>
      </div>

      {bereich === "darstellung" && (
        <Darstellung mandant={mandant} onMandantAktualisiert={onMandantAktualisiert} />
      )}
      {bereich === "standorte" && <Standorte />}
      {bereich === "sicherheit" && <Sicherheit />}
    </div>
  );
}

function Darstellung({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto | null;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  // Nur ein Anzeige-Hinweis -- der Server entscheidet (siehe tokenRolle()).
  const darfBranding = tokenRolle() === "bereichsleitung";

  return (
    <div className="zv-card zv-card-weit">
      <section className="zv-einstellungen-abschnitt">
        <h3>
          <IDarstellung />
          Design
        </h3>
        <p className="zv-sub">
          Gilt nur für dich, auf diesem Gerät. Wird nicht auf dem Server gespeichert.
        </p>
        <ThemeAuswahl />
      </section>

      {darfBranding && mandant && (
        <Traegerfarbe mandant={mandant} onMandantAktualisiert={onMandantAktualisiert} />
      )}
    </div>
  );
}

function Traegerfarbe({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  const { akzentVorschau, akzentUebernehmen } = useTheme();
  const [gewaehlt, setGewaehlt] = useState(mandant.akzentfarbe);
  const [hexFeld, setHexFeld] = useState(mandant.akzentfarbe);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  // Zaehlt jeden angestossenen Speichern()-Aufruf durch. "disabled" auf dem
  // Knopf verhindert nur einen zweiten KLICK, nicht eine zweite Anfrage --
  // React setzt das disabled-Attribut erst beim naechsten Rendern, und
  // zwei Antworten vom Server muessen nicht in Sendereihenfolge zurueckkommen.
  // Ohne diesen Zaehler koennte eine spaete Antwort auf eine AELTERE Anfrage
  // eine bereits abgeschlossene NEUERE ueberschreiben. Nur die Antwort auf
  // die zuletzt gestellte Anfrage wird uebernommen.
  const laufendeAnfrage = useRef(0);

  // Wenn der Mandant nachgeladen wird, die Auswahl nachziehen.
  useEffect(() => {
    setGewaehlt(mandant.akzentfarbe);
    setHexFeld(mandant.akzentfarbe);
  }, [mandant.akzentfarbe]);

  const geaendert = gewaehlt.toLowerCase() !== mandant.akzentfarbe.toLowerCase();

  function waehle(hex: string) {
    setGewaehlt(hex);
    setHexFeld(hex);
    setFehler(null);
    setErfolg(null);
    // Live: faerbt die GANZE Anwendung sofort um, nicht nur die Kachel --
    // die ueberzeugendste Vorschau, die es gibt. Ohne den Kaltstart-Cache
    // zu verstellen, solange nicht gespeichert wurde.
    akzentVorschau(hex);
  }

  function hexGeaendert(wert: string) {
    setHexFeld(wert);
    if (AKZENTFARBE_MUSTER.test(wert)) waehle(wert);
  }

  async function speichern() {
    if (speichert) return;
    const angefordert = ++laufendeAnfrage.current;
    const ziel = gewaehlt;
    setSpeichert(true);
    setFehler(null);
    setErfolg(null);
    try {
      const aktualisiert = await api.mandantAkzentfarbeSetzen(ziel);
      if (laufendeAnfrage.current !== angefordert) return; // ueberholt -- eine neuere Anfrage zaehlt
      onMandantAktualisiert(aktualisiert);
      akzentUebernehmen(aktualisiert.akzentfarbe);
      setErfolg("Farbe gespeichert. Sie gilt ab sofort für alle Mitarbeitenden.");
    } catch (err) {
      if (laufendeAnfrage.current !== angefordert) return;
      // Faengt insbesondere ein 403 ab, falls die Rolle im Token nicht der
      // Wahrheit auf dem Server entspricht.
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      akzentVorschau(mandant.akzentfarbe);
      setGewaehlt(mandant.akzentfarbe);
      setHexFeld(mandant.akzentfarbe);
    } finally {
      if (laufendeAnfrage.current === angefordert) setSpeichert(false);
    }
  }

  function zuruecksetzen() {
    waehle(mandant.akzentfarbe);
    setErfolg(null);
    setFehler(null);
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Erscheinungsbild des Trägers</h3>
      <p className="zv-sub">
        Gilt für alle Mitarbeitenden von {mandant.name}. Nur die Leitung kann das ändern.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}

      <div className="zv-field">
        <label id="farbwelt-label">Farbwelt</label>
        <div className="zv-swatch-grid" role="group" aria-labelledby="farbwelt-label">
          {PASTELL_PALETTEN.map((p) => (
            <button
              key={p.id}
              type="button"
              className="zv-swatch"
              style={{ background: p.hex }}
              aria-pressed={gewaehlt.toLowerCase() === p.hex.toLowerCase()}
              aria-label={p.name}
              title={p.name}
              onClick={() => waehle(p.hex)}
            >
              {gewaehlt.toLowerCase() === p.hex.toLowerCase() && <IBestaetigen />}
            </button>
          ))}
        </div>
      </div>

      <div className="zv-field">
        <label htmlFor="eigene-farbe">Eigene Farbe</label>
        <div className="zv-farbwahl-frei">
          <input
            id="eigene-farbe"
            type="color"
            value={AKZENTFARBE_MUSTER.test(hexFeld) ? hexFeld : gewaehlt}
            onChange={(e) => waehle(e.target.value)}
          />
          <input
            type="text"
            value={hexFeld}
            onChange={(e) => hexGeaendert(e.target.value)}
            aria-label="Farbwert als Hex"
            spellCheck={false}
            maxLength={7}
          />
          {!AKZENTFARBE_MUSTER.test(hexFeld) && (
            <span className="zv-sub-inline">Bitte im Format #e3000f.</span>
          )}
        </div>
      </div>

      <Vorschau />

      <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
        <button className="zv-btn" onClick={speichern} disabled={!geaendert || speichert}>
          <ISpeichern />
          {speichert ? "Speichert…" : "Speichern"}
        </button>
        <button className="zv-btn zv-btn-still" onClick={zuruecksetzen} disabled={!geaendert}>
          <IZuruecksetzen />
          Zurücksetzen
        </button>
      </div>
    </section>
  );
}

/**
 * Zeigt dieselben Bedienelemente einmal hell und einmal dunkel. Moeglich
 * ohne jede Sonderlogik, weil data-vorschau in app.css color-scheme lokal
 * setzt -- dadurch loesen sich alle light-dark()-Tokens in diesem Teilbaum
 * neu auf. Die Leitung sieht so beide Themes, ohne selbst umzuschalten.
 */
function Vorschau() {
  return (
    <div className="zv-field">
      <label>Vorschau</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {(["hell", "dunkel"] as const).map((variante) => (
          <div key={variante} className="zv-vorschau" data-vorschau={variante}>
            <strong style={{ fontSize: "var(--zv-text-s)", color: "var(--zv-text-muted)" }}>
              {variante === "hell" ? "Hell" : "Dunkel"}
            </strong>
            <div className="zv-vorschau-zeile">
              <button className="zv-btn zv-btn-klein" type="button" tabIndex={-1}>
                Aktion
              </button>
              <button className="zv-btn zv-btn-sekundaer zv-btn-klein" type="button" tabIndex={-1}>
                Zweitrangig
              </button>
            </div>
            <div className="zv-vorschau-zeile">
              <span className="zv-pill">Zugeordnet</span>
              <span className="zv-pill zv-pill-vergeben">Vergeben</span>
            </div>
            <span style={{ color: "var(--zv-accent)", fontSize: "var(--zv-text-s)", fontWeight: 600 }}>
              Beispiel-Verweis
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
