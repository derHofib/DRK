import { FormEvent, useState } from "react";
import type { AccountTypDto, OrgUnitDto, PositionDto } from "@zimmerakte/shared";
import { ORG_UNIT_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Modal } from "../../components/Modal";
import { IAbbrechen, IFehler, INeu, ISpeichern, IVerschieben } from "../../components/icons";
import { type ZielOption, positionsStatus } from "./baum";
import { GeschwisterButtons, type GeschwisterInfo } from "./KnotenBox";

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
export function EinheitPanel({
  einheit,
  positionenInEinheit,
  accountTypen,
  verschiebenZiele,
  aufVerschieben,
  geschwister,
  aufGeschwisterVerschieben,
  onAktualisiert,
}: {
  einheit: OrgUnitDto;
  positionenInEinheit: PositionDto[];
  accountTypen: AccountTypDto[];
  verschiebenZiele: ZielOption[];
  aufVerschieben: (zielId: string) => Promise<void>;
  geschwister: GeschwisterInfo | null;
  aufGeschwisterVerschieben: (richtung: "links" | "rechts") => Promise<void>;
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
        <GeschwisterButtons geschwister={geschwister} aufVerschieben={aufGeschwisterVerschieben} />
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
 * Verwaltung der weiteren Organisationseinheiten einer Linienposition
 * (Migration 0047, Live-Rückmeldung "Einrichtungsleitung mit zwei
 * Einrichtungen"). Replace-Set wie bei der Stabsstelle-Scope-Verwaltung,
 * hier aber mit sofortiger Einzel-Aktion je Zeile (Hinzufügen/Entfernen)
 * statt eines gesammelten "Speichern" -- es ist immer nur eine einzelne
 * Einheit, die dazukommt oder wegfällt, kein mehrzeiliges Formular wie die
 * Rechte-Matrix.
 */
export function WeitereEinheiten({
  position,
  orgUnits,
  orgUnitNamen,
  onAktualisiert,
}: {
  position: PositionDto;
  orgUnits: OrgUnitDto[];
  orgUnitNamen: Map<string, string>;
  onAktualisiert: () => void;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const optionen = orgUnits.filter((u) => u.id !== position.orgUnitId && !position.weitereOrgUnitIds.includes(u.id));

  async function setzen(neu: string[]) {
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammWeitereEinheitenSetzen(position.id, neu);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Weitere Organisationseinheiten konnten nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function hinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const orgUnitId = String(new FormData(form).get("orgUnitId") ?? "");
    if (!orgUnitId) return;
    await setzen([...position.weitereOrgUnitIds, orgUnitId]);
    form.reset();
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h4>Weitere Organisationseinheiten</h4>
      <p className="zv-sub">
        Zusätzlich zur Heimat-Einheit zugeordnet -- z.B. eine Einrichtungsleitung mit zwei Einrichtungen. Wirkt sich
        sofort auf die Rechte dieser Position aus.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <ul className="zv-verlauf-liste">
        {position.weitereOrgUnitIds.map((id) => (
          <li key={id}>
            <strong>{orgUnitNamen.get(id) ?? "?"}</strong>
            <button
              className="zv-link-btn"
              type="button"
              onClick={() => setzen(position.weitereOrgUnitIds.filter((wid) => wid !== id))}
              disabled={wirdGespeichert}
            >
              <IAbbrechen />
              Entfernen
            </button>
          </li>
        ))}
        {position.weitereOrgUnitIds.length === 0 && <li className="zv-sub-inline">Keine weiteren Einheiten.</li>}
      </ul>

      {optionen.length > 0 && (
        <form onSubmit={hinzufuegen} className="zv-vorschau-zeile" style={{ marginTop: 12 }}>
          <select name="orgUnitId" defaultValue="" required aria-label="Weitere Einheit wählen">
            <option value="" disabled>
              Einheit wählen…
            </option>
            {optionen.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button className="zv-btn zv-btn-still" type="submit" disabled={wirdGespeichert}>
            <INeu />
            Hinzufügen
          </button>
        </form>
      )}
    </div>
  );
}
