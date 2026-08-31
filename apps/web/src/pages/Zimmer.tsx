import { FormEvent, useEffect, useState } from "react";
import type {
  BelegungsverlaufEintragDto,
  KlientListEintragDto,
  OffenerKapazitaetsantragDto,
  StandortDto,
  ZimmerBewohnerDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";
import { BENUTZER_ROLLE_LABEL, ZIMMERSTATUS_LABEL } from "@zimmerakte/shared";
import { api, tokenRolle } from "../api/client";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IAbbrechen,
  IAblehnen,
  IAufklappen,
  IAuszug,
  IBearbeiten,
  IEinziehen,
  IFehler,
  IGenehmigen,
  IKapazitaet,
  ILeerVerlauf,
  ILeerZimmer,
  INeu,
  ISpeichern,
  ISVergeben,
  ISZugeordnet,
  IStandort,
  IVerlauf,
  IZuklappen,
} from "../components/icons";

/** Sentinel-Wert im Standort-Select fuer "einen neuen Standort anlegen". */
const NEUER_STANDORT = "__neu__";

/**
 * "teilweise" (Mehrbettzimmer mit noch freiem Platz) bekommt bewusst
 * dasselbe Icon wie "zugeordnet" -- beide bedeuten fuer die Zuweisung
 * dasselbe ("hier passt noch jemand rein"), nur die Pill-Farbe (siehe
 * app.css, zv-pill-teilweise) unterscheidet sie visuell von "ganz frei".
 */
const STATUS_ICON = {
  vergeben: ISVergeben,
  teilweise: ISZugeordnet,
  zugeordnet: ISZugeordnet,
} as const;

/**
 * Zeigt bewusst nur, was die API tatsächlich zurückgibt -- "status" wird
 * hier nie berechnet, nur anzeigt. Die Ableitung passiert serverseitig
 * (siehe zimmer.service.ts), das Frontend ist hier absichtlich dumm.
 */
