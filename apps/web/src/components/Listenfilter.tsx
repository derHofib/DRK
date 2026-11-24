import { ReactNode, useState } from "react";
import { SCHNELLWAHL_LABEL, type Schnellwahl, zeitraumFuer } from "../pages/tagesberichte-filter";
import type { ListenExport } from "../export/listenExport";
import { AktionsMenue } from "./AktionsMenue";
import { ExportMenue } from "./ExportMenue";
import { FilterAuswahl, FilterMehrfachAuswahl, FilterPille } from "./Filterleiste";
import { ZeitraumAuswahl } from "./ZeitraumAuswahl";
import { zeitraumKurz } from "./datumsfeld-logik";
import { IFilterLoeschen, IKalender, INeu, ISortierung, IStandort, ISuche } from "./icons";

/**
 * Die ganze Filterleiste einer Listenansicht: Suchfeld, feste Pillen
 * (children), per "+ Filter" zuschaltbare Zusatzfilter, Sortierung und
 * Zuruecksetzen. Die Bausteine (FilterPille, FilterAuswahl) liegen in
 * Filterleiste.tsx; hier steht nur das, was jede Liste gleich braucht --
 * damit Kassenbuch, Klienten, Zimmer usw. dieselbe Leiste zeigen und eine
 * Aenderung am Aussehen an einer Stelle reicht.
 */

export interface ZusatzFilter {
  id: string;
  label: string;
  icon: ReactNode;
  /** Anzeigewert des gesetzten Filters (ohne fuehrenden Doppelpunkt); null = nicht gesetzt. */
  wert: string | null;
  optionen: { wert: string; label: string }[];
  gewaehlt: string | null;
  onWaehlen: (wert: string) => void;
  onEntfernen: () => void;
}

export function Filterleiste({
  ariaLabel,
  suche,
  children,
  zusatz,
  sortierung,
  aktiv,
  onZuruecksetzen,
  exportListe,
}: {
  ariaLabel: string;
  suche?: { wert: string; onChange: (wert: string) => void; placeholder?: string; ariaLabel?: string };
  /** Feste Pillen, immer sichtbar. */
  children?: ReactNode;
  /** Zusatzfilter: erst ueber "+ Filter" sichtbar (oder sobald ein Wert gesetzt ist). */
  zusatz?: ZusatzFilter[];
  sortierung?: { optionen: { wert: string; label: string }[]; wert: string; onWaehlen: (wert: string) => void };
  /** Schraenkt irgendein Filter die Liste gerade ein? Steuert den Zuruecksetzen-Knopf. */
  aktiv: boolean;
  onZuruecksetzen: () => void;
  /** Baut die gerade sichtbare (gefilterte, sortierte) Liste fuer CSV/PDF; ohne diese Angabe gibt es keinen Export-Knopf. */
  exportListe?: () => ListenExport;
}) {
  // Welche Zusatzfilter der Mensch aktiv eingeblendet hat. Ein gesetzter Wert
  // blendet seinen Filter unabhaengig davon ein (z. B. Startfilter per Link).
  const [eingeblendet, setEingeblendet] = useState<Set<string>>(new Set());
  const sichtbar = (z: ZusatzFilter) => eingeblendet.has(z.id) || z.wert !== null;
  const fehlend = (zusatz ?? []).filter((z) => !sichtbar(z));

  return (
    <div className="zv-filterleiste" role="search" aria-label={ariaLabel}>
      {suche && (
        <label className="zv-filter-suche">
          <ISuche />
          <input
            type="search"
            value={suche.wert}
            onChange={(e) => suche.onChange(e.target.value)}
            placeholder={suche.placeholder ?? "Suchen…"}
            aria-label={suche.ariaLabel ?? "Liste durchsuchen"}
          />
        </label>
      )}

      {children}

      {(zusatz ?? []).filter(sichtbar).map((z) => (
        <FilterPille
          key={z.id}
          icon={z.icon}
          label={z.label}
          wert={z.wert !== null ? `: ${z.wert}` : null}
          onEntfernen={z.onEntfernen}
          startOffen={z.wert === null}
        >
          {(schliessen) => (
            <FilterAuswahl
              optionen={z.optionen}
              gewaehlt={z.gewaehlt}
              onWaehlen={(w) => {
                z.onWaehlen(w);
                schliessen();
              }}
            />
          )}
        </FilterPille>
      ))}

      {fehlend.length > 0 && (
        <AktionsMenue label="Filter hinzufügen" variante="pille" beschriftung="Filter" icon={<INeu />}>
          {fehlend.map((z) => (
            <button
              key={z.id}
              type="button"
              role="menuitem"
              onClick={() => setEingeblendet((s) => new Set(s).add(z.id))}
            >
              {z.icon} {z.label}
            </button>
          ))}
        </AktionsMenue>
      )}

      {sortierung && (
        <>
          <span className="zv-filter-trenner" aria-hidden="true" />
          <FilterPille icon={<ISortierung />} label="Sortierung" wert={null}>
            {(schliessen) => (
              <FilterAuswahl
                optionen={sortierung.optionen}
                gewaehlt={sortierung.wert}
                onWaehlen={(w) => {
                  sortierung.onWaehlen(w);
                  schliessen();
                }}
              />
            )}
          </FilterPille>
        </>
      )}

      {exportListe && (
        <>
          <span className="zv-filter-trenner" aria-hidden="true" />
          <ExportMenue erzeuge={exportListe} />
        </>
      )}

      <button
        type="button"
        className="zv-icon-btn"
        aria-label="Alle Filter zurücksetzen"
        title="Alle Filter zurücksetzen"
        disabled={!aktiv}
        onClick={() => {
          setEingeblendet(new Set());
          onZuruecksetzen();
        }}
      >
        <IFilterLoeschen />
      </button>
    </div>
  );
}

