import { KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SucheErgebnisDto, SucheGruppe, SucheTrefferDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { formatBetrag } from "../format";
import { IFehler, IKassenbuch, IKlienten, IMitarbeitende, INeu, ISuche, IZimmer, type IconKomponente } from "./icons";

/** Ein Eintrag, der ohne Server auskommt (Menue, Aktionen). */
export interface Befehl {
  schluessel: string;
  titel: string;
  hinweis?: string;
  icon: IconKomponente;
  ausfuehren: () => void;
}

const ZULETZT_SCHLUESSEL = "zv-palette-zuletzt";
const MAX_ZULETZT = 8;
const MIN_ZEICHEN = 2;
const ENTPRELLEN_MS = 150;

type Zuletzt = { gruppe: SucheGruppe; id: string };

/**
 * Nur IDs (Typ + UUID), nie Namen: ein reiner Komfort dieses Geraets, wie
 * Theme und Menueband (TTDSG §25 Abs. 2, vom Nutzer gewollte Funktion). Die
 * Anzeige holt der Client bei jedem Oeffnen frisch vom Server -- dort gelten
 * Rechte und Standort-Beschraenkung erneut, ein spaeter entzogener Zugriff
 * zeigt sich also nicht aus dem Zwischenspeicher. Beim Abmelden geloescht
 * (Shell.tsx).
 */
export function zuletztLesen(): Zuletzt[] {
  try {
    const roh = JSON.parse(localStorage.getItem(ZULETZT_SCHLUESSEL) ?? "[]") as unknown;
    if (!Array.isArray(roh)) return [];
    return roh.filter(
      (e): e is Zuletzt =>
        typeof e?.id === "string" && ["klienten", "zimmer", "mitarbeitende", "belege"].includes(e?.gruppe)
    );
  } catch {
    return [];
  }
}

export function zuletztMerken(eintrag: Zuletzt) {
  try {
    const neu = [eintrag, ...zuletztLesen().filter((e) => !(e.id === eintrag.id && e.gruppe === eintrag.gruppe))];
    localStorage.setItem(ZULETZT_SCHLUESSEL, JSON.stringify(neu.slice(0, MAX_ZULETZT)));
  } catch {
    // Ohne localStorage fehlt nur die Liste "Zuletzt geöffnet".
  }
}

export function zuletztLoeschen() {
  try {
    localStorage.removeItem(ZULETZT_SCHLUESSEL);
  } catch {
    // egal
  }
}

const GRUPPE_LABEL: Record<SucheGruppe, string> = {
  klienten: "Klient:innen",
  zimmer: "Zimmer",
  mitarbeitende: "Mitarbeitende",
  belege: "Belege",
};
const GRUPPE_ICON: Record<SucheGruppe, IconKomponente> = {
  klienten: IKlienten,
  zimmer: IZimmer,
  mitarbeitende: IMitarbeitende,
  belege: IKassenbuch,
};
const SERVER_GRUPPEN: SucheGruppe[] = ["klienten", "zimmer", "mitarbeitende", "belege"];

interface Zeile {
  schluessel: string;
  titel: string;
  untertitel?: string | null;
  mono?: boolean;
  betragCent?: number | null;
  icon: IconKomponente;
  ausfuehren: () => void;
}
interface Abschnitt {
  label: string;
  zeilen: Zeile[];
}

const normal = (s: string) => s.toLocaleLowerCase("de-DE").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Trefferbegriff hervorheben -- als <mark>, damit es auch ohne Farbe (Systemfarben) erkennbar bleibt. */
function hervorheben(text: string, q: string): ReactNode {
  const begriff = q.trim();
  if (begriff.length < MIN_ZEICHEN) return text;
  const i = normal(text).indexOf(normal(begriff));
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + begriff.length)}</mark>
      {text.slice(i + begriff.length)}
    </>
  );
}

