import { CSSProperties, Fragment, FormEvent, useEffect, useState } from "react";
import type {
  KassenbuchungDto,
  KlientDetailDto,
  KostenuebernahmeDto,
  RechnungDto,
  RechnungStatus,
  TagDto,
  TagesberichtDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";
import { HZL_RHYTHMUS_LABEL, KASSENBUCHUNG_TYP_LABEL, RECHNUNG_STATUS_LABEL } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { Leerzustand, LeerzustandZeile } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IAbbrechen,
  IAblehnen,
  IAuszahlen,
  IAuszug,
  IBeenden,
  IDokument,
  IEinziehen,
  IFehler,
  IGenehmigen,
  IKassenbuch,
  IKostenuebernahme,
  ILeerKassenbuch,
  ILeerKostenuebernahmen,
  ILeerRechnungen,
  ILeerTagesberichte,
  ILoeschen,
  INeu,
  IRechnung,
  ISErledigt,
  ISOffen,
  ISStorniert,
  ISpeichern,
  ITagesberichte,
  IUebersicht,
  IZurueck,
} from "../components/icons";
import { dateiZuBase64 } from "../datei";
import { formatBetrag } from "../format";
import { TagesberichtZeile, TagVorschlaegeDatalist } from "./Tagesberichte";

type Tab = "uebersicht" | "kostenuebernahmen" | "rechnungen" | "kassenbuch" | "tagesberichte";

const eingabeFeldStil = {
  padding: "6px 8px",
  borderRadius: "var(--zv-radius-s)",
  border: "1px solid var(--zv-border)",
  background: "var(--zv-bg)",
  color: "var(--zv-text)",
  fontSize: 14,
};

const ROLLEN_MIT_ANONYMISIERUNG = new Set(["bereichsleitung", "einrichtungsleitung"]);

