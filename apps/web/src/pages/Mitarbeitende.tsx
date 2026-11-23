import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import { personFarbStil } from "../personFarbe";
import type {
  AccountTypDto,
  BenutzerListEintragDto,
  OrgUnitDto,
  StandortDto,
  StandortSichtDto,
  StandortSichtVorschauDto,
} from "@zimmerakte/shared";
import { STANDORT_SICHT_HERKUNFT_LABEL } from "@zimmerakte/shared";
import { formatDatum } from "../format";
import { api } from "../api/client";
import { AktionsMenue } from "../components/AktionsMenue";
import { Filterleiste, OptionenFilter, trifftSuche } from "../components/Listenfilter";
import { Leerzustand } from "../components/Leerzustand";
import { MitarbeiterDetail } from "../components/MitarbeiterDetail";
import { Modal } from "../components/Modal";
import { IAbbrechen, IAktivieren, IDeaktivieren, IFehler, IKopieren, IMitarbeitende, ILeerMitarbeitende, INeu, IPosition, IResetLink, ISpeichern, IStandort, IInfo, IVertretung, IAufklappen, IZuklappen } from "../components/icons";

type MitarbeitendeSortierung = "name-az" | "name-za" | "status";
const MITARBEITENDE_SORTIERUNG_LABEL: Record<MitarbeitendeSortierung, string> = {
  "name-az": "Name A–Z",
  "name-za": "Name Z–A",
  status: "Aktive zuerst",
};

