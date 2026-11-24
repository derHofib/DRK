import { CSSProperties, useMemo, useState } from "react";
import type { BenutzerListEintragDto, PositionDto, SimulationZelleDto } from "@zimmerakte/shared";
import { RECHT_HERKUNFT_LABEL } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { IFehler } from "../../components/icons";
import { SCOPE_LABEL } from "./AccountTypen";

/**
 * "Anzeigen als…" -- Organigramm-Plan, Lieferreihenfolge Schritt 7/UI,
 * fuenfter Teilschritt. Rein lesend: zeigt, welche Rechte fuer eine
 * gewaehlte Person ODER eine gewaehlte Position effektiv gelten wuerden,
 * inklusive Herkunft je Zelle -- keine Mutation, kein Knopf, der etwas
 * aendert. Laedt wie AccountTypenAnsicht NICHTS automatisch beim Oeffnen
 * der Ansicht (das waere GET /rechte/simulation ohne Ziel, das die API gar
 * nicht annimmt), sondern erst nach einer tatsaechlichen Auswahl.
 *
 * Zwei getrennte Formulare (Mitarbeiter/in vs. Position) statt eines
 * gemeinsamen Ziel-Dropdowns ueber beide Listen: die beiden IDs sind nicht
 * aus demselben Wertebereich (ein Dropdown muesste sie technisch trennen,
 * um ueberhaupt zu wissen, welcher API-Parameter gemeint ist) und die
 * fachliche Frage ist ohnehin eine andere, s. RechteService.simuliereFuer-
 * Benutzer()/-Position().
 */
export function SimulationAnsicht({
  benutzerListe,
  positionen,
  orgUnitNamen,
}: {
  benutzerListe: BenutzerListEintragDto[];
  positionen: PositionDto[];
  orgUnitNamen: Map<string, string>;
}) {
  const [art, setArt] = useState<"benutzer" | "position">("benutzer");
  const [benutzerId, setBenutzerId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [zellen, setZellen] = useState<SimulationZelleDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  const positionOptionen = useMemo(
    () =>
      positionen
        .map((p) => ({ id: p.id, label: `${p.titel} (${orgUnitNamen.get(p.orgUnitId) ?? "?"})` }))
        .sort((a, b) => a.label.localeCompare(b.label, "de")),
    [positionen, orgUnitNamen]
  );

  async function simulieren(gewaehlteId: string) {
    if (!gewaehlteId) {
      setZellen(null);
      return;
    }
    setFehler(null);
    setLaedt(true);
    try {
      const ergebnis =
        art === "benutzer" ? await api.rechteSimulation({ benutzerId: gewaehlteId }) : await api.rechteSimulation({ positionId: gewaehlteId });
      setZellen(ergebnis.zellen);
    } catch (err) {
      setZellen(null);
      setFehler(err instanceof Error ? err.message : "Simulation konnte nicht geladen werden.");
    } finally {
      setLaedt(false);
    }
  }

  function artWechseln(neu: "benutzer" | "position") {
    setArt(neu);
    setBenutzerId("");
    setPositionId("");
    setZellen(null);
    setFehler(null);
  }

  return (
    <div>
      <p className="zv-sub" style={{ marginTop: -8, marginBottom: 16 }}>
        Zeigt, welche Rechte effektiv gelten würden — ändert nichts.
      </p>

      <div className="zv-segmented" role="radiogroup" aria-label="Simulieren für" style={{ marginBottom: 16 }}>
        <button
          type="button"
          role="radio"
          aria-checked={art === "benutzer"}
          className={art === "benutzer" ? "active" : ""}
          onClick={() => artWechseln("benutzer")}
        >
          Mitarbeiter/in
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={art === "position"}
          className={art === "position" ? "active" : ""}
          onClick={() => artWechseln("position")}
        >
          Position
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-field" style={{ maxWidth: 420 }}>
        {art === "benutzer" ? (
          <>
            <label htmlFor="simulation-benutzer">Mitarbeiter/in</label>
            <select
              id="simulation-benutzer"
              value={benutzerId}
              onChange={(e) => {
                setBenutzerId(e.target.value);
                void simulieren(e.target.value);
              }}
            >
              <option value="">Bitte wählen…</option>
              {benutzerListe.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label htmlFor="simulation-position">Position</label>
            <select
              id="simulation-position"
              value={positionId}
              onChange={(e) => {
                setPositionId(e.target.value);
                void simulieren(e.target.value);
              }}
            >
              <option value="">Bitte wählen…</option>
              {positionOptionen.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {laedt && <p className="zv-sub">Lädt…</p>}

      {zellen && (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Modul · Aktion</span>
            <span>Zugriff</span>
            <span>Herkunft</span>
          </div>
          {zellen.map((z) => (
            <div className="zv-info-karte" key={`${z.modul}.${z.aktion}`}>
              <span className="zv-liste-zelle-titel">
                {z.modul} · {z.aktion}
              </span>
              <span className="zv-liste-zelle" data-label="Zugriff">
                <span className={`zv-pill ${z.erlaubt ? "zv-pill-ok" : "zv-pill-neutral"}`}>
                  {z.erlaubt ? "Erlaubt" : "Kein Zugriff"}
                </span>
              </span>
              <span className="zv-liste-zelle" data-label="Herkunft">
                {RECHT_HERKUNFT_LABEL[z.herkunft]}
                {z.scope && ` · ${SCOPE_LABEL[z.scope] ?? z.scope}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
