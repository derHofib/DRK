import { FormEvent, useEffect, useState } from "react";
import type {
  BenutzerListEintragDto,
  KlientDetailDto,
  KlientStammdatenDto,
  KostenuebernahmeDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Modal } from "../../components/Modal";
import {
  IAufklappen,
  IAuszug,
  IBearbeiten,
  IEinziehen,
  IFehler,
  IGeplant,
  ILoeschen,
  ISpeichern,
  IWarteliste,
} from "../../components/icons";
import { formatDatum, heuteBerlin } from "../../format";
import { Datumsfeld, Zeitraumfeld } from "../../components/Datumsfeld";

export function StammdatenTab({ klient, onGeaendert }: { klient: KlientDetailDto; onGeaendert: () => void }) {
  const [aktuelleKostenuebernahme, setAktuelleKostenuebernahme] = useState<KostenuebernahmeDto | null | undefined>(
    undefined
  );
  const [freieZimmer, setFreieZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [zuweisungOffen, setZuweisungOffen] = useState(false);
  const [auszugOffen, setAuszugOffen] = useState(false);
  const [belegungBearbeitenOffen, setBelegungBearbeitenOffen] = useState(false);
  const [wartelisteOffen, setWartelisteOffen] = useState(false);
  const [alleZimmer, setAlleZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  useEffect(() => {
    api.kostenuebernahmenListe(klient.id).then((liste) => {
      setAktuelleKostenuebernahme(liste.find((k) => k.bis === null) ?? null);
    });
  }, [klient.id]);

  useEffect(() => {
    api.zimmerListe().then((liste) => {
      setAlleZimmer(liste);
      if (!klient.aktuellesZimmer) setFreieZimmer(liste.filter((z) => z.bewohner.length < z.kapazitaet));
    });
  }, [klient.id, klient.aktuellesZimmer]);

  // Fuer das Bezugsbetreuer-Dropdown in den Stammdaten -- einmal fuer die
  // ganze Uebersicht geladen statt je Abschnitt neu.
  useEffect(() => {
    api.benutzerListe().then(setBenutzerListe).catch(() => {});
  }, []);

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

  async function belegungBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!klient.aktuellesZimmer) return;
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      const auszug = String(form.get("auszug"));
      await api.belegungBearbeiten(klient.aktuellesZimmer.belegungId, {
        einzug: String(form.get("einzug")),
        auszug: auszug === "" ? null : auszug,
      });
      setBelegungBearbeitenOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Belegung konnte nicht geändert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function wartelisteHinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerWartelisteHinzufuegen(String(form.get("zimmerId")), klient.id);
      setWartelisteOffen(false);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Klient:in konnte nicht auf die Warteliste gesetzt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function wartelisteEntfernen(zimmerId: string, eintragId: string) {
    try {
      await api.zimmerWartelisteEntfernen(zimmerId, eintragId);
      onGeaendert();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Eintrag konnte nicht entfernt werden.");
    }
  }

  return (
    <div className="zv-stammdaten">
    <StammdatenSprungliste />
    <div className="zv-stammdaten-gruppen">
    <div className="zv-card zv-card-weit" style={{ marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 12, fontSize: 14 }}>
        <div style={{ color: "var(--zv-text-muted)" }}>Zimmer</div>
        <div>
          {klient.aktuellesZimmer ? (
            <>
              {klient.aktuellesZimmer.nummer} · {klient.aktuellesZimmer.standortName}{" "}
              {klient.aktuellesZimmer.auszug && (
                <span className="zv-pill zv-pill-info">
                  <IGeplant />
                  Auszug geplant {formatDatum(klient.aktuellesZimmer.auszug)}
                </span>
              )}{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setAuszugOffen(true);
                }}
              >
                <IAuszug />
                Auszug eintragen
              </button>{" "}
              <button
                className="zv-link-btn"
                onClick={() => {
                  setFormFehler(null);
                  setBelegungBearbeitenOffen(true);
                }}
              >
                <IBearbeiten />
                Bearbeiten
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
              ? `${aktuelleKostenuebernahme.amt}, seit ${formatDatum(aktuelleKostenuebernahme.von)}`
              : "Kein offener Zeitraum"}
        </div>
        <div style={{ color: "var(--zv-text-muted)" }}>Aufnahme am</div>
        <div>{klient.aufnahmeAm ? formatDatum(klient.aufnahmeAm) : "–"}</div>
        <div style={{ color: "var(--zv-text-muted)" }}>Entlassen am</div>
        <div>{klient.entlassenAm ? formatDatum(klient.entlassenAm) : "–"}</div>
        <div style={{ color: "var(--zv-text-muted)" }}>Wartelisten</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {klient.wartelisten.length === 0 ? (
            <span className="zv-sub-inline">Auf keiner Warteliste</span>
          ) : (
            klient.wartelisten.map((w) => (
              <span key={w.eintragId} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="zv-pill zv-pill-info">
                  <IWarteliste />
                  {w.standortName} · Zimmer {w.zimmerNummer}
                </span>
                <button className="zv-link-btn" onClick={() => wartelisteEntfernen(w.zimmerId, w.eintragId)}>
                  <ILoeschen />
                  Entfernen
                </button>
              </span>
            ))
          )}
          <button
            className="zv-link-btn"
            onClick={() => {
              setFormFehler(null);
              setWartelisteOffen(true);
            }}
          >
            <IWarteliste />
            Auf Warteliste setzen
          </button>
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
                    {z.kapazitaet > 1 ? ` (${z.bewohner.length}/${z.kapazitaet})` : ""}
                  </option>
                ))}
              </select>
              {freieZimmer.length === 0 && (
                <span className="zv-sub-inline">Kein freies Zimmer verfügbar.</span>
              )}
            </div>
            <div className="zv-field">
              <label htmlFor="klient-einzug">Einzugsdatum</label>
              <Datumsfeld id="klient-einzug" name="einzug" required defaultValue={heuteBerlin()} schnellwahl="heute" />
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
              <Datumsfeld id="klient-auszug" name="auszug" required autoFocus defaultValue={heuteBerlin()} schnellwahl="heute" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IAuszug />
              {wirdGespeichert ? "Speichert…" : "Auszug speichern"}
            </button>
          </form>
        </Modal>
      )}

      {belegungBearbeitenOffen && klient.aktuellesZimmer && (
        <Modal titel="Belegung bearbeiten" onClose={() => setBelegungBearbeitenOffen(false)}>
          <form onSubmit={belegungBearbeiten}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <p className="zv-sub" style={{ margin: "0 0 12px" }}>
              Nutzen, wenn sich ein Einzug oder Auszug verzögert oder sich geändert hat.
            </p>
            <div className="zv-field-row">
              <Zeitraumfeld
                von={{ id: "klient-belegung-einzug", name: "einzug", label: "Einzugsdatum", required: true }}
                bis={{ id: "klient-belegung-auszug", name: "auszug", label: "Auszugsdatum (optional)" }}
                defaultVon={klient.aktuellesZimmer.einzug}
                defaultBis={klient.aktuellesZimmer.auszug ?? ""}
                autoFocus
              />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}

      {wartelisteOffen && (
        <Modal titel="Auf Warteliste setzen" onClose={() => setWartelisteOffen(false)}>
          <form onSubmit={wartelisteHinzufuegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="klient-warteliste-zimmer">Zimmer</label>
              <select id="klient-warteliste-zimmer" name="zimmerId" required autoFocus defaultValue="">
                <option value="" disabled>
                  Bitte wählen
                </option>
                {alleZimmer
                  .filter(
                    (z) =>
                      z.id !== klient.aktuellesZimmer?.id &&
                      !klient.wartelisten.some((w) => w.zimmerId === z.id)
                  )
                  .map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.nummer} · {z.standortName}
                    </option>
                  ))}
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IWarteliste />
              {wirdGespeichert ? "Speichert…" : "Eintragen"}
            </button>
          </form>
        </Modal>
      )}
    </div>

    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Schnelle Informationen"
      felder={SCHNELLE_INFO_FELDER}
      stammdaten={klient.stammdaten}
      benutzerListe={benutzerListe}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Weitere Informationen"
      felder={WEITERE_INFO_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Kontakt / Betreuung"
      felder={KONTAKT_BETREUUNG_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Gesundheit"
      standardOffen={false}
      felder={GESUNDHEIT_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Bildung / Ausbildung"
      felder={BILDUNG_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    <StammdatenAbschnitt
      klientId={klient.id}
      titel="Vorherige Einrichtung"
      felder={VORHERIGE_EINRICHTUNG_FELDER}
      stammdaten={klient.stammdaten}
      onGeaendert={onGeaendert}
    />
    </div>
    </div>
  );
}

type StammdatenFeldTyp = "text" | "textarea" | "datum" | "benutzer";

interface StammdatenFeld {
  key: keyof Omit<KlientStammdatenDto, "bezugsbetreuerName" | "aktualisiertAm">;
  label: string;
  typ: StammdatenFeldTyp;
}

const SCHNELLE_INFO_FELDER: StammdatenFeld[] = [
  { key: "geburtsort", label: "Geburtsort", typ: "text" },
  { key: "nationalitaet", label: "Nationalität", typ: "text" },
  { key: "sorgeberechtigt", label: "Sorgeberechtigt", typ: "text" },
  { key: "bezugsbetreuerId", label: "Bezugsbetreuer:in", typ: "benutzer" },
  { key: "betreuungsstunden", label: "Betreuungsstunden", typ: "text" },
  { key: "telefon", label: "Telefon", typ: "text" },
  { key: "sprachen", label: "Sprachen", typ: "text" },
  { key: "anmerkungen", label: "Anmerkungen", typ: "textarea" },
];

const WEITERE_INFO_FELDER: StammdatenFeld[] = [
  { key: "personaldokumente", label: "Personaldokumente", typ: "text" },
  { key: "bankkonto", label: "Bankkonto (Kontoinhaber:in)", typ: "text" },
  { key: "iban", label: "IBAN", typ: "text" },
];

const KONTAKT_BETREUUNG_FELDER: StammdatenFeld[] = [
  { key: "jugendamtAdresse", label: "Adresse des Jugendamts", typ: "text" },
  { key: "jugendamtSachbearbeiter", label: "Sachbearbeiter:in", typ: "text" },
  { key: "jugendamtStellenzeichen", label: "Stellenzeichen", typ: "text" },
  { key: "jugendamtTelefon", label: "Telefon Jugendamt", typ: "text" },
  { key: "jugendamtEmail", label: "E-Mail Jugendamt", typ: "text" },
  { key: "wjhName", label: "WJH (Name)", typ: "text" },
  { key: "wjhTelefon", label: "WJH Telefon", typ: "text" },
  { key: "wjhEmail", label: "WJH E-Mail", typ: "text" },
  { key: "personensorgeberechtigte", label: "Personensorgeberechtigte(r)", typ: "text" },
  { key: "besuchskontakte", label: "Besuchskontakte", typ: "textarea" },
];

const GESUNDHEIT_FELDER: StammdatenFeld[] = [
  { key: "krankenkasse", label: "Krankenkasse", typ: "text" },
  { key: "versichertennummer", label: "Versichertennummer", typ: "text" },
  { key: "medikamente", label: "Medikamente", typ: "textarea" },
  { key: "diagnosen", label: "Diagnosen", typ: "textarea" },
  { key: "allergien", label: "Allergien", typ: "textarea" },
  { key: "besonderheitenGesundheitlich", label: "Besonderheiten (gesundheitlich)", typ: "textarea" },
  { key: "besonderheitenPsychisch", label: "Besonderheiten (psychisch)", typ: "textarea" },
];

const BILDUNG_FELDER: StammdatenFeld[] = [
  { key: "schule", label: "Schule", typ: "text" },
  { key: "klassenstufe", label: "Klassenstufe", typ: "text" },
  { key: "schulabschluesse", label: "Schulabschlüsse", typ: "text" },
  { key: "foerderbedarfe", label: "Förderbedarfe", typ: "textarea" },
];

const VORHERIGE_EINRICHTUNG_FELDER: StammdatenFeld[] = [
  { key: "vorherigeEinrichtungTraeger", label: "Träger", typ: "text" },
  { key: "vorherigeEinrichtungKontakt", label: "Kontakt", typ: "text" },
  { key: "vorherigeEinrichtungAnfrageAm", label: "Anfrage am", typ: "datum" },
  { key: "vorherigeEinrichtungEinzugAm", label: "Einzug am", typ: "datum" },
  { key: "vorherigeEinrichtungAuszugAm", label: "Auszug am", typ: "datum" },
];

function anzeigeWert(feld: StammdatenFeld, stammdaten: KlientStammdatenDto | null): string {
  if (!stammdaten) return "–";
  if (feld.typ === "benutzer") return stammdaten.bezugsbetreuerName ?? "–";
  const wert = stammdaten[feld.key] as string | null;
  if (!wert) return "–";
  return feld.typ === "datum" ? formatDatum(wert) : wert;
}

const STAMMDATEN_GRUPPEN = [
  "Schnelle Informationen",
  "Weitere Informationen",
  "Kontakt / Betreuung",
  "Gesundheit",
  "Bildung / Ausbildung",
  "Vorherige Einrichtung",
];

function gruppenId(titel: string): string {
  return titel.toLowerCase().replace(/[^a-z]+/g, "-");
}

/** Sprungliste fuer die Stammdaten im Vollbild; oeffnet eine zugeklappte Gruppe gleich mit. */
function StammdatenSprungliste() {
  return (
    <nav className="zv-stammdaten-sprung" aria-label="Abschnitte der Stammdaten">
      {STAMMDATEN_GRUPPEN.map((t) => (
        <button
          key={t}
          type="button"
          className="zv-link-btn"
          onClick={() => {
            const el = document.getElementById(`stammdaten-${gruppenId(t)}`) as HTMLDetailsElement | null;
            if (!el) return;
            el.open = true;
            el.scrollIntoView({ block: "start" });
          }}
        >
          {t}
        </button>
      ))}
    </nav>
  );
}

function StammdatenAbschnitt({
  klientId,
  titel,
  felder,
  stammdaten,
  benutzerListe,
  onGeaendert,
  standardOffen = true,
}: {
  klientId: string;
  titel: string;
  /** Gesundheit startet zu: Art.-9-Daten nicht nebenbei auf dem Bildschirm (Konzept klienten-ansicht, 3.2). */
  standardOffen?: boolean;
  felder: StammdatenFeld[];
  stammdaten: KlientStammdatenDto | null;
  benutzerListe?: BenutzerListEintragDto[];
  onGeaendert: () => void;
}) {
  const [bearbeitenOffen, setBearbeitenOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  async function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload: Record<string, string> = {};
    for (const f of felder) {
      const wert = String(form.get(f.key) ?? "");
      // "Nicht zugeordnet" beim Bezugsbetreuer wird bewusst NICHT
      // mitgeschickt: die Spalte ist eine uuid-FK, ein leerer String waere
      // dort kein gueltiger "loeschen"-Wert wie bei Text (siehe
      // KlientStammdatenService.setzen()) -- einmal zugeordnet, laesst sich
      // die Zuordnung ueber dieses Formular nicht wieder entfernen.
      if (f.typ === "benutzer" && wert === "") continue;
      payload[f.key] = wert;
    }
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.klientStammdatenSetzen(klientId, payload);
      setBearbeitenOffen(false);
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Angaben konnten nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <details className="zv-card zv-card-weit zv-stammdaten-gruppe" id={`stammdaten-${gruppenId(titel)}`} open={standardOffen}>
      <summary>
        <h3>{titel}</h3>
        <IAufklappen />
      </summary>
      <div className="zv-stammdaten-gruppe-kopf">
        <button className="zv-link-btn" onClick={() => setBearbeitenOffen(true)}>
          <IBearbeiten />
          Bearbeiten
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr)", rowGap: 10, columnGap: 12, fontSize: 14 }}>
        {felder.map((f) => (
          <div key={f.key} style={{ display: "contents" }}>
            <div style={{ color: "var(--zv-text-muted)" }}>{f.label}</div>
            <div style={{ whiteSpace: f.typ === "textarea" ? "pre-wrap" : undefined }}>
              {anzeigeWert(f, stammdaten)}
            </div>
          </div>
        ))}
      </div>

      {bearbeitenOffen && (
        <Modal titel={titel} onClose={() => setBearbeitenOffen(false)}>
          <form onSubmit={speichern}>
            {fehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {fehler}
              </div>
            )}
            {felder.map((f) => (
              <div className="zv-field" key={f.key}>
                <label htmlFor={`sf-${f.key}`}>{f.label}</label>
                {f.typ === "textarea" ? (
                  <textarea id={`sf-${f.key}`} name={f.key} rows={3} defaultValue={stammdaten?.[f.key] ?? ""} />
                ) : f.typ === "datum" ? (
                  <Datumsfeld id={`sf-${f.key}`} name={f.key} defaultValue={(stammdaten?.[f.key] as string | null) ?? ""} />
                ) : f.typ === "benutzer" ? (
                  <select id={`sf-${f.key}`} name={f.key} defaultValue={stammdaten?.bezugsbetreuerId ?? ""}>
                    <option value="">Nicht zugeordnet</option>
                    {(benutzerListe ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`sf-${f.key}`}
                    name={f.key}
                    type="text"
                    defaultValue={(stammdaten?.[f.key] as string | null) ?? ""}
                  />
                )}
              </div>
            ))}
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}
    </details>
  );
}
