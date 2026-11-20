import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  LEISTUNGSARTEN,
  LEISTUNGSART_LABEL,
  formatMinutenAlsStunden,
  type BenutzerListEintragDto,
  type KlientListEintragDto,
  type Leistungsart,
  type StundenbuchungDto,
  type StundenSummeDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { formatDatum, heuteBerlin } from "../format";
import { AktionsMenue } from "../components/AktionsMenue";
import { FilterAuswahl, FilterPille } from "../components/Filterleiste";
import { GrundAbfrage } from "../components/GrundAbfrage";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { IFehler, IFilterLoeschen, IKalender, IKlienten, ILeerStunden, INeu, IPerson, ISpeichern, IStornieren, ISuche } from "../components/icons";
import { SCHNELLWAHL_LABEL, zeitraumFuer, type Schnellwahl } from "./tagesberichte-filter";
import { Datumsfeld } from "../components/Datumsfeld";
import { ZeitraumAuswahl } from "../components/ZeitraumAuswahl";
import { zeitraumKurz } from "../components/datumsfeld-logik";

const MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function monatText(monat: string): string {
  const [jahr, m] = monat.split("-");
  return `${MONATSNAMEN[Number(m) - 1]} ${jahr}`;
}

/**
 * Stundenbuchung: geleistete Betreuungszeit je Klient:in. Eine Buchung wird
 * nie geaendert, nur storniert (Migration 0072) -- deshalb gibt es hier
 * "Buchen" und "Stornieren", aber kein "Bearbeiten". Die Summen kommen vom
 * Server (aus den nicht stornierten Buchungen), nicht aus der angezeigten
 * Liste: die Suche unten filtert nur die Anzeige und darf den Saldo nicht
 * veraendern.
 */
