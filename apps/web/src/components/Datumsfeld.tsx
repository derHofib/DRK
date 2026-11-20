import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { formatDatum, heuteBerlin } from "../format";
import {
  MONATSNAMEN,
  MONATSNAMEN_KURZ,
  WOCHENTAGE_KURZ,
  WOCHENTAGE_LANG,
  grenzFehler,
  istIsoTag,
  leseDatum,
  monatTitel,
  monatVon,
  monatsblatt,
  plusMonatAufMonat,
  plusMonate,
  plusTage,
  type SchnellwahlArt,
  schnellwahlTage,
  tagLang,
  teile,
  wochentag,
  zeitraumInWorten,
} from "./datumsfeld-logik";
import { IAufklappen, IKalender, IVor, IZurueckPfeil } from "./icons";
import { useSchwebendSchliessen } from "./schwebend";

/*
 * Eigenes Datumsfeld im Zimmerakte-Design (Konzept Datumsfeld, Rueckmeldung
 * "Datum auswahl": das Kalender-Popup des Browsers sah in jedem Browser
 * anders aus, aber nie wie die App, und type="month" gibt es in Firefox und
 * Safari am Desktop gar nicht).
 *
 * Bewusst ohne Bibliothek: react-day-picker braeuchte date-fns und muesste
 * ohnehin komplett auf Tokens umgestylt werden; Tippfeld, Monatswahl und
 * FormData-Anbindung waeren trotzdem Eigenbau.
 *
 * Werte gehen immer als ISO-String (JJJJ-MM-TT / JJJJ-MM) hinein und hinaus.
 * Mit `name` rendert jedes Feld zusaetzlich ein verstecktes <input>, damit
 * die vorhandenen FormData-Formulare unveraendert weiterlaufen.
 */

/* ------------------------------------------------------------------ */
/* Touch-Weiche                                                         */
/* ------------------------------------------------------------------ */

const GROBER_ZEIGER = "(pointer: coarse)";

/**
 * Auf Touchgeraeten bleibt das native Feld (iOS/Android bringen eine grosse,
 * bekannte Auswahl mit; TT.MM.JJJJ auf der Handytastatur ist muehsam).
 * Bewusst ueber den Zeiger, NICHT ueber die Breite: ein schmales
 * Desktopfenster bekommt trotzdem den eigenen Kalender.
 */
