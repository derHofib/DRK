import { Fragment, FormEvent, useEffect, useState } from "react";
import type { KassenbuchungDto, KassenbuchungTyp, KlientListEintragDto, WochenuebersichtEintragDto } from "@zimmerakte/shared";
import { KASSENBUCHUNG_TYP_LABEL } from "@zimmerakte/shared";
import { api } from "../api/client";
import { LeerzustandZeile } from "../components/Leerzustand";
import {
  IAbbrechen,
  IAuszahlen,
  IFehler,
  ILeerKassenbuch,
  ILeerWoche,
  INeu,
  ISErledigt,
  ISOffen,
  ISStorniert,
  ISpeichern,
  IStornieren,
  IUnterschrift,
} from "../components/icons";
import { SignaturePad } from "../components/SignaturePad";
import { formatBetrag } from "../format";

type Richtung = "einzahlung" | "auszahlung";

function aktuelleIsoWoche(): { jahr: number; woche: number } {
  const heute = new Date();
  const d = new Date(Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate()));
  const tagNr = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - tagNr + 3);
  const ersterDonnerstag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ersterTagNr = (ersterDonnerstag.getUTCDay() + 6) % 7;
  ersterDonnerstag.setUTCDate(ersterDonnerstag.getUTCDate() - ersterTagNr + 3);
  const woche = 1 + Math.round((d.getTime() - ersterDonnerstag.getTime()) / (7 * 24 * 3600 * 1000));
  return { jahr: d.getUTCFullYear(), woche };
}

export function Kassenbuch() {
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [buchungen, setBuchungen] = useState<KassenbuchungDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  const initialeWoche = aktuelleIsoWoche();
  const [uebersichtJahr, setUebersichtJahr] = useState(initialeWoche.jahr);
  const [uebersichtWoche, setUebersichtWoche] = useState(initialeWoche.woche);
  const [uebersicht, setUebersicht] = useState<WochenuebersichtEintragDto[]>([]);

  const [formularOffen, setFormularOffen] = useState(false);
  const [vorbelegung, setVorbelegung] = useState<{ klientId: string; isoJahr: number; isoWoche: number } | null>(null);
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
    ladeBuchungen();
  }, []);

  useEffect(() => {
    ladeUebersicht(uebersichtJahr, uebersichtWoche);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uebersichtJahr, uebersichtWoche]);

  function formularOeffnenFuer(klientId: string) {
    setVorbelegung({ klientId, isoJahr: uebersichtJahr, isoWoche: uebersichtWoche });
    setTyp("hzl");
    setRichtung("auszahlung");
    setUnterschrift(null);
    setFormularOffen(true);
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

    if (richtung === "auszahlung" && !unterschrift) {
      setFehler("Für eine Auszahlung wird eine Unterschrift benötigt.");
      return;
    }

    setWirdGespeichert(true);
    try {
      await api.kassenbuchungAnlegen({
        klientId: String(form.get("klientId")),
        datum: String(form.get("datum")),
        betragCent,
        verwendungszweck: String(form.get("verwendungszweck")),
        typ,
        isoJahr: typ === "hzl" ? Number(form.get("isoJahr")) : undefined,
        isoWoche: typ === "hzl" ? Number(form.get("isoWoche")) : undefined,
        unterschriftBase64: unterschrift ?? undefined,
      });
      setFormularOffen(false);
      setVorbelegung(null);
      setUnterschrift(null);
      formElement.reset();
      ladeBuchungen();
      ladeUebersicht(uebersichtJahr, uebersichtWoche);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Buchung konnte nicht gespeichert werden.");
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

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>HZL-Wochenübersicht</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              value={uebersichtJahr}
              onChange={(e) => setUebersichtJahr(Number(e.target.value))}
              style={{ width: 70 }}
            />
            <span className="zv-sub-inline">KW</span>
            <input
              type="number"
              min={1}
              max={53}
              value={uebersichtWoche}
              onChange={(e) => setUebersichtWoche(Number(e.target.value))}
              style={{ width: 55 }}
            />
          </div>
        </div>

        <table className="zv-table">
          <thead>
            <tr>
              <th>Klient</th>
              <th>Status</th>
              <th>Betrag</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {uebersicht.map((e) => (
              <tr key={e.klientId}>
                <td>{e.klientName}</td>
                <td>
                  <span className={`zv-pill ${e.bezahlt ? "zv-pill-ok" : "zv-pill-offen"}`}>
                    {e.bezahlt ? <ISErledigt /> : <ISOffen />}
                    {e.bezahlt ? "Bezahlt" : "Offen"}
                  </span>
                </td>
                <td>{e.betragCent !== null ? formatBetrag(e.betragCent) : "–"}</td>
                <td>
                  {!e.bezahlt && (
                    <button className="zv-link-btn" onClick={() => formularOeffnenFuer(e.klientId)}>
                      <IAuszahlen />
                      Jetzt auszahlen
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {uebersicht.length === 0 && (
              <LeerzustandZeile icon={ILeerWoche} spalten={4}>
                Keine Klienten mit wöchentlichem HZL-Rhythmus.
              </LeerzustandZeile>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Kassenbuch</h2>
        <button
          className="zv-btn"
          onClick={() => {
            if (formularOffen) {
              setFormularOffen(false);
            } else {
              setVorbelegung(null);
              setTyp("hzl");
              setRichtung("einzahlung");
              setUnterschrift(null);
              setFormularOffen(true);
            }
          }}
        >
          {formularOffen ? "Abbrechen" : "+ Neue Buchung"}
        </button>
      </div>

      {formularOffen && (
        <form className="zv-inline-form" onSubmit={anlegen} key={vorbelegung?.klientId ?? "leer"}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label>Klient</label>
              <select name="klientId" required defaultValue={vorbelegung?.klientId ?? ""}>
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
              <label>Datum</label>
              <input name="datum" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>

          <div className="zv-field-row">
            <div className="zv-field">
              <label>Typ</label>
              <select name="typ" value={typ} onChange={(e) => setTyp(e.target.value as KassenbuchungTyp)}>
                <option value="hzl">HZL</option>
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

          {typ === "hzl" && (
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

          <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
            <ISpeichern />
            {wirdGespeichert ? "Speichert…" : "Buchung speichern"}
          </button>
        </form>
      )}

      <table className="zv-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Klient</th>
            <th>Betrag</th>
            <th>Zweck</th>
            <th>Typ</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {buchungen.map((b) => (
            <Fragment key={b.id}>
              <tr>
                <td>{b.datum}</td>
                <td>{b.klientName}</td>
                <td style={{ color: b.betragCent < 0 ? "var(--zv-status-danger)" : "var(--zv-status-ok)" }}>
                  {formatBetrag(b.betragCent)}
                </td>
                <td>{b.verwendungszweck}</td>
                <td>
                  {KASSENBUCHUNG_TYP_LABEL[b.typ]}
                  {b.isoJahr && b.isoWoche ? <span className="zv-sub-inline">KW {b.isoWoche}</span> : null}
                </td>
                <td>
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
                </td>
                <td style={{ display: "flex", gap: 10 }}>
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
                </td>
              </tr>
              {offeneUnterschrift?.buchungId === b.id && (
                <tr>
                  <td colSpan={7} style={{ background: "var(--zv-surface-2)" }}>
                    <img src={offeneUnterschrift.url} alt="Unterschrift" style={{ maxHeight: 100 }} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {buchungen.length === 0 && (
            <LeerzustandZeile icon={ILeerKassenbuch} spalten={7}>
              Noch keine Buchungen erfasst.
            </LeerzustandZeile>
          )}
        </tbody>
      </table>
    </div>
  );
}
