import { DragEvent, KeyboardEvent } from "react";
import { ORG_UNIT_TYP_LABEL } from "@zimmerakte/shared";
import {
  IAufklappen,
  IBereichTeam,
  IPosition,
  IStabsstelle,
  ITraeger,
  IVerknuepft,
  IVerschiebenLinks,
  IVerschiebenRechts,
  IZiehen,
  IZuklappen,
} from "../../components/icons";
import {
  BOX_BREITE,
  BOX_HOEHE,
  type Knoten,
  PLATZKARTEN_LUECKE,
  SPALTEN_SCHRITT,
  besetzteNamen,
  istZiehbar,
  knotenHoehe,
  platzkarten,
  positionsStatus,
} from "./baum";

export function KnotenBox({
  knoten,
  yJeTiefe,
  accountTypNamen,
  ausgewaehlt,
  onOeffnen,
  ziehtGerade,
  istZielMoeglich,
  istZielAktuell,
  einfuegeAn,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onKollabierenUmschalten,
}: {
  knoten: Knoten;
  yJeTiefe: number[];
  accountTypNamen: Map<string, string>;
  ausgewaehlt: boolean;
  onOeffnen: () => void;
  ziehtGerade: boolean;
  istZielMoeglich: boolean;
  istZielAktuell: boolean;
  einfuegeAn: "vor" | "nach" | null;
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onKollabierenUmschalten: (() => void) | null;
}) {
  const links = knoten.x * SPALTEN_SCHRITT + (SPALTEN_SCHRITT - BOX_BREITE) / 2;
  const oben = yJeTiefe[knoten.tiefe] ?? 0;
  const hoehe = knotenHoehe(knoten);
  const stil = { left: links, top: oben, width: BOX_BREITE, height: hoehe };
  const ziehbar = istZiehbar(knoten);
  // Knoten sind div[role=button], kein <button> -- der Ein-/Ausklapp-Knopf
  // steckt als echtes <button> darin, und zwei verschachtelte <button>
  // sind ungueltiges HTML (React warnt: validateDOMNesting). Deshalb hier
  // die Tastatur-Aktivierung manuell nachgebaut.
  function beiKnotenTaste(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOeffnen();
    }
  }
  const zugsKlassen = `${ziehtGerade ? " zv-organigramm-knoten-zieht" : ""}${
    istZielMoeglich ? " zv-organigramm-knoten-ziel-moeglich" : ""
  }${istZielAktuell ? " zv-organigramm-knoten-ziel-aktuell" : ""}${
    einfuegeAn ? ` zv-organigramm-knoten-einfuegen-${einfuegeAn}` : ""
  }`;
  const ziehGriff = ziehbar && (
    <span className="zv-organigramm-knoten-griff" aria-hidden="true">
      <IZiehen />
    </span>
  );
  const kollabierenKnopf = onKollabierenUmschalten && (
    <button
      type="button"
      className="zv-organigramm-knoten-kollabieren"
      onClick={(e) => {
        e.stopPropagation();
        onKollabierenUmschalten();
      }}
      aria-label={knoten.versteckteNachkommen ? "Teilbaum einblenden" : "Teilbaum ausblenden"}
      title={knoten.versteckteNachkommen ? "Teilbaum einblenden" : "Teilbaum ausblenden"}
    >
      {knoten.versteckteNachkommen ? <IAufklappen /> : <IZuklappen />}
    </button>
  );
  const verstecktHinweis = knoten.versteckteNachkommen ? (
    <span className="zv-pill zv-pill-neutral zv-organigramm-knoten-versteckt">+{knoten.versteckteNachkommen}</span>
  ) : null;

  if (knoten.art === "einheit") {
    const u = knoten.einheit!;
    const Icon = u.typ === "traeger" || u.typ === "einrichtung" ? ITraeger : IBereichTeam;
    return (
      <div
        role="button"
        tabIndex={0}
        style={stil}
        draggable={ziehbar}
        onClick={onOeffnen}
        onKeyDown={beiKnotenTaste}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={`zv-organigramm-knoten zv-organigramm-knoten-einheit${u.aktiv ? "" : " zv-organigramm-knoten-inaktiv"}${ausgewaehlt ? " zv-organigramm-knoten-aktiv" : ""}${zugsKlassen}`}
      >
        {ziehGriff}
        {kollabierenKnopf}
        <div className="zv-organigramm-knoten-kopf">
          <Icon />
          <span className="zv-organigramm-knoten-titel">{u.name}</span>
        </div>
        <span className="zv-organigramm-knoten-sub">
          {ORG_UNIT_TYP_LABEL[u.typ]}
          {!u.aktiv && " · inaktiv"}
        </span>
        {verstecktHinweis}
      </div>
    );
  }

  const p = knoten.position!;
  const status = positionsStatus(p);
  const { namen, ausgeblendet: namenAusgeblendet } = besetzteNamen(p);
  const Icon = p.typ === "stabsstelle" ? IStabsstelle : IPosition;
  // Eine Karte je Mitarbeiter (Live-Rueckmeldung): mindestens eine
  // Platzkarte ("Vakant"/"Geplant"), sonst eine je tatsaechlich besetztem
  // Platz -- gestapelt, siehe knotenHoehe()/platzkarten() oben.
  const anzahlKarten = platzkarten(knoten);
  const zeilen: (string | null)[] = anzahlKarten === 1 ? [namen[0] ?? null] : namen.length > 0 ? namen : [null];
  while (zeilen.length < anzahlKarten) zeilen.push(null);

  return (
    <div style={{ position: "absolute", left: links, top: oben, width: BOX_BREITE, height: hoehe }}>
      {zeilen.map((name, i) => (
        <div
          key={knoten.position!.besetztMit[i]?.besetzungId ?? `leer-${i}`}
          role="button"
          tabIndex={0}
          style={{ position: "absolute", top: i * (BOX_HOEHE + PLATZKARTEN_LUECKE), left: 0, width: BOX_BREITE, height: BOX_HOEHE }}
          draggable={ziehbar}
          onClick={onOeffnen}
          onKeyDown={beiKnotenTaste}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          className={`zv-organigramm-knoten zv-organigramm-knoten-position${
            p.typ === "stabsstelle" ? " zv-organigramm-knoten-stabsstelle" : ""
          }${!p.aktiv ? " zv-organigramm-knoten-inaktiv" : ""}${ausgewaehlt ? " zv-organigramm-knoten-aktiv" : ""}${zugsKlassen}`}
        >
          {i === 0 && ziehGriff}
          {i === 0 && kollabierenKnopf}
          <div className="zv-organigramm-knoten-kopf">
            <Icon />
            <span className="zv-organigramm-knoten-titel">{p.titel}</span>
            {knoten.istWeitereZuordnung && (
              <span title="Weitere Organisationseinheit derselben Position" aria-hidden="true">
                <IVerknuepft />
              </span>
            )}
          </div>
          <span className="zv-organigramm-knoten-sub">
            {accountTypNamen.get(p.accountTypId) ?? "?"}
            {p.typ === "stabsstelle" && " · Stabsstelle"}
            {!p.aktiv && " · inaktiv"}
          </span>
          <span className={`zv-pill ${status.klasse}`}>{status.label}</span>
          {name && <span className="zv-organigramm-knoten-namen">{name}</span>}
          {!name && namenAusgeblendet && anzahlKarten === 1 && (
            <span className="zv-organigramm-knoten-namen">Namen ausgeblendet</span>
          )}
          {i === 0 && verstecktHinweis}
        </div>
      ))}
    </div>
  );
}

