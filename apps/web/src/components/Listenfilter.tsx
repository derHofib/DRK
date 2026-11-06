import { ReactNode, useState } from "react";
import { formatDatum } from "../format";
import { SCHNELLWAHL_LABEL, type Schnellwahl, zeitraumFuer } from "../pages/tagesberichte-filter";
import { AktionsMenue } from "./AktionsMenue";
import { FilterAuswahl, FilterPille } from "./Filterleiste";
import { IFilterLoeschen, IKalender, INeu, ISortierung, ISuche } from "./icons";

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
export function useZeitraum() {
  const [schnellwahl, setSchnellwahl] = useState<Schnellwahl | null>("alle");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  function waehlen(wahl: Schnellwahl) {
    const z = zeitraumFuer(wahl);
    setSchnellwahl(wahl);
    setVon(z.von);
    setBis(z.bis);
  }
  const text = schnellwahl
    ? SCHNELLWAHL_LABEL[schnellwahl]
    : [von && formatDatum(von), bis && formatDatum(bis)].filter(Boolean).join(" – ") || null;
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
    text,
    aktiv: Boolean(von || bis),
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
      wert={zeitraum.aktiv ? (zeitraum.text ? `: ${zeitraum.text}` : "") : null}
      onEntfernen={() => zeitraum.waehlen("alle")}
    >
      {(schliessen) => (
        <>
          <FilterAuswahl
            optionen={(Object.keys(SCHNELLWAHL_LABEL) as Schnellwahl[]).map((w) => ({ wert: w, label: SCHNELLWAHL_LABEL[w] }))}
            gewaehlt={zeitraum.schnellwahl}
            onWaehlen={(w) => {
              zeitraum.waehlen(w);
              schliessen();
            }}
          />
          <div className="zv-filter-datumsfelder">
            <div className="zv-field">
              <label htmlFor={`${idPrefix}-von`}>Von</label>
              <input
                id={`${idPrefix}-von`}
                type="date"
                value={zeitraum.von}
                max={zeitraum.bis || undefined}
                onChange={(e) => zeitraum.setVon(e.target.value)}
              />
            </div>
            <div className="zv-field">
              <label htmlFor={`${idPrefix}-bis`}>Bis</label>
              <input
                id={`${idPrefix}-bis`}
                type="date"
                value={zeitraum.bis}
                min={zeitraum.von || undefined}
                onChange={(e) => zeitraum.setBis(e.target.value)}
              />
            </div>
          </div>
        </>
      )}
    </FilterPille>
  );
}

/** Suchtext normalisieren und gegen mehrere Felder pruefen (Gross-/Kleinschreibung egal). */
export function trifftSuche(suche: string, felder: (string | null | undefined)[]): boolean {
  const q = suche.trim().toLocaleLowerCase("de");
  return !q || felder.some((f) => (f ?? "").toLocaleLowerCase("de").includes(q));
}
