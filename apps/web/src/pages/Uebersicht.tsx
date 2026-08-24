import { useEffect, useState } from "react";
import type { BenutzerListEintragDto } from "@zimmerakte/shared";
import { BENUTZER_ROLLE_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";

export function Uebersicht() {
  const [benutzer, setBenutzer] = useState<BenutzerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    api.benutzerListe().then(setBenutzer).catch((err) => setFehler(err.message));
  }, []);

  return (
    <div>
      {fehler && <div className="zv-error">{fehler}</div>}

      <h2 style={{ fontSize: 16 }}>Mitarbeitende im eigenen Mandanten</h2>
      <table className="zv-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>E-Mail</th>
            <th>Rolle</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {benutzer.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>{b.email}</td>
              <td>
                <span className="zv-pill">{BENUTZER_ROLLE_LABEL[b.rolle]}</span>
              </td>
              <td>{b.aktiv ? "Aktiv" : "Inaktiv"}</td>
            </tr>
          ))}
          {benutzer.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "var(--zv-text-faint)", padding: 16 }}>
                Keine Mitarbeitenden gefunden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
