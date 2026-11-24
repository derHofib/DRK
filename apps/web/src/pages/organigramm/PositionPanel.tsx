import { FormEvent, useState } from "react";
import type { BenutzerListEintragDto, BesetzungDto, OrgUnitDto, PositionDto } from "@zimmerakte/shared";
import { POSITION_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Modal } from "../../components/Modal";
import {
  IAbbrechen,
  IAuszug,
  IDeaktivieren,
  IEinziehen,
  IFehler,
  IPosition,
  IVerknuepft,
  IVerschieben,
} from "../../components/icons";
import { Datumsfeld } from "../../components/Datumsfeld";
import { type ZielOption, datumAnzeige, heute, positionsStatus } from "./baum";
import { GeschwisterButtons, type GeschwisterInfo } from "./KnotenBox";
import { WeitereEinheiten } from "./EinheitPanel";

/**
 * Seitenpanel-Inhalt fuer eine Position: Stammdaten, die aktiven
 * Besetzungen (mit "seit"-Datum) je mit "Beenden", sowie "Besetzen" und
 * "Deaktivieren". Siehe EinheitPanel fuer die Begruendung, warum die
 * Aktionen hier nicht clientseitig nach Rolle ausgeblendet werden.
 */
export function PositionPanel({
  position,
  accountTypNamen,
  benutzerListe,
  orgUnits,
  orgUnitNamen,
  positionen,
  verschiebenZiele,
  aufVerschieben,
  istWeitereZuordnung,
  geschwister,
  aufGeschwisterVerschieben,
  onAktualisiert,
}: {
  position: PositionDto;
  accountTypNamen: Map<string, string>;
  benutzerListe: BenutzerListEintragDto[];
  orgUnits: OrgUnitDto[];
  orgUnitNamen: Map<string, string>;
  /** Alle Positionen des Mandanten -- fuer "wo ist diese Person sonst noch
   *  zugeordnet" unter jeder Besetzung (siehe andereZuordnungenVon unten). */
  positionen: PositionDto[];
  verschiebenZiele: ZielOption[];
  aufVerschieben: (zielId: string) => Promise<void>;
  istWeitereZuordnung: boolean;
  geschwister: GeschwisterInfo | null;
  aufGeschwisterVerschieben: (richtung: "links" | "rechts") => Promise<void>;
  onAktualisiert: () => void;
}) {
  const [besetzenOffen, setBesetzenOffen] = useState(false);
  const [beendenBesetzung, setBeendenBesetzung] = useState<BesetzungDto | null>(null);
  const [deaktivierenOffen, setDeaktivierenOffen] = useState(false);
  const [verschiebenOffen, setVerschiebenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const status = positionsStatus(position);

  /**
   * Alle anderen aktiven Positionen, auf denen dieselbe Person gerade
   * sitzt -- z.B. eine Bezugsbetreuung, die zusaetzlich Mitglied einer
   * zweiten Einheit ist. Ohne "organigramm.personendaten-sehen" liefert
   * der Server ueberall benutzerId=null (siehe BesetzungDto-Kommentar in
   * packages/shared), dann bleibt die Liste leer statt falsch zu raten.
   */
  function andereZuordnungenVon(benutzerId: string | null): PositionDto[] {
    if (!benutzerId) return [];
    return positionen.filter(
      (p) => p.id !== position.id && p.aktiv && p.besetztMit.some((b) => b.benutzerId === benutzerId)
    );
  }

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

      {istWeitereZuordnung && (
        <div className="zv-hinweis zv-hinweis-info" style={{ marginTop: 16 }}>
          <IVerknuepft />
          Weitere Organisationseinheit dieser Position -- Heimat-Einheit: {orgUnitNamen.get(position.orgUnitId) ?? "?"}
          . Besetzen/Verschieben/Reihenfolge gelten nur dort, siehe die Karte in der Heimat-Einheit.
        </div>
      )}

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" style={{ marginTop: 16 }}>
          <IFehler />
          {fehler}
        </div>
      )}

      {!istWeitereZuordnung && (
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
          <GeschwisterButtons geschwister={geschwister} aufVerschieben={aufGeschwisterVerschieben} />
        </div>
      )}

      {!istWeitereZuordnung && position.typ === "linie" && (
        <WeitereEinheiten position={position} orgUnits={orgUnits} orgUnitNamen={orgUnitNamen} onAktualisiert={onAktualisiert} />
      )}

      <h4 style={{ marginTop: 20 }}>Besetzungen</h4>
      <ul className="zv-verlauf-liste">
        {position.besetztMit.map((b) => {
          const andereZuordnungen = andereZuordnungenVon(b.benutzerId);
          return (
            <li key={b.besetzungId}>
              <strong>{b.benutzerName ?? "Namen ausgeblendet"}</strong>
              <span className="zv-sub-inline" style={{ whiteSpace: "nowrap" }}>
                seit {datumAnzeige(b.gueltigAb)}
              </span>
              <button className="zv-link-btn" type="button" onClick={() => setBeendenBesetzung(b)}>
                <IAuszug />
                Beenden
              </button>
              {andereZuordnungen.length > 0 && (
                <div className="zv-sub-inline-zeile zv-weitere-zuordnungen">
                  <span className="zv-sub-inline" style={{ marginLeft: 0 }}>
                    Auch zugeordnet:
                  </span>
                  {andereZuordnungen.map((p) => (
                    <span key={p.id} className="zv-pill zv-pill-vergeben">
                      <IPosition />
                      {p.titel} · {orgUnitNamen.get(p.orgUnitId) ?? "?"}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
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
                {benutzerListe
                  .filter((b) => b.aktiv)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="zv-field">
              <label htmlFor="besetzen-gueltig-ab">Besetzt ab</label>
              <Datumsfeld id="besetzen-gueltig-ab" name="gueltigAb" defaultValue={heute()} schnellwahl="heute" />
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
              <Datumsfeld id="beenden-datum" name="gueltigBis" defaultValue={heute()} schnellwahl="heute" />
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