export function KlientDetail({ klientId, onZurueck }: { klientId: string; onZurueck: () => void }) {
  const [klient, setKlient] = useState<KlientDetailDto | null>(null);
  const [tab, setTab] = useState<Tab>("uebersicht");
  const [fehler, setFehler] = useState<string | null>(null);
  const [anonymisierenOffen, setAnonymisierenOffen] = useState(false);
  const [wirdAnonymisiert, setWirdAnonymisiert] = useState(false);

  // Nur ein Anzeige-Hinweis, der den Knopf ausblendet -- der Server prueft
  // dieselbe Rolle nochmal in KlientService.anonymisieren() (siehe tokenRolle()).
  const darfAnonymisieren = ROLLEN_MIT_ANONYMISIERUNG.has(tokenRolle() ?? "");

  function laden() {
    api.klient(klientId).then(setKlient).catch((err) => setFehler(err.message));
  }

  useEffect(laden, [klientId]);

  async function anonymisieren() {
    setFehler(null);
    setWirdAnonymisiert(true);
    try {
      await api.klientAnonymisieren(klientId);
      setAnonymisierenOffen(false);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Klient konnte nicht anonymisiert werden.");
    } finally {
      setWirdAnonymisiert(false);
    }
  }

  return (
    <div>
      <button className="zv-link-btn" onClick={onZurueck} style={{ marginBottom: 14 }}>
        <IZurueck />
        Zurück zur Liste
      </button>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {klient && (
        <div className="zv-card zv-card-weit" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: 19 }}>
                {klient.vorname} {klient.nachname}
              </h2>
              <p className="zv-sub" style={{ margin: 0 }}>
                Aktenzeichen {klient.aktenzeichen} · {klient.amt}
                {klient.geburtsdatum && <> · geb. {klient.geburtsdatum}</>} · HZL{" "}
                {HZL_RHYTHMUS_LABEL[klient.hzlRhythmus]}
              </p>
            </div>
            {klient.anonymisiertAm ? (
              <span className="zv-pill zv-pill-vergeben">
                <ILoeschen />
                Anonymisiert am {klient.anonymisiertAm.slice(0, 10)}
              </span>
            ) : (
              darfAnonymisieren && (
                <button className="zv-link-btn" onClick={() => setAnonymisierenOffen(true)}>
                  <ILoeschen />
                  Klient anonymisieren
                </button>
              )
            )}
          </div>
        </div>
      )}

      {anonymisierenOffen && (
        <Modal titel="Klient anonymisieren" onClose={() => setAnonymisierenOffen(false)}>
          <p style={{ marginTop: 0 }}>
            Name und Geburtsdatum dieses Klienten werden dauerhaft überschrieben (Recht auf Löschung, Art. 17
            DSGVO). Aktenzeichen, Amt sowie Kassenbuch- und Rechnungshistorie bleiben als Belege erhalten. Diese
            Aktion kann nicht rückgängig gemacht werden.
          </p>
          <button className="zv-btn zv-btn-gefahr zv-btn-block" onClick={anonymisieren} disabled={wirdAnonymisiert}>
            <ILoeschen />
            {wirdAnonymisiert ? "Wird anonymisiert…" : "Klient jetzt anonymisieren"}
          </button>
        </Modal>
      )}

      <div className="zv-tabbar" style={{ padding: 0, marginBottom: 20 }}>
        <button className={tab === "uebersicht" ? "active" : ""} onClick={() => setTab("uebersicht")}>
          <IUebersicht />
          Übersicht
        </button>
        <button className={tab === "kostenuebernahmen" ? "active" : ""} onClick={() => setTab("kostenuebernahmen")}>
          <IKostenuebernahme />
          Kostenübernahmen
        </button>
        <button className={tab === "rechnungen" ? "active" : ""} onClick={() => setTab("rechnungen")}>
          <IRechnung />
          Rechnungen
        </button>
        <button className={tab === "kassenbuch" ? "active" : ""} onClick={() => setTab("kassenbuch")}>
          <IKassenbuch />
          Kassenbuch
        </button>
        <button className={tab === "tagesberichte" ? "active" : ""} onClick={() => setTab("tagesberichte")}>
          <ITagesberichte />
          Tagesberichte
        </button>
      </div>

      {tab === "uebersicht" && klient && <UebersichtTab klient={klient} onGeaendert={laden} />}
      {tab === "kostenuebernahmen" && <KostenuebernahmenTab klientId={klientId} />}
      {tab === "rechnungen" && <RechnungenTab klientId={klientId} />}
      {tab === "kassenbuch" && <KlientKassenbuchTab klientId={klientId} />}
      {tab === "tagesberichte" && <TagesberichteTab klientId={klientId} />}
    </div>
  );
}

