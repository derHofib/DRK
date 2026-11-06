/**
 * Zeichnung der Katze (Vorlage: Fotos von Dennis' Katze -- rot getigert mit
 * Weiss: Blesse, weisse Schnauze, Brust, Bauch und Pfoten, geringelter
 * Schwanz, rosa Nase, bernsteinfarbene Augen). Alle Posen blicken nach
 * rechts und stehen mit den Fuessen auf y = 96 (viewBox 160 x 100); das
 * Spiegeln uebernimmt die Komponente.
 *
 * Farben ausschliesslich ueber Klassen -> Tokens (siehe app.css), nie als
 * Literal im SVG.
 */

type Augen = "auf" | "halb" | "zu";

export function Kopf({ augen = "auf" }: { augen?: Augen }) {
  return (
    <g>
      {/* Ohren: gross und aufrecht, innen rosa */}
      <path className="k-fell" d="M-11 -6 L-12 -25 L0 -13 Z" />
      <path className="k-ohr" d="M-9.5 -9 L-10 -20 L-3.5 -13 Z" />
      <path className="k-fell" d="M3 -13 L13 -25 L14 -5 Z" />
      <path className="k-ohr" d="M5 -13 L11.5 -21 L12 -9 Z" />
      <ellipse className="k-fell" cx="0" cy="0" rx="14.5" ry="13" />
      {/* Tabby-"M" und Wangenstreifen */}
      <path className="k-streifen k-duenn" d="M-5 -12 L-3.5 -7 M-1 -13 L-0.5 -8 M-9 -9 L-8 -5 M-13 3 L-8 4 M-13 7.5 L-8 6.5" />
      {/* Blesse von der Stirn zur Schnauze, weisses Kinn */}
      <path className="k-weiss" d="M4 -12.5 C6 -6 6 -1 9 4 L16 4 C14 -3 11 -9 9.5 -12.5 Z" />
      <ellipse className="k-weiss" cx="8.5" cy="6.5" rx="8" ry="5.8" />
      <ellipse className="k-weiss" cx="6" cy="10" rx="6" ry="3.2" />
      <path className="k-ohr" d="M12 2.6 L16.5 2.6 L14.2 5.8 Z" />
      <path className="k-linie" d="M14.2 5.8 L14.2 8 M14.2 8 Q11.8 10.8 8.5 9.5 M14.2 8 Q16 10.4 18 9" />
      <g className="k-augen">
        {augen === "zu" ? (
          <path className="k-linie" d="M-0.5 -3 Q2.5 0 5.5 -3 M8 -3 Q11 0 14 -3" />
        ) : (
          <>
            <ellipse className="k-auge" cx="2.6" cy="-3" rx="3.3" ry={augen === "halb" ? 1.7 : 3.5} />
            <ellipse className="k-pupille" cx="3.1" cy="-3" rx="1" ry={augen === "halb" ? 1.5 : 3} />
            <ellipse className="k-auge" cx="10.8" cy="-3" rx="2.9" ry={augen === "halb" ? 1.5 : 3.2} />
            <ellipse className="k-pupille" cx="11.2" cy="-3" rx="0.9" ry={augen === "halb" ? 1.3 : 2.8} />
            {augen === "halb" && <path className="k-linie" d="M-0.5 -3.6 Q2.6 -5.5 5.8 -3.6 M8 -3.6 Q10.8 -5.2 13.8 -3.6" />}
          </>
        )}
      </g>
      <path className="k-linie k-schnurr" d="M17 5 L31 1.5 M17 7 L31 8 M16 6 L30 5" />
    </g>
  );
}

/** Geringelter Schwanz: Grundstrich plus abgesetzte Ringe, helle Spitze. */
function Schwanz({ d, className = "" }: { d: string; className?: string }) {
  return (
    <g className={className}>
      <path className="k-schwanz" d={d} />
      <path className="k-schwanz-ringe" d={d} />
    </g>
  );
}