export function Stunden() {
  const [buchungen, setBuchungen] = useState<StundenbuchungDto[]>([]);
  const [summen, setSummen] = useState<StundenSummeDto[]>([]);
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [mitarbeitende, setMitarbeitende] = useState<BenutzerListEintragDto[]>([]);
  const [rechte, setRechte] = useState<{ ansehen: boolean; buchen: boolean; fuerAndereBuchen: boolean } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [stornoZiel, setStornoZiel] = useState<StundenbuchungDto | null>(null);

  const [schnellwahl, setSchnellwahl] = useState<Schnellwahl | null>("monat");
  const [von, setVon] = useState(() => zeitraumFuer("monat").von);
  const [bis, setBis] = useState(() => zeitraumFuer("monat").bis);
  const [klientFilter, setKlientFilter] = useState("");
  const [mitarbeiterFilter, setMitarbeiterFilter] = useState("");
  const [suche, setSuche] = useState("");

  function laden() {
    const filter = { von, bis, klientId: klientFilter || undefined, mitarbeiterId: mitarbeiterFilter || undefined };
    Promise.all([api.stundenListe(filter), api.stundenSummen(filter)])
      .then(([liste, summe]) => {
        setBuchungen(liste);
        setSummen(summe);
        setFehler(null);
      })
      .catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    api.stundenRechte().then(setRechte).catch((err) => setFehler(err.message));
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
    api.benutzerListe().then(setMitarbeitende).catch(() => setMitarbeitende([]));
  }, []);

  useEffect(() => {
    if (von && bis && von > bis) return;
    if (rechte && !rechte.ansehen) return;
    laden();
  }, [von, bis, klientFilter, mitarbeiterFilter, rechte]);

  function schnellwahlWaehlen(wahl: Schnellwahl) {
    const z = zeitraumFuer(wahl);
    setSchnellwahl(wahl);
    setVon(z.von);
    setBis(z.bis);
  }

  const zeitraumUngueltig = Boolean(von && bis && von > bis);
  const sichtbar = useMemo(() => {
    const q = suche.trim().toLocaleLowerCase("de");
    if (!q) return buchungen;
    return buchungen.filter((b) =>
      [b.klientName, b.mitarbeiterName ?? "", b.notiz ?? "", LEISTUNGSART_LABEL[b.leistungsart]].some((f) => f.toLocaleLowerCase("de").includes(q))
    );
  }, [buchungen, suche]);

  const gesamtMinuten = summen.reduce((s, x) => s + x.minuten, 0);
  const klientText = klienten.find((k) => k.id === klientFilter);
  const mitarbeiterText = mitarbeitende.find((m) => m.id === mitarbeiterFilter);
  const zeitraumText = schnellwahl
    ? SCHNELLWAHL_LABEL[schnellwahl]
    : zeitraumKurz(von, bis) || null;
  const filterAktiv = Boolean(klientFilter || mitarbeiterFilter || suche.trim() || schnellwahl !== "monat");

  function alleZuruecksetzen() {
    schnellwahlWaehlen("monat");
    setKlientFilter("");
    setMitarbeiterFilter("");
    setSuche("");
  }

  async function stornieren(grund: string) {
    if (!stornoZiel) return;
    const ziel = stornoZiel;
    setStornoZiel(null);
    try {
      await api.stundenStornieren(ziel.id, grund);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Buchung konnte nicht storniert werden.");
    }
  }

  if (rechte && !rechte.ansehen) {
    return (
      <div>
        <div className="zv-seiten-kopf">
          <h2>Stunden</h2>
        </div>
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          Für die Stundenbuchung fehlt die Berechtigung. Bitte die Leitung, sie in den Account-Typ-Rechten („Stunden“) zu vergeben.
        </div>
      </div>
    );
  }

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Stunden</h2>
        {rechte?.buchen && (
          <button className="zv-btn" onClick={() => setFormularOffen(true)}>
            <INeu />
            Stunden buchen
          </button>
        )}
      </div>

      {formularOffen && (
        <BuchungsFormular
          klienten={klienten}
          mitarbeitende={mitarbeitende.filter((m) => m.aktiv)}
          fuerAndereBuchen={rechte?.fuerAndereBuchen ?? false}
          startKlientId={klientFilter}
          onClose={() => setFormularOffen(false)}
          onGebucht={() => {
            setFormularOffen(false);
            laden();
          }}
        />
      )}

      {stornoZiel && (
        <GrundAbfrage
          titel="Stundenbuchung stornieren"
          label={`Grund für das Storno von ${formatMinutenAlsStunden(stornoZiel.minuten)} am ${formatDatum(stornoZiel.datum)} (${stornoZiel.klientName})`}
          bestaetigenText="Stornieren"
          onBestaetigen={stornieren}
          onAbbrechen={() => setStornoZiel(null)}
        />
      )}

      <div className="zv-filterleiste" role="search" aria-label="Stunden filtern">
        <label className="zv-filter-suche">
          <ISuche />
          <input type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen…" aria-label="Stundenbuchungen durchsuchen" />
        </label>

        <FilterPille
          icon={<IKalender />}
          label="Zeitraum"
          breit
          wert={schnellwahl === "monat" ? null : zeitraumText ? `: ${zeitraumText}` : ""}
          onEntfernen={() => schnellwahlWaehlen("monat")}
        >
          {(schliessen) => (
            <ZeitraumAuswahl
              idPraefix="std"
              schnellwahl={schnellwahl}
              von={von}
              bis={bis}
              onSchnellwahl={(w) => {
                schnellwahlWaehlen(w);
                schliessen();
              }}
              onUebernehmen={(v, b) => {
                setSchnellwahl(null);
                setVon(v);
                setBis(b);
                schliessen();
              }}
            />
          )}
        </FilterPille>

        <FilterPille
          icon={<IKlienten />}
          label="Klient:in"
          wert={klientText ? `: ${klientText.vorname} ${klientText.nachname}` : null}
          onEntfernen={() => setKlientFilter("")}
        >
          {(schliessen) => (
            <FilterAuswahl
              optionen={klienten.map((k) => ({ wert: k.id, label: `${k.vorname} ${k.nachname}` }))}
              gewaehlt={klientFilter || null}
              onWaehlen={(id) => {
                setKlientFilter(id);
                schliessen();
              }}
            />
          )}
        </FilterPille>

        <FilterPille icon={<IPerson />} label="Mitarbeiter:in" wert={mitarbeiterText ? `: ${mitarbeiterText.name}` : null} onEntfernen={() => setMitarbeiterFilter("")}>
          {(schliessen) => (
            <FilterAuswahl
              optionen={mitarbeitende.map((m) => ({ wert: m.id, label: m.name }))}
              gewaehlt={mitarbeiterFilter || null}
              onWaehlen={(id) => {
                setMitarbeiterFilter(id);
                schliessen();
              }}
            />
          )}
        </FilterPille>

        <span className="zv-filter-trenner" aria-hidden="true" />

        <button type="button" className="zv-icon-btn" aria-label="Alle Filter zurücksetzen" title="Alle Filter zurücksetzen" disabled={!filterAktiv} onClick={alleZuruecksetzen}>
          <IFilterLoeschen />
        </button>
      </div>

      {zeitraumUngueltig && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          „Von“ liegt nach „Bis“ – bitte den Zeitraum korrigieren.
        </div>
      )}

      {summen.length > 0 && (
        <section aria-label="Stundensaldo" style={{ marginBottom: "var(--zv-space-4)" }}>
          <h3 className="zv-gruppe-kopf">
            Saldo im Zeitraum: <strong>{formatMinutenAlsStunden(gesamtMinuten)}</strong>
          </h3>
          <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.4fr 1.2fr 1fr 0.8fr" } as CSSProperties}>
            <div className="zv-liste-kopf">
              <span>Klient:in</span>
              <span>Monat</span>
              <span>Stunden</span>
              <span>Buchungen</span>
            </div>
            {summen.map((s) => (
              <div key={`${s.klientId}-${s.monat}`} className="zv-info-karte">
                <span className="zv-liste-zelle-titel">{s.klientName}</span>
                <span className="zv-liste-zelle" data-label="Monat">
                  {monatText(s.monat)}
                </span>
                <span className="zv-liste-zelle" data-label="Stunden">
                  <strong>{formatMinutenAlsStunden(s.minuten)}</strong>
                </span>
                <span className="zv-liste-zelle" data-label="Buchungen">
                  {s.anzahl}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="zv-sub-inline" aria-live="polite" style={{ marginBottom: "var(--zv-space-3)" }}>
        {sichtbar.length} {sichtbar.length === 1 ? "Buchung" : "Buchungen"}
      </div>

      {sichtbar.length === 0 ? (
        <Leerzustand
          icon={ILeerStunden}
          aktion={
            !filterAktiv && rechte?.buchen ? (
              <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => setFormularOffen(true)}>
                Stunden buchen
              </button>
            ) : undefined
          }
        >
          {filterAktiv ? "Keine Buchungen für diese Auswahl." : "In diesem Zeitraum sind noch keine Stunden gebucht."}
        </Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.9fr 1.3fr 1.3fr 1.1fr 0.8fr 2fr 0.6fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Datum</span>
            <span>Klient:in</span>
            <span>Mitarbeiter:in</span>
            <span>Leistung</span>
            <span>Dauer</span>
            <span>Notiz</span>
            <span />
          </div>
          {sichtbar.map((b) => (
            <div key={b.id} className="zv-info-karte" style={b.storniert ? { opacity: 0.65 } : undefined}>
              <span className="zv-liste-zelle-titel">
                <span style={b.storniert ? { textDecoration: "line-through" } : undefined}>{formatDatum(b.datum)}</span>
              </span>
              <span className="zv-liste-zelle" data-label="Klient:in">
                {b.klientName}
              </span>
              <span className="zv-liste-zelle" data-label="Mitarbeiter:in">
                {b.mitarbeiterName ?? "–"}
                {b.gebuchtVonName && b.gebuchtVonName !== b.mitarbeiterName && <span className="zv-sub-inline"> (eingetragen von {b.gebuchtVonName})</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Leistung">
                {LEISTUNGSART_LABEL[b.leistungsart]}
              </span>
              <span className="zv-liste-zelle" data-label="Dauer">
                <strong style={b.storniert ? { textDecoration: "line-through" } : undefined}>{formatMinutenAlsStunden(b.minuten)}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Notiz">
                {b.notiz}
                {b.storniert && (
                  <span className="zv-pill zv-pill-danger" title={b.stornoAm ? `Storniert am ${formatDatum(b.stornoAm.slice(0, 10))}` : undefined}>
                    <span className="zv-pill-text">
                      Storniert{b.stornoVonName ? ` von ${b.stornoVonName}` : ""}: {b.stornoGrund}
                    </span>
                  </span>
                )}
              </span>
              <span className="zv-liste-zelle">
                {b.stornierbar && (
                  <AktionsMenue label={`Aktionen für Buchung vom ${formatDatum(b.datum)}`}>
                    <button type="button" role="menuitem" onClick={() => setStornoZiel(b)}>
                      <IStornieren /> Stornieren
                    </button>
                  </AktionsMenue>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BuchungsFormular({
  klienten,
  mitarbeitende,
  fuerAndereBuchen,
  startKlientId,
  onClose,
  onGebucht,
}: {
  klienten: KlientListEintragDto[];
  mitarbeitende: BenutzerListEintragDto[];
  fuerAndereBuchen: boolean;
  startKlientId: string;
  onClose: () => void;
  onGebucht: () => void;
}) {
  // Beim Oeffnen erzeugt und danach nie mehr gewechselt: scheitert die Antwort
  // und die Person tippt noch einmal auf "Buchen", ist es fuer den Server
  // derselbe Versuch (Migration 0072). Ein neues Formular bekommt einen neuen.
  const schluessel = useRef(crypto.randomUUID());
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const heute = heuteBerlin();

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Vor dem ersten await heben: e.currentTarget ist danach null.
    const form = new FormData(e.currentTarget);
    const minuten = Number(form.get("stunden") || 0) * 60 + Number(form.get("minuten") || 0);
    if (minuten < 1) {
      setFehler("Bitte eine Dauer angeben.");
      return;
    }
    setFehler(null);
    setLaeuft(true);
    try {
      const mitarbeiterId = String(form.get("mitarbeiterId") ?? "");
      await api.stundenBuchen(
        {
          klientId: String(form.get("klientId")),
          mitarbeiterId: mitarbeiterId || undefined,
          datum: String(form.get("datum")),
          minuten,
          leistungsart: String(form.get("leistungsart")) as Leistungsart,
          notiz: String(form.get("notiz") ?? "").trim() || undefined,
        },
        schluessel.current
      );
      onGebucht();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Stunden konnten nicht gebucht werden.");
      setLaeuft(false);
    }
  }

  return (
    <Modal titel="Stunden buchen" onClose={onClose}>
      <form onSubmit={absenden}>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler" role="alert">
            <IFehler />
            {fehler}
          </div>
        )}
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="std-klient">Klient:in</label>
            <select key={klienten.length} id="std-klient" name="klientId" required autoFocus defaultValue={startKlientId}>
              <option value="" disabled>
                Bitte wählen
              </option>
              {klienten.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.vorname} {k.nachname}
                </option>
              ))}
            </select>
          </div>
          <div className="zv-field">
            <label htmlFor="std-datum">Datum</label>
            <Datumsfeld id="std-datum" name="datum" required max={heute} defaultValue={heute} schnellwahl="heute-gestern" />
          </div>
        </div>
        <div className="zv-field-row">
          <div className="zv-field">
            <label htmlFor="std-stunden">Stunden</label>
            <input id="std-stunden" name="stunden" type="number" min={0} max={24} step={1} defaultValue={1} inputMode="numeric" />
          </div>
          <div className="zv-field">
            <label htmlFor="std-minuten">Minuten</label>
            <input id="std-minuten" name="minuten" type="number" min={0} max={59} step={5} defaultValue={0} inputMode="numeric" />
          </div>
          <div className="zv-field">
            <label htmlFor="std-art">Leistung</label>
            <select id="std-art" name="leistungsart" required defaultValue="einzelbetreuung">
              {LEISTUNGSARTEN.map((a) => (
                <option key={a} value={a}>
                  {LEISTUNGSART_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {fuerAndereBuchen && (
          <div className="zv-field">
            <label htmlFor="std-ma">Geleistet von</label>
            <select id="std-ma" name="mitarbeiterId" defaultValue="">
              <option value="">Ich selbst</option>
              {mitarbeitende.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="zv-field">
          <label htmlFor="std-notiz">Notiz (optional)</label>
          <textarea id="std-notiz" name="notiz" rows={3} maxLength={2000} />
        </div>
        <button className="zv-btn zv-btn-block" type="submit" disabled={laeuft}>
          <ISpeichern />
          Buchen
        </button>
      </form>
    </Modal>
  );
}
