import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  LEISTUNGSARTEN,
  LEISTUNGSART_LABEL,
  berlinTag,
  formatMinutenAlsStunden,
  type BenutzerListEintragDto,
  type KlientListEintragDto,
  type Leistungsart,
  type StundenbuchungDto,
  type StundenHerkunft,
  type StundenSummeDto,
  type StundenVormerkungDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { formatDatum, heuteBerlin } from "../format";
import { AktionsMenue } from "../components/AktionsMenue";
import { FilterAuswahl, FilterPille } from "../components/Filterleiste";
import { GrundAbfrage } from "../components/GrundAbfrage";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IFehler,
  IFilterLoeschen,
  IKalender,
  IKlienten,
  ILeerStunden,
  INeu,
  IPerson,
  ISpeichern,
  IStornieren,
  IStunden,
  ISuche,
  IVerknuepft,
} from "../components/icons";
import { Datumsfeld } from "../components/Datumsfeld";
import { ZeitraumFilter, useZeitraum } from "../components/Listenfilter";

const HERKUNFT_LABEL: Record<StundenHerkunft, string> = { manuell: "Von Hand", kalender: "Aus dem Kalender" };

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

  const zeitraum = useZeitraum("monat");
  const { von, bis } = zeitraum;
  const [klientFilter, setKlientFilter] = useState("");
  const [mitarbeiterFilter, setMitarbeiterFilter] = useState("");
  const [suche, setSuche] = useState("");
  const [herkunft, setHerkunft] = useState<StundenHerkunft | "">("");
  const [vormerkungen, setVormerkungen] = useState<StundenVormerkungDto[]>([]);

  // Die Liste zuerst: GET /stundenbuchungen zieht vorher die Kalenderbuchungen
  // nach (Konzept 3.3), erst danach stimmen Summen und Vormerkungen.
  function laden() {
    const filter = { von, bis, klientId: klientFilter || undefined, mitarbeiterId: mitarbeiterFilter || undefined, herkunft: herkunft || undefined };
    api
      .stundenListe(filter)
      .then(async (liste) => {
        const [summe, vorgemerkt] = await Promise.all([api.stundenSummen(filter), api.stundenVormerkungen().catch(() => [])]);
        setBuchungen(liste);
        setSummen(summe);
        setVormerkungen(vorgemerkt);
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
  }, [von, bis, klientFilter, mitarbeiterFilter, herkunft, rechte]);

  const zeitraumUngueltig = zeitraum.ungueltig;
  const sichtbar = useMemo(() => {
    const q = suche.trim().toLocaleLowerCase("de");
    if (!q) return buchungen;
    return buchungen.filter((b) =>
      [b.klientName, b.mitarbeiterName ?? "", b.notiz ?? "", b.terminTitel ?? "", LEISTUNGSART_LABEL[b.leistungsart]].some((f) => f.toLocaleLowerCase("de").includes(q))
    );
  }, [buchungen, suche]);

  const gesamtMinuten = summen.reduce((s, x) => s + x.minuten, 0);
  const mitKalender = summen.some((x) => x.minutenKalender > 0);
  const geplant = vormerkungen.filter((v) => v.status === "geplant" && !v.grund);
  const nichtGebucht = vormerkungen.filter((v) => v.status === "nicht-gebucht" || v.grund);
  const klientText = klienten.find((k) => k.id === klientFilter);
  const mitarbeiterText = mitarbeitende.find((m) => m.id === mitarbeiterFilter);
  const filterAktiv = Boolean(klientFilter || mitarbeiterFilter || herkunft || suche.trim() || zeitraum.geaendert);

  function alleZuruecksetzen() {
    zeitraum.zuruecksetzen();
    setHerkunft("");
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

        <ZeitraumFilter zeitraum={zeitraum} idPrefix="std" startIstLeer />

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

        <FilterPille icon={<IVerknuepft />} label="Herkunft" wert={herkunft ? `: ${HERKUNFT_LABEL[herkunft]}` : null} onEntfernen={() => setHerkunft("")}>
          {(schliessen) => (
            <FilterAuswahl
              optionen={(["manuell", "kalender"] as StundenHerkunft[]).map((h) => ({ wert: h, label: HERKUNFT_LABEL[h] }))}
              gewaehlt={herkunft || null}
              onWaehlen={(h) => {
                setHerkunft(h as StundenHerkunft);
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

      {(geplant.length > 0 || nichtGebucht.length > 0) && (
        <section className="zv-stunden-vormerkungen" aria-label="Vorgemerkte Termine">
          <IStunden />
          <div>
            {geplant.length > 0 && (
              <>
                <strong>
                  {geplant.length === 1 ? "1 Termin vorgemerkt" : `${geplant.length} Termine vorgemerkt`} ·{" "}
                  {formatMinutenAlsStunden(geplant.reduce((s, v) => s + v.minuten * Math.max(1, v.klientNamen.length), 0))}
                </strong>
                <p className="zv-sub">Werden nach dem Terminende automatisch gebucht. Nur für dich sichtbar, bis sie gebucht sind; zählen noch nicht zum Saldo.</p>
              </>
            )}
            {nichtGebucht.map((v) => (
              <p key={v.terminId} className="zv-sub">
                <strong>{v.titel}</strong> ({formatDatum(berlinTag(new Date(v.beginn)))}): {v.grund ?? "Nicht gebucht."}
              </p>
            ))}
          </div>
        </section>
      )}

      {summen.length > 0 && (
        <section aria-label="Stundensaldo" style={{ marginBottom: "var(--zv-space-4)" }}>
          <h3 className="zv-gruppe-kopf">
            Saldo im Zeitraum: <strong>{formatMinutenAlsStunden(gesamtMinuten)}</strong>
          </h3>
          <div className="zv-karten-liste" style={{ "--zv-liste-spalten": mitKalender ? "1.4fr 1.2fr 1fr 1fr 0.8fr" : "1.4fr 1.2fr 1fr 0.8fr" } as CSSProperties}>
            <div className="zv-liste-kopf">
              <span>Klient:in</span>
              <span>Monat</span>
              <span>Stunden</span>
              {mitKalender && <span>davon aus Kalender</span>}
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
                {mitKalender && (
                  <span className="zv-liste-zelle" data-label="davon aus Kalender">
                    {formatMinutenAlsStunden(s.minutenKalender)}
                  </span>
                )}
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
              <span className="zv-liste-zelle zv-stunden-notiz" data-label="Notiz">
                {b.terminId ? (
                  // Die Notiz einer Kalenderbuchung ist der Termintitel beim Buchen;
                  // wer den Termin sehen darf, sieht den heutigen Titel.
                  <span className="zv-stunden-herkunft">
                    <IKalender />
                    Kalender: {b.terminTitel ?? b.notiz ?? "Termin"}
                  </span>
                ) : (
                  b.notiz
                )}
                {b.automatischNeuGebucht && (
                  <span className="zv-pill zv-pill-offen" title="Automatisch neu gebucht, weil der Termin nach der ersten Buchung geändert wurde. Die alte Buchung steht storniert daneben.">
                    <span className="zv-pill-text">Automatisch neu gebucht</span>
                  </span>
                )}
                {b.moeglicherweiseDoppelt && (
                  <span className="zv-pill zv-pill-offen" title="Am selben Tag gibt es für diese Person und Klient:in eine Buchung aus dem Kalender und eine von Hand.">
                    <span className="zv-pill-text">Möglicherweise doppelt</span>
                  </span>
                )}
                {b.storniert && (
                  <span
                    className="zv-pill zv-pill-danger"
                    title={`${b.stornoAutomatisch ? "Automatisch storniert" : "Storniert"}: ${b.stornoGrund ?? ""}${b.stornoAm ? ` (am ${formatDatum(berlinTag(new Date(b.stornoAm)))})` : ""}`}
                  >
                    <span className="zv-pill-text">
                      {b.stornoAutomatisch ? "Automatisch storniert" : `Storniert${b.stornoVonName ? ` von ${b.stornoVonName}` : ""}`}: {b.stornoGrund}
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
