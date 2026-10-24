import { useEffect, useState } from "react";
import type { MitarbeiterProfilFuerKlientDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { MitarbeiterProfilKarte } from "./MitarbeiterProfilKarte";

/** Das fuer eine Klient-Sitzung freigegebene Profil einer Mitarbeiter:in. */
export function MitarbeiterProfilKlient({ benutzerId }: { benutzerId: string }) {
  const [profil, setProfil] = useState<MitarbeiterProfilFuerKlientDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    setProfil(null);
    setFehler(null);
    api
      .mitarbeiterProfilFuerKlient(benutzerId)
      .then(setProfil)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Das Profil konnte nicht geladen werden."));
  }, [benutzerId]);

  if (fehler) return <p className="zv-sub">{fehler}</p>;
  if (!profil) return <p className="zv-sub">Wird geladen…</p>;
  return (
    <div>
      <div className="zv-profil-kopf">
        <strong>{profil.name}</strong>
        {profil.zugeordnet && <span className="zv-pill">Deine Bezugsbetreuung</span>}
      </div>
      <MitarbeiterProfilKarte inhalt={profil} leerText={`${profil.name} hat keine Kontaktangaben freigegeben.`} />
    </div>
  );
}