/** Pille mit genau einer Auswahl aus einer Liste (Standardfall: "Klient:in", "Standort", "Status"). */
export function OptionenFilter({
  icon,
  label,
  optionen,
  wert,
  onWaehlen,
}: {
  icon: ReactNode;
  label: string;
  optionen: { wert: string; label: string }[];
  /** "" = kein Filter. */
  wert: string;
  onWaehlen: (wert: string) => void;
}) {
  const treffer = wert ? optionen.find((o) => o.wert === wert) : undefined;
  return (
    <FilterPille icon={icon} label={label} wert={treffer ? `: ${treffer.label}` : null} onEntfernen={() => onWaehlen("")}>
      {(schliessen) => (
        <FilterAuswahl
          optionen={optionen}
          gewaehlt={wert || null}
          onWaehlen={(w) => {
            onWaehlen(w);
            schliessen();
          }}
        />
      )}
    </FilterPille>
  );
}

/**
 * Zustand des Zeitraumfilters (Schnellwahl oder eigene Von/Bis-Tage). Als Hook,
 * weil Listen den Zeitraum teils serverseitig (Tagesberichte), teils auf der
 * geladenen Liste (Kassenbuch) anwenden -- der Zustand ist derselbe.
 */
export function useZeitraum(start: Schnellwahl = "alle") {
  const [schnellwahl, setSchnellwahl] = useState<Schnellwahl | null>(start);
  const [von, setVon] = useState(() => zeitraumFuer(start).von);
  const [bis, setBis] = useState(() => zeitraumFuer(start).bis);
  function waehlen(wahl: Schnellwahl) {
    const z = zeitraumFuer(wahl);
    setSchnellwahl(wahl);
    setVon(z.von);
    setBis(z.bis);
  }
  const text = schnellwahl
    ? SCHNELLWAHL_LABEL[schnellwahl]
    : zeitraumKurz(von, bis) || null;
  return {
    schnellwahl,
    von,
    bis,
    waehlen,
    setVon: (v: string) => {
      setSchnellwahl(null);
      setVon(v);
    },
    setBis: (v: string) => {
      setSchnellwahl(null);
      setBis(v);
    },
    setzen: (v: string, b: string) => {
      setSchnellwahl(null);
      setVon(v);
      setBis(b);
    },
    text,
    aktiv: Boolean(von || bis),
    /** Weicht vom Startwert ab -- nur dann ist "Zuruecksetzen" sinnvoll. */
    geaendert: schnellwahl !== start,
    zuruecksetzen: () => waehlen(start),
    ungueltig: Boolean(von && bis && von > bis),
    /** Liegt der ISO-Tag (yyyy-mm-dd) im gewaehlten Zeitraum? Offene Grenzen zaehlen als unbegrenzt. */
    enthaelt: (tag: string) => (!von || tag >= von) && (!bis || tag <= bis),
  };
}

export function ZeitraumFilter({ zeitraum, idPrefix, label = "Zeitraum" }: { zeitraum: ReturnType<typeof useZeitraum>; idPrefix: string; label?: string }) {
  return (
    <FilterPille
      icon={<IKalender />}
      label={label}
      breit
      wert={zeitraum.aktiv ? (zeitraum.text ? `: ${zeitraum.text}` : "") : null}
      onEntfernen={() => zeitraum.waehlen("alle")}
    >
      {(schliessen) => (
        <ZeitraumAuswahl
          idPraefix={idPrefix}
          schnellwahl={zeitraum.schnellwahl}
          von={zeitraum.von}
          bis={zeitraum.bis}
          onSchnellwahl={(w) => {
            zeitraum.waehlen(w);
            schliessen();
          }}
          onUebernehmen={(v, b) => {
            zeitraum.setzen(v, b);
            schliessen();
          }}
        />
      )}
    </FilterPille>
  );
}

