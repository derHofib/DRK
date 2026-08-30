import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type {
  BenutzerListEintragDto,
  KassenbuchungDto,
  KassenbuchungTyp,
  KlientListEintragDto,
  StandortDto,
  WochenuebersichtEintragDto,
} from "@zimmerakte/shared";
import { KASSENBUCHUNG_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IAuszahlen,
  IFehler,
  IKlienten,
  ILeerKassenbuch,
  ILeerStandorte,
  ILeerWoche,
  IMitarbeitende,
  INeu,
  ISErledigt,
  ISOffen,
  ISStorniert,
  ISpeichern,
  IStandort,
  IStornieren,
  IUnterschrift,
  IVor,
  IZurueckPfeil,
} from "../components/icons";
import { SignaturePad } from "../components/SignaturePad";
import { formatBetrag, formatDatum } from "../format";

type Richtung = "einzahlung" | "auszahlung";
type Ziel = "klient" | "standort";

function isoWocheVon(datum: Date): { jahr: number; woche: number } {
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()));
  const tagNr = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - tagNr + 3);
  const ersterDonnerstag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ersterTagNr = (ersterDonnerstag.getUTCDay() + 6) % 7;
  ersterDonnerstag.setUTCDate(ersterDonnerstag.getUTCDate() - ersterTagNr + 3);
  const woche = 1 + Math.round((d.getTime() - ersterDonnerstag.getTime()) / (7 * 24 * 3600 * 1000));
  return { jahr: d.getUTCFullYear(), woche };
}

function aktuelleIsoWoche(): { jahr: number; woche: number } {
  return isoWocheVon(new Date());
}

// Der 28. Dezember liegt kalendarisch immer in der letzten ISO-Kalenderwoche
// des Jahres (Definition der ISO-8601-Woche) -- daran laesst sich ablesen, ob
// ein Jahr 52 oder 53 Wochen hat, ohne das selbst nachzurechnen.
function isoWochenImJahr(jahr: number): number {
  return isoWocheVon(new Date(jahr, 11, 28)).woche;
}

// Montag der gegebenen ISO-Woche, um darauf 7 Tage auf-/abzurechnen und ueber
// isoWocheVon() das Jahr korrekt mitzuverschieben (Jahreswechsel bei KW 1/52/53).
function montagDerIsoWoche(jahr: number, woche: number): Date {
  const jan4 = new Date(Date.UTC(jahr, 0, 4));
  const jan4TagNr = (jan4.getUTCDay() + 6) % 7;
  const montagWoche1 = new Date(jan4);
  montagWoche1.setUTCDate(jan4.getUTCDate() - jan4TagNr);
  const montag = new Date(montagWoche1);
  montag.setUTCDate(montagWoche1.getUTCDate() + (woche - 1) * 7);
  return montag;
}

