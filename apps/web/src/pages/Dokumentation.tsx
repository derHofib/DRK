import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ZUORDNUNG_LABEL,
  type DokumentationsAngebotDto,
  type FormularZuordnung,
  type KlientListEintragDto,
  type ProtokollKurzDto,
  type ProtokolleRechteDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import {
  Filterleiste,
  OptionenFilter,
  trifftSuche,
} from "../components/Listenfilter";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import {
  IFehler,
  IHerunterladen,
  ILeerTagesberichte,
  INeu,
  IStandort,
} from "../components/icons";
import { SammelPdf } from "./dokumentation/SammelPdf";
import { formatDatum } from "../format";
import { ProtokollDetail } from "./klient/ProtokolleTab";
import { Tagesberichte } from "./Tagesberichte";
import { zuordnungText } from "./dokumentation/zuordnung";

/**
 * Was links gewaehlt ist: die Tagesberichte (eigene Tabelle, eigene Logik),
 * alle Protokolle, ein einzelnes Formular oder die eigenen Entwuerfe.
 */
type Wahl =
  | { art: "tagesberichte" }
  | { art: "alle" }
  | { art: "entwuerfe" }
  | { art: "formular"; id: string };
const WAHL_SCHLUESSEL = "zv-dokumentation-wahl";

function wahlLesen(): Wahl {
  try {
    const roh = sessionStorage.getItem(WAHL_SCHLUESSEL);
    const w = roh ? (JSON.parse(roh) as Wahl) : null;
    if (
      w &&
      (w.art === "alle" ||
        w.art === "entwuerfe" ||
        w.art === "tagesberichte" ||
        (w.art === "formular" && typeof w.id === "string"))
    )
      return w;
  } catch {
    // ohne Speicher oder kaputter Wert: Tagesberichte wie bisher
  }
  return { art: "tagesberichte" };
}

const GRUPPEN: { titel: string; zuordnungen: FormularZuordnung[] }[] = [
  { titel: "Zu Klient:innen", zuordnungen: ["klient", "klient_wahlweise"] },
  { titel: "Zum Standort", zuordnungen: ["standort"] },
  { titel: "Ohne Zuordnung", zuordnungen: ["ohne"] },
];

/**
 * Menuepunkt "Dokumentation" (Rueckmeldung „Dokumentation“, Konzept
 * dokumentation-formulare, Bild 1): hier wird JEDES veroeffentlichte Formular
 * ausgefuellt, nicht nur der Tagesbericht -- auch solche ohne Klient:in
 * (Teambesprechung am Standort, Fahrzeugcheck). Links die Formulare, rechts
 * die Dokumente dazu. Was ohne Formular passiert (Telefonat, Notiz), steht
 * weiter im Verlauf der Akte.
 */