/** Bein mit weisser "Socke": gleiche Bounding-Box fuer den Schwingpunkt oben. */
function Bein({ x, y = 60, h = 34, dunkel = false, className }: { x: number; y?: number; h?: number; dunkel?: boolean; className: string }) {
  return (
    <g className={`k-bein ${className}`}>
      <rect className={dunkel ? "k-fell-dunkel" : "k-fell"} x={x} y={y} width="6.5" height={h} rx="3.2" />
      <rect className="k-weiss" x={x - 0.3} y={y + h - 15} width="7.1" height="14" rx="3.2" />
      <ellipse className="k-weiss" cx={x + 3.2} cy={y + h - 1.5} rx="5.2" ry="2.8" />
    </g>
  );
}

export function PoseGehen() {
  return (
    <>
      <Schwanz className="k-schwanz-g" d="M32 52 C14 52 8 38 14 26" />
      <Bein x={34} y={58} h={37} dunkel className="k-bein-a" />
      <Bein x={92} y={60} h={35} dunkel className="k-bein-b" />
      <g className="k-koerper">
        <path
          className="k-fell"
          d="M26 54 C26 44 42 39 62 40 C82 41 98 43 108 48 C113 54 110 63 100 65 C84 67 50 67 38 65 C30 63 26 60 26 54Z"
        />
        <path className="k-weiss" d="M46 65 C60 71 88 71 102 64 C92 66 58 66 46 65Z" />
        <ellipse className="k-weiss" cx="104" cy="60" rx="8" ry="8" />
        <ellipse className="k-weiss" cx="70" cy="50" rx="9" ry="4.5" opacity="0.95" />
        <path className="k-streifen" d="M44 41 Q46 48 42 54 M56 40 Q59 47 54 55 M84 41 Q87 47 82 53 M96 44 Q98 49 95 53" />
        <ellipse className="k-fell" cx="42" cy="56" rx="15" ry="11" />
        <path className="k-streifen k-duenn" d="M30 54 C34 46 48 46 54 56" />
        <ellipse className="k-fell" cx="110" cy="50" rx="9" ry="9" />
        <g transform="translate(124 45) rotate(8) scale(.95)">
          <Kopf />
        </g>
      </g>
      <Bein x={50} y={60} h={35} className="k-bein-b" />
      <Bein x={104} y={60} h={35} className="k-bein-a k-bein-vn" />
    </>
  );
}

function SitzKoerper({ vorderbein }: { vorderbein: boolean }) {
  return (
    <>
      <Schwanz d="M36 93 C58 100 104 100 118 94 C124 92 124 86 120 84" />
      <path className="k-fell" d="M38 94 C32 70 44 46 70 38 C86 33 98 40 98 58 L96 94 Z" />
      <ellipse className="k-fell" cx="50" cy="78" rx="20" ry="17" />
      <path className="k-streifen k-duenn" d="M35 74 C40 62 58 62 66 76" />
      <path className="k-streifen" d="M52 47 Q58 56 54 64 M64 41 Q71 52 66 61 M76 38 Q82 47 78 55" />
      <ellipse className="k-weiss" cx="62" cy="94.5" rx="10" ry="3.6" />
      <path className="k-weiss" d="M88 46 C98 52 99 72 96 94 L84 94 C86 76 84 60 88 46Z" />
      <g>
        <rect className="k-fell-dunkel" x="95" y="62" width="6.5" height="32" rx="3.2" />
        <rect className="k-weiss" x="94.7" y="79" width="7.1" height="15" rx="3.2" />
        <ellipse className="k-weiss" cx="98.2" cy="94.5" rx="5.5" ry="3" />
      </g>
      {vorderbein && (
        <g>
          <rect className="k-fell" x="86" y="62" width="6.5" height="32" rx="3.2" />
          <rect className="k-weiss" x="85.7" y="79" width="7.1" height="15" rx="3.2" />
          <ellipse className="k-weiss" cx="89.2" cy="94.5" rx="5.5" ry="3" />
        </g>
      )}
    </>
  );
}

