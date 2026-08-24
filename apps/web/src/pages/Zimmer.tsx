import { useEffect, useState } from "react";
import type { BelegungsverlaufEintragDto, ZimmerListEintragDto } from "@zimmerakte/shared";
import { ZIMMERSTATUS_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";

/**
 * Zeigt bewusst nur, was die API tatsächlich zurückgibt -- "status" wird
 * hier nie berechnet, nur anzeigt. Die Ableitung passiert serverseitig
 * (siehe zimmer.service.ts), das Frontend ist hier absichtlich dumm.
 */
export function Zimmer() {
  const [zimmer, setZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenesZimmer, setOffenesZimmer] = useState<string | null>(null);
  const [verlauf, setVerlauf] = useState<BelegungsverlaufEintragDto[]>([]);

  useEffect(() => {
    api.zimmerListe().then(setZimmer).catch((err) => setFehler(err.message));
  }, []);

  async function verlaufAnzeigen(zimmerId: string) {
    if (offenesZimmer === zimmerId) {
      setOffenesZimmer(null);
      return;
    }
    setOffenesZimmer(zimmerId);
    try {
      setVerlauf(await api.belegungsverlauf(zimmerId));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Belegungsverlauf konnte nicht geladen werden.");
    }
  }

  const gruppen = zimmer.reduce<Record<string, ZimmerListEintragDto[]>>((acc, z) => {
    (acc[z.standortName] ??= []).push(z);
    return acc;
  }, {});

  return (
    <div>
      {fehler && <div className="zv-error">{fehler}</div>}

      {Object.entries(gruppen).map(([standortName, raum]) => (
        <div key={standortName} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>{standortName}</h2>
          <div className="zv-room-grid">
            {raum.map((z) => (
              <div key={z.id} className="zv-room-card">
                <div className="zv-room-head">
                  <span className="zv-room-nummer">{z.nummer}</span>
                  <span className={`zv-pill zv-pill-${z.status}`}>{ZIMMERSTATUS_LABEL[z.status]}</span>
                </div>
                {z.aktuellerKlient ? (
                  <div className="zv-room-klient">
                    {z.aktuellerKlient.name}
                    <span className="zv-sub-inline">seit {z.aktuellerKlient.einzug}</span>
                  </div>
                ) : (
                  <div className="zv-room-klient zv-sub-inline">Kein Klient zugeordnet</div>
                )}
                <button className="zv-link-btn" onClick={() => verlaufAnzeigen(z.id)}>
                  {offenesZimmer === z.id ? "Verlauf ausblenden" : "Belegungsverlauf"}
                </button>

                {offenesZimmer === z.id && (
                  <ul className="zv-verlauf-liste">
                    {verlauf.map((v) => (
                      <li key={v.id}>
                        <strong>{v.name}</strong>
                        <span className="zv-sub-inline">
                          {v.einzug} – {v.auszug ?? "heute"}
                        </span>
                      </li>
                    ))}
                    {verlauf.length === 0 && <li className="zv-sub-inline">Noch keine Belegung erfasst.</li>}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {zimmer.length === 0 && !fehler && (
        <p style={{ color: "var(--zv-text-faint)" }}>Noch keine Zimmer angelegt.</p>
      )}
    </div>
  );
}
