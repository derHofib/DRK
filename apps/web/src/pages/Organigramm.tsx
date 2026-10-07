import { useEffect, useMemo, useState } from "react";
import type { AccountTypDto, OrgUnitDto, PositionDto } from "@zimmerakte/shared";
import { ORG_UNIT_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { IBereichTeam, IFehler, ILeerOrganigramm, IPosition, IStabsstelle, ITraeger } from "../components/icons";

/**
 * Ein Knoten im Organigramm -- entweder eine Organisationseinheit oder eine
 * Position. Beide Arten stehen bewusst im selben Baum (nicht zwei getrennte
 * Visualisierungen): eine Position haengt immer unter der Einheit, zu der
 * sie gehoert (org_unit_id), zusaetzlich -- wenn gesetzt -- unter einer
 * anderen Position derselben Einheit (parent_position_id), fuer eine lokale
 * Berichtshierarchie innerhalb der Einheit (z.B. Teamleitung ueber
 * Mitarbeiter-Positionen im selben Team).
 */
interface Knoten {
  schluessel: string;
  art: "einheit" | "position";
  einheit?: OrgUnitDto;
  position?: PositionDto;
  kinder: Knoten[];
  tiefe: number;
  x: number;
}

/**
 * parentPositionId, die auf eine Position AUSSERHALB der eigenen Einheit
 * zeigt, wird hier bewusst ignoriert (die Position haengt dann direkt unter
 * ihrer eigenen Einheit) -- die uebergeordnete Einheit ist im Baum ohnehin
 * schon verschachtelt sichtbar, eine zusaetzliche Verbindung quer durch den
 * Baum wuerde im einfachen Ebenen-Layout (s.u.) zu Ueberschneidungen
 * zwischen Teilbaeumen fuehren. Eine spaetere Drag&Drop-Ansicht kann das
 * bei Bedarf genauer darstellen.
 */
function baueBaum(orgUnits: OrgUnitDto[], positionen: PositionDto[]): Knoten | null {
  const einheitKnoten = new Map<string, Knoten>();
  for (const u of orgUnits) {
    einheitKnoten.set(u.id, { schluessel: `u:${u.id}`, art: "einheit", einheit: u, kinder: [], tiefe: 0, x: 0 });
  }
  let wurzel: Knoten | null = null;
  for (const u of orgUnits) {
    const knoten = einheitKnoten.get(u.id)!;
    if (u.parentId && einheitKnoten.has(u.parentId)) {
      einheitKnoten.get(u.parentId)!.kinder.push(knoten);
    } else {
      wurzel = knoten;
    }
  }
  if (!wurzel) return null;

  const positionenJeEinheit = new Map<string, PositionDto[]>();
  for (const p of positionen) {
    const liste = positionenJeEinheit.get(p.orgUnitId) ?? [];
    liste.push(p);
    positionenJeEinheit.set(p.orgUnitId, liste);
  }

  for (const [orgUnitId, liste] of positionenJeEinheit) {
    const einheit = einheitKnoten.get(orgUnitId);
    if (!einheit) continue;
    const posKnoten = new Map<string, Knoten>();
    for (const p of liste) {
      posKnoten.set(p.id, { schluessel: `p:${p.id}`, art: "position", position: p, kinder: [], tiefe: 0, x: 0 });
    }
    for (const p of liste) {
      const knoten = posKnoten.get(p.id)!;
      const elternId = p.parentPositionId;
      if (elternId && posKnoten.has(elternId)) {
        posKnoten.get(elternId)!.kinder.push(knoten);
      } else {
        einheit.kinder.push(knoten);
      }
    }
  }

  return wurzel;
}

/**
 * Einfaches, selbstgebautes Ebenen-Layout (kein Force-Simulation, keine
 * neue Graph-Library -- siehe Organigramm-Plan): Blaetter bekommen
 * aufsteigende, eindeutige Spalten in Durchlaufreihenfolge, jeder innere
 * Knoten wird ueber dem Mittel seiner Kinder zentriert. Das ist
 * ueberschneidungsfrei, solange jede Spalte dieselbe Breite hat (hier der
 * Fall) -- ein vollwertiger Tidy-Tree-Algorithmus waere fuer die hier
 * erwartete Knotenzahl (zwei- bis niedrig dreistellig) unnoetiger Aufwand.
 */
function layout(wurzel: Knoten): { breiteSpalten: number; tiefe: number } {
  let naechsteSpalte = 0;
  let maxTiefe = 0;
  function besuch(knoten: Knoten, tiefe: number) {
    knoten.tiefe = tiefe;
    maxTiefe = Math.max(maxTiefe, tiefe);
    if (knoten.kinder.length === 0) {
      knoten.x = naechsteSpalte;
      naechsteSpalte += 1;
      return;
    }
    for (const kind of knoten.kinder) besuch(kind, tiefe + 1);
    const erste = knoten.kinder[0].x;
    const letzte = knoten.kinder[knoten.kinder.length - 1].x;
    knoten.x = (erste + letzte) / 2;
  }
  besuch(wurzel, 0);
  return { breiteSpalten: naechsteSpalte, tiefe: maxTiefe };
}

const BOX_BREITE = 212;
const SPALTEN_SCHRITT = BOX_BREITE + 28;
// Hoch genug fuer eine Position mit allen vier Zeilen (Titel, Account-Typ,
// Status-Pill, Namen) OHNE dass der Spaltenflex etwas zusammenquetschen
// muss (siehe .zv-organigramm-knoten-sub/-namen in app.css) -- gemessen an
// den tatsaechlich gerenderten Zeilenhoehen, nicht geschaetzt.
const BOX_HOEHE = 112;
const ZEILEN_LUECKE = 48;
const ZEILEN_SCHRITT = BOX_HOEHE + ZEILEN_LUECKE;

function alleKnoten(wurzel: Knoten): Knoten[] {
  const ergebnis: Knoten[] = [];
  function besuch(k: Knoten) {
    ergebnis.push(k);
    for (const kind of k.kinder) besuch(kind);
  }
  besuch(wurzel);
  return ergebnis;
}

function positionsStatus(p: PositionDto): { label: string; klasse: string } {
  if (p.istGeplant) return { label: "Geplant (Platzhalter)", klasse: "zv-pill-info" };
  if (p.besetztMit.length === 0) return { label: "Vakant", klasse: "zv-pill-neutral" };
  if (p.besetztMit.length < p.sollBesetzung) {
    return { label: `Besetzt ${p.besetztMit.length}/${p.sollBesetzung}`, klasse: "zv-pill-teilweise" };
  }
  return { label: "Besetzt", klasse: "zv-pill-ok" };
}

function KnotenBox({ knoten, accountTypNamen }: { knoten: Knoten; accountTypNamen: Map<string, string> }) {
  const links = knoten.x * SPALTEN_SCHRITT + (SPALTEN_SCHRITT - BOX_BREITE) / 2;
  const oben = knoten.tiefe * ZEILEN_SCHRITT;
  const stil = { left: links, top: oben, width: BOX_BREITE, height: BOX_HOEHE };

  if (knoten.art === "einheit") {
    const u = knoten.einheit!;
    const Icon = u.typ === "traeger" || u.typ === "einrichtung" ? ITraeger : IBereichTeam;
    return (
      <div
        style={stil}
        className={`zv-organigramm-knoten zv-organigramm-knoten-einheit${u.aktiv ? "" : " zv-organigramm-knoten-inaktiv"}`}
      >
        <div className="zv-organigramm-knoten-kopf">
          <Icon />
          <span className="zv-organigramm-knoten-titel">{u.name}</span>
        </div>
        <span className="zv-organigramm-knoten-sub">
          {ORG_UNIT_TYP_LABEL[u.typ]}
          {!u.aktiv && " · inaktiv"}
        </span>
      </div>
    );
  }

  const p = knoten.position!;
  const status = positionsStatus(p);
  const namen = p.besetztMit.filter((b) => b.benutzerName !== null).map((b) => b.benutzerName as string);
  const namenAusgeblendet = p.besetztMit.length > 0 && namen.length === 0;
  const Icon = p.typ === "stabsstelle" ? IStabsstelle : IPosition;
  return (
    <div
      style={stil}
      className={`zv-organigramm-knoten zv-organigramm-knoten-position${
        p.typ === "stabsstelle" ? " zv-organigramm-knoten-stabsstelle" : ""
      }${!p.aktiv ? " zv-organigramm-knoten-inaktiv" : ""}`}
    >
      <div className="zv-organigramm-knoten-kopf">
        <Icon />
        <span className="zv-organigramm-knoten-titel">{p.titel}</span>
      </div>
      <span className="zv-organigramm-knoten-sub">
        {accountTypNamen.get(p.accountTypId) ?? "?"}
        {p.typ === "stabsstelle" && " · Stabsstelle"}
        {!p.aktiv && " · inaktiv"}
      </span>
      <span className={`zv-pill ${status.klasse}`}>{status.label}</span>
      {namen.length > 0 && <span className="zv-organigramm-knoten-namen">{namen.join(", ")}</span>}
      {namenAusgeblendet && <span className="zv-organigramm-knoten-namen">Namen ausgeblendet</span>}
    </div>
  );
}

function Verbindungen({ knoten }: { knoten: Knoten[] }) {
  const pfade: string[] = [];
  for (const k of knoten) {
    const px = k.x * SPALTEN_SCHRITT + SPALTEN_SCHRITT / 2;
    const py = k.tiefe * ZEILEN_SCHRITT + BOX_HOEHE;
    for (const kind of k.kinder) {
      const cx = kind.x * SPALTEN_SCHRITT + SPALTEN_SCHRITT / 2;
      const cy = kind.tiefe * ZEILEN_SCHRITT;
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

/**
 * Organigramm-Grundansicht (lesend) -- Organigramm-Plan, Lieferreihenfolge
 * Schritt 7/UI, erster Teilschritt. Seitenpanel, Drag & Drop,
 * Account-Typ-Verwaltung, "Anzeigen als…" und die Tabellenansicht folgen
 * als eigene, spaeter commitete Teilschritte.
 */
export function Organigramm() {
  const [orgUnits, setOrgUnits] = useState<OrgUnitDto[]>([]);
  const [positionen, setPositionen] = useState<PositionDto[]>([]);
  const [accountTypen, setAccountTypen] = useState<AccountTypDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    Promise.all([api.organigrammOrgUnits(), api.organigrammPositionen(), api.organigrammAccountTypen()])
      .then(([u, p, a]) => {
        setOrgUnits(u);
        setPositionen(p);
        setAccountTypen(a);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Organigramm konnte nicht geladen werden."))
      .finally(() => setGeladen(true));
  }, []);

  const accountTypNamen = useMemo(() => new Map(accountTypen.map((a) => [a.id, a.name])), [accountTypen]);

  const wurzel = useMemo(() => baueBaum(orgUnits, positionen), [orgUnits, positionen]);
  const { breite, hoehe, knoten } = useMemo(() => {
    if (!wurzel) return { breite: 0, hoehe: 0, knoten: [] as Knoten[] };
    const { breiteSpalten, tiefe } = layout(wurzel);
    return {
      breite: Math.max(breiteSpalten, 1) * SPALTEN_SCHRITT,
      hoehe: (tiefe + 1) * ZEILEN_SCHRITT - ZEILEN_LUECKE,
      knoten: alleKnoten(wurzel),
    };
  }, [wurzel]);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Organigramm</h2>
      </div>
      <p className="zv-sub" style={{ marginTop: -8, marginBottom: 16 }}>
        Organisationseinheiten und Positionen dieses Trägers. Durchgezogener Rahmen: Linienposition. Gestrichelter
        Rahmen: Stabsstelle (kein automatischer Zuständigkeitsbereich). Namen erscheinen nur mit dem Recht „Personendaten
        sehen" -- sonst nur die Anzahl der besetzten Plätze.
      </p>

      {!wurzel && geladen && !fehler ? (
        <Leerzustand icon={ILeerOrganigramm}>Noch keine Organisationsstruktur angelegt.</Leerzustand>
      ) : wurzel ? (
        <div className="zv-organigramm-scroll">
          <div className="zv-organigramm-leinwand" style={{ width: breite, height: hoehe }}>
            <Verbindungen knoten={knoten} />
            {knoten.map((k) => (
              <KnotenBox key={k.schluessel} knoten={k} accountTypNamen={accountTypNamen} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
