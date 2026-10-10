import { CSSProperties } from "react";

/**
 * Das feste hecaso-Markenzeichen -- Haus-Umriss + Koralle-Sonnenbogen,
 * Pfaddaten unveraendert aus der Markenvorgabe uebernommen. Bewusst NICHT
 * ueber das Akzentsystem (--zv-accent-h/-c) eingefaerbt: die Markenfarbe ist
 * Produktidentitaet und bleibt unabhaengig von der je Mandant einstellbaren
 * Akzentfarbe -- siehe --zv-marke-haus/-sonne in tokens.css. Passt sich nur
 * dem Hell/Dunkel-Thema an.
 */
const ICON_VIEWBOX = "11.5 15.5 97 101";
const ICON_SEITENVERHAELTNIS = 101 / 97;

export function MarkenIcon({ groesse = 28, style }: { groesse?: number; style?: CSSProperties }) {
  return (
    <svg
      width={groesse}
      height={groesse * ICON_SEITENVERHAELTNIS}
      viewBox={ICON_VIEWBOX}
      fill="none"
      aria-hidden="true"
      style={{ flex: "none", ...style }}
    >
      <path
        d="M24 104 V58 L60 28 L96 58 V104 Z"
        stroke="var(--zv-marke-haus)"
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M40 97 A20 20 0 0 1 80 97 Z" fill="var(--zv-marke-sonne)" />
    </svg>
  );
}

/** Icon + "hecaso"-Schriftzug nebeneinander -- fuer Login-Titel, Sidebar, Topbar. */
export function MarkenZeichen({
  iconGroesse = 28,
  style,
}: {
  iconGroesse?: number;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: iconGroesse * 0.3, ...style }}>
      <MarkenIcon groesse={iconGroesse} />
      <span
        style={{
          fontFamily: "var(--zv-font-marke)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--zv-marke-haus)",
        }}
      >
        hecaso
      </span>
    </span>
  );
}