export function PoseSitzen() {
  return (
    <>
      <SitzKoerper vorderbein />
      <g className="k-kopf" transform="translate(88 31)">
        <Kopf />
      </g>
    </>
  );
}

export function PosePutzen() {
  return (
    <>
      <SitzKoerper vorderbein={false} />
      <g transform="translate(92 36) rotate(22)">
        <Kopf augen="zu" />
      </g>
      <g className="k-pfote">
        <path className="k-bein-linie" d="M88 64 L102 46" />
        <ellipse className="k-weiss" cx="103.5" cy="44.5" rx="5" ry="3.8" />
      </g>
    </>
  );
}

/** Brotlaib (Foto 2): liegend, Pfoten eingeschlagen, Kopf oben. */
export function PoseBrotlaib() {
  return (
    <g className="k-atmen">
      <Schwanz d="M22 93 C40 99 98 99 116 94" />
      <path
        className="k-fell"
        d="M20 94 C14 78 32 64 60 63 C84 62 98 68 102 82 C104 92 100 95 92 95 L28 95 C24 95 21 95 20 94Z"
      />
      <path className="k-streifen" d="M38 66 Q42 76 36 86 M54 63 Q58 74 52 85 M70 63 Q74 73 69 83" />
      <ellipse className="k-fell" cx="34" cy="82" rx="15" ry="12" />
      <path className="k-streifen k-duenn" d="M22 80 C26 72 42 72 47 83" />
      <ellipse className="k-weiss" cx="30" cy="94" rx="9" ry="3" />
      <path className="k-weiss" d="M90 70 C102 74 106 86 104 94 L88 94 C90 86 88 78 90 70Z" />
      <ellipse className="k-weiss" cx="110" cy="94" rx="11" ry="3.4" />
      <ellipse className="k-weiss" cx="122" cy="93.5" rx="7" ry="3" />
      <g className="k-kopf" transform="translate(100 62) rotate(6)">
        <Kopf augen="halb" />
      </g>
    </g>
  );
}

/** Eingerollt (Foto 1): Kugel, Pfote ueber dem Gesicht, Schwanz um den Koerper. */
export function PoseSchlafen() {
  return (
    <g className="k-atmen">
      <path
        className="k-fell"
        d="M16 92 C10 70 30 52 66 52 C102 52 124 66 124 84 C124 93 118 96 108 96 L26 96 C20 96 17 95 16 92Z"
      />
      <path className="k-streifen" d="M38 56 Q44 70 36 84 M56 53 Q62 68 54 84 M74 52 Q80 67 72 83 M92 54 Q96 66 90 78" />
      <ellipse className="k-weiss" cx="94" cy="86" rx="14" ry="8" />
      <Schwanz d="M22 92 C42 101 100 101 120 91 C128 87 126 80 120 80" />
      <g transform="translate(104 74) rotate(14)">
        <Kopf augen="zu" />
      </g>
      <ellipse className="k-weiss" cx="104" cy="70" rx="10" ry="5" transform="rotate(-18 104 70)" />
      <path className="k-linie k-duenn" d="M98 70 L110 67 M98 73 L110 70" opacity="0.4" />
      <text className="k-zzz k-zzz-1" x="130" y="58">z</text>
      <text className="k-zzz k-zzz-2" x="138" y="47">z</text>
      <text className="k-zzz k-zzz-3" x="145" y="35">z</text>
    </g>
  );
}