export function Befehlspalette({
  offen,
  oeffnungNr,
  onSchliessen,
  navigation,
  aktionen,
  onTreffer,
  tagesberichtFuer,
}: {
  offen: boolean;
  /** Erhoeht sich bei jedem Oeffnen -- setzt Suchtext und Auswahl auch bei erneutem Oeffnen zurueck. */
  oeffnungNr: number;
  onSchliessen: () => void;
  navigation: Befehl[];
  aktionen: Befehl[];
  onTreffer: (t: SucheTrefferDto) => void;
  /** Aktion "Tagesbericht für … schreiben" zu einem Klient:innen-Treffer. */
  tagesberichtFuer: (t: SucheTrefferDto) => void;
}) {
  const [q, setQ] = useState("");
  const [ergebnis, setErgebnis] = useState<SucheErgebnisDto | null>(null);
  const [zuletzt, setZuletzt] = useState<SucheErgebnisDto | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [aktiv, setAktiv] = useState(0);
  const eingabeRef = useRef<HTMLInputElement>(null);
  const listeRef = useRef<HTMLDivElement>(null);
  const oeffnerRef = useRef<HTMLElement | null>(null);
  const anfrageNr = useRef(0);

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

  // Fokus beim Oeffnen merken und beim Schliessen zurueckgeben.
  useEffect(() => {
    if (!offen) return;
    oeffnerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQ("");
    setErgebnis(null);
    setFehler(null);
    setAktiv(0);
    eingabeRef.current?.focus();
    const liste = zuletztLesen();
    if (liste.length > 0 && navigator.onLine) {
      api.sucheZuletzt(liste).then(setZuletzt).catch(() => setZuletzt(null));
    } else {
      setZuletzt(null);
    }
    return () => {
      oeffnerRef.current?.focus();
    };
  }, [offen, oeffnungNr]);

  // Suche: 150 ms nach dem letzten Tastendruck; eine spaeter gestartete
  // Anfrage verwirft die Antwort einer frueheren.
  useEffect(() => {
    if (!offen) return;
    const begriff = q.trim();
    if (begriff.length < MIN_ZEICHEN || !online) {
      anfrageNr.current++;
      setErgebnis(null);
      setLaedt(false);
      setFehler(null);
      return;
    }
    setLaedt(true);
    const nr = ++anfrageNr.current;
    const timer = window.setTimeout(() => {
      api
        .suche(begriff)
        .then((e) => {
          if (nr !== anfrageNr.current) return;
          setErgebnis(e);
          setFehler(null);
        })
        .catch((err) => {
          if (nr !== anfrageNr.current) return;
          setErgebnis(null);
          setFehler(err instanceof Error ? err.message : "Die Suche ist fehlgeschlagen.");
        })
        .finally(() => {
          if (nr === anfrageNr.current) setLaedt(false);
        });
    }, ENTPRELLEN_MS);
    return () => window.clearTimeout(timer);
  }, [q, offen, online]);

  const treffer = useCallback(
    (t: SucheTrefferDto): Zeile => ({
      schluessel: `${t.gruppe}:${t.id}`,
      titel: t.titel,
      untertitel: t.untertitel,
      mono: t.gruppe === "belege" || t.gruppe === "zimmer",
      betragCent: t.betragCent,
      icon: GRUPPE_ICON[t.gruppe],
      ausfuehren: () => onTreffer(t),
    }),
    [onTreffer]
  );
  const befehl = (b: Befehl): Zeile => ({
    schluessel: b.schluessel,
    titel: b.titel,
    untertitel: b.hinweis,
    icon: b.icon,
    ausfuehren: b.ausfuehren,
  });

  const begriff = q.trim();
  const abgefragt = begriff.length >= MIN_ZEICHEN;

  const abschnitte: Abschnitt[] = useMemo(() => {
    const liste: Abschnitt[] = [];
    const passt = (b: Befehl) => normal(`${b.titel} ${b.hinweis ?? ""}`).includes(normal(begriff));
    if (abgefragt) {
      for (const g of SERVER_GRUPPEN) {
        const zeilen = (ergebnis?.[g] ?? []).map(treffer);
        if (zeilen.length > 0) liste.push({ label: GRUPPE_LABEL[g], zeilen });
      }
      const nav = navigation.filter(passt).map(befehl);
      if (nav.length > 0) liste.push({ label: "Navigation", zeilen: nav });
      const aktionsZeilen = aktionen.filter(passt).map(befehl);
      for (const k of (ergebnis?.klienten ?? []).slice(0, 2)) {
        aktionsZeilen.push({
          schluessel: `tagesbericht:${k.id}`,
          titel: `Tagesbericht für ${k.titel} schreiben`,
          icon: INeu,
          ausfuehren: () => tagesberichtFuer(k),
        });
      }
      if (aktionsZeilen.length > 0) liste.push({ label: "Aktionen", zeilen: aktionsZeilen });
    } else {
      if (zuletzt) {
        const zeilen = SERVER_GRUPPEN.flatMap((g) => zuletzt[g]).map(treffer);
        // Reihenfolge wie gemerkt, nicht nach Gruppen.
        const reihenfolge = zuletztLesen().map((e) => `${e.gruppe}:${e.id}`);
        zeilen.sort((a, b) => reihenfolge.indexOf(a.schluessel) - reihenfolge.indexOf(b.schluessel));
        if (zeilen.length > 0) liste.push({ label: "Zuletzt geöffnet", zeilen });
      }
      liste.push({ label: "Navigation", zeilen: navigation.map(befehl) });
      liste.push({ label: "Aktionen", zeilen: aktionen.map(befehl) });
    }
    return liste;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abgefragt, begriff, ergebnis, zuletzt, navigation, aktionen, treffer, tagesberichtFuer]);

  const flach = abschnitte.flatMap((a) => a.zeilen);
  useEffect(() => setAktiv(0), [q, ergebnis]);
  useEffect(() => {
    listeRef.current?.querySelector(`[data-index="${aktiv}"]`)?.scrollIntoView({ block: "nearest" });
  }, [aktiv]);

  if (!offen) return null;

  function waehlen(z: Zeile | undefined) {
    if (!z) return;
    onSchliessen();
    z.ausfuehren();
  }

  function taste(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onSchliessen();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAktiv((i) => (flach.length === 0 ? 0 : (i + 1) % flach.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAktiv((i) => (flach.length === 0 ? 0 : (i - 1 + flach.length) % flach.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      waehlen(flach[aktiv]);
    } else if (e.key === "Tab") {
      // Der Dialog hat nur ein Eingabefeld; Optionen werden per Pfeiltasten gewaehlt.
      e.preventDefault();
    }
  }

  const keineTreffer = abgefragt && !laedt && !fehler && flach.length === 0;
  const statusText = !online
    ? "Offline – nur Menü und Aktionen verfügbar."
    : fehler
      ? fehler
      : laedt
        ? "Sucht…"
        : abgefragt
          ? flach.length === 0
            ? "Keine Treffer."
            : `${flach.length} Treffer`
          : "";

  let index = -1;
  return (
    <div className="zv-palette-scrim" onMouseDown={onSchliessen}>
      <div
        className="zv-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Befehlspalette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={taste}
      >
        <div className="zv-palette-eingabe">
          <ISuche />
          <input
            ref={eingabeRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="zv-palette-liste"
            aria-activedescendant={flach.length > 0 ? `zv-pal-opt-${aktiv}` : undefined}
            aria-autocomplete="list"
            aria-label="Suchen oder Befehl eingeben"
            placeholder="Klient:in, Zimmer, Person, Beleg oder Befehl…"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <p className="zv-palette-status" role="status" aria-live="polite">
          {statusText}
        </p>

        <div className="zv-palette-liste" id="zv-palette-liste" role="listbox" aria-label="Ergebnisse" ref={listeRef}>
          {fehler && (
            <div className="zv-palette-meldung" role="alert">
              <IFehler />
              {fehler}
            </div>
          )}
          {!online && abgefragt && (
            <div className="zv-palette-meldung">Offline – Klient:innen, Zimmer, Mitarbeitende und Belege lassen sich nur mit Verbindung suchen.</div>
          )}
          {keineTreffer && (
            <div className="zv-palette-meldung">
              Nichts gefunden für „{begriff}“. Versuchen Sie einen Namen, eine Zimmernummer oder eine Belegnummer wie KB-42.
            </div>
          )}
          {abschnitte.map((a) => (
            <div key={a.label} role="group" aria-label={a.label}>
              <div className="zv-palette-gruppe" aria-hidden="true">
                {a.label}
              </div>
              {a.zeilen.map((z) => {
                index++;
                const i = index;
                const Icon = z.icon;
                return (
                  <div
                    key={z.schluessel}
                    id={`zv-pal-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === aktiv}
                    className={`zv-palette-zeile${i === aktiv ? " aktiv" : ""}`}
                    onMouseMove={() => i !== aktiv && setAktiv(i)}
                    onClick={() => waehlen(z)}
                  >
                    <Icon />
                    <span className="zv-palette-text">
                      <span className={`zv-palette-titel${z.mono ? " zv-mono" : ""}`}>{hervorheben(z.titel, q)}</span>
                      {z.untertitel && <span className="zv-palette-untertitel">{hervorheben(z.untertitel, q)}</span>}
                    </span>
                    {z.betragCent !== null && z.betragCent !== undefined && (
                      <span className="zv-palette-betrag zv-mono">{formatBetrag(z.betragCent)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="zv-palette-fuss" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> wählen</span>
          <span><kbd>↵</kbd> öffnen</span>
          <span><kbd>Esc</kbd> schließen</span>
          <span><kbd>/</kbd> oder <kbd>Strg</kbd>+<kbd>K</kbd> öffnen</span>
        </div>
      </div>
    </div>
  );
}
