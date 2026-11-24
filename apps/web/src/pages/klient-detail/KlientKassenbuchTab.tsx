import { CSSProperties, useEffect, useState } from "react";
import type { KassenbuchungDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import { IFehler, IHerunterladen, ILeerKassenbuch, ISErledigt, ISStorniert } from "../../components/icons";
import { formatBetrag, formatDatum, heuteBerlin } from "../../format";
import { Monatsfeld } from "../../components/Datumsfeld";

export function KlientKassenbuchTab({ klientId }: { klientId: string }) {
  const [buchungen, setBuchungen] = useState<KassenbuchungDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  // Vormonat als Vorgabe: ein Monatsabschluss wird nach Monatsende gemacht.
  const [abschlussMonat, setAbschlussMonat] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [abschlussLaeuft, setAbschlussLaeuft] = useState(false);

  async function monatsabschlussHerunterladen() {
    setAbschlussLaeuft(true);
    setFehler(null);
    try {
      await api.kassenbuchMonatsabschlussHerunterladen(klientId, abschlussMonat);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Monatsabschluss konnte nicht erstellt werden.");
    } finally {
      setAbschlussLaeuft(false);
    }
  }

  useEffect(() => {
    api.kassenbuchungenListe({ klientId }).then(setBuchungen).catch((err) => setFehler(err.message));
  }, [klientId]);

  return (
    <div>
      <div className="zv-werkzeugzeile">
        <label htmlFor="kb-abschluss-monat" id="kb-abschluss-monat-label">
          Monatsabschluss für
        </label>
        {/* Zukuenftige Monate gesperrt (es gibt noch nichts abzuschliessen),
            der laufende erlaubt: ein vorlaeufiger Abschluss zur Monatsmitte
            wird fuer Amtsnachfragen gebraucht. */}
        <Monatsfeld
          id="kb-abschluss-monat"
          aria-labelledby="kb-abschluss-monat-label"
          value={abschlussMonat}
          max={heuteBerlin().slice(0, 7)}
          onChange={setAbschlussMonat}
        />
        <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={monatsabschlussHerunterladen} disabled={abschlussLaeuft || !abschlussMonat}>
          <IHerunterladen />
          {abschlussLaeuft ? "Wird erstellt …" : "Als PDF"}
        </button>
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {buchungen.length === 0 ? (
        <Leerzustand icon={ILeerKassenbuch}>Keine Kassenbuch-Einträge für diese Klient:in.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1fr 1.2fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Zweck</span>
            <span>Datum</span>
            <span>Betrag</span>
            <span>Typ</span>
            <span>Status</span>
          </div>
          {buchungen.map((b) => (
            <div key={b.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{b.verwendungszweck}</span>
              <span className="zv-liste-zelle" data-label="Datum">
                <strong>{formatDatum(b.datum)}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Betrag">
                <strong
                  className="zv-mono"
                  style={{ color: b.betragCent < 0 ? "var(--zv-status-danger)" : "var(--zv-status-ok)" }}
                >
                  {formatBetrag(b.betragCent)}
                </strong>
              </span>
              <span className="zv-liste-zelle" data-label="Typ">
                {b.typBezeichnung}
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                {b.storniert ? (
                  <span className="zv-pill zv-pill-vergeben">
                    <ISStorniert />
                    Storniert
                  </span>
                ) : (
                  <span className="zv-pill zv-pill-ok">
                    <ISErledigt />
                    Aktiv
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
