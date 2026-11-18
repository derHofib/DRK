import { useEffect, useState } from "react";
import type { FormularDto, FormularVorlageDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { IArchivieren, IEntarchivieren, IFehler, INeu } from "../components/icons";

/**
 * Formulare fuer Protokolle (Schritt 1: nur aus der Vorlagenbibliothek; der
 * Editor aus Bausteinen folgt in Schritt 2). Eine uebernommene Vorlage ist
 * eine Kopie im Traeger -- spaetere Aenderungen an der Vorlage wirken nie
 * auf sie. Stilllegen statt Loeschen: alte Protokolle zeigen auf das Formular.
 */
export function FormulareVerwaltung() {
  const [formulare, setFormulare] = useState<FormularDto[]>([]);
  const [vorlagen, setVorlagen] = useState<FormularVorlageDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  function laden() {
    api.formulare().then(setFormulare).catch((err) => setFehler(err.message));
    api.formularVorlagen().then(setVorlagen).catch((err) => setFehler(err.message));
  }
  useEffect(laden, []);

  async function ausfuehren(schluessel: string, fn: () => Promise<unknown>) {
    setFehler(null);
    setLaeuft(schluessel);
    try {
      await fn();
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
    } finally {
      setLaeuft(null);
    }
  }

  const offen = vorlagen.filter((v) => !v.uebernommen);

  return (
    <div className="zv-einstellungen-raster">
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <section className="zv-einstellungen-abschnitt">
        <h3>Formulare dieses Trägers</h3>
        {formulare.length === 0 ? (
          <p className="zv-sub">Noch keine Formulare. Übernimm eine Vorlage, dann können alle mit dem passenden Recht Protokolle damit ausfüllen.</p>
        ) : (
          <ul className="zv-formular-liste">
            {formulare.map((f) => (
              <li key={f.id}>
                <div>
                  <strong>{f.name}</strong>
                  {f.archiviert && <span className="zv-pill zv-formular-stillgelegt">stillgelegt</span>}
                  <div className="zv-formular-meta">
                    Version {f.aktuelleVersion?.nummer ?? "–"} · {f.anzahlProtokolle} {f.anzahlProtokolle === 1 ? "Protokoll" : "Protokolle"}
                  </div>
                </div>
                <button
                  type="button"
                  className="zv-btn zv-btn-sekundaer zv-btn-klein"
                  disabled={laeuft === f.id}
                  onClick={() => ausfuehren(f.id, () => api.formularArchivieren(f.id, !f.archiviert))}
                >
                  {f.archiviert ? <IEntarchivieren /> : <IArchivieren />}
                  {f.archiviert ? "Wieder aktivieren" : "Stilllegen"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="zv-einstellungen-abschnitt">
        <h3>Vorlagen</h3>
        {offen.length === 0 ? (
          <p className="zv-sub">Alle mitgelieferten Vorlagen sind übernommen.</p>
        ) : (
          <ul className="zv-formular-liste">
            {offen.map((v) => (
              <li key={v.schluessel}>
                <div>
                  <strong>{v.name}</strong>
                  <div className="zv-formular-meta">{v.beschreibung}</div>
                </div>
                <button
                  type="button"
                  className="zv-btn zv-btn-klein"
                  disabled={laeuft === v.schluessel}
                  onClick={() => ausfuehren(v.schluessel, () => api.formularVorlageUebernehmen(v.schluessel))}
                >
                  <INeu />
                  Übernehmen
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="zv-sub">Eigene Formulare aus Bausteinen folgen mit dem Formular-Editor.</p>
      </section>
    </div>
  );
}
