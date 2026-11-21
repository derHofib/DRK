import { type MutableRefObject, useId } from "react";

/**
 * Die Huelle der Katze (Vorlage: Fotos von Dennis' Katze -- rot getigert mit
 * Weiss: Blesse, weisse Schnauze, Brust, Bauch und Pfoten, geringelter
 * Schwanz, rosa Nase, bernsteinfarbene Augen).
 *
 * Hier stehen nur die Teile; Rumpf, Beine und Schwanz haben absichtlich leere
 * Pfade. Ihre Form rechnet katzen-rig.ts in jedem Frame aus der Haltung --
 * deshalb gibt es keine fertig gezeichneten Posen mehr. Fest gezeichnet sind
 * nur die beiden Koepfe (Profil und von vorn), zwischen denen ueberblendet
 * wird, wenn sie den Kopf zum Betrachter dreht.
 *
 * Farben ausschliesslich ueber Klassen -> Tokens (siehe app.css), nie als
 * Literal im SVG.
 */

function Bein({ i }: { i: number }) {
  return (
    <g className={`k-b${i} ${i >= 2 ? "k-fern" : "k-nah"}`}>
      <path className="k-b-oben k-glied" d="" />
      <path className="k-b-mitte k-glied" d="" />
      <path className="k-b-unten k-glied" d="" />
      <path className="k-b-socke k-weiss" d="" />
      <ellipse className="k-g-pfote k-weiss" cx="0" cy="0" rx="3.9" ry="2.3" />
    </g>
  );
}

function Auge({ x, y, kipp = 0 }: { x: number; y: number; kipp?: number }) {
  return (
    <g className="k-auge-g" data-x={x} data-y={y} transform={`translate(${x} ${y})`}>
      <g transform={`rotate(${kipp})`}>
        <path className="k-auge" d="M-2.8 0.4C-1.7 -2.3 1.5 -2.5 2.8 -0.4C1.5 2 -1.5 2.2 -2.8 0.4Z" />
        <ellipse className="k-pupille" cx="0" cy="0" rx="0.6" ry="1.9" />
        <path className="k-linie k-fein" d="M-2.9 0.3C-1.7 -2.5 1.6 -2.7 2.9 -0.5" />
        <circle className="k-glanz" cx="0.8" cy="-0.8" r="0.45" />
      </g>
    </g>
  );
}

function KopfProfil() {
  return (
    <g className="k-kopf-profil">
      <g className="k-ohr-g" data-seite="1" data-x="5" data-y="-6">
        <path className="k-fell-dunkel" d="M1 -6.2C2 -10 3.6 -13.4 5.2 -15.6C6.8 -12.6 8 -9 8.4 -5.4Z" />
      </g>
      <path
        className="k-fell"
        d="M-8.6 0.4C-8.8 -5.2 -4.2 -8.4 1.2 -8.2C5.2 -8 7.9 -5.9 9.6 -3.2C10.6 -1.9 12 -1.2 12.9 -0.2C13.5 0.6 13.3 1.7 12.6 2.3C12.2 3.2 11.9 4.2 11.2 5C9 7.2 4.6 8.3 0.2 7.9C-4.8 7.5 -8.5 5.2 -8.6 0.4Z"
      />
      <path className="k-streifen k-fein" d="M0.2 -7.6L1.3 -4.6M3.2 -7.5L3.9 -4.8M2.4 -0.4L-2.8 0.9M1.8 2.4L-3.4 3.8" />
      {/* Blesse am Nasenruecken, weisse Schnauze */}
      <path className="k-weiss" d="M6.2 -7C7.9 -5.7 8.9 -4.5 9.6 -3.2C10.6 -1.9 12 -1.2 12.9 -0.2C13.5 0.6 13.3 1.7 12.6 2.3L10.4 3.6C9 2.6 8.4 0.6 8 -1.4C7.6 -3.4 7 -5.2 6.2 -7Z" />
      <path className="k-rachen k-maul" d="M12.4 2.2L4.6 3.6L8.6 9.4Z" />
      <g className="k-kiefer">
        <path className="k-weiss" d="M12.6 2.3C12.2 3.2 11.9 4.2 11.2 5C9.6 6.6 7 7.6 4.2 7.9C4.2 6 5.2 4.4 6.8 3.5C8.6 2.6 10.8 2.6 12.6 2.3Z" />
      </g>
      <path className="k-nase" d="M11.7 -1L13.3 0.1L12.1 1.2Z" />
      <path className="k-linie k-fein" d="M12.3 1.5C11.6 2.9 10.2 3.6 8.6 3.6" />
      <Auge x={5.4} y={-1.8} kipp={-8} />
      <g className="k-ohr-g" data-seite="1" data-x="-1" data-y="-6">
        <path className="k-fell" d="M-6 -4.4C-6.4 -9.6 -4.6 -14.4 -2.7 -17C0 -14.2 2.6 -10.6 3.7 -6.6Z" />
        <path className="k-ohr" d="M-4.2 -6C-4.4 -9.8 -3.4 -12.8 -2.6 -14.4C-0.9 -12.2 0.7 -9.6 1.6 -7Z" />
      </g>
      <path className="k-linie k-schnurr" d="M10.4 3L18.4 1M10.2 3.8L18 5M9.8 4.6L16.2 8.4" />
    </g>
  );
}