export function useGrobZeiger(): boolean {
  const [grob, setGrob] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(GROBER_ZEIGER).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(GROBER_ZEIGER);
    if (!mq) return;
    const f = () => setGrob(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return grob;
}

/** form.reset() setzt nur DOM-Felder zurueck, nicht unseren Zustand -- deshalb mithoeren. */
function useFormZuruecksetzen(feld: RefObject<HTMLInputElement>, zuruecksetzen: () => void) {
  const r = useRef(zuruecksetzen);
  r.current = zuruecksetzen;
  useEffect(() => {
    const form = feld.current?.form;
    if (!form) return;
    const h = () => r.current();
    form.addEventListener("reset", h);
    return () => form.removeEventListener("reset", h);
  });
}

function klemme(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/* ------------------------------------------------------------------ */
/* Kalender (Raster)                                                     */
/* ------------------------------------------------------------------ */

export interface KalenderProps {
  /** Einzeltag */
  wert?: string;
  /** Zeitraum: welcher Wert wird mit dem naechsten Klick gesetzt? */
  bereich?: { von: string; bis: string; phase: "von" | "bis" };
  min?: string;
  max?: string;
  monate?: 1 | 2;
  onWaehlen: (iso: string) => void;
  autoFokus?: boolean;
  /** Getippter Wert, der sichtbar werden soll (Kalender folgt dem Tippfeld). */
  zeige?: string;
  fuss?: ReactNode;
}

export function Kalender({ wert, bereich, min, max, monate = 1, onWaehlen, autoFokus, zeige, fuss }: KalenderProps) {
  const heute = heuteBerlin();
  const [fokus, setFokus] = useState(() => {
    const f = bereich ? (bereich.phase === "bis" ? bereich.bis || bereich.von : bereich.von || bereich.bis) : wert;
    return klemme(f && istIsoTag(f) ? f : heute, min, max);
  });
  const [anzeige, setAnzeige] = useState(() => {
    // Liegt ein Zeitraum ueber zwei Monate, beide zeigen statt nur den Fokusmonat.
    if (monate === 2 && bereich?.von && bereich.bis && monatVon(bereich.von) === plusMonatAufMonat(monatVon(fokus), -1)) {
      return monatVon(bereich.von);
    }
    return monatVon(fokus);
  });
  const [ansicht, setAnsicht] = useState<"tage" | "monate" | "jahre">("tage");
  const [hover, setHover] = useState<string | null>(null);
  const raster = useRef<HTMLDivElement>(null);
  // Fokus nur nachziehen, solange die Tastatur im Raster arbeitet -- sonst
  // wuerde der Kalender dem Tippfeld daneben den Fokus wegnehmen.
  const imRaster = useRef(false);
  const letzterMonat = plusMonatAufMonat(anzeige, monate - 1);

  function sichtbarMachen(iso: string) {
    const m = monatVon(iso);
    if (m < anzeige) setAnzeige(m);
    else if (m > letzterMonat) setAnzeige(plusMonatAufMonat(m, -(monate - 1)));
  }

  useEffect(() => {
    if (zeige && istIsoTag(zeige)) {
      setFokus(zeige);
      sichtbarMachen(zeige);
    }
    // nur wenn sich der getippte Wert aendert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeige]);

  useEffect(() => {
    if (ansicht !== "tage" || !imRaster.current) return;
    raster.current?.querySelector<HTMLButtonElement>(`button[data-tag="${fokus}"]`)?.focus();
  }, [fokus, anzeige, ansicht]);

  useEffect(() => {
    if (!autoFokus) return;
    imRaster.current = true;
    raster.current?.querySelector<HTMLButtonElement>(`button[data-tag="${fokus}"]`)?.focus();
    // nur beim Oeffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function taste(e: ReactKeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      // Selbst waehlen statt den Klick des Knopfs abzuwarten: der Kalender
      // gibt den Fokus beim Waehlen ans Tippfeld zurueck, und das Enter liefe
      // dort als keypress weiter -- das Formular wuerde abgeschickt.
      e.preventDefault();
      const gesperrt = Boolean((min && fokus < min) || (max && fokus > max));
      if (!gesperrt) onWaehlen(fokus);
      return;
    }
    let neu: string | null = null;
    switch (e.key) {
      case "ArrowLeft":
        neu = plusTage(fokus, -1);
        break;
      case "ArrowRight":
        neu = plusTage(fokus, 1);
        break;
      case "ArrowUp":
        neu = plusTage(fokus, -7);
        break;
      case "ArrowDown":
        neu = plusTage(fokus, 7);
        break;
      case "Home":
        neu = plusTage(fokus, -wochentag(fokus));
        break;
      case "End":
        neu = plusTage(fokus, 6 - wochentag(fokus));
        break;
      case "PageUp":
        neu = plusMonate(fokus, e.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        neu = plusMonate(fokus, e.shiftKey ? 12 : 1);
        break;
    }
    if (!neu) return;
    e.preventDefault();
    imRaster.current = true;
    setFokus(neu);
    sichtbarMachen(neu);
    if (bereich?.phase === "bis") setHover(neu);
  }

  function blaettern(richtung: -1 | 1) {
    if (ansicht === "tage") setAnzeige(plusMonatAufMonat(anzeige, richtung));
    else if (ansicht === "monate") setAnzeige(plusMonatAufMonat(anzeige, 12 * richtung));
    else setAnzeige(plusMonatAufMonat(anzeige, 144 * richtung));
  }

  const jahr = teile(`${anzeige}-01`).j;
  const jahrStart = jahr - (jahr % 12);
  const vorschauAktiv = bereich?.phase === "bis" && Boolean(bereich.von) && hover !== null;
  const [bVon, bBis] = vorschauAktiv
    ? [bereich!.von, hover!].sort()
    : [bereich?.von ?? "", bereich?.bis ?? ""];

  function tagZelle(iso: string, monat: string) {
    const aussen = monatVon(iso) !== monat;
    if (aussen && monate === 2) return <td key={iso} role="gridcell" />;
    const gesperrt = Boolean((min && iso < min) || (max && iso > max));
    const gewaehlt = bereich ? iso === bVon || iso === bBis : iso === wert;
    const imBereich = Boolean(bereich && bVon && bBis && iso > bVon && iso < bBis);
    const kl = ["zv-dkal-tag"];
    if (aussen) kl.push("aussen");
    else if (wochentag(iso) > 4) kl.push("we");
    if (iso === heute) kl.push("heute");
    if (imBereich) kl.push("imbereich");
    if (bereich && bVon && bBis && bVon !== bBis && iso === bVon) kl.push("anfang");
    if (bereich && bVon && bBis && bVon !== bBis && iso === bBis) kl.push("ende");
    if (gewaehlt) kl.push("gewaehlt");
    if (gesperrt) kl.push("gesperrt");
    return (
      <td key={iso} role="gridcell" aria-selected={gewaehlt}>
        <button
          type="button"
          data-tag={iso}
          className={kl.join(" ")}
          tabIndex={iso === fokus ? 0 : -1}
          aria-label={tagLang(iso)}
          aria-current={iso === heute ? "date" : undefined}
          aria-disabled={gesperrt || undefined}
          onClick={() => {
            setFokus(iso);
            if (!gesperrt) onWaehlen(iso);
          }}
          onMouseEnter={bereich?.phase === "bis" ? () => setHover(iso) : undefined}
        >
          {teile(iso).t}
        </button>
      </td>
    );
  }

  function blatt(monat: string) {
    const tage = monatsblatt(monat);
    return (
      <table key={monat} role="grid" className="zv-dkal-raster" aria-label={monatTitel(monat)}>
        <thead>
          <tr>
            {WOCHENTAGE_KURZ.map((w, i) => (
              <th key={w} scope="col" abbr={WOCHENTAGE_LANG[i]} className={i > 4 ? "we" : undefined}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <tr key={r}>{tage.slice(r * 7, r * 7 + 7).map((iso) => tagZelle(iso, monat))}</tr>
          ))}
        </tbody>
      </table>
    );
  }

  const monateListe = monate === 2 ? [anzeige, plusMonatAufMonat(anzeige, 1)] : [anzeige];
  const pfeilLabel =
    ansicht === "tage" ? ["Vormonat", "Nächster Monat"] : ansicht === "monate" ? ["Vorjahr", "Nächstes Jahr"] : ["Frühere Jahre", "Spätere Jahre"];

  return (
    <div className={`zv-dkal${monate === 2 ? " zv-dkal-zwei" : ""}`}>
      <div className="zv-dkal-kopf">
        <button type="button" className="zv-dkal-pfeil" aria-label={pfeilLabel[0]} onClick={() => blaettern(-1)}>
          <IZurueckPfeil />
        </button>
        {ansicht === "tage" ? (
          monateListe.map((m, i) =>
            i === 0 ? (
              <button
                key={m}
                type="button"
                className="zv-dkal-titel"
                aria-label={`${monatTitel(m)}, Monat und Jahr wählen`}
                onClick={() => setAnsicht("monate")}
              >
                {monatTitel(m)}
                <IAufklappen />
              </button>
            ) : (
              <span key={m} className="zv-dkal-titel" aria-hidden="true">
                {monatTitel(m)}
              </span>
            )
          )
        ) : ansicht === "monate" ? (
          <button type="button" className="zv-dkal-titel" aria-label={`${jahr}, Jahr wählen`} onClick={() => setAnsicht("jahre")}>
            {jahr}
            <IAufklappen />
          </button>
        ) : (
          <span className="zv-dkal-titel">
            {jahrStart} – {jahrStart + 11}
          </span>
        )}
        <button type="button" className="zv-dkal-pfeil" aria-label={pfeilLabel[1]} onClick={() => blaettern(1)}>
          <IVor />
        </button>
      </div>

      {ansicht === "tage" ? (
        <div
          ref={raster}
          className="zv-dkal-monate"
          onKeyDown={taste}
          onMouseLeave={() => setHover(null)}
          onBlur={(e) => {
            if (e.relatedTarget && !raster.current?.contains(e.relatedTarget as Node)) imRaster.current = false;
          }}
        >
          {monateListe.map(blatt)}
        </div>
      ) : ansicht === "monate" ? (
        <Wahlraster
          label="Monat wählen"
          eintraege={MONATSNAMEN.map((_, i) => {
            const m = `${jahr}-${String(i + 1).padStart(2, "0")}`;
            return {
              schluessel: m,
              text: MONATSNAMEN_KURZ[i],
              langtext: monatTitel(m),
              gewaehlt: m === anzeige,
              heute: m === monatVon(heute),
              gesperrt: Boolean((min && m < monatVon(min)) || (max && m > monatVon(max))),
            };
          })}
          onWaehlen={(m) => {
            setAnzeige(m);
            const neu = klemme(`${m}-${String(Math.min(teile(fokus).t, new Date(+m.slice(0, 4), +m.slice(5), 0).getDate())).padStart(2, "0")}`, min, max);
            imRaster.current = true;
            setFokus(neu);
            setAnsicht("tage");
          }}
        />
      ) : (
        <Wahlraster
          label="Jahr wählen"
          eintraege={Array.from({ length: 12 }, (_, i) => {
            const j = jahrStart + i;
            return {
              schluessel: String(j),
              text: String(j),
              langtext: String(j),
              gewaehlt: j === jahr,
              heute: j === +heute.slice(0, 4),
              gesperrt: Boolean((min && j < +min.slice(0, 4)) || (max && j > +max.slice(0, 4))),
            };
          })}
          onWaehlen={(j) => {
            setAnzeige(`${j}-${anzeige.slice(5)}`);
            setAnsicht("monate");
          }}
        />
      )}
      {fuss}
    </div>
  );
}

/** 3 x 4-Raster fuer Monate bzw. Jahre; Pfeiltasten wandern, Enter waehlt. */
function Wahlraster({
  label,
  eintraege,
  onWaehlen,
  autoFokus = true,
}: {
  label: string;
  eintraege: { schluessel: string; text: string; langtext: string; gewaehlt: boolean; heute: boolean; gesperrt: boolean }[];
  onWaehlen: (schluessel: string) => void;
  autoFokus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = Math.max(0, eintraege.findIndex((e) => e.gewaehlt));
  const [fokus, setFokus] = useState(start);
  const erstes = useRef(true);
  useEffect(() => {
    // Beim Einhaengen nur auf Wunsch (Jahr blaettern soll den Fokus auf dem
    // Pfeil lassen), danach nur, solange die Tastatur im Raster ist.
    const beimStart = erstes.current;
    erstes.current = false;
    if (beimStart ? !autoFokus : !ref.current?.contains(document.activeElement)) return;
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[fokus]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokus]);
  return (
    <div
      ref={ref}
      className="zv-dkal-wahl"
      role="group"
      aria-label={label}
      onKeyDown={(e) => {
        const schritt = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
        if (schritt === undefined) return;
        e.preventDefault();
        setFokus((f) => Math.max(0, Math.min(eintraege.length - 1, f + schritt)));
      }}
    >
      {eintraege.map((e, i) => (
        <button
          key={e.schluessel}
          type="button"
          tabIndex={i === fokus ? 0 : -1}
          className={`zv-dkal-wahl-knopf${e.gewaehlt ? " gewaehlt" : ""}${e.heute ? " heute" : ""}${e.gesperrt ? " gesperrt" : ""}`}
          aria-label={e.langtext}
          aria-pressed={e.gewaehlt}
          aria-disabled={e.gesperrt || undefined}
          aria-current={e.heute ? "date" : undefined}
          onClick={() => {
            setFokus(i);
            if (!e.gesperrt) onWaehlen(e.schluessel);
          }}
        >
          {e.text}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Schwebende Huelle (Portal)                                            */
/* ------------------------------------------------------------------ */

/**
 * Portal an document.body: das Seitenpanel liegt per transform im Bild,
 * und ein transform-Vorfahr macht position: fixed relativ zu sich selbst --
 * der Kalender saesse dann verschoben bzw. abgeschnitten (overflow im Modal).
 * React-Ereignisse laufen trotzdem durch den Komponentenbaum, deshalb
 * schliesst ein Klick in den Kalender das Modal nicht.
 */
function KalenderPopup({
  anker,
  label,
  onSchliessen,
  children,
}: {
  anker: RefObject<HTMLElement>;
  label: string;
  /** zurueck = Fokus ans Feld zurueckgeben (Escape), nicht bei Klick ausserhalb. */
  onSchliessen: (zurueck: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const positionieren = useCallback(() => {
    const a = anker.current;
    const p = ref.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let top = r.bottom + 4;
    // Passt er unten nicht, aber oben schon: nach oben aufklappen.
    if (top + h > window.innerHeight - 8 && r.top - h - 4 >= 8) top = r.top - h - 4;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos((alt) => (alt && Math.abs(alt.top - top) < 0.5 && Math.abs(alt.left - left) < 0.5 ? alt : { top, left }));
  }, [anker]);

  // Nach jedem Rendern: Monats-/Jahresansicht und zweiter Monat aendern die Groesse.
  useLayoutEffect(positionieren);
  useSchwebendSchliessen(true, [ref, anker], () => onSchliessen(false), positionieren);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="zv-dkal-popover"
      // opacity statt visibility bis zur ersten Messung: unsichtbare
      // (visibility: hidden) Knoepfe lassen sich nicht fokussieren, und der
      // Kalender setzt den Fokus schon beim Einhaengen.
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, opacity: 0 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Sonst schliesst der Document-Listener von Modal/Seitenpanel mit.
          e.stopPropagation();
          e.preventDefault();
          onSchliessen(true);
        } else if (e.key === "Tab") {
          // Fokusfalle wie im WAI-ARIA-Muster "Date Picker Dialog": das Portal
          // liegt am Ende von <body>, Tab liefe sonst ins Leere.
          const knoepfe = Array.from(ref.current!.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")).filter(
            (el) => el.tabIndex >= 0
          );
          if (knoepfe.length === 0) return;
          const i = knoepfe.indexOf(document.activeElement as HTMLElement);
          const ziel = e.shiftKey ? (i <= 0 ? knoepfe.length - 1 : i - 1) : i === knoepfe.length - 1 ? 0 : i + 1;
          e.preventDefault();
          knoepfe[ziel].focus();
        }
      }}
    >
      {children}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Tippfeld                                                             */
/* ------------------------------------------------------------------ */

interface EingabeProps {
  id?: string;
  name?: string;
  wert: string;
  onWert: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  autoFocus?: boolean;
  kompakt?: boolean;
  ohneKalender?: boolean;
  kalenderOffen?: boolean;
  onKalender?: () => void;
  onKalenderZu?: () => void;
  eingabeRef?: RefObject<HTMLInputElement>;
  huelleRef?: RefObject<HTMLDivElement>;
  onFokus?: () => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function Datumseingabe(p: EingabeProps) {
  const eigeneId = useId();
  const id = p.id ?? `datum-${eigeneId}`;
  const [text, setText] = useState(p.wert ? formatDatum(p.wert) : "");
  const [fehler, setFehler] = useState<string | null>(null);
  const eigeneEingabe = useRef<HTMLInputElement>(null);
  const eingabe = p.eingabeRef ?? eigeneEingabe;
  const versteckt = useRef<HTMLInputElement>(null);
  // Zuletzt selbst gemeldeter Wert: aendert sich `wert` von aussen
  // (Kalender, Schnellwahl, Elternzustand), wird der Text neu gesetzt --
  // beim eigenen Tippen nicht, sonst spraenge der Cursor.
  const gemeldet = useRef(p.wert);

  useEffect(() => {
    if (p.wert === gemeldet.current) return;
    gemeldet.current = p.wert;
    setText(p.wert ? formatDatum(p.wert) : "");
    setFehler(null);
  }, [p.wert]);

  // Formularpruefung des Browsers: ein ungueltiger Text blockiert das
  // Absenden mit derselben Meldung, die unter dem Feld steht.
  useEffect(() => {
    const r = leseDatum(text, true);
    const meldung = !r ? "" : "fehler" in r ? r.fehler : (grenzFehler(r.iso, p.min, p.max) ?? "");
    eingabe.current?.setCustomValidity(meldung);
  }, [text, p.min, p.max, eingabe]);

  function melden(iso: string) {
    gemeldet.current = iso;
    // Sofort ins DOM: drueckt jemand Enter, liest das Formular FormData noch
    // im selben Ereignis -- vor Reacts naechstem Rendern.
    if (versteckt.current) versteckt.current.value = iso;
    if (iso !== p.wert) p.onWert(iso);
  }

  function festlegen() {
    const r = leseDatum(text, true);
    if (!r) {
      melden("");
      setFehler(null);
      return;
    }
    if ("fehler" in r) {
      setFehler(r.fehler);
      melden("");
      return;
    }
    setText(formatDatum(r.iso));
    melden(r.iso);
    setFehler(grenzFehler(r.iso, p.min, p.max));
  }

  const hinweisId = `${id}-hinweis`;
  const fehlerId = `${id}-fehler`;
  const beschrieben = [hinweisId, fehler ? fehlerId : null, p["aria-describedby"]].filter(Boolean).join(" ");

  return (
    <div className={`zv-datum-huelle${p.kompakt ? " kompakt" : ""}`}>
      <div ref={p.huelleRef} className={`zv-datum${p.kompakt ? " kompakt" : ""}${fehler || p["aria-invalid"] ? " fehler" : ""}`}>
        <input
          ref={eingabe}
          id={id}
          type="text"
          className="zv-datum-text"
          autoComplete="off"
          spellCheck={false}
          placeholder="TT.MM.JJJJ"
          value={text}
          required={p.required}
          autoFocus={p.autoFocus}
          aria-label={p["aria-label"]}
          aria-describedby={beschrieben}
          aria-invalid={Boolean(fehler) || p["aria-invalid"] || undefined}
          onFocus={p.onFokus}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (!t.trim()) {
              melden("");
              return;
            }
            const r = leseDatum(t, false);
            if (r && "iso" in r) {
              melden(r.iso);
              setFehler(null);
            }
          }}
          onBlur={festlegen}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && e.altKey && p.onKalender && !p.ohneKalender) {
              e.preventDefault();
              festlegen();
              p.onKalender();
            } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey) {
              e.preventDefault();
              const neu = klemme(plusTage(p.wert || heuteBerlin(), e.key === "ArrowUp" ? 1 : -1), p.min, p.max);
              setText(formatDatum(neu));
              setFehler(null);
              melden(neu);
            } else if (e.key === "Enter") {
              festlegen();
            } else if (e.key === "Escape" && p.kalenderOffen) {
              e.stopPropagation();
              p.onKalenderZu?.();
            }
          }}
        />
        {!p.ohneKalender && (
          <button
            type="button"
            className="zv-datum-knopf"
            aria-label="Kalender öffnen"
            aria-haspopup="dialog"
            aria-expanded={Boolean(p.kalenderOffen)}
            onClick={() => {
              festlegen();
              p.onKalender?.();
            }}
          >
            <IKalender />
          </button>
        )}
      </div>
      <span id={hinweisId} className="zv-sr-only">
        Format TT.MM.JJJJ{p.ohneKalender ? "" : ", Alt und Pfeil nach unten öffnet den Kalender"}
      </span>
      {fehler && (
        <div id={fehlerId} className="zv-datum-fehler" role="alert">
          {fehler}
        </div>
      )}
      {p.name && <input ref={versteckt} type="hidden" name={p.name} value={p.wert} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Natives Feld (Touch)                                                  */
/* ------------------------------------------------------------------ */

export function NativesDatum({
  feldRef,
  id,
  name,
  wert,
  onWert,
  min,
  max,
  required,
  autoFocus,
  kompakt,
  chips,
  ...aria
}: {
  feldRef?: RefObject<HTMLInputElement>;
  id?: string;
  name?: string;
  wert: string;
  onWert: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  autoFocus?: boolean;
  kompakt?: boolean;
  chips: { label: string; iso: string }[];
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <div className={`zv-datum-huelle${kompakt ? " kompakt" : ""}`}>
      <input
        ref={feldRef}
        id={id}
        name={name}
        type="date"
        className={`zv-datum-nativ${kompakt ? " kompakt" : ""}`}
        value={wert}
        min={min}
        max={max}
        required={required}
        autoFocus={autoFocus}
        onChange={(e) => onWert(e.target.value)}
        {...aria}
      />
      {/* Schnellwahl unter dem Feld: spart am Handy die meisten Eingaben. */}
      {chips.length > 0 && (
        <div className="zv-datum-chips">
          {chips.map((c) => (
            <button key={c.label} type="button" className={`zv-datum-chip${c.iso === wert ? " an" : ""}`} onClick={() => onWert(c.iso)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Datumsfeld (Tag)                                                      */
/* ------------------------------------------------------------------ */

export interface DatumsfeldProps {
  id?: string;
  /** Mit name: verstecktes Feld fuer FormData (Wert ISO). */
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  autoFocus?: boolean;
  schnellwahl?: SchnellwahlArt;
  /** formular = 40 px, kompakt = 36 px (Werkzeug- und Listenzeilen) */
  groesse?: "formular" | "kompakt";
  /** Geburtsdatum: nur Tippen -- wer 1985 sucht, tippt schneller als er blaettert. */
  ohneKalender?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function Datumsfeld(p: DatumsfeldProps) {
  const grob = useGrobZeiger();
  const [intern, setIntern] = useState(p.defaultValue ?? "");
  const [neuAufbau, setNeuAufbau] = useState(0);
  const wert = p.value ?? intern;
  const setWert = (v: string) => {
    if (p.value === undefined) setIntern(v);
    p.onChange?.(v);
  };
  const [offen, setOffen] = useState(false);
  const huelle = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLInputElement>(null);
  const kompakt = p.groesse === "kompakt";

  useFormZuruecksetzen(eingabe, () => {
    setIntern(p.defaultValue ?? "");
    setNeuAufbau((n) => n + 1);
  });

  const chips = schnellwahlTage(p.schnellwahl ?? "keine").filter((c) => !grenzFehler(c.iso, p.min, p.max));
  const aria = { "aria-label": p["aria-label"], "aria-describedby": p["aria-describedby"], "aria-invalid": p["aria-invalid"] };

  if (grob) {
    return (
      <NativesDatum
        key={neuAufbau}
        feldRef={eingabe}
        id={p.id}
        name={p.name}
        wert={wert}
        onWert={setWert}
        min={p.min}
        max={p.max}
        required={p.required}
        autoFocus={p.autoFocus}
        kompakt={kompakt}
        chips={p.ohneKalender ? [] : chips}
        {...aria}
      />
    );
  }

  function schliessen(zurueck: boolean) {
    setOffen(false);
    if (zurueck) eingabe.current?.focus();
  }

  return (
    <>
      <Datumseingabe
        key={neuAufbau}
        id={p.id}
        name={p.name}
        wert={wert}
        onWert={setWert}
        min={p.min}
        max={p.max}
        required={p.required}
        autoFocus={p.autoFocus}
        kompakt={kompakt}
        ohneKalender={p.ohneKalender}
        kalenderOffen={offen}
        onKalender={() => setOffen((o) => !o)}
        onKalenderZu={() => setOffen(false)}
        eingabeRef={eingabe}
        huelleRef={huelle}
        {...aria}
      />
      {offen && (
        <KalenderPopup anker={huelle} label="Datum wählen" onSchliessen={schliessen}>
          <Kalender
            wert={wert}
            min={p.min}
            max={p.max}
            autoFokus
            onWaehlen={(iso) => {
              setWert(iso);
              schliessen(true);
            }}
            fuss={
              (chips.length > 0 || !p.required) && (
                <div className="zv-dkal-fuss">
                  {chips.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      className={`zv-datum-chip${c.iso === wert ? " an" : ""}`}
                      onClick={() => {
                        setWert(c.iso);
                        schliessen(true);
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                  {!p.required && (
                    <button
                      type="button"
                      className="zv-btn zv-btn-still zv-btn-klein zv-dkal-fuss-rechts"
                      onClick={() => {
                        setWert("");
                        schliessen(true);
                      }}
                    >
                      Leeren
                    </button>
                  )}
                </div>
              )
            }
          />
        </KalenderPopup>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Zeitraumfeld (von-bis in Formularen)                                  */
/* ------------------------------------------------------------------ */

interface ZeitraumTeil {
  id: string;
  label: string;
  name?: string;
  required?: boolean;
}

/**
 * Zwei Tippfelder, EIN Kalender mit Bereich: 1. Klick setzt "Von", 2. Klick
 * "Bis" (liegt er davor, wird getauscht), die Maus zeigt den Bereich als
 * Vorschau. Rendert zwei .zv-field nebeneinander ohne eigene Zeile, damit
 * es in die vorhandenen .zv-field-row passt (teils mit drittem Feld).
 */
export function Zeitraumfeld({
  von: vonTeil,
  bis: bisTeil,
  wertVon,
  wertBis,
  defaultVon,
  defaultBis,
  onChange,
  min,
  max,
  autoFocus,
}: {
  von: ZeitraumTeil;
  bis: ZeitraumTeil;
  wertVon?: string;
  wertBis?: string;
  defaultVon?: string;
  defaultBis?: string;
  onChange?: (von: string, bis: string) => void;
  min?: string;
  max?: string;
  autoFocus?: boolean;
}) {
  const grob = useGrobZeiger();
  const [iVon, setIVon] = useState(defaultVon ?? "");
  const [iBis, setIBis] = useState(defaultBis ?? "");
  const [neuAufbau, setNeuAufbau] = useState(0);
  const von = wertVon ?? iVon;
  const bis = wertBis ?? iBis;
  const setze = (v: string, b: string) => {
    if (wertVon === undefined) setIVon(v);
    if (wertBis === undefined) setIBis(b);
    onChange?.(v, b);
  };
  const [phase, setPhase] = useState<"von" | "bis" | null>(null);
  const [ankerTeil, setAnkerTeil] = useState<"von" | "bis">("von");
  const huelleVon = useRef<HTMLDivElement>(null);
  const huelleBis = useRef<HTMLDivElement>(null);
  const eingabeVon = useRef<HTMLInputElement>(null);
  const eingabeBis = useRef<HTMLInputElement>(null);

  useFormZuruecksetzen(eingabeVon, () => {
    setIVon(defaultVon ?? "");
    setIBis(defaultBis ?? "");
    setNeuAufbau((n) => n + 1);
  });

  if (grob) {
    return (
      <>
        <div className="zv-field">
          <label htmlFor={vonTeil.id}>{vonTeil.label}</label>
          <NativesDatum key={`v${neuAufbau}`} feldRef={eingabeVon} id={vonTeil.id} name={vonTeil.name} wert={von} onWert={(v) => setze(v, bis && v > bis ? "" : bis)} min={min} max={bis || max} required={vonTeil.required} autoFocus={autoFocus} chips={[]} />
        </div>
        <div className="zv-field">
          <label htmlFor={bisTeil.id}>{bisTeil.label}</label>
          <NativesDatum key={`b${neuAufbau}`} feldRef={eingabeBis} id={bisTeil.id} name={bisTeil.name} wert={bis} onWert={(b) => setze(von, b)} min={von || min} max={max} required={bisTeil.required} chips={[]} />
        </div>
      </>
    );
  }

  function oeffnen(teil: "von" | "bis") {
    setAnkerTeil(teil);
    setPhase((p) => (p ? null : teil));
  }
  function schliessen(zurueck: boolean) {
    const teil = phase;
    setPhase(null);
    if (zurueck) (teil === "bis" ? eingabeBis : eingabeVon).current?.focus();
  }

  const zweiMonate = typeof window !== "undefined" && window.innerWidth >= 700;

  return (
    <>
      <div className="zv-field">
        <label htmlFor={vonTeil.id}>{vonTeil.label}</label>
        <Datumseingabe
          key={`v${neuAufbau}`}
          id={vonTeil.id}
          name={vonTeil.name}
          wert={von}
          onWert={(v) => setze(v, bis)}
          min={min}
          max={max}
          required={vonTeil.required}
          autoFocus={autoFocus}
          kalenderOffen={phase !== null && ankerTeil === "von"}
          onKalender={() => oeffnen("von")}
          onKalenderZu={() => setPhase(null)}
          eingabeRef={eingabeVon}
          huelleRef={huelleVon}
        />
      </div>
      <div className="zv-field">
        <label htmlFor={bisTeil.id}>{bisTeil.label}</label>
        <Datumseingabe
          key={`b${neuAufbau}`}
          id={bisTeil.id}
          name={bisTeil.name}
          wert={bis}
          onWert={(b) => setze(von, b)}
          min={von || min}
          max={max}
          required={bisTeil.required}
          kalenderOffen={phase !== null && ankerTeil === "bis"}
          onKalender={() => oeffnen("bis")}
          onKalenderZu={() => setPhase(null)}
          eingabeRef={eingabeBis}
          huelleRef={huelleBis}
        />
      </div>
      {phase && (
        <KalenderPopup anker={ankerTeil === "bis" ? huelleBis : huelleVon} label="Zeitraum wählen" onSchliessen={schliessen}>
          <Kalender
            bereich={{ von, bis, phase }}
            min={min}
            max={max}
            monate={zweiMonate ? 2 : 1}
            autoFokus
            onWaehlen={(iso) => {
              if (phase === "von") {
                setze(iso, bis && bis < iso ? "" : bis);
                setPhase("bis");
              } else if (von && iso < von) {
                setze(iso, von);
                setPhase(null);
                eingabeBis.current?.focus();
              } else {
                setze(von, iso);
                setPhase(null);
                eingabeBis.current?.focus();
              }
            }}
            fuss={
              <div className="zv-dkal-fuss">
                <span className="zv-dkal-fuss-text" aria-live="polite">
                  {phase === "von" ? `${vonTeil.label} wählen · ` : `${bisTeil.label} wählen · `}
                  {zeitraumInWorten(von, bis)}
                </span>
              </div>
            }
          />
        </KalenderPopup>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Monatsfeld                                                            */
/* ------------------------------------------------------------------ */

/**
 * Monat mit ‹ › zum Blaettern -- auch am Handy die eigene Variante, weil
 * type="month" in Firefox und Safari am Desktop gar nicht existiert (dort
 * wird daraus ein leeres Textfeld) und die Pfeile ohnehin daumentauglich sind.
 */
export function Monatsfeld({
  id,
  value,
  onChange,
  min,
  max,
  name,
  "aria-labelledby": beschriftetVon,
}: {
  id: string;
  value: string;
  onChange: (monat: string) => void;
  min?: string;
  max?: string;
  name?: string;
  "aria-labelledby": string;
}) {
  const [offen, setOffen] = useState(false);
  const huelle = useRef<HTMLDivElement>(null);
  const wertKnopf = useRef<HTMLButtonElement>(null);
  const [jahr, setJahr] = useState(() => +(value || heuteBerlin()).slice(0, 4));
  const [geblaettert, setGeblaettert] = useState(false);
  const vor = value ? plusMonatAufMonat(value, -1) : "";
  const nach = value ? plusMonatAufMonat(value, 1) : "";
  const jetzt = monatVon(heuteBerlin());
  const erlaubt = (m: string) => !(min && m < min) && !(max && m > max);

  function schliessen(zurueck: boolean) {
    setOffen(false);
    if (zurueck) wertKnopf.current?.focus();
  }
  function waehlen(m: string) {
    onChange(m);
    schliessen(true);
  }

  return (
    <div ref={huelle} className="zv-monatsfeld" role="group" aria-labelledby={beschriftetVon}>
      <button type="button" className="zv-monatsfeld-schritt" aria-label="Vormonat" disabled={!vor || !erlaubt(vor)} onClick={() => onChange(vor)}>
        <IZurueckPfeil />
      </button>
      <button
        ref={wertKnopf}
        id={id}
        type="button"
        className="zv-monatsfeld-wert"
        aria-haspopup="dialog"
        aria-expanded={offen}
        aria-labelledby={`${beschriftetVon} ${id}-wert`}
        onClick={() => {
          setJahr(+(value || heuteBerlin()).slice(0, 4));
          setGeblaettert(false);
          setOffen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            setJahr(+(value || heuteBerlin()).slice(0, 4));
            setGeblaettert(false);
            setOffen(true);
          } else if (e.key === "Escape" && offen) {
            e.stopPropagation();
            setOffen(false);
          }
        }}
      >
        <span id={`${id}-wert`}>{value ? monatTitel(value) : "Monat wählen"}</span>
        <IAufklappen />
      </button>
      <button type="button" className="zv-monatsfeld-schritt" aria-label="Nächster Monat" disabled={!nach || !erlaubt(nach)} onClick={() => onChange(nach)}>
        <IVor />
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {offen && (
        <KalenderPopup anker={huelle} label="Monat wählen" onSchliessen={schliessen}>
          <div className="zv-dkal">
            <div className="zv-dkal-kopf">
              <button type="button" className="zv-dkal-pfeil" aria-label="Vorjahr" disabled={Boolean(min && `${jahr - 1}-12` < min)} onClick={() => {
                  setGeblaettert(true);
                  setJahr(jahr - 1);
                }}
              >
                <IZurueckPfeil />
              </button>
              <span className="zv-dkal-titel" aria-live="polite">
                {jahr}
              </span>
              <button type="button" className="zv-dkal-pfeil" aria-label="Nächstes Jahr" disabled={Boolean(max && `${jahr + 1}-01` > max)} onClick={() => {
                  setGeblaettert(true);
                  setJahr(jahr + 1);
                }}
              >
                <IVor />
              </button>
            </div>
            <Wahlraster
              key={jahr}
              autoFokus={!geblaettert}
              label={`Monat ${jahr} wählen`}
              eintraege={MONATSNAMEN.map((_, i) => {
                const m = `${jahr}-${String(i + 1).padStart(2, "0")}`;
                return { schluessel: m, text: MONATSNAMEN_KURZ[i], langtext: monatTitel(m), gewaehlt: m === value, heute: m === jetzt, gesperrt: !erlaubt(m) };
              })}
              onWaehlen={waehlen}
            />
            <div className="zv-dkal-fuss">
              {[
                { label: "Dieser Monat", m: jetzt },
                { label: "Letzter Monat", m: plusMonatAufMonat(jetzt, -1) },
              ]
                .filter((c) => erlaubt(c.m))
                .map((c) => (
                  <button key={c.label} type="button" className={`zv-datum-chip${c.m === value ? " an" : ""}`} onClick={() => waehlen(c.m)}>
                    {c.label}
                  </button>
                ))}
            </div>
          </div>
        </KalenderPopup>
      )}
    </div>
  );
}