function UebersichtTab({ klient, onGeaendert }: { klient: KlientDetailDto; onGeaendert: () => void }) {
  const [aktuelleKostenuebernahme, setAktuelleKostenuebernahme] = useState<KostenuebernahmeDto | null | undefined>(
    undefined
  );
  const [freieZimmer, setFreieZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [zuweisungOffen, setZuweisungOffen] = useState(false);
  const [auszugOffen, setAuszugOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  useEffect(() => {
    api.kostenuebernahmenListe(klient.id).then((liste) => {
      setAktuelleKostenuebernahme(liste.find((k) => k.bis === null) ?? null);
    });
  }, [klient.id]);

  useEffect(() => {
    if (klient.aktuellesZimmer) return;
    api.zimmerListe().then((liste) => setFreieZimmer(liste.filter((z) => z.status === "zugeordnet")));
  }, [klient.id, klient.aktuellesZimmer]);

  async function zimmerZuweisen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungEinziehen({
        zimmerId: String(form.get("zimmerId")),
        klientId: klient.id,
        einzug: String(form.get("einzug")),
      });
      setZuweisungOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Zimmer konnte nicht zugewiesen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function auszugEintragen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!klient.aktuellesZimmer) return;
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungAusziehen(klient.aktuellesZimmer.belegungId, String(form.get("auszug")));
      setAuszugOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Auszug konnte nicht eingetragen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div className="zv-card zv-card-weit">
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 12, fontSize: 14 }}>
        <div style={{ color: "var(--zv-text-muted)" }}>Zimmer</div>
        <div>
          {klient.aktuellesZimmer ? (
            <>
              {klient.aktuellesZimmer.nummer} · {klient.aktuellesZimmer.standortName}{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setAuszugOffen(true);
                }}
              >
                <IAuszug />
                Auszug eintragen
              </button>
            </>
          ) : (
            <>
              Kein Zimmer zugeordnet{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setZuweisungOffen(true);
                }}
              >
                <IEinziehen />
                Zimmer zuweisen
              </button>
            </>
          )}
        </div>
        <div style={{ color: "var(--zv-text-muted)" }}>Aktuelle Kostenübernahme</div>
        <div>
          {aktuelleKostenuebernahme === undefined
            ? "…"
            : aktuelleKostenuebernahme
              ? `${aktuelleKostenuebernahme.amt}, seit ${aktuelleKostenuebernahme.von}`
              : "Kein offener Zeitraum"}
        </div>
      </div>

      {zuweisungOffen && (
        <Modal titel="Zimmer zuweisen" onClose={() => setZuweisungOffen(false)}>
          <form onSubmit={zimmerZuweisen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="klient-zimmer-select">Zimmer</label>
              <select id="klient-zimmer-select" name="zimmerId" required autoFocus defaultValue="">
                <option value="" disabled>
                  Bitte wählen
                </option>
                {freieZimmer.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nummer} · {z.standortName}
                  </option>
                ))}
              </select>
              {freieZimmer.length === 0 && (
                <span className="zv-sub-inline">Kein freies Zimmer verfügbar.</span>
              )}
            </div>
            <div className="zv-field">
              <label htmlFor="klient-einzug">Einzugsdatum</label>
              <input
                id="klient-einzug"
                name="einzug"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IEinziehen />
              {wirdGespeichert ? "Speichert…" : "Einziehen"}
            </button>
          </form>
        </Modal>
      )}

      {auszugOffen && (
        <Modal titel="Auszug eintragen" onClose={() => setAuszugOffen(false)}>
          <form onSubmit={auszugEintragen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="klient-auszug">Auszugsdatum</label>
              <input
                id="klient-auszug"
                name="auszug"
                type="date"
                required
                autoFocus
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IAuszug />
              {wirdGespeichert ? "Speichert…" : "Auszug speichern"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function KostenuebernahmenTab({ klientId }: { klientId: string }) {
  const [liste, setListe] = useState<KostenuebernahmeDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [beendenId, setBeendenId] = useState<string | null>(null);

  function laden() {
    api.kostenuebernahmenListe(klientId).then(setListe).catch((err) => setFehler(err.message));
  }
  useEffect(laden, [klientId]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.kostenuebernahmeAnlegen({ klientId, amt: String(form.get("amt")), von: String(form.get("von")) });
      setFormularOffen(false);
      formElement.reset();
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zeitraum konnte nicht angelegt werden.");
    }
  }

  async function beenden(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.kostenuebernahmeBeenden(id, String(form.get("bis")));
      setBeendenId(null);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zeitraum konnte nicht beendet werden.");
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Kostenübernahme-Zeiträume</h3>
        <button
          className="zv-btn"
          onClick={() => setFormularOffen((v) => !v)}
        >
          {formularOffen ? <IAbbrechen /> : <INeu />}
          {formularOffen ? "Abbrechen" : "Neuer Zeitraum"}
        </button>
      </div>

      {formularOffen && (
        <form className="zv-inline-form" onSubmit={anlegen}>
          <div className="zv-field-row">
            <div className="zv-field">
              <label>Amt</label>
              <input name="amt" required />
            </div>
            <div className="zv-field">
              <label>Von</label>
              <input name="von" type="date" required />
            </div>
          </div>
          <button className="zv-btn" type="submit">
            <ISpeichern />
            Anlegen
          </button>
        </form>
      )}

      <table className="zv-table">
        <thead>
          <tr>
            <th>Amt</th>
            <th>Von</th>
            <th>Bis</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {liste.map((k) => (
            <tr key={k.id}>
              <td>{k.amt}</td>
              <td>{k.von}</td>
              <td>{k.bis ?? <span className="zv-pill zv-pill-offen"><ISOffen />Offen</span>}</td>
              <td>
                {k.bis === null &&
                  (beendenId === k.id ? (
                    <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={(e) => beenden(e, k.id)}>
                      <input name="bis" type="date" required style={eingabeFeldStil} />
                      <button className="zv-link-btn" type="submit">
                        Speichern
                      </button>
                    </form>
                  ) : (
                    <button className="zv-link-btn" onClick={() => setBeendenId(k.id)}>
                      <IBeenden />
                      Beenden
                    </button>
                  ))}
              </td>
            </tr>
          ))}
          {liste.length === 0 && (
            <LeerzustandZeile icon={ILeerKostenuebernahmen} spalten={4}>
              Noch keine Kostenübernahme erfasst.
            </LeerzustandZeile>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RechnungenTab({ klientId }: { klientId: string }) {
  const [liste, setListe] = useState<RechnungDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);
  const [offenesDokument, setOffenesDokument] = useState<{ id: string; url: string } | null>(null);

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

  async function statusAendern(r: RechnungDto, status: RechnungStatus) {
    let grund: string | undefined;
    if (status === "abgelehnt") {
      const eingabe = window.prompt("Grund für die Ablehnung:");
      if (!eingabe) return;
      grund = eingabe;
    }
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

      <table className="zv-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Betrag</th>
            <th>Beschreibung</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {liste.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>{r.erstelltAm.slice(0, 10)}</td>
                <td>{formatBetrag(r.betragCent)}</td>
                <td>{r.beschreibung}</td>
                <td>
                  <span
                    className={`zv-pill ${
                      r.status === "abgelehnt" ? "zv-pill-danger" : r.status === "ausgezahlt" ? "zv-pill-ok" : r.status === "genehmigt" ? "zv-pill-info" : "zv-pill-offen"
                    }`}
                  >
                    {RECHNUNG_STATUS_LABEL[r.status]}
                  </span>
                  {r.status === "abgelehnt" && r.statusGrund && <span className="zv-sub-inline">{r.statusGrund}</span>}
                </td>
                <td style={{ display: "flex", gap: 10 }}>
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
                      <button className="zv-link-btn" onClick={() => statusAendern(r, "abgelehnt")}>
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
                </td>
              </tr>
              {offenesDokument?.id === r.id && (
                <tr>
                  <td colSpan={5} style={{ background: "var(--zv-surface-2)" }}>
                    <a href={offenesDokument.url} target="_blank" rel="noreferrer">
                      Dokument in neuem Tab öffnen
                    </a>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {liste.length === 0 && (
            <LeerzustandZeile icon={ILeerRechnungen} spalten={5}>
              Noch keine Rechnungen erfasst.
            </LeerzustandZeile>
          )}
        </tbody>
      </table>
    </div>
  );
}

function KlientKassenbuchTab({ klientId }: { klientId: string }) {
  const [buchungen, setBuchungen] = useState<KassenbuchungDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    api.kassenbuchungenListe(klientId).then(setBuchungen).catch((err) => setFehler(err.message));
  }, [klientId]);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <table className="zv-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Betrag</th>
            <th>Zweck</th>
            <th>Typ</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {buchungen.map((b) => (
            <tr key={b.id}>
              <td>{b.datum}</td>
              <td style={{ color: b.betragCent < 0 ? "var(--zv-status-danger)" : "var(--zv-status-ok)" }}>
                {formatBetrag(b.betragCent)}
              </td>
              <td>{b.verwendungszweck}</td>
              <td>{KASSENBUCHUNG_TYP_LABEL[b.typ]}</td>
              <td>
                {b.storniert ? (
                  <span className="zv-pill zv-pill-vergeben"><ISStorniert />Storniert</span>
                ) : (
                  <span className="zv-pill zv-pill-ok"><ISErledigt />Aktiv</span>
                )}
              </td>
            </tr>
          ))}
          {buchungen.length === 0 && (
            <LeerzustandZeile icon={ILeerKassenbuch} spalten={5}>
              Keine Kassenbuch-Einträge für diesen Klienten.
            </LeerzustandZeile>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TagesberichteTab({ klientId }: { klientId: string }) {
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [tagVorschlaege, setTagVorschlaege] = useState<TagDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);

  function laden() {
    api.tagesberichteListe(klientId).then(setBerichte).catch((err) => setFehler(err.message));
    api.tagsListe().then(setTagVorschlaege).catch(() => {});
  }

  useEffect(laden, [klientId]);

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const tagsText = String(form.get("tags") ?? "");
    const datei = form.get("dokument") as File | null;
    setFormFehler(null);
    try {
      let dokumente: { base64: string; dateiname: string; mimeType: string }[] | undefined;
      if (datei && datei.size > 0) {
        dokumente = [
          { base64: await dateiZuBase64(datei), dateiname: datei.name, mimeType: datei.type || "application/octet-stream" },
        ];
      }
      await api.tagesberichtAnlegen({
        klientId,
        datum: String(form.get("datum")),
        text: String(form.get("text")),
        tagNamen: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        dokumente,
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Tagesbericht konnte nicht angelegt werden.");
    }
  }

  async function tagEntfernen(berichtId: string, tagId: string) {
    try {
      await api.tagesberichtTagEntfernen(berichtId, tagId);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Tag konnte nicht entfernt werden.");
    }
  }

  async function tagHinzufuegen(berichtId: string, name: string) {
    if (!name.trim()) return;
    try {
      await api.tagesberichtTagHinzufuegen(berichtId, name.trim());
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Tag konnte nicht hinzugefügt werden.");
    }
  }

  async function dokumentHinzufuegen(berichtId: string, base64: string, dateiname: string, mimeType: string) {
    try {
      await api.tagesberichtDokumentHinzufuegen(berichtId, { base64, dateiname, mimeType });
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Dokument konnte nicht hinzugefügt werden.");
    }
  }

  const heute = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Tagesberichte</h3>
        <button
          className="zv-btn"
          onClick={() => {
            setFormFehler(null);
            setFormularOffen(true);
          }}
        >
          <INeu />
          Neuer Bericht
        </button>
      </div>

      {formularOffen && (
        <Modal titel="Neuer Tagesbericht" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label>Datum</label>
              <input name="datum" type="date" required autoFocus defaultValue={heute} />
            </div>
            <div className="zv-field">
              <label>Bericht</label>
              <textarea name="text" required rows={5} />
            </div>
            <div className="zv-field">
              <label>Tags (optional, durch Komma getrennt)</label>
              <input name="tags" placeholder="z. B. Beobachtung, Freizeit" />
            </div>
            <div className="zv-field">
              <label>Dokument (optional)</label>
              <input name="dokument" type="file" accept="application/pdf,image/*" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Anlegen
            </button>
          </form>
        </Modal>
      )}

      <TagVorschlaegeDatalist tags={tagVorschlaege} />

      {berichte.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>Noch keine Tagesberichte für diesen Klienten erfasst.</Leerzustand>
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "0.9fr 2.6fr 1.5fr 1.5fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Datum</span>
            <span>Bericht</span>
            <span>Tags</span>
            <span>Dokumente</span>
          </div>
          {berichte.map((b) => (
            <TagesberichtZeile
              key={b.id}
              bericht={b}
              zeigeKlient={false}
              onTagEntfernen={(tagId) => tagEntfernen(b.id, tagId)}
              onTagHinzufuegen={(name) => tagHinzufuegen(b.id, name)}
              onDokumentHinzufuegen={(base64, dateiname, mimeType) => dokumentHinzufuegen(b.id, base64, dateiname, mimeType)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