export function Mitarbeitende({
  onKlientOeffnen,
  onChatOeffnen,
}: {
  onKlientOeffnen?: (klientId: string) => void;
  onChatOeffnen?: (chatId: string) => void;
} = {}) {
  const [benutzer, setBenutzer] = useState<BenutzerListEintragDto[]>([]);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ name: string; url: string; laeuftAbAm: string } | null>(null);
  const [kopiert, setKopiert] = useState(false);
  const [standortZuweisung, setStandortZuweisung] = useState<BenutzerListEintragDto | null>(null);
  const [zuweisungFehler, setZuweisungFehler] = useState<string | null>(null);
  const [wirdZugewiesen, setWirdZugewiesen] = useState(false);
  // "Abweichend: nur diese Standorte" im Dialog "Sicht festlegen".
  const [sichtAbweichend, setSichtAbweichend] = useState(false);
  // Vorschau der Standortregel; null ohne Recht (403) -- dann kein Kasten.
  const [vorschau, setVorschau] = useState<StandortSichtVorschauDto | null>(null);
  const [vorschauOffen, setVorschauOffen] = useState(false);
  const [regelWirdGeschaltet, setRegelWirdGeschaltet] = useState(false);
  // Seitenpanel „wofür ist die Person zuständig“ (Rueckmeldung 29e0f19d).
  const [detailPerson, setDetailPerson] = useState<BenutzerListEintragDto | null>(null);
  const [statusAenderung, setStatusAenderung] = useState<BenutzerListEintragDto | null>(null);
  const [statusFehler, setStatusFehler] = useState<string | null>(null);
  const [statusWirdGespeichert, setStatusWirdGespeichert] = useState(false);

  const [rangZiel, setRangZiel] = useState<BenutzerListEintragDto | null>(null);
  const [rangTypen, setRangTypen] = useState<AccountTypDto[]>([]);
  const [rangEinrichtungen, setRangEinrichtungen] = useState<OrgUnitDto[]>([]);
  const [rangTypWahl, setRangTypWahl] = useState("");
  const [rangFehler, setRangFehler] = useState<string | null>(null);
  const [rangWirdGespeichert, setRangWirdGespeichert] = useState(false);

  // Zur Auswahl steht jeder Account-Typ, nicht nur einer mit schon vorhandener
  // Position: ein selbst angelegter Typ (z. B. "Bereichsleiter") hat noch keine,
  // und der Server legt sie beim ersten Zuweisen an.
  // Ob die Person das darf, entscheidet allein der Server (403 landet im
  // Dialog) -- das Frontend kennt die Rechte der angemeldeten Person nicht.
  async function rangOeffnen(b: BenutzerListEintragDto) {
    setFehler(null);
    try {
      const [typen, einheiten] = await Promise.all([api.organigrammAccountTypen(), api.organigrammOrgUnits()]);
      setRangTypen(typen);
      setRangEinrichtungen(einheiten.filter((u) => u.typ === "einrichtung" && u.aktiv));
      setRangTypWahl(typen.find((t) => t.name === b.positionen[0]?.accountTypName)?.id ?? "");
      setRangFehler(null);
      setRangZiel(b);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Positionen konnten nicht geladen werden.");
    }
  }

  async function rangSpeichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rangZiel) return;
    const form = new FormData(e.currentTarget);
    const wert = String(form.get("accountTypId"));
    // Vollzugriff gilt ohnehin fuer den ganzen Mandanten: dort keine Standorte.
    const mitStandorten = wert !== "" && !rangTypen.find((t) => t.id === wert)?.istVollzugriff;
    setRangFehler(null);
    setRangWirdGespeichert(true);
    try {
      await api.benutzerPositionWechseln(
        rangZiel.id,
        wert === "" ? null : wert,
        mitStandorten ? form.getAll("einheitIds").map(String) : undefined
      );
      setRangZiel(null);
      laden();
    } catch (err) {
      setRangFehler(err instanceof Error ? err.message : "Rang konnte nicht geändert werden.");
    } finally {
      setRangWirdGespeichert(false);
    }
  }

  function laden() {
    api.benutzerListe().then(setBenutzer).catch((err) => setFehler(err.message));
    // Liefert bereits nur die eigenen erlaubten Standorte (siehe
    // StandortService.findeAlle).
    api.standorteListe().then(setStandorte).catch(() => {});
    api.standortSichtVorschau().then(setVorschau).catch(() => setVorschau(null));
  }

  async function regelSchalten(ausRang: boolean) {
    setRegelWirdGeschaltet(true);
    setFehler(null);
    try {
      setVorschau(await api.standortRegelSetzen(ausRang));
      api.benutzerListe().then(setBenutzer).catch(() => {});
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Die Standortregel konnte nicht umgeschaltet werden.");
    } finally {
      setRegelWirdGeschaltet(false);
    }
  }

  useEffect(laden, []);

  const [suche, setSuche] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [standortFilter, setStandortFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [sortierung, setSortierung] = useState<MitarbeitendeSortierung>("name-az");
  const sichtbareBenutzer = useMemo(() => {
    const nachName = (a: BenutzerListEintragDto, b: BenutzerListEintragDto) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id);
    return benutzer
      .filter(
        (b) =>
          (!statusFilter || (statusFilter === "aktiv") === b.aktiv) &&
          // Filtert nach dem, was die Person SIEHT (fest, aus dem Rang oder per
          // Vertretung) -- wer alles sieht, passt zu jedem Standort.
          (!standortFilter || b.sicht.alle || b.sicht.eintraege.some((e) => e.standortId === standortFilter)) &&
          (!positionFilter || b.positionen.some((p) => p.titel === positionFilter)) &&
          trifftSuche(suche, [b.name, b.email, ...b.positionen.map((p) => p.titel)]),
      )
      .sort((a, b) => {
        switch (sortierung) {
          case "name-az":
            return nachName(a, b);
          case "name-za":
            return nachName(b, a);
          case "status":
            return Number(b.aktiv) - Number(a.aktiv) || nachName(a, b);
        }
      });
  }, [benutzer, statusFilter, standortFilter, positionFilter, suche, sortierung]);
  const positionOptionen = useMemo(
    () => [...new Set(benutzer.flatMap((b) => b.positionen.map((p) => p.titel)))].sort((a, b) => a.localeCompare(b, "de")).map((t) => ({ wert: t, label: t })),
    [benutzer],
  );
  const benutzerFilterAktiv = Boolean(statusFilter || standortFilter || positionFilter || suche.trim());

  async function standorteSpeichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!standortZuweisung) return;
    const form = new FormData(e.currentTarget);
    // "Wie im Rang" = keine feste Sicht: die Liste wird geleert.
    const gewaehlteIds = sichtAbweichend ? form.getAll("standortIds").map(String) : [];
    if (sichtAbweichend && gewaehlteIds.length === 0) {
      setZuweisungFehler("Bitte mindestens einen Standort wählen oder „Wie im Rang“ nehmen.");
      return;
    }
    setZuweisungFehler(null);
    setWirdZugewiesen(true);
    try {
      await api.benutzerStandorteSetzen(standortZuweisung.id, gewaehlteIds);
      setStandortZuweisung(null);
      laden();
    } catch (err) {
      setZuweisungFehler(err instanceof Error ? err.message : "Standorte konnten nicht gespeichert werden.");
    } finally {
      setWirdZugewiesen(false);
    }
  }

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    try {
      await api.benutzerAnlegen({
        name: String(form.get("name")),
        email: String(form.get("email")),
        passwort: String(form.get("passwort")),
      });
      setFormularOffen(false);
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Mitarbeiter konnte nicht angelegt werden.");
    }
  }

  async function passwortZuruecksetzen(b: BenutzerListEintragDto) {
    setFehler(null);
    setKopiert(false);
    try {
      const { token, laeuftAbAm } = await api.passwortResetErstellen(b.id);
      const url = `${window.location.origin}${window.location.pathname}?reset=${token}`;
      setResetLink({ name: b.name, url, laeuftAbAm });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Link konnte nicht erzeugt werden.");
    }
  }

  // Beide Richtungen ueber denselben Dialog: Deaktivieren sperrt sofort
  // (auch ein bereits eingeloggtes Token, siehe auth.guard.ts), loescht aber
  // nichts -- Tagesberichte, Kassenbuch und Audit-Log behalten ihren Bezug.
  // Wie bei den anderen Aktionen hier entscheidet allein der Server, ob die
  // Person das darf (403 landet im Dialog).
  async function statusBestaetigen() {
    if (!statusAenderung) return;
    setStatusFehler(null);
    setStatusWirdGespeichert(true);
    try {
      await api.benutzerAktivSetzen(statusAenderung.id, !statusAenderung.aktiv);
      setStatusAenderung(null);
      laden();
    } catch (err) {
      setStatusFehler(err instanceof Error ? err.message : "Status konnte nicht geändert werden.");
    } finally {
      setStatusWirdGespeichert(false);
    }
  }

  async function linkKopieren() {
    if (!resetLink) return;
    await navigator.clipboard.writeText(resetLink.url);
    setKopiert(true);
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
        <h2>Mitarbeitende</h2>
        <button
          className="zv-btn"
          onClick={() => {
            setFormFehler(null);
            setFormularOffen(true);
          }}
        >
          <INeu />
          Neuer Mitarbeiter
        </button>
      </div>

      {formularOffen && (
        <Modal titel="Neuer Mitarbeiter" onClose={() => setFormularOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Name</label>
                <input name="name" required autoFocus />
              </div>
              <div className="zv-field">
                <label>E-Mail</label>
                <input name="email" type="email" required />
              </div>
            </div>
            <div className="zv-field-row">
              <div className="zv-field">
                <label>Initialpasswort</label>
                <input name="passwort" type="password" required minLength={8} />
              </div>
            </div>
            <p className="zv-sub">
              Rechte gibt es erst über eine Position im Organigramm -- direkt nach dem Anlegen hat {`der neue Account`}
              {" "}noch keine.
            </p>
            <button className="zv-btn zv-btn-block" type="submit">
              <ISpeichern />
              Anlegen
            </button>
          </form>
        </Modal>
      )}

      {resetLink && (
        <Modal titel={`Passwort-Reset-Link — ${resetLink.name}`} onClose={() => setResetLink(null)}>
          <p className="zv-sub">
            Diesen Link auf einem beliebigen Weg (z. B. Teams, mündlich) an {resetLink.name} weitergeben. Der Link
            ist nur <strong>einmal einlösbar</strong> und läuft am{" "}
            {new Date(resetLink.laeuftAbAm).toLocaleString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            Uhr ab. {resetLink.name} vergibt das neue Passwort dabei selbst — es wird an keiner Stelle angezeigt oder
            gespeichert.
          </p>
          <div className="zv-field">
            <label htmlFor="reset-link-feld">Link (nur jetzt sichtbar)</label>
            <input id="reset-link-feld" readOnly value={resetLink.url} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <button className="zv-btn zv-btn-block" type="button" onClick={linkKopieren}>
            <IKopieren />
            {kopiert ? "Kopiert!" : "Link kopieren"}
          </button>
        </Modal>
      )}

      {vorschau && (
        <RegelVorschau
          vorschau={vorschau}
          offen={vorschauOffen}
          onUmschalten={() => setVorschauOffen((v) => !v)}
          onRegel={regelSchalten}
          wirdGeschaltet={regelWirdGeschaltet}
        />
      )}

      {benutzer.length > 0 && (
        <>
          <Filterleiste
            ariaLabel="Mitarbeitende filtern und sortieren"
            suche={{ wert: suche, onChange: setSuche, placeholder: "Name, E-Mail, Position…", ariaLabel: "Mitarbeitende durchsuchen" }}
            zusatz={[
              {
                id: "position",
                label: "Position",
                icon: <IPosition />,
                wert: positionFilter || null,
                optionen: positionOptionen,
                gewaehlt: positionFilter || null,
                onWaehlen: setPositionFilter,
                onEntfernen: () => setPositionFilter(""),
              },
            ]}
            sortierung={{
              optionen: (Object.keys(MITARBEITENDE_SORTIERUNG_LABEL) as MitarbeitendeSortierung[]).map((o) => ({ wert: o, label: MITARBEITENDE_SORTIERUNG_LABEL[o] })),
              wert: sortierung,
              onWaehlen: (o) => setSortierung(o as MitarbeitendeSortierung),
            }}
            aktiv={benutzerFilterAktiv}
            onZuruecksetzen={() => {
              setStatusFilter("");
              setStandortFilter("");
              setPositionFilter("");
              setSuche("");
            }}
          >
            <OptionenFilter
              icon={<IAktivieren />}
              label="Status"
              optionen={[
                { wert: "aktiv", label: "Aktiv" },
                { wert: "inaktiv", label: "Inaktiv" },
              ]}
              wert={statusFilter}
              onWaehlen={setStatusFilter}
            />
            <OptionenFilter
              icon={<IStandort />}
              label="Standort"
              optionen={standorte.map((st) => ({ wert: st.id, label: st.name }))}
              wert={standortFilter}
              onWaehlen={setStandortFilter}
            />
          </Filterleiste>
          <div className="zv-sub-inline" aria-live="polite" style={{ marginBottom: "var(--zv-space-3)" }}>
            {sichtbareBenutzer.length} {sichtbareBenutzer.length === 1 ? "Person" : "Personen"} · {MITARBEITENDE_SORTIERUNG_LABEL[sortierung]}
          </div>
        </>
      )}

      {benutzer.length === 0 ? (
        <Leerzustand icon={ILeerMitarbeitende}>Keine Mitarbeitenden gefunden.</Leerzustand>
      ) : sichtbareBenutzer.length === 0 ? (
        <Leerzustand icon={ILeerMitarbeitende}>Keine Mitarbeitenden für diese Auswahl.</Leerzustand>
      ) : (
        <div
          className="zv-karten-liste"
          style={{ "--zv-liste-spalten": "1.2fr 1.4fr 1.1fr 0.7fr 1.3fr 1.5fr 1.4fr" } as CSSProperties}
        >
          <div className="zv-liste-kopf">
            <span>Name</span>
            <span>E-Mail</span>
            <span>Position(en)</span>
            <span>Status</span>
            <span>Zuständig für</span>
            <span>Sieht</span>
            <span></span>
          </div>
          {sichtbareBenutzer.map((b) => (
            <div key={b.id} className="zv-info-karte">
              <span className="zv-liste-zelle-titel">
                {/* Dieselbe Farbe wie im Kalender (personFarbe.ts). */}
                <span className="zv-person-punkt zv-person-farbe" style={personFarbStil(b.farbIndex)} title="Farbe im Kalender" aria-hidden="true" />
                <button type="button" className="zv-name-link" onClick={() => setDetailPerson(b)}>
                  {b.name}
                </button>
              </span>
              <span className="zv-liste-zelle" data-label="E-Mail">
                <strong>{b.email}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Position(en)">
                {b.positionen.length === 0 ? (
                  <span className="zv-sub-inline" style={{ marginLeft: 0 }}>
                    Keine Position
                  </span>
                ) : (
                  b.positionen.map((p, i) => (
                    <span key={i} className="zv-pill" style={{ marginRight: 4 }} title={`${p.titel} (${p.accountTypName})`}>
                      <span className="zv-pill-text">{p.titel}</span>
                    </span>
                  ))
                )}
              </span>
              <span className="zv-liste-zelle" data-label="Status">
                <strong>{b.aktiv ? "Aktiv" : "Inaktiv"}</strong>
              </span>
              <span className="zv-liste-zelle" data-label="Zuständig für">
                <ZustaendigZelle b={b} />
              </span>
              <span className="zv-liste-zelle" data-label="Sieht">
                <SichtZelle sicht={b.sicht} />
              </span>
              <span className="zv-liste-zelle-aktionen">
                <AktionsMenue label={`Aktionen für ${b.name}`}>
                  <button role="menuitem" onClick={() => setDetailPerson(b)}>
                    <IMitarbeitende />
                    Profil und Zuständigkeiten
                  </button>
                  <button role="menuitem" onClick={() => rangOeffnen(b)}>
                    <IMitarbeitende />
                    Rang ändern
                  </button>
                  <button role="menuitem" onClick={() => passwortZuruecksetzen(b)}>
                    <IResetLink />
                    Passwort zurücksetzen
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setZuweisungFehler(null);
                      setSichtAbweichend(b.standortIds.length > 0);
                      setStandortZuweisung(b);
                    }}
                  >
                    <IStandort />
                    Sicht festlegen
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setStatusFehler(null);
                      setStatusAenderung(b);
                    }}
                  >
                    {b.aktiv ? <IDeaktivieren /> : <IAktivieren />}
                    {b.aktiv ? "Deaktivieren" : "Reaktivieren"}
                  </button>
                </AktionsMenue>
              </span>
            </div>
          ))}
        </div>
      )}

      <MitarbeiterDetail
        person={detailPerson}
        onSchliessen={() => setDetailPerson(null)}
        onKlientOeffnen={onKlientOeffnen}
        onChatOeffnen={onChatOeffnen}
      />

      {rangZiel && (
        <Modal titel={`Rang ändern — ${rangZiel.name}`} onClose={() => setRangZiel(null)}>
          <form onSubmit={rangSpeichern}>
            {rangFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {rangFehler}
              </div>
            )}
            <p className="zv-sub" style={{ marginTop: 0 }}>
              Die gewählte Position ersetzt alle bisherigen Positionen von {rangZiel.name}. Die neuen Rechte gelten
              sofort; die Änderung wird im Protokoll festgehalten. Ohne Position hat die Person keine Rechte.
            </p>
            <div className="zv-field">
              <label htmlFor="rang-position">Position</label>
              <select
                id="rang-position"
                name="accountTypId"
                value={rangTypWahl}
                onChange={(e) => setRangTypWahl(e.target.value)}
              >
                <option value="">Keine Position</option>
                {rangTypen.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {rangTypWahl !== "" && !rangTypen.find((t) => t.id === rangTypWahl)?.istVollzugriff && (
              <fieldset className="zv-field" style={{ border: 0, padding: 0, margin: "16px 0 0" }}>
                <legend>Arbeitet an</legend>
                <p className="zv-sub" style={{ marginTop: 0 }}>
                  Die Rechte dieses Rangs gelten für {rangZiel.name} nur an den angehakten Einrichtungen. Ohne Haken
                  gelten sie an keiner.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {rangEinrichtungen.map((u) => (
                    <label key={u.id} className="zv-checkbox-zeile">
                      <input
                        type="checkbox"
                        name="einheitIds"
                        value={u.id}
                        defaultChecked={rangZiel.einheitIds.includes(u.id)}
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <button className="zv-btn zv-btn-block" type="submit" disabled={rangWirdGespeichert} style={{ marginTop: 20 }}>
              <ISpeichern />
              {rangWirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}

      {statusAenderung && (
        <Modal
          titel={`${statusAenderung.aktiv ? "Deaktivieren" : "Reaktivieren"} — ${statusAenderung.name}`}
          onClose={() => setStatusAenderung(null)}
        >
          {statusFehler && (
            <div className="zv-hinweis zv-hinweis-fehler">
              <IFehler />
              {statusFehler}
            </div>
          )}
          <p className="zv-sub" style={{ marginTop: 0 }}>
            {statusAenderung.aktiv
              ? `${statusAenderung.name} kann sich danach nicht mehr anmelden; eine laufende Sitzung endet sofort. Nichts wird gelöscht — Tagesberichte, Kassenbuch und Protokoll behalten ihren Bezug, und die Person lässt sich jederzeit reaktivieren.`
              : `${statusAenderung.name} kann sich danach wieder anmelden und hat dieselben Rechte wie vor der Deaktivierung.`}
          </p>
          <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
            <button className="zv-btn" type="button" onClick={statusBestaetigen} disabled={statusWirdGespeichert}>
              {statusAenderung.aktiv ? <IDeaktivieren /> : <IAktivieren />}
              {statusWirdGespeichert ? "Speichert…" : statusAenderung.aktiv ? "Deaktivieren" : "Reaktivieren"}
            </button>
            <button className="zv-btn zv-btn-still" type="button" onClick={() => setStatusAenderung(null)}>
              <IAbbrechen />
              Abbrechen
            </button>
          </div>
        </Modal>
      )}

      {standortZuweisung && (
        <Modal titel={`Sicht festlegen — ${standortZuweisung.name}`} onClose={() => setStandortZuweisung(null)}>
          <form onSubmit={standorteSpeichern}>
            {zuweisungFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {zuweisungFehler}
              </div>
            )}
            <p className="zv-sub" style={{ marginTop: 0 }}>
              Welche Standorte {standortZuweisung.name} sieht: Klient:innen, Dokumentation, Kassenbuch und alles, was daran hängt.
            </p>
            <label className="zv-checkbox-zeile">
              <input type="radio" name="sichtArt" checked={!sichtAbweichend} onChange={() => setSichtAbweichend(false)} />
              <span>
                Wie im Rang (Arbeitet an)
                <span className="zv-sub" style={{ display: "block", margin: 0 }}>
                  {vorschau && !vorschau.ausRang
                    ? "Solange die Regel „Sicht aus dem Rang“ aus ist: alle Standorte."
                    : rangSichtText(standortZuweisung, vorschau)}
                </span>
              </span>
            </label>
            <label className="zv-checkbox-zeile" style={{ marginTop: 8 }}>
              <input type="radio" name="sichtArt" checked={sichtAbweichend} onChange={() => setSichtAbweichend(true)} />
              Abweichend: nur diese Standorte
            </label>
            {sichtAbweichend && (
            <div style={{ marginLeft: 28, marginTop: 8 }}>
              {standorte.length === 0 ? (
                <p className="zv-sub">Keine Standorte verfügbar.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {standorte.map((s) => (
                    <label key={s.id} className="zv-checkbox-zeile">
                      <input
                        type="checkbox"
                        name="standortIds"
                        value={s.id}
                        defaultChecked={standortZuweisung.standortIds.includes(s.id)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            )}
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdZugewiesen} style={{ marginTop: 20 }}>
              <ISpeichern />
              {wirdZugewiesen ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** Sichtbare Standorte als Pillen, mit Herkunft. */
/**
 * Kurzfassung fuer die Liste. Die Zahl zaehlt auch Klient:innen an Standorten,
 * die die betrachtende Person nicht sieht (Entscheidung im Konzept): Namen
 * gibt es erst im Detail, und dort gefiltert.
 */
function ZustaendigZelle({ b }: { b: BenutzerListEintragDto }) {
  const z = b.zustaendig;
  return (
    <span className="zv-zustaendig-zelle">
      <strong>{z.bezugsklienten === 0 ? "—" : z.bezugsklienten === 1 ? "1 Klient:in" : `${z.bezugsklienten} Klient:innen`}</strong>
      {z.vertritt.map((v) => (
        <span key={v.benutzerId} className="zv-pill zv-pill-info" title={`Vertritt ${v.name} bis ${formatDatum(v.bis)}`}>
          <IVertretung />
          <span className="zv-pill-text">vertritt {v.name}</span>
        </span>
      ))}
      {z.wirdVertretenVon.length > 0 && (
        <span
          className="zv-pill zv-pill-info"
          title={z.wirdVertretenVon.map((v) => `Vertreten von ${v.name} bis ${formatDatum(v.bis)}`).join(", ")}
        >
          <IVertretung />
          <span className="zv-pill-text">wird vertreten</span>
        </span>
      )}
    </span>
  );
}

function SichtZelle({ sicht }: { sicht: StandortSichtDto }) {
  if (sicht.alle) return <span className="zv-sub-inline" style={{ marginLeft: 0 }}>Alle Standorte</span>;
  if (sicht.eintraege.length === 0) {
    return (
      <span className="zv-pill zv-pill-achtung">
        <span className="zv-pill-text">Kein Standort</span>
      </span>
    );
  }
  const herkunft = new Set(sicht.eintraege.filter((e) => e.herkunft !== "vertretung").map((e) => e.herkunft));
  return (
    <span className="zv-sicht-zelle">
      {sicht.eintraege.map((e) => (
        <span
          key={e.standortId}
          className={`zv-pill${e.herkunft === "vertretung" ? " zv-pill-info" : ""}`}
          title={e.herkunft === "vertretung" ? `Vertretung für ${e.vertretenerName ?? "?"}` : STANDORT_SICHT_HERKUNFT_LABEL[e.herkunft]}
        >
          {e.herkunft === "vertretung" && <IVertretung />}
          <span className="zv-pill-text">
            {e.herkunft === "vertretung" ? `+ ${e.standortName}${e.bis ? ` bis ${formatDatum(e.bis).slice(0, 6)}` : ""}` : e.standortName}
          </span>
        </span>
      ))}
      {herkunft.size === 1 && <span className="zv-sub-inline">{STANDORT_SICHT_HERKUNFT_LABEL[[...herkunft][0]]}</span>}
    </span>
  );
}

function sichtText(sicht: StandortSichtDto): string {
  if (sicht.alle) return "alle";
  const eigene = sicht.eintraege.filter((e) => e.herkunft !== "vertretung");
  if (eigene.length === 0) return "nichts (kein Haken bei „Arbeitet an“)";
  return eigene.map((e) => e.standortName).join(", ");
}

/** Text fuer "Wie im Rang" im Dialog: was die Person mit dieser Wahl saehe. */
function rangSichtText(b: BenutzerListEintragDto, vorschau: StandortSichtVorschauDto | null): string {
  // Ohne feste Sicht ist die aktuelle Sicht schon die aus dem Rang.
  if (b.standortIds.length === 0) return `Sieht dann: ${sichtText(b.sicht)}.`;
  const p = vorschau?.personen.find((x) => x.benutzerId === b.id);
  return p ? `Sieht dann: ${sichtText(p.andereRegel)}.` : "Sieht dann die Einrichtungen, an denen die Person laut Rang arbeitet.";
}

/**
 * Vorschau und Schalter der Standortregel (Konzept standort-sichtbarkeit,
 * Abschnitt 5): die neue Regel nimmt Menschen Sicht, deshalb steht VOR dem
 * Umschalten, wen es trifft. Umschalten nur mit Vollzugriff (Server prueft).
 */
function RegelVorschau({
  vorschau,
  offen,
  onUmschalten,
  onRegel,
  wirdGeschaltet,
}: {
  vorschau: StandortSichtVorschauDto;
  offen: boolean;
  onUmschalten: () => void;
  onRegel: (ausRang: boolean) => void;
  wirdGeschaltet: boolean;
}) {
  const weniger = vorschau.personen.filter((p) => p.weniger);
  const andere = vorschau.personen.filter((p) => !p.weniger);
  const liste = offen ? vorschau.personen : weniger.slice(0, 3);
  if (vorschau.ausRang && vorschau.personen.length === 0) return null;
  return (
    <div className="zv-hinweis zv-hinweis-info zv-regel-vorschau">
      <IInfo />
      <div className="zv-regel-vorschau-inhalt">
        {vorschau.ausRang ? (
          <strong>Sicht aus dem Rang ist eingeschaltet.</strong>
        ) : (
          <strong>
            Neue Standortregel: {weniger.length === 1 ? "1 Person sieht" : `${weniger.length} Personen sehen`} danach weniger als heute.
          </strong>
        )}
        <p>
          {vorschau.ausRang
            ? `Wer laut Rang an einer Einrichtung arbeitet, sieht nur diese. ${weniger.length} ${weniger.length === 1 ? "Person sieht" : "Personen sehen"} dadurch weniger als vorher.`
            : "Wer laut Rang an einer Einrichtung arbeitet, sieht künftig nur diese. Wer weiter alles sehen soll, bekommt vorher über „Sicht festlegen“ eine feste Sicht."}
        </p>
        {liste.length > 0 && (
          <div className="zv-regel-vorschau-liste" role="table" aria-label="Sicht heute und künftig">
            {liste.map((p) => {
              const vorher = vorschau.ausRang ? p.andereRegel : p.heute;
              const nachher = vorschau.ausRang ? p.heute : p.andereRegel;
              return (
                <div key={p.benutzerId} role="row">
                  <strong role="cell">{p.name}</strong>
                  <span role="cell">{vorschau.ausRang ? "vorher" : "heute"}: {sichtText(vorher)}</span>
                  <span role="cell">{vorschau.ausRang ? "jetzt" : "künftig"}: {sichtText(nachher)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="zv-regel-vorschau-aktionen">
          {vorschau.personen.length > liste.length || offen ? (
            <button type="button" className="zv-link-btn" onClick={onUmschalten} aria-expanded={offen}>
              {offen ? <IZuklappen /> : <IAufklappen />}
              {offen ? "Weniger anzeigen" : `Alle ${vorschau.personen.length} anzeigen${andere.length > 0 ? ` (davon ${andere.length} ohne Verlust)` : ""}`}
            </button>
          ) : null}
          {vorschau.darfUmschalten && (
            <button
              type="button"
              className={vorschau.ausRang ? "zv-btn zv-btn-still zv-btn-klein" : "zv-btn zv-btn-klein"}
              onClick={() => onRegel(!vorschau.ausRang)}
              disabled={wirdGeschaltet}
            >
              {wirdGeschaltet ? "Schaltet…" : vorschau.ausRang ? "Zurück zur bisherigen Regel" : "Sicht aus dem Rang einschalten"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