/** Auf dem Ruecken (Foto 3): weisser Bauch oben, Pfoten angewinkelt, Kopf verkehrt herum. */
export function PoseRuecken() {
  return (
    <g className="k-raekeln">
      <Schwanz d="M20 90 C8 92 0 88 -4 80" />
      <ellipse className="k-fell" cx="66" cy="84" rx="46" ry="12" />
      <path className="k-weiss" d="M22 80 C36 66 90 62 108 78 C92 74 38 74 22 80Z" />
      <ellipse className="k-weiss" cx="66" cy="74" rx="38" ry="8" />
      <path className="k-streifen" d="M30 88 Q36 92 44 92 M52 92 Q60 95 70 94" />
      <g className="k-bein-r1">
        <path className="k-bein-linie k-weiss-strich" d="M44 70 L50 52" />
        <ellipse className="k-weiss" cx="51" cy="49.5" rx="4.5" ry="3.4" />
      </g>
      <g className="k-bein-r2">
        <path className="k-bein-linie k-weiss-strich" d="M86 70 L96 54" />
        <ellipse className="k-weiss" cx="97.5" cy="51.5" rx="4.5" ry="3.4" />
      </g>
      <path className="k-bein-linie" d="M28 80 L16 62" />
      <ellipse className="k-weiss" cx="14.5" cy="60" rx="5" ry="3.6" />
      <g className="k-kopf" transform="translate(122 80) rotate(172)">
        <Kopf />
      </g>
    </g>
  );
}

/** Hocke vor dem Sprung: Brust tief, Hinterhand hoch, Blick aufs Ziel. */
export function PoseHocke() {
  return (
    <>
      <Schwanz className="k-schwanz-zucken" d="M24 70 C10 74 4 84 2 92" />
      <path
        className="k-fell"
        d="M22 70 C22 58 40 56 58 62 C78 68 98 74 108 82 C110 90 104 94 92 94 C74 95 44 95 34 92 C26 90 22 80 22 70Z"
      />
      <path className="k-weiss" d="M60 92 C80 96 100 92 108 84 C104 92 80 94 60 92Z" />
      <path className="k-streifen" d="M34 60 Q38 70 32 80 M46 59 Q50 68 44 78 M60 64 Q64 72 58 80" />
      <ellipse className="k-fell" cx="38" cy="78" rx="15" ry="15" />
      <path className="k-streifen k-duenn" d="M26 76 C30 66 46 66 50 80" />
      <ellipse className="k-weiss" cx="46" cy="94" rx="10" ry="3.2" />
      <path className="k-bein-linie" d="M98 82 L116 92" />
      <ellipse className="k-weiss" cx="119" cy="93" rx="6" ry="3" />
      <path className="k-bein-linie k-dunkel-strich" d="M90 84 L108 94" />
      <g transform="translate(120 76) rotate(12)">
        <Kopf />
      </g>
    </>
  );
}

/** Flug: Koerper gestreckt, Vorderbeine vor, Hinterbeine zurueck, Schwanz als Ausgleich. */
export function PoseSprung() {
  return (
    <>
      <Schwanz d="M22 52 C10 50 2 44 -6 40" />
      <path className="k-bein-linie k-dunkel-strich" d="M40 62 L10 74" />
      <path className="k-bein-linie k-dunkel-strich" d="M112 60 L142 56" />
      <path
        className="k-fell"
        d="M20 56 C24 46 50 44 76 46 C98 48 112 50 118 56 C120 62 112 66 100 66 C76 68 44 68 30 64 C24 62 20 60 20 56Z"
      />
      <path className="k-weiss" d="M44 66 C62 70 90 70 106 64 C92 66 60 66 44 66Z" />
      <path className="k-streifen" d="M40 47 Q42 55 38 62 M56 46 Q59 55 54 64 M80 47 Q83 55 78 63" />
      <path className="k-bein-linie" d="M36 64 L6 80" />
      <ellipse className="k-weiss" cx="4" cy="81.5" rx="5.5" ry="3" transform="rotate(-25 4 81.5)" />
      <path className="k-bein-linie" d="M116 62 L146 62" />
      <ellipse className="k-weiss" cx="148.5" cy="62" rx="5.5" ry="3" />
      <g transform="translate(128 48) rotate(-6)">
        <Kopf />
      </g>
    </>
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
