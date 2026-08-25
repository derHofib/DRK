import { useEffect, useState } from "react";
import type { BelegungsverlaufEintragDto, ZimmerListEintragDto } from "@zimmerakte/shared";
import { ZIMMERSTATUS_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import {
  IAufklappen,
  IFehler,
  ILeerVerlauf,
  ILeerZimmer,
  ISVergeben,
  ISZugeordnet,
  IStandort,
  IVerlauf,
  IZuklappen,
} from "../components/icons";

const STATUS_ICON = {
  vergeben: ISVergeben,
  zugeordnet: ISZugeordnet,
} as const;

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
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {Object.entries(gruppen).map(([standortName, raum]) => (
        <div key={standortName} style={{ marginBottom: 28 }}>
          <div className="zv-seiten-kopf">
            <h2>
              <IStandort style={{ verticalAlign: "-3px", marginRight: 6 }} />
              {standortName}
            </h2>
          </div>
          <div className="zv-room-grid">
            {raum.map((z) => {
              const StatusIcon = STATUS_ICON[z.status];
              return (
              <div key={z.id} className="zv-room-card">
                <div className="zv-room-head">
                  <span className="zv-room-nummer">{z.nummer}</span>
                  <span className={`zv-pill zv-pill-${z.status}`}>
                    <StatusIcon />
                    {ZIMMERSTATUS_LABEL[z.status]}
                  </span>
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
                  {offenesZimmer === z.id ? <IZuklappen /> : <IVerlauf />}
                  {offenesZimmer === z.id ? "Verlauf ausblenden" : "Belegungsverlauf"}
                  {offenesZimmer !== z.id && <IAufklappen />}
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
              );
            })}
          </div>
        </div>
      ))}

      {zimmer.length === 0 && !fehler && (
        <Leerzustand icon={ILeerZimmer}>Noch keine Zimmer angelegt.</Leerzustand>
      )}
    </div>
  );
}
