import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { RechnungDto, RechnungStatus } from "@zimmerakte/shared";
import { RECHNUNG_STATUS_LABEL } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { GrundAbfrage } from "../../components/GrundAbfrage";
import { Leerzustand } from "../../components/Leerzustand";
import {
  IAbbrechen,
  IAblehnen,
  IAuszahlen,
  IDokument,
  IFehler,
  IGenehmigen,
  ILeerRechnungen,
  INeu,
  ISpeichern,
} from "../../components/icons";
import { dateiZuBase64 } from "../../datei";
import { formatBetrag, formatDatum } from "../../format";

export function RechnungenTab({ klientId }: { klientId: string }) {
  const [liste, setListe] = useState<RechnungDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const [offenesDokument, setOffenesDokument] = useState<{ id: string; url: string } | null>(null);
  const [ablehnenRechnung, setAblehnenRechnung] = useState<RechnungDto | null>(null);

  function laden() {
    api.rechnungenListe(klientId).then(setListe).catch((err) => setFehler(err.message));
  }
  useEffect(laden, [klientId]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const betragCent = Math.round(Number(String(form.get("betrag")).replace(",", ".")) * 100);
    const datei = form.get("dokument") as File | null;

    setWirdGespeichert(true);
    try {
      let dokumentBase64: string | undefined;
      let dokumentDateiname: string | undefined;
      let dokumentMimeType: string | undefined;
      if (datei && datei.size > 0) {
        dokumentBase64 = await dateiZuBase64(datei);
        dokumentDateiname = datei.name;
        dokumentMimeType = datei.type || "application/octet-stream";
      }
      await api.rechnungAnlegen({
        klientId,
        betragCent,
        beschreibung: String(form.get("beschreibung")),
        dokumentBase64,
        dokumentDateiname,
        dokumentMimeType,
      });
      setFormularOffen(false);
      formElement.reset();
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Rechnung konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function statusAendern(r: RechnungDto, status: RechnungStatus, grund?: string) {
    try {
      await api.rechnungStatusAendern(r.id, status, grund);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Status konnte nicht geändert werden.");
    }
  }

  async function dokumentAnzeigen(id: string) {
    if (offenesDokument?.id === id) {
      setOffenesDokument(null);
      return;
    }
    try {
      const url = await api.rechnungDokumentUrl(id);
      setOffenesDokument({ id, url });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Dokument konnte nicht geladen werden.");
    }
  }

  // Jedes geoeffnete Dokument ist eine eigene Blob-URL (api/client.ts,
  // blobUrl()) -- ohne ausdrueckliches revokeObjectURL haelt der Browser es
  // im Speicher, auch nachdem es geschlossen oder durch ein anderes ersetzt
  // wurde. Der Cleanup einer useEffect-Instanz laeuft automatisch vor der
  // naechsten Zuweisung UND beim Unmount -- deckt "wechseln", "schliessen"
  // und "Seite verlassen" mit derselben Zeile ab (gleiches Muster wie
  // Kassenbuch.tsx bei den Unterschriften).
  useEffect(() => {
    if (!offenesDokument) return;
    const url = offenesDokument.url;
    return () => URL.revokeObjectURL(url);
  }, [offenesDokument]);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Rechnungen</h3>
        <button
          className="zv-btn"
          onClick={() => setFormularOffen((v) => !v)}
        >
          {formularOffen ? <IAbbrechen /> : <INeu />}
          {formularOffen ? "Abbrechen" : "Neue Rechnung"}
        </button>
      </div>

      {formularOffen && (
        <form className="zv-inline-form" onSubmit={anlegen}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label>Betrag (€)</label>
              <input name="betrag" type="text" inputMode="decimal" placeholder="150,00" required />
            </div>
            <div className="zv-field">
              <label>Beschreibung</label>
              <input name="beschreibung" required />
            </div>
          </div>
          <div className="zv-field">
            <label>Dokument (optional)</label>
            <input name="dokument" type="file" accept="application/pdf,image/*" />
          </div>
          <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
            <ISpeichern />
            {wirdGespeichert ? "Speichert…" : "Rechnung anlegen"}
          </button>
        </form>
      )}

      {liste.length === 0 ? (
        <Leerzustand icon={ILeerRechnungen}>Noch keine Rechnungen erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1.4fr 1.8fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Beschreibung</span>
            <span>Datum</span>
            <span>Betrag</span>
            <span>Status</span>
            <span></span>
          </div>
          {liste.map((r) => (
            <div key={r.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{r.beschreibung}</span>
              <span className="zv-liste-zelle" data-label="Datum">
                <strong>{formatDatum(r.erstelltAm.slice(0, 10))}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Betrag">
                <strong className="zv-mono">{formatBetrag(r.betragCent)}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <span
                  className={`zv-pill ${
                    r.status === "abgelehnt" ? "zv-pill-danger" : r.status === "ausgezahlt" ? "zv-pill-ok" : r.status === "genehmigt" ? "zv-pill-info" : "zv-pill-offen"
                  }`}
                >
                  {RECHNUNG_STATUS_LABEL[r.status]}
                </span>
                {r.status === "abgelehnt" && r.statusGrund && <span className="zv-sub-inline">{r.statusGrund}</span>}
              </span>
              <span className="zv-liste-zelle-aktionen">
                {r.hatDokument && (
                  <button className="zv-link-btn" onClick={() => dokumentAnzeigen(r.id)}>
                    <IDokument />
                    Dokument
                  </button>
                )}
                {r.status === "beantragt" && (
                  <>
                    <button className="zv-link-btn" onClick={() => statusAendern(r, "genehmigt")}>
                      <IGenehmigen />
                      Genehmigen
                    </button>
                    <button className="zv-link-btn" onClick={() => setAblehnenRechnung(r)}>
                      <IAblehnen />
                      Ablehnen
                    </button>
                  </>
                )}
                {r.status === "genehmigt" && (
                  <button className="zv-link-btn" onClick={() => statusAendern(r, "ausgezahlt")}>
                    <IAuszahlen />
                    Auszahlen
                  </button>
                )}
              </span>
              {offenesDokument?.id === r.id && (
                <div style={{ gridColumn: "1 / -1", marginTop: "var(--zv-space-2)" }}>
                  <a href={offenesDokument.url} target="_blank" rel="noreferrer">
                    Dokument in neuem Tab öffnen
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {ablehnenRechnung && (
        <GrundAbfrage
          titel="Rechnung ablehnen"
          label="Grund für die Ablehnung"
          bestaetigenText="Ablehnen"
          onAbbrechen={() => setAblehnenRechnung(null)}
          onBestaetigen={(grund) => {
            statusAendern(ablehnenRechnung, "abgelehnt", grund);
            setAblehnenRechnung(null);
          }}
        />
      )}
    </div>
  );
}