function Ohr({ seite }: { seite: 1 | -1 }) {
  return (
    <g transform={seite === 1 ? undefined : "scale(-1 1)"}>
      <g className="k-ohr-g" data-seite="1" data-x="-5.5" data-y="-6">
        <path className="k-fell" d="M-9.4 -3.4C-10.6 -9 -10 -13.8 -8.6 -17C-5.4 -14.8 -2.6 -11.6 -1.2 -7.8Z" />
        <path className="k-ohr" d="M-8.2 -5.6C-8.8 -9.2 -8.4 -12.2 -7.8 -14C-5.9 -12.4 -4.3 -10.3 -3.3 -8Z" />
      </g>
    </g>
  );
}

function KopfVorn() {
  return (
    <g className="k-kopf-vorn">
      <Ohr seite={1} />
      <Ohr seite={-1} />
      <path
        className="k-fell"
        d="M0 -8.6C5.4 -8.6 9.8 -5.6 10.3 -0.6C10.7 2.4 9.5 4.5 7.4 6.1C5.4 7.8 2.8 8.6 0 8.6C-2.8 8.6 -5.4 7.8 -7.4 6.1C-9.5 4.5 -10.7 2.4 -10.3 -0.6C-9.8 -5.6 -5.4 -8.6 0 -8.6Z"
      />
      {/* Tabby-"M" und Wangenstreifen */}
      <path className="k-streifen k-fein" d="M-3.6 -8L-3 -5.2M-5.8 -7L-4.9 -4.6M3.6 -8L3 -5.2M5.8 -7L4.9 -4.6M-10 0.6L-7.2 1.2M-9.6 3L-7 3M10 0.6L7.2 1.2M9.6 3L7 3" />
      <path className="k-weiss" d="M-0.9 -8.5C-1.2 -5 -1.8 -2 -3.4 1.4L3.4 1.4C1.8 -2 1.2 -5 0.9 -8.5Z" />
      <ellipse className="k-weiss" cx="-2.7" cy="4" rx="3.8" ry="3.1" />
      <ellipse className="k-weiss" cx="2.7" cy="4" rx="3.8" ry="3.1" />
      <ellipse className="k-weiss" cx="0" cy="6.5" rx="3.2" ry="2.1" />
      <ellipse className="k-rachen k-maul" cx="0" cy="5.9" rx="2.3" ry="0.3" />
      <path className="k-nase" d="M-1.5 1.6L1.5 1.6L0 3.3Z" />
      <path className="k-linie k-fein" d="M0 3.3L0 4.3M0 4.3C-0.8 5.5 -2.3 5.5 -2.9 4.7M0 4.3C0.8 5.5 2.3 5.5 2.9 4.7" />
      <Auge x={-4.6} y={-1.6} kipp={8} />
      <Auge x={4.6} y={-1.6} kipp={-8} />
      <path className="k-linie k-schnurr" d="M-4.6 4L-14.5 2.2M-4.6 4.8L-14.5 5.8M-4.3 5.6L-12.8 8.8M4.6 4L14.5 2.2M4.6 4.8L14.5 5.8M4.3 5.6L12.8 8.8" />
    </g>
  );
}

const STREIFEN = [0, 1, 2, 3, 4, 5, 6, 7];

export function KatzenFigur({ rigRef }: { rigRef: MutableRefObject<SVGGElement | null> }) {
  // Eigene Kennungen je Figur: mit festen ids griffe jede weitere Katze im Dokument auf den Umriss der ersten zu.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rumpf = `zv-katze-rumpf-${id}`;
  const weichId = `zv-katze-weich-${id}`;
  return (
    <g ref={rigRef}>
      <defs>
        <clipPath id={rumpf}>
          <path className="k-clip" d="" />
        </clipPath>
        {/* Weiche Raender fuer Streifen und Bauchfell: Fell hat keine Kante. */}
        <filter id={weichId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
      </defs>
      <Bein i={2} />
      <Bein i={3} />
      <path className="k-koerper k-fell" d="" />
      <g clipPath={`url(#${rumpf})`}>
        <g filter={`url(#${weichId})`}>
          {STREIFEN.map((i) => (
            <path key={i} className="k-streif k-streifen" d="" />
          ))}
          <path className="k-bauch k-weiss" d="" />
          <ellipse className="k-fleck k-weiss" cx="0" cy="0" rx="4.2" ry="2.6" />
        </g>
      </g>
      <path className="k-schwanz-teil k-schwanz" d="" />
      <path className="k-schwanz-teil k-schwanz-ringe" d="" pathLength={1} />
      <path className="k-schwanz-teil k-schwanz-spitze" d="" pathLength={1} />
      <Bein i={0} />
      <Bein i={1} />
      <KopfProfil />
      <KopfVorn />
    </g>
  );
}

export function Wollknaeuel() {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" className="zv-wolle__svg">
      <path className="w-faden" d="M30 28 C38 30 40 36 34 38" />
      <circle className="w-kugel" cx="20" cy="20" r="16" />
      <path className="w-linie" d="M6 16 C14 10 26 12 34 20 M5 22 C14 16 28 18 34 26 M10 31 C16 24 26 24 31 30 M14 6 C12 16 16 28 24 35" />
    </svg>
  );
}