export function Zimmer() {
  // Nur ein Anzeige-Hinweis -- der Server entscheidet ueber die Berechtigung
  // (siehe ROLLEN_MIT_ZIMMER_STAMMDATEN in zimmer.service.ts). Klient
  // zuweisen/Auszug eintragen/Belegungsverlauf bleiben davon unberuehrt --
  // das ist Tagesgeschaeft, keine Stammdatenpflege.
  const rolleZimmer = tokenRolle();
  const darfStammdatenBearbeiten = rolleZimmer === "bereichsleitung" || rolleZimmer === "einrichtungsleitung";

  const [zimmer, setZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenesZimmer, setOffenesZimmer] = useState<string | null>(null);
  const [verlauf, setVerlauf] = useState<BelegungsverlaufEintragDto[]>([]);

  const [formularOffen, setFormularOffen] = useState(false);
  const [standortAuswahl, setStandortAuswahl] = useState<string>(NEUER_STANDORT);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const [bearbeitetesZimmer, setBearbeitetesZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [bearbeitenFehler, setBearbeitenFehler] = useState<string | null>(null);

  const [zuweisungsZimmer, setZuweisungsZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [zuweisungFehler, setZuweisungFehler] = useState<string | null>(null);
  const [auszugBewohner, setAuszugBewohner] = useState<{ zimmer: ZimmerListEintragDto; bewohner: ZimmerBewohnerDto } | null>(
    null
  );
  const [auszugFehler, setAuszugFehler] = useState<string | null>(null);

  const [kapazitaetZimmer, setKapazitaetZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [kapazitaetFehler, setKapazitaetFehler] = useState<string | null>(null);

  function ladeZimmer() {
    api.zimmerListe().then(setZimmer).catch((err) => setFehler(err.message));
  }

  function ladeKlienten() {
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
  }

  function ladeStandorte() {
    api
      .standorteListe()
      .then((liste) => {
        setStandorte(liste);
        // Gibt es schon mindestens einen AKTIVEN Standort, ist er beim
        // Oeffnen des Formulars vorausgewaehlt -- "neuen Standort anlegen"
        // bleibt ueber das Select trotzdem erreichbar, ist nur nicht mehr
        // die Vorgabe. Ein deaktivierter Standort taucht im Select gar
        // nicht erst auf (siehe unten), darf also auch nicht vorausgewaehlt
        // werden.
        const ersterAktiver = liste.find((s) => s.aktiv);
        if (ersterAktiver) setStandortAuswahl(ersterAktiver.id);
      })
      .catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    ladeZimmer();
    ladeStandorte();
    ladeKlienten();
  }, []);

  function formularOeffnen() {
    setFormFehler(null);
    setFormularOffen(true);
  }

  async function zimmerAnlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const nummer = String(form.get("nummer") ?? "").trim();
    const etage = String(form.get("etage") ?? "").trim();
    const kapazitaet = Number(form.get("kapazitaet") ?? 1);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      let standortId = standortAuswahl;
      if (standortId === NEUER_STANDORT) {
        const name = String(form.get("standortName") ?? "").trim();
        const adresse = String(form.get("standortAdresse") ?? "").trim();
        const neuerStandort = await api.standortAnlegen({ name, adresse });
        standortId = neuerStandort.id;
      }
      await api.zimmerAnlegen({ standortId, nummer, etage: etage || undefined, kapazitaet });
      setFormularOffen(false);
      ladeZimmer();
      ladeStandorte();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Zimmer konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function zimmerBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bearbeitetesZimmer) return;
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setBearbeitenFehler(null);
    setWirdGespeichert(true);
    try {
      const etage = String(form.get("etage") ?? "").trim();
      await api.zimmerAktualisieren(bearbeitetesZimmer.id, {
        nummer: String(form.get("nummer") ?? "").trim(),
        etage: etage || undefined,
      });
      setBearbeitetesZimmer(null);
      ladeZimmer();
    } catch (err) {
      setBearbeitenFehler(err instanceof Error ? err.message : "Zimmer konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function zimmerDeaktivieren(zimmerId: string) {
    try {
      await api.zimmerDeaktivieren(zimmerId);
      ladeZimmer();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zimmer konnte nicht deaktiviert werden.");
    }
  }

  async function klientZuweisen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!zuweisungsZimmer) return;
    const form = new FormData(e.currentTarget);
    setZuweisungFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungEinziehen({
        zimmerId: zuweisungsZimmer.id,
        klientId: String(form.get("klientId")),
        einzug: String(form.get("einzug")),
      });
      setZuweisungsZimmer(null);
      ladeZimmer();
      ladeKlienten();
    } catch (err) {
      setZuweisungFehler(err instanceof Error ? err.message : "Klient konnte nicht zugewiesen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function auszugEintragen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auszugBewohner) return;
    const form = new FormData(e.currentTarget);
    setAuszugFehler(null);
    setWirdGespeichert(true);
    try {
      await api.belegungAusziehen(auszugBewohner.bewohner.belegungId, String(form.get("auszug")));
      setAuszugBewohner(null);
      ladeZimmer();
      ladeKlienten();
    } catch (err) {
      setAuszugFehler(err instanceof Error ? err.message : "Auszug konnte nicht eingetragen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function kapazitaetAendern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!kapazitaetZimmer) return;
    const form = new FormData(e.currentTarget);
    const neueKapazitaet = Number(form.get("neueKapazitaet"));
    setKapazitaetFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerKapazitaetAendern(kapazitaetZimmer.id, neueKapazitaet);
      setKapazitaetZimmer(null);
      ladeZimmer();
    } catch (err) {
      setKapazitaetFehler(err instanceof Error ? err.message : "Kapazitätsänderung konnte nicht beantragt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function kapazitaetEntscheiden(antrag: OffenerKapazitaetsantragDto, entscheidung: "bestaetigt" | "abgelehnt") {
    let grund: string | undefined;
    if (entscheidung === "abgelehnt") {
      const eingabe = window.prompt("Grund für die Ablehnung:");
      if (!eingabe) return;
      grund = eingabe;
    }
    try {
      await api.zimmerKapazitaetEntscheiden(antrag.id, entscheidung, grund);
      ladeZimmer();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kapazitätsänderung konnte nicht entschieden werden.");
    }
  }

  /**
   * Reiner Anzeige-Hinweis (der Server prueft es erneut, siehe
   * kapazitaetEntscheiden() in zimmer.service.ts): Bestaetigen/Ablehnen nur
   * fuer die jeweils ANDERE Leitungsrolle als die antragstellende --
   * niemals fuer dieselbe Rolle, auch nicht fuer die antragstellende
   * Person selbst.
   */
  function darfKapazitaetEntscheiden(antrag: OffenerKapazitaetsantragDto): boolean {
    if (rolleZimmer !== "bereichsleitung" && rolleZimmer !== "einrichtungsleitung") return false;
    const gegenrolle = antrag.beantragtVonRolle === "bereichsleitung" ? "einrichtungsleitung" : "bereichsleitung";
    return rolleZimmer === gegenrolle;
  }

  async function verlaufAnzeigen(zimmerId: string) {
    if (offenesZimmer === zimmerId) {
      setOffenesZimmer(null);
      return;
    }
    setOffenesZimmer(zimmerId);
    try {
      setVerlauf(await api.belegungsverlauf(zimmerId));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Belegungsverlauf konnte nicht geladen werden.");
    }
  }

  const gruppen = zimmer.reduce<Record<string, ZimmerListEintragDto[]>>((acc, z) => {
    (acc[z.standortName] ??= []).push(z);
    return acc;
  }, {});

  /**
   * Etage ist Freitext (bewusste Entscheidung, da Gebaeude Stockwerke nicht
   * einheitlich benennen) -- eine alphabetische Sortierung stellt
   * "Dachgeschoss" faelschlich vor "EG". Bekannte Bezeichnungen (UG/EG/OG/
   * Etage/Dachgeschoss, je mit optionaler Nummer) werden deshalb erkannt
   * und in Gebaeude-Reihenfolge gebracht; alles andere faellt auf eine
   * gemeinsame Zwischenposition zurueck und wird dort alphabetisch
   * sortiert, damit unbekannte Bezeichnungen wenigstens untereinander
   * stabil bleiben.
   */
  function etagenSortierschluessel(etage: string): [number, string] {
    const e = etage.trim().toLowerCase();
    const ug = e.match(/^(\d+)\.?\s*(ug|untergeschoss|keller)\b/);
    if (ug) return [-Number(ug[1]), e];
    if (/^(ug|untergeschoss|keller)\b/.test(e)) return [-1, e];
    if (/^(eg|erdgeschoss|parterre)\b/.test(e)) return [0, e];
    const og = e.match(/^(\d+)\.?\s*(og|obergeschoss|etage|stock)?\b/);
    if (og) return [Number(og[1]), e];
    if (/^(dg|dachgeschoss|mansarde|spitzboden)\b/.test(e)) return [900, e];
    return [500, e];
  }

  function nachEtageGruppieren(raum: ZimmerListEintragDto[]): [string, ZimmerListEintragDto[]][] {
    const gruppiert = raum.reduce<Record<string, ZimmerListEintragDto[]>>((acc, z) => {
      (acc[z.etage] ??= []).push(z);
      return acc;
    }, {});
    return Object.entries(gruppiert).sort(([a], [b]) => {
      const [na, sa] = etagenSortierschluessel(a);
      const [nb, sb] = etagenSortierschluessel(b);
      return na - nb || sa.localeCompare(sb);
    });
  }

  const etagenVorschlaege = Array.from(new Set(zimmer.map((z) => z.etage)));

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Zimmer</h2>
        {darfStammdatenBearbeiten && (
          <button className="zv-btn" onClick={formularOeffnen}>
            <INeu />
            Neues Zimmer
          </button>
        )}
      </div>

      {Object.entries(gruppen).map(([standortName, raum]) => (
        <div key={standortName} style={{ marginBottom: 28 }}>
          <div className="zv-seiten-kopf">
            <h2>
              <IStandort style={{ verticalAlign: "-3px", marginRight: 6 }} />
              {standortName}
            </h2>
          </div>
          {nachEtageGruppieren(raum).map(([etage, raumInEtage]) => (
            <div key={etage} style={{ marginBottom: 20 }}>
              <h3 className="zv-etagen-kopf">{etage}</h3>
              <div className="zv-room-grid">
                {raumInEtage.map((z) => {
                  const StatusIcon = STATUS_ICON[z.status];
                  return (
                  <div key={z.id} className="zv-room-card">
                    <div className="zv-room-head">
                      <span className="zv-room-nummer">{z.nummer}</span>
                      <span className={`zv-pill zv-pill-${z.status}`}>
                        <StatusIcon />
                        {ZIMMERSTATUS_LABEL[z.status]}
                      </span>
                    </div>
                    <p className="zv-sub-inline" style={{ marginLeft: 0 }}>
                      {z.bewohner.length} / {z.kapazitaet} {z.kapazitaet === 1 ? "Platz belegt" : "Plätze belegt"}
                    </p>
                    {z.bewohner.length === 0 ? (
                      <div className="zv-room-klient zv-sub-inline">Kein Klient zugeordnet</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {z.bewohner.map((bew) => (
                          <div
                            key={bew.belegungId}
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                          >
                            <span className="zv-room-klient" style={{ margin: 0 }}>
                              {bew.name}
                              <span className="zv-sub-inline">seit {bew.einzug}</span>
                            </span>
                            <button
                              className="zv-link-btn"
                              onClick={() => {
                                setAuszugFehler(null);
                                setAuszugBewohner({ zimmer: z, bewohner: bew });
                              }}
                            >
                              <IAuszug />
                              Auszug
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {z.offenerKapazitaetsantrag && (
                      <div className="zv-hinweis zv-hinweis-info" style={{ marginTop: "var(--zv-space-2)" }}>
                        Kapazitätsänderung {z.offenerKapazitaetsantrag.alteKapazitaet} →{" "}
                        {z.offenerKapazitaetsantrag.neueKapazitaet} beantragt von{" "}
                        {z.offenerKapazitaetsantrag.beantragtVonName} (
                        {BENUTZER_ROLLE_LABEL[z.offenerKapazitaetsantrag.beantragtVonRolle]})
                        {darfKapazitaetEntscheiden(z.offenerKapazitaetsantrag) && (
                          <div className="zv-vorschau-zeile" style={{ marginTop: "var(--zv-space-1)" }}>
                            <button
                              className="zv-link-btn"
                              onClick={() => kapazitaetEntscheiden(z.offenerKapazitaetsantrag!, "bestaetigt")}
                            >
                              <IGenehmigen />
                              Bestätigen
                            </button>
                            <button
                              className="zv-link-btn"
                              onClick={() => kapazitaetEntscheiden(z.offenerKapazitaetsantrag!, "abgelehnt")}
                            >
                              <IAblehnen />
                              Ablehnen
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="zv-vorschau-zeile">
                      <button className="zv-link-btn" onClick={() => verlaufAnzeigen(z.id)}>
                        {offenesZimmer === z.id ? <IZuklappen /> : <IVerlauf />}
                        {offenesZimmer === z.id ? "Verlauf ausblenden" : "Belegungsverlauf"}
                        {offenesZimmer !== z.id && <IAufklappen />}
                      </button>
                      {darfStammdatenBearbeiten && (
                        <button
                          className="zv-link-btn"
                          onClick={() => {
                            setBearbeitenFehler(null);
                            setBearbeitetesZimmer(z);
                          }}
                        >
                          <IBearbeiten />
                          Bearbeiten
                        </button>
                      )}
                      {darfStammdatenBearbeiten && !z.offenerKapazitaetsantrag && (
                        <button
                          className="zv-link-btn"
                          onClick={() => {
                            setKapazitaetFehler(null);
                            setKapazitaetZimmer(z);
                          }}
                        >
                          <IKapazitaet />
                          Kapazität ändern
                        </button>
                      )}
                      {z.bewohner.length < z.kapazitaet && (
                        <button
                          className="zv-link-btn"
                          onClick={() => {
                            setZuweisungFehler(null);
                            setZuweisungsZimmer(z);
                          }}
                        >
                          <IEinziehen />
                          Klient zuweisen
                        </button>
                      )}
                      {darfStammdatenBearbeiten && z.bewohner.length === 0 && (
                        <button className="zv-link-btn" onClick={() => zimmerDeaktivieren(z.id)}>
                          Deaktivieren
                        </button>
                      )}
                    </div>

                    {offenesZimmer === z.id && (
                      <ul className="zv-verlauf-liste">
                        {verlauf.map((v) => (
                          <li key={v.id}>
                            <strong>{v.name}</strong>
                            <span className="zv-sub-inline">
                              {v.einzug} – {v.auszug ?? "heute"}
                            </span>
                          </li>
                        ))}
                        {verlauf.length === 0 && <li className="zv-sub-inline">Noch keine Belegung erfasst.</li>}
                      </ul>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}

      {zimmer.length === 0 && !fehler && (
        <Leerzustand icon={ILeerZimmer}>Noch keine Zimmer angelegt.</Leerzustand>
      )}

      <datalist id="zv-etagen-vorschlaege">
        {etagenVorschlaege.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>

      {formularOffen && (
        <Modal titel="Neues Zimmer" onClose={() => setFormularOffen(false)}>
          <form onSubmit={zimmerAnlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}

            <div className="zv-field">
              <label htmlFor="zimmer-standort">Standort</label>
              <select
                id="zimmer-standort"
                value={standortAuswahl}
                onChange={(e) => setStandortAuswahl(e.target.value)}
              >
                {standorte
                  .filter((s) => s.aktiv)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                <option value={NEUER_STANDORT}>+ Neuen Standort anlegen…</option>
              </select>
            </div>

            {standortAuswahl === NEUER_STANDORT && (
              <div className="zv-field-row">
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-name">Name des Standorts</label>
                  <input id="zimmer-standort-name" name="standortName" placeholder="z. B. Wohnheim Nordstraße" required autoFocus />
                </div>
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-adresse">Adresse</label>
                  <input id="zimmer-standort-adresse" name="standortAdresse" placeholder="Straße, PLZ Ort" required />
                </div>
              </div>
            )}

            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="zimmer-nummer">Zimmernummer</label>
                <input
                  id="zimmer-nummer"
                  name="nummer"
                  placeholder="z. B. 101"
                  required
                  autoFocus={standortAuswahl !== NEUER_STANDORT}
                />
              </div>
              <div className="zv-field">
                <label htmlFor="zimmer-etage">Etage</label>
                <input id="zimmer-etage" name="etage" list="zv-etagen-vorschlaege" placeholder="z. B. EG" defaultValue="EG" />
              </div>
            </div>

            <div className="zv-field">
              <label htmlFor="zimmer-kapazitaet">Kapazität (Bewohner:innen)</label>
              <input id="zimmer-kapazitaet" name="kapazitaet" type="number" min={1} max={12} defaultValue={1} />
            </div>

            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Zimmer anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {bearbeitetesZimmer && (
        <Modal titel="Zimmer bearbeiten" onClose={() => setBearbeitetesZimmer(null)}>
          <form onSubmit={zimmerBearbeiten}>
            {bearbeitenFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {bearbeitenFehler}
              </div>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label htmlFor="zimmer-bearbeiten-nummer">Zimmernummer</label>
                <input
                  id="zimmer-bearbeiten-nummer"
                  name="nummer"
                  defaultValue={bearbeitetesZimmer.nummer}
                  required
                  autoFocus
                />
              </div>
              <div className="zv-field">
                <label htmlFor="zimmer-bearbeiten-etage">Etage</label>
                <input
                  id="zimmer-bearbeiten-etage"
                  name="etage"
                  list="zv-etagen-vorschlaege"
                  defaultValue={bearbeitetesZimmer.etage}
                />
              </div>
            </div>
            <div className="zv-vorschau-zeile">
              <button className="zv-btn" type="submit" disabled={wirdGespeichert}>
                <ISpeichern />
                {wirdGespeichert ? "Speichert…" : "Speichern"}
              </button>
              <button
                className="zv-btn zv-btn-still"
                type="button"
                onClick={() => setBearbeitetesZimmer(null)}
              >
                <IAbbrechen />
                Abbrechen
              </button>
            </div>
          </form>
        </Modal>
      )}

      {zuweisungsZimmer && (
        <Modal titel={`Klient zuweisen — Zimmer ${zuweisungsZimmer.nummer}`} onClose={() => setZuweisungsZimmer(null)}>
          <form onSubmit={klientZuweisen}>
            {zuweisungFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {zuweisungFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="zuweisung-klient">Klient</label>
              <select id="zuweisung-klient" name="klientId" required autoFocus defaultValue="">
                <option value="" disabled>
                  Bitte wählen
                </option>
                {klienten
                  .filter((k) => k.aktuellesZimmer === null)
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.vorname} {k.nachname}
                    </option>
                  ))}
              </select>
              {klienten.filter((k) => k.aktuellesZimmer === null).length === 0 && (
                <span className="zv-sub-inline">Alle Klienten haben bereits ein Zimmer.</span>
              )}
            </div>
            <div className="zv-field">
              <label htmlFor="zuweisung-einzug">Einzugsdatum</label>
              <input
                id="zuweisung-einzug"
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

      {auszugBewohner && (
        <Modal
          titel={`Auszug eintragen — Zimmer ${auszugBewohner.zimmer.nummer}`}
          onClose={() => setAuszugBewohner(null)}
        >
          <form onSubmit={auszugEintragen}>
            {auszugFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {auszugFehler}
              </div>
            )}
            <p className="zv-sub" style={{ margin: "0 0 12px" }}>
              {auszugBewohner.bewohner.name} zieht aus diesem Zimmer aus.
            </p>
            <div className="zv-field">
              <label htmlFor="auszug-datum">Auszugsdatum</label>
              <input
                id="auszug-datum"
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

      {kapazitaetZimmer && (
        <Modal titel={`Kapazität ändern — Zimmer ${kapazitaetZimmer.nummer}`} onClose={() => setKapazitaetZimmer(null)}>
          <form onSubmit={kapazitaetAendern}>
            {kapazitaetFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {kapazitaetFehler}
              </div>
            )}
            <p className="zv-sub" style={{ marginTop: 0 }}>
              Aktuelle Kapazität: {kapazitaetZimmer.kapazitaet}. Die Änderung wirkt erst, wenn die jeweils andere
              Leitungsrolle sie bestätigt hat.
            </p>
            <div className="zv-field">
              <label htmlFor="kapazitaet-neu">Neue Kapazität</label>
              <input
                id="kapazitaet-neu"
                name="neueKapazitaet"
                type="number"
                min={1}
                max={12}
                required
                autoFocus
                defaultValue={kapazitaetZimmer.kapazitaet}
              />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Änderung beantragen"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
