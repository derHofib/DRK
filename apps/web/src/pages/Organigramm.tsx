import { CSSProperties, DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AccountTypDto,
  BenutzerListEintragDto,
  BesetzungDto,
  OrgUnitDto,
  PositionDto,
  RechtRegistryEintragDto,
} from "@zimmerakte/shared";
import { ORG_UNIT_TYP_LABEL, POSITION_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { Seitenpanel } from "../components/Seitenpanel";
import {
  IAbbrechen,
  IAnpassen,
  IAuszug,
  IBearbeiten,
  IBereichTeam,
  IDeaktivieren,
  IEinziehen,
  IFehler,
  ILeerOrganigramm,
  INeu,
  IOrganigramm,
  IPosition,
  ISpeichern,
  IStabsstelle,
  ITraeger,
  IVerschieben,
  IZiehen,
} from "../components/icons";

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

function nachkommenSchluessel(knoten: Knoten): Set<string> {
  const ergebnis = new Set<string>();
  function besuch(k: Knoten) {
    for (const kind of k.kinder) {
      ergebnis.add(kind.schluessel);
      besuch(kind);
    }
  }
  besuch(knoten);
  return ergebnis;
}

/**
 * Wer kommt fuer "quelle" ueberhaupt als neues Ziel infrage -- fuer Drag &
 * Drop UND fuer "Verschieben nach…" dieselbe Funktion, damit beide Wege nie
 * auseinanderlaufen. Nur dieselbe Art (Einheit auf Einheit, Position auf
 * Position -- eine Position unter eine andere Einheit haengen gibt es in
 * diesem API-Stand nicht, org_unit_id einer Position ist nicht aenderbar),
 * nie man selbst, nie der eigene Teilbaum (sonst Zyklus). Eine
 * "falsche Reihenfolge" (z.B. Bereich unter Team) wird hier NICHT
 * zusaetzlich ausgeschlossen -- der Zyklenschutz-Trigger in der DB kennt
 * diese Unterscheidung auch nicht, Client und Server sollen dieselbe
 * Grenze ziehen.
 */
function gueltigeZiele(quelle: Knoten, alle: Knoten[]): Set<string> {
  const nachkommen = nachkommenSchluessel(quelle);
  const ziele = new Set<string>();
  for (const k of alle) {
    if (k.art !== quelle.art || k.schluessel === quelle.schluessel || nachkommen.has(k.schluessel)) continue;
    ziele.add(k.schluessel);
  }
  return ziele;
}

/** Nur traeger/einrichtung bleiben fest -- siehe legeOrgUnitAn(), dieselbe Grenze. */
function istZiehbareEinheit(u: OrgUnitDto): boolean {
  return u.typ === "bereich" || u.typ === "team";
}

function istZiehbar(k: Knoten): boolean {
  return k.art === "position" || istZiehbareEinheit(k.einheit!);
}

interface ZielOption {
  id: string;
  label: string;
}

function zielOptionen(quelle: Knoten, alle: Knoten[], orgUnitNamen: Map<string, string>): ZielOption[] {
  const erlaubt = gueltigeZiele(quelle, alle);
  const optionen: ZielOption[] = [];
  for (const k of alle) {
    if (!erlaubt.has(k.schluessel)) continue;
    if (k.art === "einheit") {
      optionen.push({ id: k.einheit!.id, label: `${k.einheit!.name} (${ORG_UNIT_TYP_LABEL[k.einheit!.typ]})` });
    } else {
      optionen.push({
        id: k.position!.id,
        label: `${k.position!.titel} (${orgUnitNamen.get(k.position!.orgUnitId) ?? "?"})`,
      });
    }
  }
  optionen.sort((a, b) => a.label.localeCompare(b.label, "de"));
  return optionen;
}

function positionsStatus(p: PositionDto): { label: string; klasse: string } {
  if (p.istGeplant) return { label: "Geplant (Platzhalter)", klasse: "zv-pill-info" };
  if (p.besetztMit.length === 0) return { label: "Vakant", klasse: "zv-pill-neutral" };
  if (p.besetztMit.length < p.sollBesetzung) {
    return { label: `Besetzt ${p.besetztMit.length}/${p.sollBesetzung}`, klasse: "zv-pill-teilweise" };
  }
  return { label: "Besetzt", klasse: "zv-pill-ok" };
}

function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

function datumAnzeige(iso: string): string {
  const [jahr, monat, tag] = iso.split("-");
  return `${tag}.${monat}.${jahr}`;
}

function KnotenBox({
  knoten,
  accountTypNamen,
  ausgewaehlt,
  onOeffnen,
  ziehtGerade,
  istZielMoeglich,
  istZielAktuell,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  knoten: Knoten;
  accountTypNamen: Map<string, string>;
  ausgewaehlt: boolean;
  onOeffnen: () => void;
  ziehtGerade: boolean;
  istZielMoeglich: boolean;
  istZielAktuell: boolean;
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLButtonElement>) => void;
  onDrop: (e: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const links = knoten.x * SPALTEN_SCHRITT + (SPALTEN_SCHRITT - BOX_BREITE) / 2;
  const oben = knoten.tiefe * ZEILEN_SCHRITT;
  const stil = { left: links, top: oben, width: BOX_BREITE, height: BOX_HOEHE };
  const ziehbar = istZiehbar(knoten);
  const zugsKlassen = `${ziehtGerade ? " zv-organigramm-knoten-zieht" : ""}${
    istZielMoeglich ? " zv-organigramm-knoten-ziel-moeglich" : ""
  }${istZielAktuell ? " zv-organigramm-knoten-ziel-aktuell" : ""}`;
  const ziehGriff = ziehbar && (
    <span className="zv-organigramm-knoten-griff" aria-hidden="true">
      <IZiehen />
    </span>
  );

  if (knoten.art === "einheit") {
    const u = knoten.einheit!;
    const Icon = u.typ === "traeger" || u.typ === "einrichtung" ? ITraeger : IBereichTeam;
    return (
      <button
        type="button"
        style={stil}
        draggable={ziehbar}
        onClick={onOeffnen}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={`zv-organigramm-knoten zv-organigramm-knoten-einheit${u.aktiv ? "" : " zv-organigramm-knoten-inaktiv"}${ausgewaehlt ? " zv-organigramm-knoten-aktiv" : ""}${zugsKlassen}`}
      >
        {ziehGriff}
        <div className="zv-organigramm-knoten-kopf">
          <Icon />
          <span className="zv-organigramm-knoten-titel">{u.name}</span>
        </div>
        <span className="zv-organigramm-knoten-sub">
          {ORG_UNIT_TYP_LABEL[u.typ]}
          {!u.aktiv && " · inaktiv"}
        </span>
      </button>
    );
  }

  const p = knoten.position!;
  const status = positionsStatus(p);
  const namen = p.besetztMit.filter((b) => b.benutzerName !== null).map((b) => b.benutzerName as string);
  const namenAusgeblendet = p.besetztMit.length > 0 && namen.length === 0;
  const Icon = p.typ === "stabsstelle" ? IStabsstelle : IPosition;
  return (
    <button
      type="button"
      style={stil}
      draggable={ziehbar}
      onClick={onOeffnen}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`zv-organigramm-knoten zv-organigramm-knoten-position${
        p.typ === "stabsstelle" ? " zv-organigramm-knoten-stabsstelle" : ""
      }${!p.aktiv ? " zv-organigramm-knoten-inaktiv" : ""}${ausgewaehlt ? " zv-organigramm-knoten-aktiv" : ""}${zugsKlassen}`}
    >
      {ziehGriff}
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
    </button>
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
 * Seitenpanel-Inhalt fuer eine Organisationseinheit: Stammdaten, die darin
 * enthaltenen Positionen, und -- fuer traeger/einrichtung/bereich als
 * Elternknoten erlaubt, siehe orgUnitAnlegenSchema -- die Aktionen "Neue
 * Unter-Einheit" (Bereich/Team) und "Neue Position".
 *
 * Es gibt hier bewusst KEINE clientseitige Rechtepruefung, die Aktionen aus-
 * blendet: rollen-mapping.ts (Organigramm-Plan Schritt 3) kennt
 * organigramm.bearbeiten fuer Einrichtungsleitung/Mitarbeiter noch nicht --
 * ein serverseitiges 403 waere also heute fuer fast jedes Konto der
 * Normalfall. Die Knoepfe bleiben trotzdem sichtbar (der Server ist die
 * einzige Instanz, die wirklich entscheidet, CLAUDE.md Regel 1-Prinzip
 * sinngemaess auf die Rechte-Engine uebertragen) und zeigen im Fehlerfall
 * die Server-Meldung an.
 */
function EinheitPanel({
  einheit,
  positionenInEinheit,
  accountTypen,
  verschiebenZiele,
  aufVerschieben,
  onAktualisiert,
}: {
  einheit: OrgUnitDto;
  positionenInEinheit: PositionDto[];
  accountTypen: AccountTypDto[];
  verschiebenZiele: ZielOption[];
  aufVerschieben: (zielId: string) => Promise<void>;
  onAktualisiert: () => void;
}) {
  const [neueEinheitOffen, setNeueEinheitOffen] = useState(false);
  const [neuePositionOffen, setNeuePositionOffen] = useState(false);
  const [verschiebenOffen, setVerschiebenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function verschieben(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await aufVerschieben(String(form.get("zielId") ?? ""));
      setVerschiebenOffen(false);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Einheit konnte nicht verschoben werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function einheitAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammOrgUnitAnlegen({
        typ: form.get("typ") as "bereich" | "team",
        name: String(form.get("name") ?? "").trim(),
        parentId: einheit.id,
      });
      setNeueEinheitOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Einheit konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function positionAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      const sollBesetzung = Number(form.get("sollBesetzung") ?? 1);
      await api.organigrammPositionAnlegen({
        orgUnitId: einheit.id,
        titel: String(form.get("titel") ?? "").trim(),
        typ: form.get("typ") as "linie" | "stabsstelle",
        accountTypId: String(form.get("accountTypId") ?? ""),
        sollBesetzung: Number.isFinite(sollBesetzung) && sollBesetzung > 0 ? sollBesetzung : undefined,
      });
      setNeuePositionOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div>
      <h3>{einheit.name}</h3>
      <p className="zv-sub">
        {ORG_UNIT_TYP_LABEL[einheit.typ]}
        {!einheit.aktiv && " · inaktiv"}
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-vorschau-zeile" style={{ marginTop: 16, marginBottom: 20 }}>
        <button className="zv-btn zv-btn-still" type="button" onClick={() => setNeueEinheitOffen(true)}>
          <INeu />
          Bereich/Team anlegen
        </button>
        <button className="zv-btn zv-btn-still" type="button" onClick={() => setNeuePositionOffen(true)}>
          <INeu />
          Position anlegen
        </button>
        {verschiebenZiele.length > 0 && (
          <button className="zv-btn zv-btn-still" type="button" onClick={() => setVerschiebenOffen(true)}>
            <IVerschieben />
            Verschieben nach…
          </button>
        )}
      </div>

      <h4>Positionen in dieser Einheit</h4>
      <ul className="zv-verlauf-liste">
        {positionenInEinheit.map((p) => {
          const status = positionsStatus(p);
          return (
            <li key={p.id}>
              <strong>{p.titel}</strong>
              <span className={`zv-pill ${status.klasse}`} style={{ marginLeft: 6 }}>
                {status.label}
              </span>
            </li>
          );
        })}
        {positionenInEinheit.length === 0 && <li className="zv-sub-inline">Noch keine Positionen angelegt.</li>}
      </ul>

      {neueEinheitOffen && (
        <Modal titel="Bereich/Team anlegen" onClose={() => setNeueEinheitOffen(false)}>
          <form onSubmit={einheitAnlegen}>
            <div className="zv-field">
              <label htmlFor="einheit-typ">Typ</label>
              <select id="einheit-typ" name="typ" defaultValue="bereich">
                <option value="bereich">Bereich</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="einheit-name">Name</label>
              <input id="einheit-name" name="name" required autoFocus />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {neuePositionOffen && (
        <Modal titel="Position anlegen" onClose={() => setNeuePositionOffen(false)}>
          <form onSubmit={positionAnlegen}>
            <div className="zv-field">
              <label htmlFor="position-titel">Titel</label>
              <input id="position-titel" name="titel" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="position-typ">Typ</label>
              <select id="position-typ" name="typ" defaultValue="linie">
                <option value="linie">Linie</option>
                <option value="stabsstelle">Stabsstelle</option>
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="position-account-typ">Account-Typ</label>
              <select id="position-account-typ" name="accountTypId" required defaultValue="">
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {accountTypen.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="position-soll">Soll-Besetzung</label>
              <input id="position-soll" name="sollBesetzung" type="number" min={1} defaultValue={1} />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {verschiebenOffen && (
        <Modal titel="Verschieben nach…" onClose={() => setVerschiebenOffen(false)}>
          <form onSubmit={verschieben}>
            <p className="zv-sub">Neue übergeordnete Organisationseinheit für „{einheit.name}".</p>
            <div className="zv-field">
              <label htmlFor="einheit-ziel">Neue übergeordnete Einheit</label>
              <select id="einheit-ziel" name="zielId" required defaultValue="" autoFocus>
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {verschiebenZiele.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <IVerschieben />
              {wirdGespeichert ? "Speichert…" : "Verschieben"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/**
 * Seitenpanel-Inhalt fuer eine Position: Stammdaten, die aktiven
 * Besetzungen (mit "seit"-Datum) je mit "Beenden", sowie "Besetzen" und
 * "Deaktivieren". Siehe EinheitPanel fuer die Begruendung, warum die
 * Aktionen hier nicht clientseitig nach Rolle ausgeblendet werden.
 */
function PositionPanel({
  position,
  accountTypNamen,
  benutzerListe,
  verschiebenZiele,
  aufVerschieben,
  onAktualisiert,
}: {
  position: PositionDto;
  accountTypNamen: Map<string, string>;
  benutzerListe: BenutzerListEintragDto[];
  verschiebenZiele: ZielOption[];
  aufVerschieben: (zielId: string) => Promise<void>;
  onAktualisiert: () => void;
}) {
  const [besetzenOffen, setBesetzenOffen] = useState(false);
  const [beendenBesetzung, setBeendenBesetzung] = useState<BesetzungDto | null>(null);
  const [deaktivierenOffen, setDeaktivierenOffen] = useState(false);
  const [verschiebenOffen, setVerschiebenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const status = positionsStatus(position);

  async function verschieben(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await aufVerschieben(String(form.get("zielId") ?? ""));
      setVerschiebenOffen(false);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht verschoben werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function besetzen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammPositionBesetzen(position.id, {
        benutzerId: String(form.get("benutzerId") ?? ""),
        gueltigAb: String(form.get("gueltigAb") ?? "") || undefined,
      });
      setBesetzenOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht besetzt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function besetzungBeenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!beendenBesetzung) return;
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammBesetzungBeenden(position.id, beendenBesetzung.besetzungId, {
        gueltigBis: String(form.get("gueltigBis") ?? "") || undefined,
      });
      setBeendenBesetzung(null);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Besetzung konnte nicht beendet werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function deaktivieren() {
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammPositionDeaktivieren(position.id);
      setDeaktivierenOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Position konnte nicht deaktiviert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div>
      <h3>{position.titel}</h3>
      <p className="zv-sub">
        {POSITION_TYP_LABEL[position.typ]} · {accountTypNamen.get(position.accountTypId) ?? "?"}
        {!position.aktiv && " · inaktiv"}
      </p>
      <span className={`zv-pill ${status.klasse}`}>{status.label}</span>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" style={{ marginTop: 16 }}>
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-vorschau-zeile" style={{ marginTop: 16, marginBottom: 20 }}>
        {position.aktiv && (
          <button className="zv-btn zv-btn-still" type="button" onClick={() => setBesetzenOffen(true)}>
            <IEinziehen />
            Besetzen
          </button>
        )}
        {position.aktiv && (
          <button className="zv-btn zv-btn-still" type="button" onClick={() => setDeaktivierenOffen(true)}>
            <IDeaktivieren />
            Deaktivieren
          </button>
        )}
        {verschiebenZiele.length > 0 && (
          <button className="zv-btn zv-btn-still" type="button" onClick={() => setVerschiebenOffen(true)}>
            <IVerschieben />
            Verschieben nach…
          </button>
        )}
      </div>

      <h4>Besetzungen</h4>
      <ul className="zv-verlauf-liste">
        {position.besetztMit.map((b) => (
          <li key={b.besetzungId}>
            <strong>{b.benutzerName ?? "Namen ausgeblendet"}</strong>
            <span className="zv-sub-inline" style={{ whiteSpace: "nowrap" }}>
              seit {datumAnzeige(b.gueltigAb)}
            </span>
            <button className="zv-link-btn" type="button" onClick={() => setBeendenBesetzung(b)}>
              <IAuszug />
              Beenden
            </button>
          </li>
        ))}
        {position.besetztMit.length === 0 && <li className="zv-sub-inline">Derzeit nicht besetzt.</li>}
      </ul>

      {besetzenOffen && (
        <Modal titel="Position besetzen" onClose={() => setBesetzenOffen(false)}>
          <form onSubmit={besetzen}>
            <div className="zv-field">
              <label htmlFor="besetzen-benutzer">Mitarbeiter/in</label>
              <select id="besetzen-benutzer" name="benutzerId" required defaultValue="" autoFocus>
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {benutzerListe.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="besetzen-gueltig-ab">Besetzt ab</label>
              <input id="besetzen-gueltig-ab" name="gueltigAb" type="date" defaultValue={heute()} />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <IEinziehen />
              {wirdGespeichert ? "Speichert…" : "Besetzen"}
            </button>
          </form>
        </Modal>
      )}

      {beendenBesetzung && (
        <Modal titel="Besetzung beenden" onClose={() => setBeendenBesetzung(null)}>
          <form onSubmit={besetzungBeenden}>
            <p className="zv-sub">
              Beendet die Besetzung von {beendenBesetzung.benutzerName ?? "dieser Person"} auf dieser Position.
            </p>
            <div className="zv-field">
              <label htmlFor="beenden-datum">Ende (optional, Standard: heute)</label>
              <input id="beenden-datum" name="gueltigBis" type="date" defaultValue={heute()} />
            </div>
            <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
              <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
                <IAuszug />
                {wirdGespeichert ? "Speichert…" : "Beenden"}
              </button>
              <button className="zv-btn zv-btn-still" type="button" onClick={() => setBeendenBesetzung(null)}>
                <IAbbrechen />
                Abbrechen
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deaktivierenOffen && (
        <Modal titel="Position deaktivieren" onClose={() => setDeaktivierenOffen(false)}>
          <p className="zv-sub">
            „{position.titel}" wird deaktiviert und verschwindet aus der Auswahl für neue Besetzungen. Das lässt sich
            über die API nicht rückgängig machen.
          </p>
          <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
            <button className="zv-btn" type="button" onClick={deaktivieren} disabled={wirdGespeichert}>
              <IDeaktivieren />
              {wirdGespeichert ? "Speichert…" : "Deaktivieren"}
            </button>
            <button className="zv-btn zv-btn-still" type="button" onClick={() => setDeaktivierenOffen(false)}>
              <IAbbrechen />
              Abbrechen
            </button>
          </div>
        </Modal>
      )}

      {verschiebenOffen && (
        <Modal titel="Verschieben nach…" onClose={() => setVerschiebenOffen(false)}>
          <form onSubmit={verschieben}>
            <p className="zv-sub">
              Neue übergeordnete Position für „{position.titel}" (Berichtslinie, nicht die Organisationseinheit --
              die bleibt dieselbe).
            </p>
            <div className="zv-field">
              <label htmlFor="position-ziel">Neue übergeordnete Position</label>
              <select id="position-ziel" name="zielId" required defaultValue="" autoFocus>
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {verschiebenZiele.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <IVerschieben />
              {wirdGespeichert ? "Speichert…" : "Verschieben"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/**
 * Scope ist in der DB/API absichtlich freier Text (keine DB-Enum, siehe
 * account_typ_recht), aber die Rechte-Engine kennt nur diese acht Werte
 * (Organigramm-Plan, Abschnitt "Rechte-Engine"). Die Auswahl hier bietet
 * deshalb genau diese Liste an, statt ein Freitextfeld zu zeigen.
 */
const SCOPE_LABEL: Record<string, string> = {
  own: "Eigene",
  team: "Team",
  wohngruppe: "Wohngruppe",
  subtree: "Teilbaum (Linie)",
  einrichtung: "Einrichtung",
  bereich: "Bereich",
  tenant: "Trägerweit",
  assigned: "Zugewiesen",
};
const SCOPE_OPTIONEN = Object.keys(SCOPE_LABEL);

/**
 * Rechte-Matrix einer einzelnen Account-Typ-Zeile (Organigramm-Plan: "Matrix
 * als Grid-Komponente aus der registry.ts, dieselbe Liste wie
 * serverseitig"). Eine Zeile ohne Eintrag in `karte` ist ein impliziter
 * Deny -- exakt wie eine fehlende account_typ_recht-Zeile serverseitig.
 * Sammelt Aenderungen lokal und schreibt sie erst auf "Speichern" komplett
 * (PUT ersetzt die gesamte Rechte-Menge, kein Sinn in einem Request pro
 * Zelle).
 */
function AccountTypRechteEditor({
  accountTyp,
  registry,
  onAktualisiert,
}: {
  accountTyp: AccountTypDto;
  registry: RechtRegistryEintragDto[];
  onAktualisiert: () => void;
}) {
  const [karte, setKarte] = useState<Map<string, string>>(new Map());
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  useEffect(() => {
    const neu = new Map<string, string>();
    for (const r of accountTyp.rechte) if (r.erlaubt) neu.set(`${r.modul}.${r.aktion}`, r.scope);
    setKarte(neu);
    setFehler(null);
  }, [accountTyp.id, accountTyp.rechte]);

  async function speichern() {
    setFehler(null);
    setWirdGespeichert(true);
    try {
      const rechte = Array.from(karte.entries()).map(([schluessel, scope]) => {
        const [modul, aktion] = schluessel.split(".");
        return { modul, aktion, scope, erlaubt: true };
      });
      await api.organigrammAccountTypRechteSetzen(accountTyp.id, rechte);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Rechte konnten nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  if (accountTyp.istVollzugriff) {
    return (
      <div>
        <h3>{accountTyp.name}</h3>
        <p className="zv-sub">
          Alle Rechte, trägerweit -- nicht reduzierbar. Dieser Account-Typ ist die Wildcard für Geschäftsführung
          (Organigramm-Plan) und bekommt deshalb nie einzelne Rechte-Zeilen.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3>{accountTyp.name}</h3>
      <p className="zv-sub" style={{ marginBottom: 16 }}>
        Fehlt eine Zeile hier komplett, gilt sie als „Kein Zugriff" -- ohne dass jemand das pflegen müsste, wenn ein
        neues Modul dazukommt.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr" } as CSSProperties}>
        <div className="zv-liste-kopf">
          <span>Modul · Aktion</span>
          <span>Zugriff</span>
        </div>
        {registry.map((r) => {
          const schluessel = `${r.modul}.${r.aktion}`;
          const wert = karte.get(schluessel) ?? "";
          return (
            <div className="zv-info-karte" key={schluessel}>
              <span className="zv-liste-zelle-titel">
                {r.modul} · {r.aktion}
                {r.sensibel && <span className="zv-sub-inline">sensibel</span>}
                {r.nieDelegierbar && <span className="zv-sub-inline">nie delegierbar</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Zugriff">
                <select
                  value={wert}
                  onChange={(e) => {
                    const neu = new Map(karte);
                    if (e.target.value === "") neu.delete(schluessel);
                    else neu.set(schluessel, e.target.value);
                    setKarte(neu);
                  }}
                >
                  <option value="">Kein Zugriff</option>
                  {SCOPE_OPTIONEN.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          );
        })}
      </div>

      <button className="zv-btn zv-btn-block" type="button" onClick={speichern} disabled={wirdGespeichert} style={{ marginTop: 16 }}>
        <ISpeichern />
        {wirdGespeichert ? "Speichert…" : "Speichern"}
      </button>
    </div>
  );
}

/**
 * Account-Typ-Verwaltung -- Organigramm-Plan, Lieferreihenfolge Schritt
 * 7/UI. Liste + Anlegen/Umbenennen nach dem Muster von
 * `KassenbuchTypen.tsx` (`ist_system`-Zeilen mit eingeschränkter Aktion,
 * genau wie dort `istHzl`); die Rechte-Matrix selbst öffnet sich im
 * Seitenpanel, damit sie bei Bedarf per Vollbild mehr Platz bekommt.
 */
function AccountTypenAnsicht({
  accountTypen,
  registry,
  onAktualisiert,
}: {
  accountTypen: AccountTypDto[];
  registry: RechtRegistryEintragDto[];
  onAktualisiert: () => void;
}) {
  const [neuOffen, setNeuOffen] = useState(false);
  const [umbenennenTyp, setUmbenennenTyp] = useState<AccountTypDto | null>(null);
  const [ausgewaehlteId, setAusgewaehlteId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const ausgewaehlt = accountTypen.find((a) => a.id === ausgewaehlteId) ?? null;

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammAccountTypAnlegen({
        name: String(form.get("name") ?? "").trim(),
        kategorie: form.get("kategorie") as "intern" | "extern",
      });
      setNeuOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Account-Typ konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function umbenennen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!umbenennenTyp) return;
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammAccountTypAktualisieren(umbenennenTyp.id, { name: String(form.get("name") ?? "").trim() });
      setUmbenennenTyp(null);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Account-Typ konnte nicht umbenannt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div>
      <div className="zv-vorschau-zeile" style={{ marginBottom: 16 }}>
        <button className="zv-btn" type="button" onClick={() => setNeuOffen(true)}>
          <INeu />
          Neuer Account-Typ
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1.6fr" } as CSSProperties}>
        <div className="zv-liste-kopf">
          <span>Name</span>
          <span>Kategorie</span>
          <span>Rechte</span>
          <span></span>
        </div>
        {accountTypen.map((a) => (
          <div className="zv-info-karte" key={a.id}>
            <span className="zv-liste-zelle-titel">
              {a.name}
              {a.istSystem && <span className="zv-sub-inline">Systemvorlage</span>}
            </span>
            <span className="zv-liste-zelle" data-label="Kategorie">
              {a.kategorie === "extern" ? "Extern" : "Intern"}
            </span>
            <span className="zv-liste-zelle" data-label="Rechte">
              {a.istVollzugriff ? "Alle (Vollzugriff)" : `${a.rechte.length} erlaubt`}
            </span>
            <span className="zv-liste-zelle-aktionen">
              <button className="zv-link-btn" type="button" onClick={() => setAusgewaehlteId(a.id)}>
                <IAnpassen />
                Rechte bearbeiten
              </button>
              {!a.istSystem && (
                <button className="zv-link-btn" type="button" onClick={() => setUmbenennenTyp(a)}>
                  <IBearbeiten />
                  Umbenennen
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {neuOffen && (
        <Modal titel="Neuer Account-Typ" onClose={() => setNeuOffen(false)}>
          <form onSubmit={anlegen}>
            <div className="zv-field">
              <label htmlFor="accounttyp-name">Name</label>
              <input id="accounttyp-name" name="name" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="accounttyp-kategorie">Kategorie</label>
              <select id="accounttyp-kategorie" name="kategorie" defaultValue="intern">
                <option value="intern">Intern</option>
                <option value="extern">Extern</option>
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {umbenennenTyp && (
        <Modal titel="Account-Typ umbenennen" onClose={() => setUmbenennenTyp(null)}>
          <form onSubmit={umbenennen}>
            <div className="zv-field">
              <label htmlFor="accounttyp-umbenennen-name">Name</label>
              <input id="accounttyp-umbenennen-name" name="name" defaultValue={umbenennenTyp.name} required autoFocus />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}

      <Seitenpanel offen={ausgewaehlt !== null} onSchliessen={() => setAusgewaehlteId(null)}>
        {ausgewaehlt && <AccountTypRechteEditor accountTyp={ausgewaehlt} registry={registry} onAktualisiert={onAktualisiert} />}
      </Seitenpanel>
    </div>
  );
}

/**
 * Organigramm-Grundansicht + Seitenpanel + Umhängen + Account-Typ-
 * Verwaltung -- Organigramm-Plan, Lieferreihenfolge Schritt 7/UI.
 * "Anzeigen als…" und die Tabellenansicht/Export folgen als eigene,
 * spaeter commitete Teilschritte.
 *
 * Umhängen geht zwei gleichwertige Wege (Organigramm-Plan: "Drag & Drop,
 * PLUS eine gleichwertige Tastatur-Alternative"): natives HTML5-Drag&Drop
 * direkt im Baum, oder im Seitenpanel "Verschieben nach…" -- ein Modal mit
 * einer <select>-Zielauswahl statt eines literalen Rechtsklick-
 * Kontextmenues. Bewusst so: ein echtes Kontextmenue ist fuer Tastatur-
 * und Screenreader-Nutzung notorisch schlecht zugaenglich, ein Modal mit
 * einer fokussierbaren Liste ist die tatsaechlich gleichwertige
 * Alternative, nicht nur eine andere Form desselben Mauswege. Beide Wege
 * nutzen dieselbe gueltigeZiele()-Funktion, damit sie nie auseinanderlaufen.
 */
export function Organigramm() {
  const [orgUnits, setOrgUnits] = useState<OrgUnitDto[]>([]);
  const [positionen, setPositionen] = useState<PositionDto[]>([]);
  const [accountTypen, setAccountTypen] = useState<AccountTypDto[]>([]);
  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [geladen, setGeladen] = useState(false);
  // Schluessel statt Objekt-Referenz: nach jeder Mutation werden die Listen
  // neu geladen und der Baum neu gebaut (useMemo unten) -- eine gehaltene
  // Knoten-Referenz waere dann veraltet. Der Schluessel findet den
  // aktuellen Knoten jedes Mal frisch in der neu gebauten Liste.
  const [ausgewaehlterSchluessel, setAusgewaehlterSchluessel] = useState<string | null>(null);
  const [gezogenerSchluessel, setGezogenerSchluessel] = useState<string | null>(null);
  const [zielSchluessel, setZielSchluessel] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<"baum" | "account-typen">("baum");
  // Registry separat und erst bei Bedarf laden (nicht im Haupt-laden()):
  // GET /rechte/registry braucht organigramm.manage-permissions, waehrend
  // der Baum selbst nur organigramm.ansehen braucht -- ein Konto ohne das
  // engere Recht soll beim blossen Oeffnen der Organigramm-Seite keinen
  // Fehlerbanner sehen, nur falls es tatsaechlich auf "Account-Typen"
  // wechselt.
  const [registry, setRegistry] = useState<RechtRegistryEintragDto[]>([]);
  const [registryFehler, setRegistryFehler] = useState<string | null>(null);

  useEffect(() => {
    if (ansicht !== "account-typen" || registry.length > 0) return;
    api
      .rechteRegistry()
      .then(setRegistry)
      .catch((err) => setRegistryFehler(err instanceof Error ? err.message : "Rechte-Übersicht konnte nicht geladen werden."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ansicht]);

  function laden() {
    return Promise.all([
      api.organigrammOrgUnits(),
      api.organigrammPositionen(),
      api.organigrammAccountTypen(),
      api.benutzerListe(),
    ])
      .then(([u, p, a, b]) => {
        setOrgUnits(u);
        setPositionen(p);
        setAccountTypen(a);
        setBenutzerListe(b);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Organigramm konnte nicht geladen werden."))
      .finally(() => setGeladen(true));
  }

  useEffect(() => {
    laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const ausgewaehlterKnoten = knoten.find((k) => k.schluessel === ausgewaehlterSchluessel) ?? null;
  const orgUnitNamen = useMemo(() => new Map(orgUnits.map((u) => [u.id, u.name])), [orgUnits]);

  const gezogenerKnoten = knoten.find((k) => k.schluessel === gezogenerSchluessel) ?? null;
  const gueltigeZielSchluessel = useMemo(
    () => (gezogenerKnoten ? gueltigeZiele(gezogenerKnoten, knoten) : new Set<string>()),
    [gezogenerKnoten, knoten]
  );

  const verschiebenZiele = useMemo(() => {
    if (!ausgewaehlterKnoten) return [];
    if (ausgewaehlterKnoten.art === "einheit" && !istZiehbareEinheit(ausgewaehlterKnoten.einheit!)) return [];
    return zielOptionen(ausgewaehlterKnoten, knoten, orgUnitNamen);
  }, [ausgewaehlterKnoten, knoten, orgUnitNamen]);

  async function verschiebenNachId(quelle: Knoten, zielId: string) {
    if (quelle.art === "einheit") {
      await api.organigrammOrgUnitAktualisieren(quelle.einheit!.id, { parentId: zielId });
    } else {
      await api.organigrammPositionAktualisieren(quelle.position!.id, { parentPositionId: zielId });
    }
    await laden();
  }

  function beiDragOver(e: DragEvent<HTMLButtonElement>, ziel: Knoten) {
    if (!gueltigeZielSchluessel.has(ziel.schluessel)) return;
    e.preventDefault();
    setZielSchluessel(ziel.schluessel);
  }

  async function beiDrop(e: DragEvent<HTMLButtonElement>, ziel: Knoten) {
    e.preventDefault();
    const quelle = gezogenerKnoten;
    setGezogenerSchluessel(null);
    setZielSchluessel(null);
    if (!quelle || !gueltigeZielSchluessel.has(ziel.schluessel)) return;
    const zielId = ziel.art === "einheit" ? ziel.einheit!.id : ziel.position!.id;
    try {
      await verschiebenNachId(quelle, zielId);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Verschieben nicht möglich.");
    }
  }

  function beiDragEnd() {
    setGezogenerSchluessel(null);
    setZielSchluessel(null);
  }

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

      <div className="zv-segmented" role="radiogroup" aria-label="Ansicht" style={{ marginBottom: 16 }}>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "baum"}
          className={ansicht === "baum" ? "active" : ""}
          onClick={() => setAnsicht("baum")}
        >
          <IOrganigramm />
          Baum
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={ansicht === "account-typen"}
          className={ansicht === "account-typen" ? "active" : ""}
          onClick={() => setAnsicht("account-typen")}
        >
          <IAnpassen />
          Account-Typen
        </button>
      </div>

      {ansicht === "account-typen" ? (
        <>
          {registryFehler && (
            <div className="zv-hinweis zv-hinweis-fehler">
              <IFehler />
              {registryFehler}
            </div>
          )}
          <AccountTypenAnsicht accountTypen={accountTypen} registry={registry} onAktualisiert={laden} />
        </>
      ) : (
        <>
          <p className="zv-sub" style={{ marginTop: -8, marginBottom: 16 }}>
            Organisationseinheiten und Positionen dieses Trägers. Durchgezogener Rahmen: Linienposition. Gestrichelter
            Rahmen: Stabsstelle (kein automatischer Zuständigkeitsbereich). Namen erscheinen nur mit dem Recht
            „Personendaten sehen" -- sonst nur die Anzahl der besetzten Plätze. Klick auf einen Knoten zeigt Details
            und Aktionen.
          </p>

          {!wurzel && geladen && !fehler ? (
            <Leerzustand icon={ILeerOrganigramm}>Noch keine Organisationsstruktur angelegt.</Leerzustand>
          ) : wurzel ? (
            <div className="zv-organigramm-scroll">
              <div className="zv-organigramm-leinwand" style={{ width: breite, height: hoehe }}>
                <Verbindungen knoten={knoten} />
                {knoten.map((k) => (
                  <KnotenBox
                    key={k.schluessel}
                    knoten={k}
                    accountTypNamen={accountTypNamen}
                    ausgewaehlt={k.schluessel === ausgewaehlterSchluessel}
                    onOeffnen={() => setAusgewaehlterSchluessel(k.schluessel)}
                    ziehtGerade={k.schluessel === gezogenerSchluessel}
                    istZielMoeglich={gezogenerSchluessel !== null && gueltigeZielSchluessel.has(k.schluessel)}
                    istZielAktuell={k.schluessel === zielSchluessel}
                    onDragStart={() => setGezogenerSchluessel(k.schluessel)}
                    onDragOver={(e) => beiDragOver(e, k)}
                    onDrop={(e) => beiDrop(e, k)}
                    onDragEnd={beiDragEnd}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <Seitenpanel offen={ausgewaehlterKnoten !== null} onSchliessen={() => setAusgewaehlterSchluessel(null)}>
            {ausgewaehlterKnoten?.art === "einheit" && ausgewaehlterKnoten.einheit && (
              <EinheitPanel
                einheit={ausgewaehlterKnoten.einheit}
                positionenInEinheit={positionen.filter((p) => p.orgUnitId === ausgewaehlterKnoten.einheit!.id)}
                accountTypen={accountTypen}
                verschiebenZiele={verschiebenZiele}
                aufVerschieben={(zielId) => verschiebenNachId(ausgewaehlterKnoten, zielId)}
                onAktualisiert={laden}
              />
            )}
            {ausgewaehlterKnoten?.art === "position" && ausgewaehlterKnoten.position && (
              <PositionPanel
                position={ausgewaehlterKnoten.position}
                accountTypNamen={accountTypNamen}
                benutzerListe={benutzerListe}
                verschiebenZiele={verschiebenZiele}
                aufVerschieben={(zielId) => verschiebenNachId(ausgewaehlterKnoten, zielId)}
                onAktualisiert={laden}
              />
            )}
          </Seitenpanel>
        </>
      )}
    </div>
  );
}