function formatTagMonat(d: Date): string {
  const tag = String(d.getUTCDate()).padStart(2, "0");
  const monat = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${tag}.${monat}.`;
}

// Zeigt Wochennummer, Datumsspanne und Jahr in einem -- ersetzt zwei getrennte
// Angaben (Zahl im Select, Jahr daneben) durch die vollstaendige, sofort
// lesbare Spanne wie "KW 34 - 17.08.-23.08.2026".
function formatKwSpanne(jahr: number, woche: number): string {
  const montag = montagDerIsoWoche(jahr, woche);
  const sonntag = new Date(montag);
  sonntag.setUTCDate(montag.getUTCDate() + 6);
  return `KW ${woche} - ${formatTagMonat(montag)}-${formatTagMonat(sonntag)}${sonntag.getUTCFullYear()}`;
}

// Aktiv = nicht storniert. Ein stornierter Eintrag zaehlt weder in den
// Saldo noch in die Buchungsanzahl -- er ist rueckwirkend ungueltig, bleibt
// aber (Bauplan Punkt 03) als Zeile in der Historie sichtbar.
function aktive(buchungen: KassenbuchungDto[]): KassenbuchungDto[] {
  return buchungen.filter((b) => !b.storniert);
}

function summeCent(buchungen: KassenbuchungDto[]): number {
  return buchungen.reduce((summe, b) => summe + b.betragCent, 0);
}

export function Kassenbuch() {
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [mitarbeitende, setMitarbeitende] = useState<BenutzerListEintragDto[]>([]);
  const [buchungen, setBuchungen] = useState<KassenbuchungDto[]>([]);
  const [filterKlientId, setFilterKlientId] = useState("");
  const [filterStandortId, setFilterStandortId] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  const initialeWoche = aktuelleIsoWoche();
  const [uebersichtJahr, setUebersichtJahr] = useState(initialeWoche.jahr);
  const [uebersichtWoche, setUebersichtWoche] = useState(initialeWoche.woche);
  const [uebersicht, setUebersicht] = useState<WochenuebersichtEintragDto[]>([]);

  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [vorbelegung, setVorbelegung] = useState<{ klientId: string; isoJahr: number; isoWoche: number } | null>(null);
  const [ziel, setZiel] = useState<Ziel>("klient");
  const [formStandortId, setFormStandortId] = useState("");
  const [richtung, setRichtung] = useState<Richtung>("einzahlung");
  const [typ, setTyp] = useState<KassenbuchungTyp>("hzl");
  const [unterschrift, setUnterschrift] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const [offeneUnterschrift, setOffeneUnterschrift] = useState<{ buchungId: string; url: string } | null>(null);

  function ladeBuchungen() {
    api.kassenbuchungenListe().then(setBuchungen).catch((err) => setFehler(err.message));
  }

  function ladeUebersicht(jahr: number, woche: number) {
    api.wochenuebersicht(jahr, woche).then(setUebersicht).catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
    api.standorteListe().then(setStandorte).catch((err) => setFehler(err.message));
    api.benutzerListe().then(setMitarbeitende).catch((err) => setFehler(err.message));
    ladeBuchungen();
  }, []);

  useEffect(() => {
    ladeUebersicht(uebersichtJahr, uebersichtWoche);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uebersichtJahr, uebersichtWoche]);

  function wocheVerschieben(deltaWochen: number) {
    const montag = montagDerIsoWoche(uebersichtJahr, uebersichtWoche);
    montag.setUTCDate(montag.getUTCDate() + deltaWochen * 7);
    const naechste = isoWocheVon(montag);
    setUebersichtJahr(naechste.jahr);
    setUebersichtWoche(naechste.woche);
  }

  // Das Jahr-Select zeigt immer das aktuell gewaehlte Jahr plus je zwei
  // Nachbarjahre -- so bleibt der gewaehlte Wert nach dem Verschieben ueber
  // eine Jahresgrenze hinweg immer eine gueltige Option in der Liste.
  const jahrOptionen = [-2, -1, 0, 1, 2].map((delta) => uebersichtJahr + delta);
  const wochenOptionen = Array.from({ length: isoWochenImJahr(uebersichtJahr) }, (_, i) => i + 1);

  function formularOeffnenFuer(klientId: string) {
    setVorbelegung({ klientId, isoJahr: uebersichtJahr, isoWoche: uebersichtWoche });
    setZiel("klient");
    setFormStandortId("");
    setTyp("hzl");
    setRichtung("auszahlung");
    setUnterschrift(null);
    setFormFehler(null);
    setFormularOffen(true);
  }

  // Wechsel zu "Standort": HZL gibt es dort nicht (siehe Migration 0030,
  // kassenbuchung_hzl_nur_klient) -- ohne diesen Reset bliebe sonst ein
  // Formular mit unsichtbaren, aber gesetzten ISO-Jahr/Woche-Feldern stehen.
  function zielWaehlen(neu: Ziel) {
    setZiel(neu);
    if (neu === "standort" && typ === "hzl") setTyp("einzahlung");
  }

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Formularelement vorab merken -- React setzt e.currentTarget nach dem
    // Event-Dispatch auf null zurueck, ein Zugriff nach einem await schlaegt
    // sonst fehl (siehe facebook/react#20544).
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const betragEuro = Number(String(form.get("betrag")).replace(",", "."));
    const betragCentAbs = Math.round(betragEuro * 100);
    const betragCent = richtung === "auszahlung" ? -betragCentAbs : betragCentAbs;

    setFormFehler(null);
    if (richtung === "auszahlung" && !unterschrift) {
      setFormFehler("Für eine Auszahlung wird eine Unterschrift benötigt.");
      return;
    }

    setWirdGespeichert(true);
    try {
      await api.kassenbuchungAnlegen({
        klientId: ziel === "klient" ? String(form.get("klientId")) : undefined,
        standortId: ziel === "standort" ? String(form.get("standortId")) : undefined,
        datum: String(form.get("datum")),
        betragCent,
        verwendungszweck: String(form.get("verwendungszweck")),
        typ,
        isoJahr: typ === "hzl" ? Number(form.get("isoJahr")) : undefined,
        isoWoche: typ === "hzl" ? Number(form.get("isoWoche")) : undefined,
        unterschriftBase64: unterschrift ?? undefined,
        teilnehmerKlientIds: ziel === "standort" ? form.getAll("teilnehmerKlientIds").map(String) : undefined,
        teilnehmerBenutzerIds: ziel === "standort" ? form.getAll("teilnehmerBenutzerIds").map(String) : undefined,
      });
      setFormularOffen(false);
      setVorbelegung(null);
      setUnterschrift(null);
      ladeBuchungen();
      ladeUebersicht(uebersichtJahr, uebersichtWoche);
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Buchung konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function stornieren(buchung: KassenbuchungDto) {
    const grund = window.prompt(`Grund für die Stornierung von "${buchung.verwendungszweck}":`);
    if (!grund) return;
    try {
      await api.kassenbuchungStornieren(buchung.id, grund);
      ladeBuchungen();
      ladeUebersicht(uebersichtJahr, uebersichtWoche);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Buchung konnte nicht storniert werden.");
    }
  }

  async function unterschriftAnzeigen(buchungId: string) {
    if (offeneUnterschrift?.buchungId === buchungId) {
      setOffeneUnterschrift(null);
      return;
    }
    try {
      const url = await api.unterschriftBildUrl(buchungId);
      setOffeneUnterschrift({ buchungId, url });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Unterschrift konnte nicht geladen werden.");
    }
  }

  // Jede geoeffnete Unterschrift ist eine eigene Blob-URL (api/client.ts,
  // blobUrl()) -- ohne ausdrueckliches revokeObjectURL haelt der Browser das
  // Bild im Speicher, auch nachdem sie geschlossen oder durch eine andere
  // ersetzt wurde. Der Cleanup einer useEffect-Instanz laeuft automatisch
  // vor der naechsten Zuweisung UND beim Unmount -- deckt damit "wechseln",
  // "schliessen" und "Seite verlassen" mit derselben Zeile ab.
  useEffect(() => {
    if (!offeneUnterschrift) return;
    const url = offeneUnterschrift.url;
    return () => URL.revokeObjectURL(url);
  }, [offeneUnterschrift]);

  const bezahltAnzahl = uebersicht.filter((e) => e.bezahlt).length;

  // Standort-Buchungen (Spaßgeld/Freizeitveranstaltungen) gehören dem ganzen
  // Haus, nicht einem Klienten -- deshalb bewusst getrennte Listen und
  // Salden, statt sie in "alle Klienten" mitzuzählen (siehe Migration 0030).
  const klientBuchungen = buchungen.filter((b) => b.klientId !== null);
  const standortBuchungen = buchungen.filter((b) => b.standortId !== null);

  const gefilterteBuchungen = filterKlientId ? klientBuchungen.filter((b) => b.klientId === filterKlientId) : klientBuchungen;
  const aktiveGesamt = aktive(klientBuchungen);
  const aktiveGefiltert = aktive(gefilterteBuchungen);
  const gesamtsaldo = summeCent(aktiveGesamt);
  const summeFilter = summeCent(aktiveGefiltert);

  const gefilterteStandortBuchungen = filterStandortId
    ? standortBuchungen.filter((b) => b.standortId === filterStandortId)
    : standortBuchungen;
  const aktiveStandortGesamt = aktive(standortBuchungen);
  const aktiveStandortGefiltert = aktive(gefilterteStandortBuchungen);
  const standortGesamtsaldo = summeCent(aktiveStandortGesamt);
  const standortSummeFilter = summeCent(aktiveStandortGefiltert);

  // Vorschlag fuer die Teilnehmer-Klienten-Auswahl: nur Klienten, die
  // aktuell am gewählten Standort wohnen -- fällt (z. B. bei fehlender
  // Zimmerzuordnung) niemand in diesen Filter, lieber die volle Liste
  // zeigen als eine leere Auswahl.
  const gewaehlterStandortName = standorte.find((s) => s.id === formStandortId)?.name;
  const klientenAmStandort = gewaehlterStandortName
    ? klienten.filter((k) => k.aktuellesZimmer?.standortName === gewaehlterStandortName)
    : [];
  const teilnehmerKlientenOptionen = klientenAmStandort.length > 0 ? klientenAmStandort : klienten;

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <div>
          <h2>Kassenbuch</h2>
          <p className="zv-sub" style={{ margin: "2px 0 0" }}>
            Alle Buchungen aller Klienten
          </p>
        </div>
        <button
          className="zv-btn"
          onClick={() => {
            setVorbelegung(null);
            setZiel("klient");
            setFormStandortId("");
            setTyp("hzl");
            setRichtung("einzahlung");
            setUnterschrift(null);
            setFormFehler(null);
            setFormularOffen(true);
          }}
        >
          <INeu />
          Neue Buchung
        </button>
      </div>

      {formularOffen && (
        <Modal titel="Neue Buchung" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen} key={vorbelegung?.klientId ?? "leer"}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            {!vorbelegung && (
              <div className="zv-field">
                <label id="ziel-label">Buchung für</label>
                <div className="zv-segmented" role="radiogroup" aria-labelledby="ziel-label">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={ziel === "klient"}
                    className={ziel === "klient" ? "active" : ""}
                    onClick={() => zielWaehlen("klient")}
                  >
                    <IKlienten />
                    Klient
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={ziel === "standort"}
                    className={ziel === "standort" ? "active" : ""}
                    onClick={() => zielWaehlen("standort")}
                  >
                    <IStandort />
                    Standort (Spaßgeld/Veranstaltung)
                  </button>
                </div>
              </div>
            )}

            <div className="zv-field-row">
              {ziel === "klient" ? (
                <div className="zv-field">
                  <label>Klient</label>
                  <select name="klientId" required defaultValue={vorbelegung?.klientId ?? ""} autoFocus>
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
              ) : (
                <div className="zv-field">
                  <label htmlFor="standortId">Standort</label>
                  <select
                    id="standortId"
                    name="standortId"
                    required
                    value={formStandortId}
                    onChange={(e) => setFormStandortId(e.target.value)}
                    autoFocus
                  >
                    <option value="" disabled>
                      Bitte wählen
                    </option>
                    {standorte.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="zv-field">
                <label>Datum</label>
                <input name="datum" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
            </div>

            {ziel === "standort" && (
              <div className="zv-field-row">
                <div className="zv-field">
                  <label htmlFor="teilnehmerKlientIds">Teilnehmende Klienten (optional)</label>
                  <select id="teilnehmerKlientIds" name="teilnehmerKlientIds" multiple size={5}>
                    {teilnehmerKlientenOptionen.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.vorname} {k.nachname}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="zv-field">
                  <label htmlFor="teilnehmerBenutzerIds">Teilnehmende Mitarbeiter (optional)</label>
                  <select id="teilnehmerBenutzerIds" name="teilnehmerBenutzerIds" multiple size={5}>
                    {mitarbeitende
                      .filter((m) => m.aktiv)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            <div className="zv-field-row">
              <div className="zv-field">
                <label>Typ</label>
                <select name="typ" value={typ} onChange={(e) => setTyp(e.target.value as KassenbuchungTyp)}>
                  {ziel === "klient" && <option value="hzl">HZL</option>}
                  <option value="einzahlung">Einzahlung</option>
                  <option value="sonstiges">Sonstiges</option>
                </select>
              </div>
              <div className="zv-field">
                <label>Richtung</label>
                <select name="richtung" value={richtung} onChange={(e) => setRichtung(e.target.value as Richtung)}>
                  <option value="einzahlung">Einzahlung (+)</option>
                  <option value="auszahlung">Auszahlung (–)</option>
                </select>
              </div>
            </div>

            {typ === "hzl" && ziel === "klient" && (
              <div className="zv-field-row">
                <div className="zv-field">
                  <label>ISO-Jahr</label>
                  <input name="isoJahr" type="number" required defaultValue={vorbelegung?.isoJahr ?? uebersichtJahr} />
                </div>
                <div className="zv-field">
                  <label>Kalenderwoche</label>
                  <input
                    name="isoWoche"
                    type="number"
                    min={1}
                    max={53}
                    required
                    defaultValue={vorbelegung?.isoWoche ?? uebersichtWoche}
                  />
                </div>
              </div>
            )}

            <div className="zv-field-row">
              <div className="zv-field">
                <label>Betrag (€)</label>
                <input name="betrag" type="text" inputMode="decimal" placeholder="20,00" required />
              </div>
              <div className="zv-field">
                <label>Verwendungszweck</label>
                <input name="verwendungszweck" required />
              </div>
            </div>

            {richtung === "auszahlung" && (
              <div className="zv-field">
                <label>Unterschrift zur Bestätigung der Auszahlung</label>
                <SignaturePad onChange={setUnterschrift} />
              </div>
            )}

            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Buchung speichern"}
            </button>
          </form>
        </Modal>
      )}

      <div className="zv-card zv-card-weit" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 15, margin: 0 }}>HZL-Wochenübersicht</h3>
            {uebersicht.length > 0 && (
              <p className="zv-sub-inline" style={{ marginLeft: 0 }}>
                {bezahltAnzahl} von {uebersicht.length} wöchentlichen Klient*innen für diese Woche ausgezahlt.
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button
              type="button"
              className="zv-icon-btn"
              aria-label="Vorherige Kalenderwoche"
              onClick={() => wocheVerschieben(-1)}
            >
              <IZurueckPfeil />
            </button>
            <select
              aria-label="Kalenderwoche"
              value={uebersichtWoche}
              onChange={(e) => setUebersichtWoche(Number(e.target.value))}
            >
              {wochenOptionen.map((w) => (
                <option key={w} value={w}>
                  {formatKwSpanne(uebersichtJahr, w)}
                  {w === initialeWoche.woche && uebersichtJahr === initialeWoche.jahr ? " (aktuell)" : ""}
                </option>
              ))}
            </select>
            <select
              aria-label="Jahr"
              value={uebersichtJahr}
              onChange={(e) => {
                const neuesJahr = Number(e.target.value);
                setUebersichtJahr(neuesJahr);
                setUebersichtWoche((w) => Math.min(w, isoWochenImJahr(neuesJahr)));
              }}
            >
              {jahrOptionen.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="zv-icon-btn"
              aria-label="Naechste Kalenderwoche"
              onClick={() => wocheVerschieben(1)}
            >
              <IVor />
            </button>
          </div>
        </div>

        {uebersicht.length === 0 ? (
          <Leerzustand icon={ILeerWoche}>Keine Klienten mit wöchentlichem HZL-Rhythmus.</Leerzustand>
        ) : (
          <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1.6fr" } as CSSProperties}>
            <div className="zv-liste-kopf">
              <span>Klient</span>
              <span>Status</span>
              <span>Auszahlung</span>
            </div>
            {uebersicht.map((e) => (
              <div key={e.klientId} className="zv-info-karte">
                <span className="zv-liste-zelle-titel">{e.klientName}</span>
                <span className="zv-liste-zelle" data-label="Status">
                  <span className={`zv-pill ${e.bezahlt ? "zv-pill-ok" : "zv-pill-offen"}`}>
                    {e.bezahlt ? <ISErledigt /> : <ISOffen />}
                    {e.bezahlt ? "Bezahlt" : "Offen"}
                  </span>
                </span>
                <span className="zv-liste-zelle" data-label="Auszahlung">
                  {e.bezahlt ? (
                    e.betragCent !== null && e.datum && (
                      <span className="zv-mono">
                        {formatBetrag(e.betragCent)} am {formatDatum(e.datum)}
                      </span>
                    )
                  ) : (
                    <button className="zv-link-btn" onClick={() => formularOeffnenFuer(e.klientId)}>
                      <IAuszahlen />
                      Jetzt auszahlen
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="zv-stat-grid">
        <div className="zv-stat-karte">
          <p className="zv-stat-label">Gesamtsaldo alle Klienten</p>
          <p className="zv-stat-wert">{formatBetrag(gesamtsaldo)}</p>
          <p className="zv-stat-sub">{aktiveGesamt.length} Buchungen gesamt</p>
        </div>
        <div className="zv-stat-karte">
          <p className="zv-stat-label">Summe (Filter)</p>
          <p className="zv-stat-wert">{formatBetrag(summeFilter)}</p>
          <p className="zv-stat-sub">{aktiveGefiltert.length} Buchungen</p>
        </div>
      </div>

      <div className="zv-field" style={{ maxWidth: 260, marginBottom: 14 }}>
        <select aria-label="Nach Klient filtern" value={filterKlientId} onChange={(e) => setFilterKlientId(e.target.value)}>
          <option value="">Alle Klienten</option>
          {klienten.map((k) => (
            <option key={k.id} value={k.id}>
              {k.vorname} {k.nachname}
            </option>
          ))}
        </select>
      </div>

      {gefilterteBuchungen.length === 0 ? (
        <Leerzustand icon={ILeerKassenbuch}>Noch keine Buchungen erfasst.</Leerzustand>
      ) : (
        <div
          className="zv-karten-liste"
          style={{ "--zv-liste-spalten": "1.3fr 1fr 1fr 1.6fr 1.3fr 1.3fr 1fr 1.6fr" } as CSSProperties}
        >
          <div className="zv-liste-kopf">
            <span>Klient</span>
            <span>Datum</span>
            <span>Betrag</span>
            <span>Zweck</span>
            <span>Typ</span>
            <span>Mitarbeiter</span>
            <span>Status</span>
            <span></span>
          </div>
          {gefilterteBuchungen.map((b) => (
            <div key={b.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{b.klientName}</span>
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
              <span className="zv-liste-zelle" data-label="Zweck">
                <strong>{b.verwendungszweck}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Typ">
                <strong>
                  {KASSENBUCHUNG_TYP_LABEL[b.typ]}
                  {b.isoJahr && b.isoWoche ? ` · KW ${b.isoWoche}` : ""}
                </strong>
              </span>
              <span className="zv-liste-zelle" data-label="Mitarbeiter">
                {b.gebuchtVonName ?? "–"}
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
              <span
                className={`zv-liste-zelle-aktionen${!b.hatUnterschrift && b.storniert ? " zv-liste-zelle-aktionen-leer" : ""}`}
              >
                {b.hatUnterschrift && (
                  <button className="zv-link-btn" onClick={() => unterschriftAnzeigen(b.id)}>
                    <IUnterschrift />
                    Unterschrift
                  </button>
                )}
                {!b.storniert && (
                  <button className="zv-link-btn" onClick={() => stornieren(b)}>
                    <IStornieren />
                    Stornieren
                  </button>
                )}
              </span>
              {offeneUnterschrift?.buchungId === b.id && (
                <div style={{ gridColumn: "1 / -1", marginTop: "var(--zv-space-2)" }}>
                  <img src={offeneUnterschrift.url} alt="Unterschrift" style={{ maxHeight: 100 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="zv-seiten-kopf" style={{ marginTop: "var(--zv-space-6)" }}>
        <div>
          <h2 style={{ fontSize: "var(--zv-text-xl)" }}>Standort-Buchungen</h2>
          <p className="zv-sub" style={{ margin: "2px 0 0" }}>
            Spaßgeld für Freizeitveranstaltungen und Ähnliches — dem Haus zugeordnet, nicht einem einzelnen Klienten.
          </p>
        </div>
      </div>

      <div className="zv-stat-grid">
        <div className="zv-stat-karte">
          <p className="zv-stat-label">Gesamtsaldo Standort-Buchungen</p>
          <p className="zv-stat-wert">{formatBetrag(standortGesamtsaldo)}</p>
          <p className="zv-stat-sub">{aktiveStandortGesamt.length} Buchungen gesamt</p>
        </div>
        <div className="zv-stat-karte">
          <p className="zv-stat-label">Summe (Filter)</p>
          <p className="zv-stat-wert">{formatBetrag(standortSummeFilter)}</p>
          <p className="zv-stat-sub">{aktiveStandortGefiltert.length} Buchungen</p>
        </div>
      </div>

      <div className="zv-field" style={{ maxWidth: 260, marginBottom: 14 }}>
        <select
          aria-label="Nach Standort filtern"
          value={filterStandortId}
          onChange={(e) => setFilterStandortId(e.target.value)}
        >
          <option value="">Alle Standorte</option>
          {standorte.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {gefilterteStandortBuchungen.length === 0 ? (
        <Leerzustand icon={ILeerStandorte}>Noch keine Standort-Buchungen erfasst.</Leerzustand>
      ) : (
        <div
          className="zv-karten-liste"
          style={{ "--zv-liste-spalten": "1.2fr 1fr 1fr 1.4fr 1fr 1.2fr 1.8fr 1fr 1.6fr" } as CSSProperties}
        >
          <div className="zv-liste-kopf">
            <span>Standort</span>
            <span>Datum</span>
            <span>Betrag</span>
            <span>Zweck</span>
            <span>Typ</span>
            <span>Mitarbeiter</span>
            <span>Teilnehmer</span>
            <span>Status</span>
            <span></span>
          </div>
          {gefilterteStandortBuchungen.map((b) => (
            <div key={b.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">{b.standortName}</span>
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
              <span className="zv-liste-zelle" data-label="Zweck">
                <strong>{b.verwendungszweck}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Typ">
                <strong>{KASSENBUCHUNG_TYP_LABEL[b.typ]}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Mitarbeiter">
                {b.gebuchtVonName ?? "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Teilnehmer">
                {b.teilnehmer.length > 0 ? (
                  <span title={b.teilnehmer.map((t) => t.name).join(", ")}>
                    {b.teilnehmer.length === 1 ? (
                      b.teilnehmer[0].name
                    ) : (
                      <>
                        {b.teilnehmer.length} Teilnehmende
                        {b.teilnehmer.some((t) => t.klientId) && b.teilnehmer.some((t) => t.benutzerId) && (
                          <span className="zv-sub-inline">
                            (<IKlienten style={{ verticalAlign: "-2px" }} />/<IMitarbeitende style={{ verticalAlign: "-2px" }} />)
                          </span>
                        )}
                      </>
                    )}
                  </span>
                ) : (
                  "–"
                )}
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
              <span
                className={`zv-liste-zelle-aktionen${!b.hatUnterschrift && b.storniert ? " zv-liste-zelle-aktionen-leer" : ""}`}
              >
                {b.hatUnterschrift && (
                  <button className="zv-link-btn" onClick={() => unterschriftAnzeigen(b.id)}>
                    <IUnterschrift />
                    Unterschrift
                  </button>
                )}
                {!b.storniert && (
                  <button className="zv-link-btn" onClick={() => stornieren(b)}>
                    <IStornieren />
                    Stornieren
                  </button>
                )}
              </span>
              {offeneUnterschrift?.buchungId === b.id && (
                <div style={{ gridColumn: "1 / -1", marginTop: "var(--zv-space-2)" }}>
                  <img src={offeneUnterschrift.url} alt="Unterschrift" style={{ maxHeight: 100 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