export function Dokumentation({ startKlientId }: { startKlientId?: string }) {
  // Ein Sprung "Tagesbericht für … schreiben" landet immer bei den Tagesberichten.
  const [wahl, setWahlRoh] = useState<Wahl>(() =>
    startKlientId ? { art: "tagesberichte" } : wahlLesen(),
  );
  const [liste, setListe] = useState<ProtokollKurzDto[] | null>(null);
  const [angebot, setAngebot] = useState<DokumentationsAngebotDto[]>([]);
  const [rechte, setRechte] = useState<ProtokolleRechteDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ausfuellenOffen, setAusfuellenOffen] = useState(false);
  const [offen, setOffen] = useState<string | null>(null);

  function setWahl(w: Wahl) {
    setWahlRoh(w);
    try {
      sessionStorage.setItem(WAHL_SCHLUESSEL, JSON.stringify(w));
    } catch {
      // ohne Speicher: beim naechsten Mal wieder Tagesberichte
    }
  }

  function laden() {
    api
      .protokolle()
      .then(setListe)
      .catch((err) =>
        setFehler(
          err instanceof Error
            ? err.message
            : "Protokolle konnten nicht geladen werden.",
        ),
      );
  }
  useEffect(() => {
    laden();
    api
      .protokolleRechte()
      .then((r) => {
        setRechte(r);
        if (r.ausfuellen)
          api
            .dokumentationsAngebot()
            .then(setAngebot)
            .catch(() => setAngebot([]));
      })
      .catch(() => setRechte(null));
  }, []);

  // Die Formularspalte zeigt, was es gibt: Formulare mit Dokumenten plus die,
  // die man gerade ausfuellen kann. Zuordnung jeweils die der neuesten Version.
  const formulare = useMemo(() => {
    const je = new Map<
      string,
      { id: string; name: string; zuordnung: FormularZuordnung; anzahl: number }
    >();
    for (const a of angebot)
      je.set(a.id, {
        id: a.id,
        name: a.name,
        zuordnung: a.zuordnung,
        anzahl: 0,
      });
    for (const p of liste ?? []) {
      const f = je.get(p.formularId) ?? {
        id: p.formularId,
        name: p.formularName,
        zuordnung: p.zuordnung,
        anzahl: 0,
      };
      f.anzahl += 1;
      je.set(p.formularId, f);
    }
    return [...je.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [angebot, liste]);
  const anzahlEntwuerfe = (liste ?? []).filter((p) => !p.abgeschlossen).length;

  if (offen) {
    return (
      <ProtokollDetail
        id={offen}
        onZurueck={() => {
          setOffen(null);
          laden();
        }}
      />
    );
  }

  const gewaehltesFormular =
    wahl.art === "formular"
      ? formulare.find((f) => f.id === wahl.id)
      : undefined;

  return (
    <div>
      <div className="zv-seiten-kopf">
        <h2>Dokumentation</h2>
        {rechte?.ausfuellen && (
          <button
            type="button"
            className="zv-btn"
            onClick={() => setAusfuellenOffen(true)}
          >
            <INeu />
            Formular ausfüllen
          </button>
        )}
      </div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <div className="zv-doku">
        <nav className="zv-doku-formulare" aria-label="Formulare">
          <WahlKnopf
            aktiv={wahl.art === "tagesberichte"}
            onClick={() => setWahl({ art: "tagesberichte" })}
            label="Tagesberichte"
          />
          <WahlKnopf
            aktiv={wahl.art === "alle"}
            onClick={() => setWahl({ art: "alle" })}
            label="Alle Protokolle"
            anzahl={liste?.length}
          />
          {GRUPPEN.map((g) => {
            const inGruppe = formulare.filter((f) =>
              g.zuordnungen.includes(f.zuordnung),
            );
            if (inGruppe.length === 0) return null;
            return (
              <div key={g.titel} role="group" aria-label={g.titel}>
                <div className="zv-gruppenlabel">{g.titel}</div>
                {inGruppe.map((f) => (
                  <WahlKnopf
                    key={f.id}
                    aktiv={wahl.art === "formular" && wahl.id === f.id}
                    onClick={() => setWahl({ art: "formular", id: f.id })}
                    label={f.name}
                    anzahl={f.anzahl}
                  />
                ))}
              </div>
            );
          })}
          {anzahlEntwuerfe > 0 && (
            <div role="group" aria-label="Meine Entwürfe">
              <div className="zv-gruppenlabel">Meine Entwürfe</div>
              <WahlKnopf
                aktiv={wahl.art === "entwuerfe"}
                onClick={() => setWahl({ art: "entwuerfe" })}
                label="Nicht abgeschlossen"
                anzahl={anzahlEntwuerfe}
                hervorheben
              />
            </div>
          )}
        </nav>
        <div className="zv-doku-inhalt">
          {wahl.art === "tagesberichte" ? (
            <Tagesberichte startKlientId={startKlientId} eingebettet />
          ) : (
            <ProtokollListe
              liste={liste}
              filter={
                wahl.art === "entwuerfe"
                  ? (p) => !p.abgeschlossen
                  : wahl.art === "formular"
                    ? (p) => p.formularId === wahl.id
                    : () => true
              }
              leerText={
                wahl.art === "entwuerfe"
                  ? "Keine offenen Entwürfe."
                  : gewaehltesFormular
                    ? `Noch nichts mit „${gewaehltesFormular.name}“ ausgefüllt.`
                    : "Noch keine Protokolle. Über „Formular ausfüllen“ geht es los."
              }
              onOeffnen={setOffen}
            />
          )}
        </div>
      </div>
      {ausfuellenOffen && (
        <FormularAusfuellen
          angebot={angebot}
          onClose={() => setAusfuellenOffen(false)}
          onTagesbericht={() => {
            setAusfuellenOffen(false);
            setWahl({ art: "tagesberichte" });
          }}
          onAngelegt={(id) => {
            setAusfuellenOffen(false);
            setOffen(id);
          }}
        />
      )}
    </div>
  );
}

function WahlKnopf({
  aktiv,
  onClick,
  label,
  anzahl,
  hervorheben,
}: {
  aktiv: boolean;
  onClick: () => void;
  label: string;
  anzahl?: number;
  hervorheben?: boolean;
}) {
  return (
    <button
      type="button"
      className={aktiv ? "active" : ""}
      aria-current={aktiv ? "true" : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      {anzahl !== undefined && (
        <span
          className={hervorheben ? "zv-pill zv-pill-frist" : "zv-doku-anzahl"}
        >
          {anzahl}
        </span>
      )}
    </button>
  );
}

function ProtokollListe({
  liste,
  filter,
  leerText,
  onOeffnen,
}: {
  liste: ProtokollKurzDto[] | null;
  filter: (p: ProtokollKurzDto) => boolean;
  leerText: string;
  onOeffnen: (id: string) => void;
}) {
  const [suche, setSuche] = useState("");
  const [zuordnung, setZuordnung] = useState("");
  // Mehrfachauswahl fuer das Sammel-PDF (Konzept Bild 4). Nur abgeschlossene
  // Dokumente: ein Entwurf hat noch kein PDF.
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  // Beim Oeffnen festgehalten: der Dialog soll nicht mit jedem Rendern neu laden.
  const [sammel, setSammel] = useState<ProtokollKurzDto[] | null>(null);
  const sichtbar = useMemo(
    () =>
      (liste ?? [])
        .filter(filter)
        .filter(
          (p) =>
            !zuordnung ||
            (zuordnung === "klient"
              ? p.klientId !== null
              : zuordnung === "standort"
                ? p.standortId !== null
                : p.klientId === null && p.standortId === null),
        )
        .filter((p) =>
          trifftSuche(suche, [
            p.formularName,
            p.klientName,
            p.standortName,
            p.autorName,
          ]),
        ),
    [liste, filter, suche, zuordnung],
  );
  const vorher = (liste ?? []).filter(filter).length;
  // Gewaehlt bleibt nur, was gerade sichtbar ist -- sonst landet nach einem
  // Filterwechsel ein unsichtbares Dokument im PDF.
  const gewaehlt = sichtbar.filter((p) => auswahl.has(p.id));
  const waehlbar = sichtbar.filter((p) => p.abgeschlossen);
  const alleGewaehlt =
    waehlbar.length > 0 && gewaehlt.length === waehlbar.length;
  function umschalten(id: string) {
    setAuswahl((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }
  return (
    <div>
      <Filterleiste
        ariaLabel="Protokolle filtern"
        suche={{
          wert: suche,
          onChange: setSuche,
          placeholder: "Formular, Klient:in, Standort, Person …",
          ariaLabel: "Protokolle durchsuchen",
        }}
        aktiv={suche !== "" || zuordnung !== ""}
        onZuruecksetzen={() => {
          setSuche("");
          setZuordnung("");
        }}
      >
        <OptionenFilter
          icon={<IStandort />}
          label="Zugeordnet zu"
          optionen={[
            { wert: "klient", label: "Klient:in" },
            { wert: "standort", label: "Standort" },
            { wert: "ohne", label: "ohne Zuordnung" },
          ]}
          wert={zuordnung}
          onWaehlen={setZuordnung}
        />
      </Filterleiste>
      {gewaehlt.length > 0 && (
        <div className="zv-doku-auswahl" role="region" aria-label="Auswahl">
          <span>
            <strong>{gewaehlt.length}</strong> ausgewählt
          </span>
          <button
            type="button"
            className="zv-btn"
            onClick={() => setSammel(gewaehlt)}
          >
            <IHerunterladen />
            Als PDF …
          </button>
          <button
            type="button"
            className="zv-btn zv-btn-still"
            onClick={() => setAuswahl(new Set())}
          >
            Auswahl aufheben
          </button>
        </div>
      )}
      {sammel && (
        <SammelPdf dokumente={sammel} onClose={() => setSammel(null)} />
      )}
      {liste === null ? null : sichtbar.length === 0 ? (
        <Leerzustand icon={ILeerTagesberichte}>
          {vorher === 0 ? leerText : "Keine Protokolle für diese Suche."}
        </Leerzustand>
      ) : (
        <div
          className="zv-karten-liste zv-doku-liste"
          style={
            {
              "--zv-liste-spalten":
                "var(--zv-space-6) 0.9fr 1.6fr 1.8fr 1.3fr 1fr",
            } as CSSProperties
          }
        >
          <div className="zv-liste-kopf">
            <span className="zv-doku-waehlen">
              <input
                type="checkbox"
                aria-label="Alle abgeschlossenen auswählen"
                checked={alleGewaehlt}
                disabled={waehlbar.length === 0}
                onChange={() =>
                  setAuswahl(
                    alleGewaehlt
                      ? new Set()
                      : new Set(waehlbar.map((p) => p.id)),
                  )
                }
              />
            </span>
            <span>Datum</span>
            <span>Formular</span>
            <span>Zugeordnet zu</span>
            <span>Ausgefüllt von</span>
            <span>Stand</span>
          </div>
          {sichtbar.map((p) => (
            <div
              key={p.id}
              className="zv-info-karte zv-info-karte-klickbar"
              role="button"
              tabIndex={0}
              onClick={() => onOeffnen(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOeffnen(p.id);
                }
              }}
            >
              {/* Eigener Klickbereich: das Haekchen oeffnet nicht das Dokument. */}
              <span
                className="zv-doku-waehlen"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  aria-label={`${p.formularName} vom ${formatDatum(p.bezugsdatum)} auswählen`}
                  title={
                    p.abgeschlossen ? undefined : "Entwürfe haben noch kein PDF"
                  }
                  checked={auswahl.has(p.id)}
                  disabled={!p.abgeschlossen}
                  onChange={() => umschalten(p.id)}
                />
              </span>
              <span className="zv-liste-zelle" data-label="Datum">
                {formatDatum(p.bezugsdatum)}
              </span>
              <span className="zv-liste-zelle-titel">{p.formularName}</span>
              <span className="zv-liste-zelle" data-label="Zugeordnet zu">
                <ZuordnungEtikett p={p} />
              </span>
              <span className="zv-liste-zelle" data-label="Ausgefüllt von">
                {p.autorName ?? "–"}
              </span>
              <span className="zv-liste-zelle" data-label="Stand">
                {!p.abgeschlossen ? (
                  <span className="zv-pill zv-pill-frist">Entwurf</span>
                ) : p.anzahlAenderungen > 0 ? (
                  <span className="zv-pill">korrigiert</span>
                ) : (
                  <span className="zv-pill zv-pill-ok">abgeschlossen</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ZuordnungEtikett({ p }: { p: ProtokollKurzDto }) {
  const art = p.klientId ? "Klient:in" : p.standortId ? "Standort" : null;
  return (
    <span className="zv-doku-zuordnung">
      {art && <span className="zv-pill zv-pill-vergeben">{art}</span>}
      <span className={art ? "" : "zv-sub"}>{zuordnungText(p)}</span>
    </span>
  );
}

/**
 * Bild 2 des Konzepts: erst das Formular, dann genau die Zuordnung, die es
 * verlangt. Der Server prueft alles noch einmal (Standort zugelassen und
 * sichtbar, Klient:in fuer das Formular zugelassen, Trigger aus 0083).
 */
function FormularAusfuellen({
  angebot,
  onClose,
  onTagesbericht,
  onAngelegt,
}: {
  angebot: DokumentationsAngebotDto[];
  onClose: () => void;
  onTagesbericht: () => void;
  onAngelegt: (protokollId: string) => void;
}) {
  const [suche, setSuche] = useState("");
  const [gewaehlt, setGewaehlt] = useState<DokumentationsAngebotDto | null>(
    null,
  );
  const [klienten, setKlienten] = useState<KlientListEintragDto[] | null>(null);
  const [klientId, setKlientId] = useState("");
  const [ohneKlient, setOhneKlient] = useState(false);
  const [standortId, setStandortId] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const brauchtKlienten =
    gewaehlt &&
    (gewaehlt.zuordnung === "klient" ||
      gewaehlt.zuordnung === "klient_wahlweise");
  useEffect(() => {
    if (brauchtKlienten && klienten === null)
      api
        .klientenListe()
        .then(setKlienten)
        .catch(() => setKlienten([]));
  }, [brauchtKlienten, klienten]);

  const treffer = angebot.filter((a) =>
    trifftSuche(suche, [a.name, a.beschreibung]),
  );
  const zuletzt = [...angebot]
    .filter((a) => a.zuletztAm)
    .sort((a, b) => (b.zuletztAm ?? "").localeCompare(a.zuletztAm ?? ""))
    .slice(0, 3);

  function waehlen(a: DokumentationsAngebotDto) {
    setGewaehlt(a);
    setFehler(null);
    setOhneKlient(false);
    setKlientId("");
    // Nur ein erlaubter Standort: gleich vorauswaehlen.
    setStandortId(a.standorte.length === 1 ? a.standorte[0].id : "");
  }

  const bereit =
    !!gewaehlt &&
    (gewaehlt.zuordnung === "ohne" ||
      (gewaehlt.zuordnung === "standort" && !!standortId) ||
      (gewaehlt.zuordnung === "klient" && !!klientId) ||
      (gewaehlt.zuordnung === "klient_wahlweise" &&
        (ohneKlient || !!klientId)));

  async function weiter() {
    if (!gewaehlt || !bereit) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const p = await api.dokumentAnlegen(gewaehlt.id, {
        klientId:
          (gewaehlt.zuordnung === "klient" ||
            gewaehlt.zuordnung === "klient_wahlweise") &&
          !ohneKlient
            ? klientId
            : null,
        standortId: gewaehlt.zuordnung === "standort" ? standortId : null,
      });
      onAngelegt(p.id);
    } catch (err) {
      setFehler(
        err instanceof Error
          ? err.message
          : "Das Formular konnte nicht angelegt werden.",
      );
      setLaeuft(false);
    }
  }

  const eintrag = (a: DokumentationsAngebotDto, praefix: string) => (
    <button
      key={`${praefix}-${a.id}`}
      type="button"
      className={gewaehlt?.id === a.id ? "active" : ""}
      aria-pressed={gewaehlt?.id === a.id}
      onClick={() => waehlen(a)}
    >
      <span>{a.name}</span>
      <span className="zv-sub">
        {a.zuordnung === "klient" ? "" : ZUORDNUNG_LABEL[a.zuordnung]}
      </span>
    </button>
  );

  return (
    <Modal titel="Formular ausfüllen" onClose={onClose} breit>
      <div className="zv-doku-ausfuellen">
        <div className="zv-doku-ausfuellen-liste">
          <div className="zv-field">
            <label htmlFor="doku-suche" className="zv-sr-only">
              Formular suchen
            </label>
            <input
              id="doku-suche"
              type="search"
              placeholder="Formular suchen …"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              autoFocus
            />
          </div>
          <div className="zv-doku-formulare zv-doku-formulare-flach">
            {!suche && zuletzt.length > 0 && (
              <div role="group" aria-label="Zuletzt von dir">
                <div className="zv-gruppenlabel">Zuletzt von dir</div>
                {zuletzt.map((a) => eintrag(a, "z"))}
              </div>
            )}
            {GRUPPEN.map((g) => {
              const inGruppe = treffer.filter((a) =>
                g.zuordnungen.includes(a.zuordnung),
              );
              const mitTagesbericht =
                g.zuordnungen.includes("klient") &&
                trifftSuche(suche, ["Tagesbericht"]);
              if (inGruppe.length === 0 && !mitTagesbericht) return null;
              return (
                <div key={g.titel} role="group" aria-label={g.titel}>
                  <div className="zv-gruppenlabel">{g.titel}</div>
                  {mitTagesbericht && (
                    <button type="button" onClick={onTagesbericht}>
                      <span>Tagesbericht</span>
                      <span className="zv-sub">zu den Tagesberichten</span>
                    </button>
                  )}
                  {inGruppe.map((a) => eintrag(a, "g"))}
                </div>
              );
            })}
          </div>
        </div>
        <div className="zv-doku-ausfuellen-wahl">
          {!gewaehlt ? (
            <p className="zv-sub">Links ein Formular wählen.</p>
          ) : (
            <>
              <h3>{gewaehlt.name}</h3>
              <p className="zv-sub">
                Version {gewaehlt.versionNummer} ·{" "}
                {ZUORDNUNG_LABEL[gewaehlt.zuordnung]}
              </p>
              {gewaehlt.beschreibung && <p>{gewaehlt.beschreibung}</p>}
              {fehler && (
                <div className="zv-hinweis zv-hinweis-fehler" role="alert">
                  <IFehler />
                  {fehler}
                </div>
              )}
              {gewaehlt.zuordnung === "standort" && (
                <div className="zv-field">
                  <label htmlFor="doku-standort">Standort</label>
                  <select
                    id="doku-standort"
                    value={standortId}
                    onChange={(e) => setStandortId(e.target.value)}
                  >
                    <option value="" disabled>
                      Standort wählen
                    </option>
                    {gewaehlt.standorte.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                  <p className="zv-sub">
                    Nur Standorte, für die das Formular zugelassen ist und die
                    du sehen darfst.
                  </p>
                </div>
              )}
              {brauchtKlienten && (
                <div className="zv-field">
                  <label htmlFor="doku-klient">
                    Klient:in
                    {gewaehlt.zuordnung === "klient_wahlweise"
                      ? " (wahlweise)"
                      : ""}
                  </label>
                  <select
                    id="doku-klient"
                    value={klientId}
                    disabled={ohneKlient || klienten === null}
                    onChange={(e) => setKlientId(e.target.value)}
                  >
                    <option value="" disabled>
                      {klienten === null ? "Wird geladen…" : "Klient:in wählen"}
                    </option>
                    {(klienten ?? []).map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.vorname} {k.nachname}
                        {k.aktuellesZimmer
                          ? ` · ${k.aktuellesZimmer.standortName}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {gewaehlt.zuordnung === "klient_wahlweise" && (
                    <label className="zv-checkbox-zeile">
                      <input
                        type="checkbox"
                        checked={ohneKlient}
                        onChange={(e) => setOhneKlient(e.target.checked)}
                      />
                      Ohne Klient:in ausfüllen
                    </label>
                  )}
                </div>
              )}
              {gewaehlt.zuordnung === "ohne" && (
                <p className="zv-sub">
                  Dieses Formular gehört zu niemandem. Es geht direkt los.
                </p>
              )}
              <div className="zv-aktionen-reihe zv-doku-aktionen">
                <button
                  type="button"
                  className="zv-btn zv-btn-sekundaer"
                  onClick={onClose}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="zv-btn"
                  disabled={!bereit || laeuft}
                  onClick={() => void weiter()}
                >
                  {laeuft ? "Wird angelegt…" : "Weiter zum Formular"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