/** Suchtext normalisieren und gegen mehrere Felder pruefen (Gross-/Kleinschreibung egal). */
export function trifftSuche(suche: string, felder: (string | null | undefined)[]): boolean {
  const q = suche.trim().toLocaleLowerCase("de");
  return !q || felder.some((f) => (f ?? "").toLocaleLowerCase("de").includes(q));
}

/**
 * Standortwahl als Pille der Filterleiste -- loest die frueheren
 * Unterstrich-Reiter ab. Rueckmeldung aus dem Betrieb: die
 * Reiterleiste wirkte bei vielen Standorten unruhig und sah anders aus als
 * jede andere Liste. Als Pille steht der Standort dort, wo auch alle anderen
 * Einschraenkungen stehen, und die Liste der Standorte ist durchsuchbar.
 *
 * `pflicht`: Seiten, die immer genau einen Standort zeigen (Belegung),
 * bekommen weder Entfernen-Kreuz noch "Alle Standorte". Ohne `pflicht`
 * heisst "kein Wert" = alle.
 * Unter zwei Standorten gibt es nichts zu waehlen -- dann keine Pille.
 */
const ALLE_STANDORTE = "__alle__";

export function StandortFilter({
  standorte,
  gewaehlt,
  onWaehlen,
  pflicht,
}: {
  /** zaehler: kurzer Zusatz wie "9/10" (belegte/vorhandene Plaetze). */
  standorte: { id: string; name: string; zaehler?: string }[];
  gewaehlt: string | null;
  onWaehlen: (id: string | null) => void;
  pflicht?: boolean;
}) {
  if (standorte.length < 2) return null;
  const aktuell = gewaehlt ? standorte.find((s) => s.id === gewaehlt) : undefined;
  const optionen = [
    ...(pflicht ? [] : [{ wert: ALLE_STANDORTE, label: "Alle Standorte" }]),
    ...standorte.map((s) => ({ wert: s.id, label: s.zaehler ? `${s.name} · ${s.zaehler}` : s.name })),
  ];
  return (
    <FilterPille
      icon={<IStandort />}
      label="Standort"
      wert={aktuell ? `: ${aktuell.name}` : null}
      onEntfernen={pflicht ? undefined : () => onWaehlen(null)}
    >
      {(schliessen) => (
        <FilterAuswahl
          optionen={optionen}
          gewaehlt={gewaehlt ?? ALLE_STANDORTE}
          onWaehlen={(w) => {
            onWaehlen(w === ALLE_STANDORTE ? null : w);
            schliessen();
          }}
        />
      )}
    </FilterPille>
  );
}

/**
 * Standortwahl mit Mehrfachauswahl (Belegung). Leere Auswahl = alle
 * Standorte, gruppiert. Rueckmeldung aus dem Betrieb: man will den Filter
 * loeschen koennen und dann alle Standorte sauber gruppiert sehen, oder
 * gezielt zwei, drei Haeuser nebeneinander. Das Kreuz leert die Auswahl,
 * statt wie frueher auf einem Pflicht-Standort stehen zu bleiben.
 */
export function StandortMehrfachFilter({
  standorte,
  gewaehlt,
  onAendern,
}: {
  /** zaehler: kurzer Zusatz wie "9/10" (belegte/vorhandene Plaetze). */
  standorte: { id: string; name: string; zaehler?: string }[];
  gewaehlt: string[];
  onAendern: (ids: string[]) => void;
}) {
  if (standorte.length < 2) return null;
  const namen = standorte.filter((s) => gewaehlt.includes(s.id)).map((s) => s.name);
  const wert = namen.length === 0 ? null : namen.length === 1 ? `: ${namen[0]}` : `: ${namen.length} Standorte`;
  return (
    <FilterPille icon={<IStandort />} label="Standort" wert={wert} onEntfernen={() => onAendern([])}>
      {() => (
        <FilterMehrfachAuswahl
          optionen={standorte.map((s) => ({ wert: s.id, label: s.zaehler ? `${s.name} · ${s.zaehler}` : s.name }))}
          gewaehlt={gewaehlt}
          onAendern={onAendern}
        />
      )}
    </FilterPille>
  );
}