export function Verbindungen({ knoten, yJeTiefe }: { knoten: Knoten[]; yJeTiefe: number[] }) {
  const pfade: string[] = [];
  for (const k of knoten) {
    const px = k.x * SPALTEN_SCHRITT + SPALTEN_SCHRITT / 2;
    const py = (yJeTiefe[k.tiefe] ?? 0) + knotenHoehe(k);
    for (const kind of k.kinder) {
      const cx = kind.x * SPALTEN_SCHRITT + SPALTEN_SCHRITT / 2;
      const cy = yJeTiefe[kind.tiefe] ?? 0;
      const midY = py + (cy - py) / 2;
      pfade.push(`M ${px} ${py} V ${midY} H ${cx} V ${cy}`);
    }
  }
  return (
    <svg className="zv-organigramm-verbindungen">
      {pfade.map((d, i) => (
        <path key={i} d={d} className="zv-organigramm-linie" />
      ))}
    </svg>
  );
}

export interface GeschwisterInfo {
  eltern: Knoten;
  liste: Knoten[];
  index: number;
}

/**
 * "Nach links/rechts"-Knöpfe -- Tastatur-/Klick-Alternative zum Drag für
 * die Geschwister-Reihenfolge (Live-Rückmeldung: "ich möchte sie selbst
 * sortieren können"), gleiches Prinzip wie die Auf/Ab-Knöpfe in
 * Einstellungen.tsx::MenuReihenfolge -- nur horizontal, weil Geschwister
 * im Organigramm nebeneinander stehen, nicht untereinander. Erscheint nur,
 * wenn es überhaupt mehr als ein Geschwister gibt.
 */
export function GeschwisterButtons({
  geschwister,
  aufVerschieben,
}: {
  geschwister: GeschwisterInfo | null;
  aufVerschieben: (richtung: "links" | "rechts") => Promise<void>;
}) {
  if (!geschwister || geschwister.liste.length < 2) return null;
  return (
    <>
      <button
        className="zv-btn zv-btn-still"
        type="button"
        onClick={() => aufVerschieben("links")}
        disabled={geschwister.index === 0}
        aria-label="In der Reihenfolge nach links verschieben"
        title="Nach links"
      >
        <IVerschiebenLinks />
      </button>
      <button
        className="zv-btn zv-btn-still"
        type="button"
        onClick={() => aufVerschieben("rechts")}
        disabled={geschwister.index === geschwister.liste.length - 1}
        aria-label="In der Reihenfolge nach rechts verschieben"
        title="Nach rechts"
      >
        <IVerschiebenRechts />
      </button>
    </>
  );
}
