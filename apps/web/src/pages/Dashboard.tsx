import { useEffect, useState } from "react";
import type { BenutzerListEintragDto, MandantDto } from "@zimmerakte/shared";
import { BENUTZER_ROLLE_LABEL } from "@zimmerakte/shared";
import { api, clearToken } from "../api/client";

/**
 * Zeigt bewusst nur: den eigenen Mandanten und die Benutzerliste. Beides
 * ist reiner RLS-Beweis fuer die Entwicklung -- keine echte Fachfunktion.
 * Die eigentlichen Bildschirme (Klienten, Zimmer, Kassenbuch) entstehen in
 * Phase 1+, sobald das jeweilige Schema steht.
 */
export function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [mandant, setMandant] = useState<MandantDto | null>(null);
  const [benutzer, setBenutzer] = useState<BenutzerListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.eigenerMandant(), api.benutzerListe()])
      .then(([m, b]) => {
        setMandant(m);
        setBenutzer(b);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen."));
  }, []);

  function logout() {
    clearToken();
    onLoggedOut();
  }

  return (
    <div>
      <div className="zv-topbar">
        <div>
          <strong>Zimmerakte</strong>{" "}
          {mandant && <span>{mandant.name} · {mandant.slug}</span>}
        </div>
        <button className="zv-btn" style={{ width: "auto", padding: "6px 14px" }} onClick={logout}>
          Abmelden
        </button>
      </div>

      <div className="zv-content">
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
    </div>
  );
}
