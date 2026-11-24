import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  alleBausteine,
  BAUSTEIN_LABEL,
  ZUORDNUNG_ERKLAERUNG,
  ZUORDNUNG_LABEL,
  zuordnungKenntKlient,
  zuordnungVon,
  type FormularZuordnung,
  pruefeVeroeffentlichung,
  type Baustein,
  type BausteinTyp,
  type FormularDefinition,
} from "@zimmerakte/shared";
import { INeu } from "./icons";
import {
  KASTEN,
  type Ziel,
  einsetzen,
  finde,
  holen,
  mitKindern,
  neuerBaustein,
  scrollbarerVorfahr,
  verweiseUmbenennen,
  zielBei,
} from "./formular-editor/baum";
import { BaumKnoten } from "./formular-editor/BaumKnoten";
import { Ausprobieren } from "./formular-editor/Ausprobieren";
import { Eigenschaften } from "./formular-editor/Eigenschaften";

/**
 * Formular-Editor (Konzept Formulare, Abschnitt 5): links der Bausteinkasten,
 * in der Mitte der Aufbau (oder "Ausprobieren" wie beim Ausfuellen), rechts
 * die Eigenschaften des gewaehlten Bausteins.
 *
 * Gesteuert von aussen (definition/onAendern): die Seite speichert den
 * Entwurf automatisch und muss vor dem Veroeffentlichen sicher sein, dass der
 * letzte Stand auf dem Server liegt -- das geht nur, wenn sie ihn haelt.
 *
 * Logik wird nur aus Saetzen und einer festen Funktionsliste gebaut, nie als
 * freier Ausdruck: wer ein Formular baut, ist keine Programmierer:in, und der
 * Auswerter in packages/shared kennt ohnehin nur diese Formen.
 */

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function FormularEditor({
  definition,
  frueher,
  onAendern,
  status,
}: {
  definition: FormularDefinition;
  /** Frueher veroeffentlichte Fassungen: ihre Schluessel und Optionen sind gesperrt. */
  frueher: FormularDefinition[];
  onAendern: (neu: FormularDefinition) => void;
  /** Speicherstand fuer die Kopfzeile ("Gespeichert 14:02"). */
  status: ReactNode;
}) {
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  // Kennung der AUSWAHL, nicht des Schluessels: das Eigenschaften-Panel darf
  // nur neu aufgebaut werden, wenn jemand einen anderen Baustein waehlt. Am
  // Schluessel festgemacht (frueher key={auswahl.schluessel}) baute es sich
  // bei jedem Buchstaben neu auf, weil der Schluessel der Beschriftung folgt --
  // das Feld verlor nach einem Buchstaben den Fokus (Rueckmeldungen „Formular
  // Schlüssel“ und „beschriftung Skala fehlerhaft“, 21.11.2026).
  const [auswahlNr, setAuswahlNr] = useState(0);
  function waehlen(schluessel: string | null) {
    setGewaehlt(schluessel);
    setAuswahlNr((n) => n + 1);
  }
  const [ansicht, setAnsicht] = useState<"aufbau" | "ausprobieren">("aufbau");

  const gesperrt = useMemo(() => {
    const m = new Map<string, Baustein>();
    for (const d of frueher) for (const b of alleBausteine(d)) m.set(b.schluessel, b);
    return m;
  }, [frueher]);
  const hinweise = useMemo(() => pruefeVeroeffentlichung(definition, frueher), [definition, frueher]);
  const pfad = gewaehlt ? finde(definition.bausteine, gewaehlt) : null;
  const auswahl = pfad ? holen(definition.bausteine, pfad) : null;

  function hinzufuegen(typ: BausteinTyp) {
    const b = neuerBaustein(typ, new Set(alleBausteine(definition).map((x) => x.schluessel)));
    let bausteine: Baustein[];
    if (!pfad) {
      bausteine = [...definition.bausteine, b];
    } else if (auswahl?.typ === "abschnitt" && typ !== "abschnitt") {
      // In den gewaehlten Abschnitt hinein -- so baut man einen Abschnitt am schnellsten auf.
      bausteine = mitKindern(definition.bausteine, pfad, (k) => [...k, b]);
    } else {
      // Abschnitte liegen immer oben: nach dem aeussersten Elternteil einfuegen.
      const ziel = typ === "abschnitt" ? pfad.slice(0, 1) : pfad;
      const eltern = ziel.slice(0, -1);
      const i = ziel[ziel.length - 1];
      bausteine = mitKindern(definition.bausteine, eltern, (k) => [...k.slice(0, i + 1), b, ...k.slice(i + 1)]);
    }
    onAendern({ ...definition, bausteine });
    waehlen(b.schluessel);
    setAnsicht("aufbau");
  }

  function aendern(neu: Baustein) {
    if (!pfad || !auswahl) return;
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    let def: FormularDefinition = { ...definition, bausteine: mitKindern(definition.bausteine, eltern, (k) => k.map((b, j) => (j === i ? neu : b))) };
    if (neu.schluessel !== auswahl.schluessel) {
      def = verweiseUmbenennen(def, auswahl.schluessel, neu.schluessel);
      setGewaehlt(neu.schluessel);
    }
    onAendern(def);
  }

  function entfernen() {
    if (!pfad || !auswahl) return;
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    const def = { ...definition, bausteine: mitKindern(definition.bausteine, eltern, (k) => k.filter((_, j) => j !== i)) };
    if (def.bezugsdatumFeld === auswahl.schluessel) delete def.bezugsdatumFeld;
    onAendern(def);
    waehlen(null);
  }

  function verschieben(richtung: -1 | 1, schluessel = gewaehlt) {
    const pfad = schluessel ? finde(definition.bausteine, schluessel) : null;
    if (!pfad) return;
    const auswahl = holen(definition.bausteine, pfad);
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    const geschwister = eltern.length ? (holen(definition.bausteine, eltern) as Extract<Baustein, { typ: "abschnitt" }>).kinder : definition.bausteine;
    const j = i + richtung;
    if (j < 0 || j >= geschwister.length) {
      // Am Rand eines Abschnitts: hinaus, vor bzw. hinter den Abschnitt.
      if (!eltern.length) return;
      const ohne = mitKindern(definition.bausteine, eltern, (k) => k.filter((_, x) => x !== i));
      const ep = eltern[eltern.length - 1] + (richtung === 1 ? 1 : 0);
      onAendern({ ...definition, bausteine: mitKindern(ohne, eltern.slice(0, -1), (k) => [...k.slice(0, ep), auswahl, ...k.slice(ep)]) });
      return;
    }
    onAendern({
      ...definition,
      bausteine: mitKindern(definition.bausteine, eltern, (k) => {
        const c = [...k];
        [c[i], c[j]] = [c[j], c[i]];
        return c;
      }),
    });
  }

  // Die Definition kann sich waehrend eines Zugs aendern (Speichern im
  // Hintergrund liefert eine neue Fassung) -- losgelassen wird auf die neueste.
  const definitionRef = useRef(definition);
  definitionRef.current = definition;
  const baumRef = useRef<HTMLUListElement>(null);
  const [zug, setZug] = useState<{ schluessel: string; ziel: Ziel | null } | null>(null);

  function griffRunter(e: ReactPointerEvent<HTMLButtonElement>, b: Baustein) {
    if (e.button !== 0) return;
    // Sonst markiert die Maus Text bzw. der Finger scrollt die Seite.
    e.preventDefault();
    const griff = e.currentTarget;
    griff.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let y = startY;
    let aktiv = false;
    let ziel: Ziel | null = null;
    let bild = 0;
    const scroller = scrollbarerVorfahr(griff);

    const messen = () => {
      ziel = baumRef.current ? zielBei(baumRef.current, y, b.typ === "abschnitt") : null;
      // Ein Ziel, das nichts aendert, wird gar nicht erst angezeigt.
      if (ziel && !einsetzen(definitionRef.current.bausteine, b.schluessel, ziel)) ziel = null;
      setZug({ schluessel: b.schluessel, ziel });
    };
    // Am Rand des sichtbaren Bereichs weiterscrollen, auch wenn der Zeiger
    // stillsteht -- sonst kaeme man in langen Formularen nicht ans Ende.
    const rand = () => {
      const r = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const zone = 48;
      const schritt = y < r.top + zone ? -10 : y > r.bottom - zone ? 10 : 0;
      if (schritt) {
        scroller.scrollBy(0, schritt);
        messen();
      }
      bild = requestAnimationFrame(rand);
    };
    const bewegen = (ev: PointerEvent) => {
      y = ev.clientY;
      if (!aktiv) {
        if (Math.abs(y - startY) < 4) return;
        aktiv = true;
        bild = requestAnimationFrame(rand);
      }
      messen();
    };
    const aufhoeren = (uebernehmen: boolean) => {
      cancelAnimationFrame(bild);
      griff.removeEventListener("pointermove", bewegen);
      griff.removeEventListener("pointerup", los);
      griff.removeEventListener("pointercancel", abbruch);
      window.removeEventListener("keydown", taste);
      setZug(null);
      if (!uebernehmen || !aktiv || !ziel) return;
      const def = definitionRef.current;
      const neu = einsetzen(def.bausteine, b.schluessel, ziel);
      if (neu) onAendern({ ...def, bausteine: neu });
    };
    const los = () => aufhoeren(true);
    const abbruch = () => aufhoeren(false);
    const taste = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") aufhoeren(false);
    };
    griff.addEventListener("pointermove", bewegen);
    griff.addEventListener("pointerup", los);
    griff.addEventListener("pointercancel", abbruch);
    window.addEventListener("keydown", taste);
  }

  /** Tastatur-Alternative am selben Griff: Pfeil hoch/runter. */
  function griffTaste(e: ReactKeyboardEvent<HTMLButtonElement>, schluessel: string) {
    const richtung = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!richtung) return;
    e.preventDefault();
    verschieben(richtung, schluessel);
    // Beim Wechsel in/aus einem Abschnitt wird die Zeile neu aufgebaut und
    // der Fokus ginge verloren.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-fe-griff="${CSS.escape(schluessel)}"]`)?.focus());
  }

  function verlegen(abschnitt: string | "") {
    if (!pfad || !auswahl) return;
    const eltern = pfad.slice(0, -1);
    const i = pfad[pfad.length - 1];
    const ohne = mitKindern(definition.bausteine, eltern, (k) => k.filter((_, x) => x !== i));
    const ziel = abschnitt ? finde(ohne, abschnitt) : null;
    onAendern({ ...definition, bausteine: ziel ? mitKindern(ohne, ziel, (k) => [...k, auswahl]) : [...ohne, auswahl] });
  }

  const abschnitte = definition.bausteine.filter((b) => b.typ === "abschnitt");

  return (
    <div className="zv-fe">
      <aside className="zv-fe-kasten" aria-label="Bausteinkasten">
        {KASTEN.map((g) => (
          <div key={g.titel} className="zv-fe-kasten-gruppe">
            <div className="zv-gruppenlabel">{g.titel}</div>
            {g.typen.map((t) => (
              <button key={t} type="button" className="zv-fe-kasten-knopf" onClick={() => hinzufuegen(t)}>
                <INeu size={14} />
                {BAUSTEIN_LABEL[t]}
              </button>
            ))}
          </div>
        ))}
        <p className="zv-fe-kasten-tipp">
          Neue Bausteine landen hinter dem gewählten Baustein, bei einem gewählten Abschnitt darin.
        </p>
      </aside>

      <section className="zv-fe-mitte" aria-label="Formular">
        <div className="zv-fe-mitte-kopf">
          <div className="zv-segmented" role="tablist" aria-label="Ansicht">
            <button type="button" role="tab" aria-selected={ansicht === "aufbau"} className={ansicht === "aufbau" ? "active" : ""} onClick={() => setAnsicht("aufbau")}>
              Aufbau
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ansicht === "ausprobieren"}
              className={ansicht === "ausprobieren" ? "active" : ""}
              onClick={() => setAnsicht("ausprobieren")}
            >
              Ausprobieren
            </button>
          </div>
          <span className="zv-fe-status" aria-live="polite">
            {status}
          </span>
        </div>
        {ansicht === "aufbau" ? (
          definition.bausteine.length === 0 ? (
            <div className="zv-fe-leer">Noch leer. Wählen Sie links einen Baustein, z. B. einen Abschnitt oder eine Frage.</div>
          ) : (
            <ul ref={baumRef} className={`zv-fe-baum${zug ? " zv-fe-baum-zug" : ""}`}>
              {definition.bausteine.map((b) => (
                <BaumKnoten
                  key={b.schluessel}
                  b={b}
                  definition={definition}
                  gewaehlt={gewaehlt}
                  zug={zug}
                  onWaehlen={(s) => s !== gewaehlt && waehlen(s)}
                  onGriff={griffRunter}
                  onGriffTaste={griffTaste}
                />
              ))}
            </ul>
          )
        ) : (
          <Ausprobieren definition={definition} />
        )}
        {hinweise.length > 0 && (
          <div className="zv-fe-hinweise" role="status">
            <strong>Vor dem Veröffentlichen noch zu klären</strong>
            <ul>
              {hinweise.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <aside className="zv-fe-eigenschaften" aria-label="Eigenschaften">
        {auswahl && pfad ? (
          <Eigenschaften
            key={auswahlNr}
            b={auswahl}
            definition={definition}
            gesperrt={gesperrt.get(auswahl.schluessel) ?? null}
            abschnitte={abschnitte}
            inAbschnitt={pfad.length > 1 ? (holen(definition.bausteine, pfad.slice(0, 1)).schluessel) : ""}
            onAendern={aendern}
            onDefinition={onAendern}
            onEntfernen={entfernen}
            onVerschieben={verschieben}
            onVerlegen={verlegen}
          />
        ) : (
          <>
            <ZuordnungWahl definition={definition} gesperrt={frueher.length > 0} onAendern={onAendern} />
            <p className="zv-sub">Wählen Sie in der Mitte einen Baustein, um ihn zu bearbeiten.</p>
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * Wozu ein ausgefuelltes Formular gehoert (Konzept dokumentation-formulare,
 * Bild 3A). Steht hier im Aufbau statt in den Einstellungen, weil es Teil der
 * VERSION ist: es aendert, was beim Ausfuellen gefragt wird, und gilt erst ab
 * der naechsten Veroeffentlichung -- bereits ausgefuellte Dokumente behalten ihre.
 */
function ZuordnungWahl({
  definition,
  gesperrt,
  onAendern,
}: {
  definition: FormularDefinition;
  gesperrt: boolean;
  onAendern: (neu: FormularDefinition) => void;
}) {
  const aktuell = zuordnungVon(definition);
  return (
    <fieldset className="zv-fe-zuordnung">
      <legend>Zuordnung</legend>
      <p className="zv-sub">Wozu gehört ein ausgefülltes Dokument?</p>
      {(Object.keys(ZUORDNUNG_LABEL) as FormularZuordnung[]).map((z) => (
        <label key={z} className="zv-checkbox-zeile zv-fe-zuordnung-wahl">
          <input
            type="radio"
            name="zv-fe-zuordnung"
            checked={aktuell === z}
            onChange={() => {
              const neu = { ...definition };
              if (z === "klient") delete neu.zuordnung;
              else neu.zuordnung = z;
              onAendern(neu);
            }}
          />
          <span>
            <strong>{ZUORDNUNG_LABEL[z]}</strong>
            <span className="zv-sub">{ZUORDNUNG_ERKLAERUNG[z]}</span>
          </span>
        </label>
      ))}
      {gesperrt && <p className="zv-protokoll-hilfe">Gilt ab der nächsten veröffentlichten Version. Bereits ausgefüllte Dokumente behalten ihre Zuordnung.</p>}
      {!zuordnungKenntKlient(aktuell) && (
        <p className="zv-protokoll-hilfe">Ohne Klient:in gibt es keine Klienten- und Belegungsdaten zum Anzeigen oder Vorausfüllen.</p>
      )}
    </fieldset>
  );
}
