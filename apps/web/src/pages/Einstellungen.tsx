import { useEffect, useRef, useState } from "react";
import {
  AKZENTFARBE_MUSTER,
  CHAT_LOESCHFRIST_MAX_TAGE,
  CHAT_LOESCHFRIST_MIN_TAGE,
  DUNKEL_GRUNDFARBEN,
  KLIENT_LOESCHFRIST_MAX_TAGE,
  KLIENT_LOESCHFRIST_MIN_TAGE,
  PASTELL_PALETTEN,
  type EinstellungenRechteDto,
  type KalenderStundenEinstellungenDto,
  type MandantDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { useTheme } from "../theme/ThemeProvider";
import { ThemeAuswahl } from "../components/ThemeToggle";
import { MeinProfil } from "../components/MeinProfil";
import { KalenderStundenKonto, KalenderStundenTraeger, KalenderStundenVormerkungen } from "../components/StundenKalenderEinstellungen";
import { Sicherheit } from "./Sicherheit";
import { DokumentAngaben } from "./DokumentAngaben";
import {
  IAnpassen,
  IBestaetigen,
  IDarstellung,
  IMitarbeitende,
  IEinklappen,
  IErfolg,
  IFehler,
  IPasswort,
  IPerson,
  IRueckmeldungen,
  ISicherheit,
  ISpeichern,
  ITraeger,
  IDokument,
  IVerschiebenHoch,
  IVerschiebenRunter,
  IZiehen,
  IVor,
  IZurueckPfeil,
  IZuruecksetzen,
  IStunden,
  type IconKomponente,
} from "../components/icons";
import {
  MENUE_GRUPPEN,
  STANDARD_REITER,
  gruppeNeuOrdnen,
  reiterDerGruppe,
  type HauptReiter,
  type MenueGruppeId,
} from "../navigation";

type KontoBereich = "profil" | "darstellung" | "kalender-stunden" | "anmeldung";
type TraegerBereich = "erscheinungsbild" | "dokumente" | "datenschutz" | "stunden" | "rueckmeldungen";
type Bereich = KontoBereich | TraegerBereich;

interface BereichEintrag<B extends Bereich> {
  wert: B;
  label: string;
  icon: IconKomponente;
  beschreibung: string;
}

const KONTO_BEREICHE: BereichEintrag<KontoBereich>[] = [
  { wert: "profil", label: "Profil", icon: IMitarbeitende, beschreibung: "Deine Kontaktdaten und was andere davon sehen." },
  { wert: "darstellung", label: "Darstellung", icon: IDarstellung, beschreibung: "Wie die Zimmerakte für dich aussieht, auf diesem Gerät." },
  { wert: "kalender-stunden", label: "Kalender & Stunden", icon: IStunden, beschreibung: "Wie deine Termine in die Stundenerfassung einfließen." },
  { wert: "anmeldung", label: "Anmeldung & Sicherheit", icon: IPasswort, beschreibung: "Passwort und Zwei-Faktor-Anmeldung deines Kontos." },
];

/**
 * Welches Recht einen Traeger-Bereich sichtbar macht, steht in
 * EinstellungenRechteDto (mandant.service.ts, einstellungenRechte()).
 * Rueckmeldungen haengt bewusst am Datenschutz-Recht: dieselbe Pruefung
 * schuetzt dort das Speichern (setzeRueckmeldungWeitergabe).
 */
const TRAEGER_BEREICHE: (BereichEintrag<TraegerBereich> & { recht: keyof EinstellungenRechteDto })[] = [
  { wert: "erscheinungsbild", label: "Erscheinungsbild", icon: ITraeger, recht: "erscheinungsbild", beschreibung: "Trägerfarbe und Grundfarbe des dunklen Designs." },
  // Wer die Traegerfarbe pflegt, pflegt auch Logos und Angaben (gleiches Recht im Service).
  { wert: "dokumente", label: "Angaben für Dokumente", icon: IDokument, recht: "erscheinungsbild", beschreibung: "Logos und Trägerangaben, die PDF-Exporte verwenden können." },
  { wert: "datenschutz", label: "Datenschutz", icon: ISicherheit, recht: "datenschutz", beschreibung: "Fristen, nach denen Daten endgültig gelöscht werden." },
  { wert: "stunden", label: "Stunden", icon: IStunden, recht: "stunden", beschreibung: "Ob Kalendertermine als Betreuungszeit gebucht werden dürfen." },
  { wert: "rueckmeldungen", label: "Rückmeldungen", icon: IRueckmeldungen, recht: "datenschutz", beschreibung: "Ob freigegebene Ideen und Fehler an den Hersteller gehen." },
];

const KEINE_TRAEGER_RECHTE: EinstellungenRechteDto = { erscheinungsbild: false, standorte: false, kassenbuch: false, datenschutz: false, formulare: false, stunden: false };

/**
 * Zwei Gruppen statt einer Reiterleiste: "Mein Konto" gilt nur fuer die
 * angemeldete Person, "Traeger" fuer alle Mitarbeitenden. Frueher lagen
 * beide gemischt in denselben Reitern (Trägerfarbe unter "Darstellung",
 * Loeschfristen unter "Sicherheit"), und ein Betreuer sah Regler, die er
 * nicht speichern durfte -- er merkte es erst an der Fehlermeldung.
 *
 * Traeger-Bereiche ohne Recht werden ausgeblendet, nicht ausgegraut. Das ist
 * nur Bequemlichkeit: verbindlich prueft jeder Speicherpfad im Service selbst
 * (test/einstellungen-rechte.e2e-spec.ts prueft beides).
 */
export function Einstellungen({
  mandant,
  onMandantAktualisiert,
  hoverAusklappen,
  onHoverAusklappenAendern,
  menuReihenfolge,
  onMenuReihenfolgeAendern,
  onOrganisatorischOeffnen,
}: {
  mandant: MandantDto | null;
  onMandantAktualisiert: (m: MandantDto) => void;
  hoverAusklappen: boolean;
  onHoverAusklappenAendern: (wert: boolean) => void;
  menuReihenfolge: HauptReiter[];
  onMenuReihenfolgeAendern: (reihenfolge: HauptReiter[]) => void;
  onOrganisatorischOeffnen: (ziel: "standorte-verwalten" | "buchungstypen") => void;
}) {
  const [bereich, setBereich] = useState<Bereich>("profil");
  // Nur auf schmalen Bildschirmen relevant: dort ist entweder die Liste oder
  // ein Bereich zu sehen (app.css, .zv-einstellungen[data-ansicht]).
  const [ansicht, setAnsicht] = useState<"liste" | "bereich">("liste");
  const [rechte, setRechte] = useState<EinstellungenRechteDto>(KEINE_TRAEGER_RECHTE);
  const [stunden, setStunden] = useState<KalenderStundenEinstellungenDto | null>(null);

  useEffect(() => {
    api.stundenKalenderEinstellungen().then(setStunden).catch(() => setStunden(null));
  }, []);

  useEffect(() => {
    let aktiv = true;
    api
      .einstellungenRechte()
      .then((r) => aktiv && setRechte(r))
      // Ohne Antwort bleibt es bei "Mein Konto" -- lieber zu wenig zeigen als
      // Regler, die beim Speichern scheitern.
      .catch(() => undefined);
    return () => {
      aktiv = false;
    };
  }, []);

  const traegerBereiche = TRAEGER_BEREICHE.filter((b) => rechte[b.recht]);
  // "Kalender & Stunden" nur, wer ueberhaupt Stunden buchen darf.
  const kontoBereiche = KONTO_BEREICHE.filter((b) => b.wert !== "kalender-stunden" || stunden?.darfBuchen);
  const alle: BereichEintrag<Bereich>[] = [...kontoBereiche, ...traegerBereiche];
  // Faellt ein Recht weg (z. B. Vertretung beendet), nicht auf einem leeren Bereich stehen bleiben.
  const aktuell = alle.find((b) => b.wert === bereich) ?? KONTO_BEREICHE[0];
  const istTraeger = traegerBereiche.some((b) => b.wert === aktuell.wert);

  function waehle(b: Bereich) {
    setBereich(b);
    setAnsicht("bereich");
  }

  const menuePunkt = (b: BereichEintrag<Bereich>) => {
    const Icon = b.icon;
    return (
      <button
        key={b.wert}
        type="button"
        className={b.wert === aktuell.wert ? "active" : ""}
        aria-current={b.wert === aktuell.wert ? "page" : undefined}
        onClick={() => waehle(b.wert)}
      >
        <Icon />
        <span>{b.label}</span>
        <IVor className="zv-einstellungen-menue-pfeil" />
      </button>
    );
  };

  return (
    <div className="zv-einstellungen" data-ansicht={ansicht}>
      <nav className="zv-einstellungen-menue" aria-label="Bereiche der Einstellungen">
        <div role="group" aria-labelledby="zv-einst-konto">
          <div className="zv-gruppenlabel" id="zv-einst-konto">
            Mein Konto
          </div>
          {kontoBereiche.map(menuePunkt)}
        </div>
        {traegerBereiche.length > 0 && (
          <div role="group" aria-labelledby="zv-einst-traeger">
            <div className="zv-gruppenlabel" id="zv-einst-traeger">
              Träger{mandant ? ` · ${mandant.name}` : ""}
            </div>
            {traegerBereiche.map(menuePunkt)}
          </div>
        )}
        {/* Uebergangshinweis: Standorte und Buchungstypen standen bis
            20.11.2026 hier. Wer sie gewohnheitsmaessig hier sucht, soll den
            neuen Platz finden statt eines fehlenden Punkts. */}
        {(rechte.standorte || rechte.kassenbuch) && (
          <p className="zv-einstellungen-umzug">
            Standorte und Buchungstypen findest du jetzt unten im Menü unter <strong>Organisatorisch</strong>.{" "}
            {rechte.standorte && (
              <button type="button" className="zv-link-btn" onClick={() => onOrganisatorischOeffnen("standorte-verwalten")}>
                Standorte
              </button>
            )}
            {rechte.standorte && rechte.kassenbuch && " · "}
            {rechte.kassenbuch && (
              <button type="button" className="zv-link-btn" onClick={() => onOrganisatorischOeffnen("buchungstypen")}>
                Buchungstypen
              </button>
            )}
          </p>
        )}
      </nav>

      <div className="zv-einstellungen-inhalt">
        <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein zv-einstellungen-zurueck" onClick={() => setAnsicht("liste")}>
          <IZurueckPfeil />
          Einstellungen
        </button>
        <div className="zv-seiten-kopf zv-einstellungen-kopf">
          <div>
            <h2>{aktuell.label}</h2>
            <p className="zv-sub">{aktuell.beschreibung}</p>
          </div>
          {istTraeger ? (
            <span className="zv-einstellungen-geltung zv-einstellungen-geltung-traeger">
              <ITraeger />
              Gilt für alle Mitarbeitenden{mandant ? ` von ${mandant.name}` : ""}
            </span>
          ) : (
            <span className="zv-einstellungen-geltung">
              <IPerson />
              Nur für dich
            </span>
          )}
        </div>

        {aktuell.wert === "profil" && <MeinProfil />}
        {aktuell.wert === "darstellung" && (
          <div className="zv-einstellungen-raster">
            <Darstellung
              hoverAusklappen={hoverAusklappen}
              onHoverAusklappenAendern={onHoverAusklappenAendern}
              menuReihenfolge={menuReihenfolge}
              onMenuReihenfolgeAendern={onMenuReihenfolgeAendern}
            />
          </div>
        )}
        {aktuell.wert === "kalender-stunden" && stunden && (
          <div className="zv-einstellungen-raster">
            <KalenderStundenKonto einstellungen={stunden} onGeaendert={setStunden} />
            <KalenderStundenVormerkungen />
          </div>
        )}
        {aktuell.wert === "stunden" && stunden && (
          <div className="zv-einstellungen-raster">
            <KalenderStundenTraeger einstellungen={stunden} onGeaendert={setStunden} />
          </div>
        )}
        {aktuell.wert === "anmeldung" && (
          <div className="zv-einstellungen-raster">
            <Sicherheit />
          </div>
        )}
        {aktuell.wert === "erscheinungsbild" && mandant && (
          <div className="zv-einstellungen-raster">
            <Traegerfarbe mandant={mandant} onMandantAktualisiert={onMandantAktualisiert} />
            <DunkleGrundfarbe mandant={mandant} onMandantAktualisiert={onMandantAktualisiert} />
          </div>
        )}
        {aktuell.wert === "dokumente" && (
          <div className="zv-einstellungen-raster">
            <DokumentAngaben />
          </div>
        )}
        {aktuell.wert === "datenschutz" && mandant && (
          <div className="zv-einstellungen-raster">
            <ChatLoeschfrist mandant={mandant} onMandantAktualisiert={onMandantAktualisiert} />
            <KlientLoeschfrist mandant={mandant} onMandantAktualisiert={onMandantAktualisiert} />
          </div>
        )}
        {aktuell.wert === "rueckmeldungen" && mandant && (
          <div className="zv-einstellungen-raster">
            <RueckmeldungWeitergabe mandant={mandant} onMandantAktualisiert={onMandantAktualisiert} />
          </div>
        )}
      </div>
    </div>
  );
}

function Darstellung({
  hoverAusklappen,
  onHoverAusklappenAendern,
  menuReihenfolge,
  onMenuReihenfolgeAendern,
}: {
  hoverAusklappen: boolean;
  onHoverAusklappenAendern: (wert: boolean) => void;
  menuReihenfolge: HauptReiter[];
  onMenuReihenfolgeAendern: (reihenfolge: HauptReiter[]) => void;
}) {
  return (
    <>
      <section className="zv-einstellungen-abschnitt">
        <h3>
          <IDarstellung />
          Design
        </h3>
        <p className="zv-sub">
          Gilt nur für dich, auf diesem Gerät. Wird nicht auf dem Server gespeichert.
        </p>
        <ThemeAuswahl />
      </section>

      <section className="zv-einstellungen-abschnitt">
        <h3>
          <IEinklappen />
          Menüband
        </h3>
        <p className="zv-sub">
          Gilt nur für dich, auf diesem Gerät. Wirkt nur, solange das Menüband links eingeklappt ist.
        </p>
        <label className="zv-checkbox-zeile">
          <input
            type="checkbox"
            checked={hoverAusklappen}
            onChange={(e) => onHoverAusklappenAendern(e.target.checked)}
          />
          Beim Überfahren mit der Maus automatisch ausklappen
        </label>
      </section>

      <MenuReihenfolge reihenfolge={menuReihenfolge} onAendern={onMenuReihenfolgeAendern} />
    </>
  );
}

/**
 * Reihenfolge der Hauptmenuepunkte -- frei einstellbar statt fest im Code
 * (siehe navigation.ts). Drag & Drop per nativem HTML5-DnD fuer die Maus;
 * die Auf/Ab-Knoepfe sind dabei kein optischer Fallback, sondern
 * gleichwertig: natives Drag & Drop funktioniert nicht per Tastatur und auf
 * den meisten Touch-Browsern nicht (iOS/Android) -- in einer PWA, die auch
 * auf echten Mobilgeraeten laeuft, waere Drag & Drop allein ein
 * Komplett-Ausschluss fuer Touch- und Tastaturnutzung.
 */
function MenuReihenfolge({
  reihenfolge,
  onAendern,
}: {
  reihenfolge: HauptReiter[];
  onAendern: (reihenfolge: HauptReiter[]) => void;
}) {
  return (
    <section className="zv-einstellungen-abschnitt zv-einstellungen-abschnitt-breit">
      <h3>
        <IAnpassen />
        Reihenfolge der Menüpunkte
      </h3>
      <p className="zv-sub">
        Gilt nur für dich, auf diesem Gerät. Die Reihenfolge gilt innerhalb der Gruppe; zum Verschieben ziehen oder die
        Pfeile nutzen.
      </p>
      <div className="zv-reihenfolge-gruppen">
        {MENUE_GRUPPEN.map((g) => (
          <MenuReihenfolgeGruppe key={g.id} gruppe={g.id} label={g.label} reihenfolge={reihenfolge} onAendern={onAendern} />
        ))}
      </div>
      <button
        type="button"
        className="zv-btn zv-btn-still zv-btn-klein"
        onClick={() => onAendern(STANDARD_REITER.map((r) => r.wert))}
      >
        <IZuruecksetzen />
        Standardreihenfolge wiederherstellen
      </button>
    </section>
  );
}

function MenuReihenfolgeGruppe({
  gruppe,
  label,
  reihenfolge,
  onAendern,
}: {
  gruppe: MenueGruppeId;
  label: string;
  reihenfolge: HauptReiter[];
  onAendern: (reihenfolge: HauptReiter[]) => void;
}) {
  const eintraege = reiterDerGruppe(reihenfolge, gruppe);
  const [ziehtIndex, setZiehtIndex] = useState<number | null>(null);
  const [zielIndex, setZielIndex] = useState<number | null>(null);

  function verschieben(von: number, nach: number) {
    if (von === nach || von < 0 || nach < 0 || von >= eintraege.length || nach >= eintraege.length) return;
    const neu = eintraege.map((r) => r.wert);
    const [stueck] = neu.splice(von, 1);
    neu.splice(nach, 0, stueck);
    onAendern(gruppeNeuOrdnen(reihenfolge, gruppe, neu));
  }

  return (
    <div>
      <h4 className="zv-gruppenlabel">{label}</h4>
      <ul className="zv-reihenfolge-liste" aria-label={`Reihenfolge ${label}`}>
        {eintraege.map((r, i) => (
          <li
            key={r.wert}
            draggable
            className={`zv-reihenfolge-zeile${ziehtIndex === i ? " zv-reihenfolge-zieht" : ""}${
              zielIndex === i && ziehtIndex !== i ? " zv-reihenfolge-ziel" : ""
            }`}
            onDragStart={() => setZiehtIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setZielIndex(i);
            }}
            onDragEnd={() => {
              setZiehtIndex(null);
              setZielIndex(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (ziehtIndex !== null) verschieben(ziehtIndex, i);
              setZiehtIndex(null);
              setZielIndex(null);
            }}
          >
            <span className="zv-reihenfolge-griff" aria-hidden="true">
              <IZiehen />
            </span>
            <r.icon />
            <span className="zv-reihenfolge-label">{r.label}</span>
            <span className="zv-reihenfolge-aktionen">
              <button
                type="button"
                className="zv-icon-btn"
                disabled={i === 0}
                onClick={() => verschieben(i, i - 1)}
                aria-label={`${r.label} nach oben verschieben`}
                title="Nach oben"
              >
                <IVerschiebenHoch />
              </button>
              <button
                type="button"
                className="zv-icon-btn"
                disabled={i === eintraege.length - 1}
                onClick={() => verschieben(i, i + 1)}
                aria-label={`${r.label} nach unten verschieben`}
                title="Nach unten"
              >
                <IVerschiebenRunter />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Traegerfarbe({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  const { akzentVorschau, akzentUebernehmen } = useTheme();
  const [gewaehlt, setGewaehlt] = useState(mandant.akzentfarbe);
  const [hexFeld, setHexFeld] = useState(mandant.akzentfarbe);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  // Zaehlt jeden angestossenen Speichern()-Aufruf durch. "disabled" auf dem
  // Knopf verhindert nur einen zweiten KLICK, nicht eine zweite Anfrage --
  // React setzt das disabled-Attribut erst beim naechsten Rendern, und
  // zwei Antworten vom Server muessen nicht in Sendereihenfolge zurueckkommen.
  // Ohne diesen Zaehler koennte eine spaete Antwort auf eine AELTERE Anfrage
  // eine bereits abgeschlossene NEUERE ueberschreiben. Nur die Antwort auf
  // die zuletzt gestellte Anfrage wird uebernommen.
  const laufendeAnfrage = useRef(0);

  // Wenn der Mandant nachgeladen wird, die Auswahl nachziehen.
  useEffect(() => {
    setGewaehlt(mandant.akzentfarbe);
    setHexFeld(mandant.akzentfarbe);
  }, [mandant.akzentfarbe]);

  const geaendert = gewaehlt.toLowerCase() !== mandant.akzentfarbe.toLowerCase();

  function waehle(hex: string) {
    setGewaehlt(hex);
    setHexFeld(hex);
    setFehler(null);
    setErfolg(null);
    // Live: faerbt die GANZE Anwendung sofort um, nicht nur die Kachel --
    // die ueberzeugendste Vorschau, die es gibt. Ohne den Kaltstart-Cache
    // zu verstellen, solange nicht gespeichert wurde.
    akzentVorschau(hex);
  }

  function hexGeaendert(wert: string) {
    setHexFeld(wert);
    if (AKZENTFARBE_MUSTER.test(wert)) waehle(wert);
  }

  async function speichern() {
    if (speichert) return;
    const angefordert = ++laufendeAnfrage.current;
    const ziel = gewaehlt;
    setSpeichert(true);
    setFehler(null);
    setErfolg(null);
    try {
      const aktualisiert = await api.mandantAkzentfarbeSetzen(ziel);
      if (laufendeAnfrage.current !== angefordert) return; // ueberholt -- eine neuere Anfrage zaehlt
      onMandantAktualisiert(aktualisiert);
      akzentUebernehmen(aktualisiert.akzentfarbe);
      setErfolg("Farbe gespeichert. Sie gilt ab sofort für alle Mitarbeitenden.");
    } catch (err) {
      if (laufendeAnfrage.current !== angefordert) return;
      // Faengt insbesondere ein 403 ab, falls die Rolle im Token nicht der
      // Wahrheit auf dem Server entspricht.
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      akzentVorschau(mandant.akzentfarbe);
      setGewaehlt(mandant.akzentfarbe);
      setHexFeld(mandant.akzentfarbe);
    } finally {
      if (laufendeAnfrage.current === angefordert) setSpeichert(false);
    }
  }

  function zuruecksetzen() {
    waehle(mandant.akzentfarbe);
    setErfolg(null);
    setFehler(null);
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Trägerfarbe</h3>
      <p className="zv-sub">
        Akzentfarbe für Knöpfe, Markierungen und das aktive Menü, für alle Mitarbeitenden von {mandant.name}.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}

      <div className="zv-field">
        <label id="farbwelt-label">Farbwelt</label>
        <div className="zv-swatch-grid" role="group" aria-labelledby="farbwelt-label">
          {PASTELL_PALETTEN.map((p) => (
            <button
              key={p.id}
              type="button"
              className="zv-swatch"
              style={{ background: p.hex }}
              aria-pressed={gewaehlt.toLowerCase() === p.hex.toLowerCase()}
              aria-label={p.name}
              title={p.name}
              onClick={() => waehle(p.hex)}
            >
              {gewaehlt.toLowerCase() === p.hex.toLowerCase() && <IBestaetigen />}
            </button>
          ))}
        </div>
      </div>

      <div className="zv-field">
        <label htmlFor="eigene-farbe">Eigene Farbe</label>
        <div className="zv-farbwahl-frei">
          <input
            id="eigene-farbe"
            type="color"
            value={AKZENTFARBE_MUSTER.test(hexFeld) ? hexFeld : gewaehlt}
            onChange={(e) => waehle(e.target.value)}
          />
          <input
            type="text"
            value={hexFeld}
            onChange={(e) => hexGeaendert(e.target.value)}
            aria-label="Farbwert als Hex"
            spellCheck={false}
            maxLength={7}
          />
          {!AKZENTFARBE_MUSTER.test(hexFeld) && (
            <span className="zv-sub-inline">Bitte im Format #2d6a4f.</span>
          )}
        </div>
      </div>

      <Vorschau />

      <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
        <button className="zv-btn" onClick={speichern} disabled={!geaendert || speichert}>
          <ISpeichern />
          {speichert ? "Speichert…" : "Speichern"}
        </button>
        <button className="zv-btn zv-btn-still" onClick={zuruecksetzen} disabled={!geaendert}>
          <IZuruecksetzen />
          Zurücksetzen
        </button>
      </div>
    </section>
  );
}

/**
 * Grundfarbe (Hintergrund/Flaechen) im dunklen Design -- unabhaengig von der
 * Traegerfarbe (siehe migrations/0029). Baugleich zu Traegerfarbe() oben,
 * nur mit der kleineren, bewusst "dezenten" Palette DUNKEL_GRUNDFARBEN statt
 * PASTELL_PALETTEN und den dunkel*-Gegenstuecken aus dem Theme-Kontext.
 */
function DunkleGrundfarbe({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  const { dunkelVorschau, dunkelUebernehmen } = useTheme();
  const [gewaehlt, setGewaehlt] = useState(mandant.dunkelGrundfarbe);
  const [hexFeld, setHexFeld] = useState(mandant.dunkelGrundfarbe);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  // Siehe Traegerfarbe() oben fuer die Begruendung dieses Zaehlers.
  const laufendeAnfrage = useRef(0);

  useEffect(() => {
    setGewaehlt(mandant.dunkelGrundfarbe);
    setHexFeld(mandant.dunkelGrundfarbe);
  }, [mandant.dunkelGrundfarbe]);

  const geaendert = gewaehlt.toLowerCase() !== mandant.dunkelGrundfarbe.toLowerCase();

  function waehle(hex: string) {
    setGewaehlt(hex);
    setHexFeld(hex);
    setFehler(null);
    setErfolg(null);
    dunkelVorschau(hex);
  }

  function hexGeaendert(wert: string) {
    setHexFeld(wert);
    if (AKZENTFARBE_MUSTER.test(wert)) waehle(wert);
  }

  async function speichern() {
    if (speichert) return;
    const angefordert = ++laufendeAnfrage.current;
    const ziel = gewaehlt;
    setSpeichert(true);
    setFehler(null);
    setErfolg(null);
    try {
      const aktualisiert = await api.mandantDunkelGrundfarbeSetzen(ziel);
      if (laufendeAnfrage.current !== angefordert) return;
      onMandantAktualisiert(aktualisiert);
      dunkelUebernehmen(aktualisiert.dunkelGrundfarbe);
      setErfolg("Grundfarbe gespeichert. Sie gilt ab sofort für alle Mitarbeitenden.");
    } catch (err) {
      if (laufendeAnfrage.current !== angefordert) return;
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      dunkelVorschau(mandant.dunkelGrundfarbe);
      setGewaehlt(mandant.dunkelGrundfarbe);
      setHexFeld(mandant.dunkelGrundfarbe);
    } finally {
      if (laufendeAnfrage.current === angefordert) setSpeichert(false);
    }
  }

  function zuruecksetzen() {
    waehle(mandant.dunkelGrundfarbe);
    setErfolg(null);
    setFehler(null);
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Grundfarbe des dunklen Designs</h3>
      <p className="zv-sub">
        Hintergrund und Flächen im dunklen Design, unabhängig von der Trägerfarbe oben. Gilt für alle
        Mitarbeitenden von {mandant.name}.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}

      <div className="zv-field">
        <label id="grundfarbe-label">Grundton</label>
        <div className="zv-swatch-grid" role="group" aria-labelledby="grundfarbe-label">
          {DUNKEL_GRUNDFARBEN.map((p) => (
            <button
              key={p.id}
              type="button"
              className="zv-swatch"
              style={{ background: p.hex }}
              aria-pressed={gewaehlt.toLowerCase() === p.hex.toLowerCase()}
              aria-label={p.name}
              title={p.name}
              onClick={() => waehle(p.hex)}
            >
              {gewaehlt.toLowerCase() === p.hex.toLowerCase() && <IBestaetigen />}
            </button>
          ))}
        </div>
      </div>

      <div className="zv-field">
        <label htmlFor="eigene-grundfarbe">Eigene Farbe</label>
        <div className="zv-farbwahl-frei">
          <input
            id="eigene-grundfarbe"
            type="color"
            value={AKZENTFARBE_MUSTER.test(hexFeld) ? hexFeld : gewaehlt}
            onChange={(e) => waehle(e.target.value)}
          />
          <input
            type="text"
            value={hexFeld}
            onChange={(e) => hexGeaendert(e.target.value)}
            aria-label="Grundfarbe als Hex"
            spellCheck={false}
            maxLength={7}
          />
          {!AKZENTFARBE_MUSTER.test(hexFeld) && (
            <span className="zv-sub-inline">Bitte im Format #10131a.</span>
          )}
        </div>
      </div>

      <Vorschau />

      <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
        <button className="zv-btn" onClick={speichern} disabled={!geaendert || speichert}>
          <ISpeichern />
          {speichert ? "Speichert…" : "Speichern"}
        </button>
        <button className="zv-btn zv-btn-still" onClick={zuruecksetzen} disabled={!geaendert}>
          <IZuruecksetzen />
          Zurücksetzen
        </button>
      </div>
    </section>
  );
}

/**
 * Zeigt dieselben Bedienelemente einmal hell und einmal dunkel. Moeglich
 * ohne jede Sonderlogik, weil data-vorschau in app.css color-scheme lokal
 * setzt -- dadurch loesen sich alle light-dark()-Tokens in diesem Teilbaum
 * neu auf. Die Leitung sieht so beide Themes, ohne selbst umzuschalten.
 */
function Vorschau() {
  return (
    <div className="zv-field">
      <label>Vorschau</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {(["hell", "dunkel"] as const).map((variante) => (
          <div key={variante} className="zv-vorschau" data-vorschau={variante}>
            <strong style={{ fontSize: "var(--zv-text-s)", color: "var(--zv-text-muted)" }}>
              {variante === "hell" ? "Hell" : "Dunkel"}
            </strong>
            <div className="zv-vorschau-zeile">
              <button className="zv-btn zv-btn-klein" type="button" tabIndex={-1}>
                Aktion
              </button>
              <button className="zv-btn zv-btn-sekundaer zv-btn-klein" type="button" tabIndex={-1}>
                Zweitrangig
              </button>
            </div>
            <div className="zv-vorschau-zeile">
              <span className="zv-pill">Zugeordnet</span>
              <span className="zv-pill zv-pill-vergeben">Vergeben</span>
            </div>
            <span style={{ color: "var(--zv-accent)", fontSize: "var(--zv-text-s)", fontWeight: 600 }}>
              Beispiel-Verweis
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Trägerweite Datenschutzentscheidung (migrations/0061), deshalb neben den
 * eigenen Sicherheitseinstellungen und nicht unter "Darstellung". Ob die
 * Person sie ändern darf, entscheidet der Server (Recht
 * mandanten.datenschutz-bearbeiten); ohne dieses Recht blendet Einstellungen()
 * den ganzen Bereich aus. Eine Ablehnung erscheint trotzdem als Fehlermeldung,
 * falls das Recht waehrend der Sitzung wegfaellt.
 */
function ChatLoeschfrist({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  const [feld, setFeld] = useState(String(mandant.chatLoeschfristTage));
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);

  useEffect(() => {
    setFeld(String(mandant.chatLoeschfristTage));
  }, [mandant.chatLoeschfristTage]);

  const tage = Number(feld);
  const gueltig = Number.isInteger(tage) && tage >= CHAT_LOESCHFRIST_MIN_TAGE && tage <= CHAT_LOESCHFRIST_MAX_TAGE;
  const geaendert = gueltig && tage !== mandant.chatLoeschfristTage;
  const kuerzer = geaendert && tage < mandant.chatLoeschfristTage;

  async function speichern() {
    if (speichert || !geaendert) return;
    setSpeichert(true);
    setFehler(null);
    setErfolg(null);
    try {
      const aktualisiert = await api.mandantChatLoeschfristSetzen(tage);
      onMandantAktualisiert(aktualisiert);
      setErfolg(`Löschfrist gespeichert: ${aktualisiert.chatLoeschfristTage} Tage.`);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Löschfrist für Chatnachrichten</h3>
      <p className="zv-sub">
        Nachrichten, Bilder und beantwortete Gesprächsanfragen werden nach dieser Frist endgültig gelöscht, für alle
        Mitarbeitenden und Klient:innen von {mandant.name}. Was dokumentiert werden muss, gehört in die Akte, nicht in
        den Chat.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}

      <div className="zv-field">
        <label htmlFor="chat-loeschfrist">Frist in Tagen</label>
        <input
          id="chat-loeschfrist"
          type="number"
          inputMode="numeric"
          min={CHAT_LOESCHFRIST_MIN_TAGE}
          max={CHAT_LOESCHFRIST_MAX_TAGE}
          step={1}
          value={feld}
          onChange={(e) => {
            setFeld(e.target.value);
            setErfolg(null);
          }}
        />
        {!gueltig && (
          <span className="zv-sub-inline">
            Bitte zwischen {CHAT_LOESCHFRIST_MIN_TAGE} und {CHAT_LOESCHFRIST_MAX_TAGE} Tagen.
          </span>
        )}
      </div>

      {kuerzer && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          Nachrichten, die älter als {tage} Tage sind, werden innerhalb der nächsten Stunde gelöscht. Das lässt sich
          nicht rückgängig machen.
        </div>
      )}

      <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
        <button className="zv-btn" onClick={speichern} disabled={!geaendert || speichert}>
          <ISpeichern />
          {speichert ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </section>
  );
}

/**
 * Automatische Anonymisierung archivierter Klient:innen (migrations/0070).
 * Leeres Feld = aus. Anders als bei der Chat-Frist braucht jedes Speichern
 * eine ausdrückliche Bestätigung: die Wirkung trifft Personen, nicht
 * Nachrichten, und lässt sich nicht zurückholen.
 */
function KlientLoeschfrist({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  const aktuell = mandant.klientLoeschfristTage;
  const text = (t: number | null) => (t === null ? "" : String(t));
  const [feld, setFeld] = useState(text(aktuell));
  const [bestaetigt, setBestaetigt] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);

  useEffect(() => {
    setFeld(text(aktuell));
    setBestaetigt(false);
  }, [aktuell]);

  const aus = feld.trim() === "";
  const tage = aus ? null : Number(feld);
  const gueltig =
    aus || (Number.isInteger(tage) && tage! >= KLIENT_LOESCHFRIST_MIN_TAGE && tage! <= KLIENT_LOESCHFRIST_MAX_TAGE);
  const geaendert = gueltig && tage !== aktuell;
  // Aus-Schalten und Verlängern verlieren nichts; nur eine neue oder kürzere Frist löscht.
  const loescht = geaendert && tage !== null && (aktuell === null || tage < aktuell);

  async function speichern() {
    if (speichert || !geaendert || (loescht && !bestaetigt)) return;
    setSpeichert(true);
    setFehler(null);
    setErfolg(null);
    try {
      const aktualisiert = await api.mandantKlientLoeschfristSetzen(tage);
      onMandantAktualisiert(aktualisiert);
      setBestaetigt(false);
      setErfolg(
        aktualisiert.klientLoeschfristTage === null
          ? "Automatische Löschung ist aus."
          : `Löschfrist gespeichert: ${aktualisiert.klientLoeschfristTage} Tage nach Archivierung.`
      );
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Löschfrist für Klientendaten</h3>
      <p className="zv-sub">
        Archivierte Klient:innen von {mandant.name} werden nach dieser Frist automatisch anonymisiert: Name,
        Geburtsdatum, Stammdaten, Kontakte, Aktenauszüge und Chatverläufe werden endgültig gelöscht. Aktenzeichen,
        Kassenbuch, Rechnungen und Tagesberichte bleiben. Wer wieder entarchiviert wird, beginnt von vorn. Ohne Eintrag
        ist die automatische Löschung aus.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      {erfolg && (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          {erfolg}
        </div>
      )}

      <div className="zv-field">
        <label htmlFor="klient-loeschfrist">Frist in Tagen nach Archivierung (leer = aus)</label>
        <input
          id="klient-loeschfrist"
          type="number"
          inputMode="numeric"
          min={KLIENT_LOESCHFRIST_MIN_TAGE}
          max={KLIENT_LOESCHFRIST_MAX_TAGE}
          step={1}
          value={feld}
          onChange={(e) => {
            setFeld(e.target.value);
            setBestaetigt(false);
            setErfolg(null);
          }}
        />
        {!gueltig && (
          <span className="zv-sub-inline">
            Bitte zwischen {KLIENT_LOESCHFRIST_MIN_TAGE} und {KLIENT_LOESCHFRIST_MAX_TAGE} Tagen oder leer lassen.
          </span>
        )}
      </div>

      {loescht && (
        <>
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            Alle Klient:innen, die vor mehr als {tage} Tagen archiviert wurden, werden innerhalb der nächsten Stunde
            anonymisiert. Das lässt sich nicht rückgängig machen.
          </div>
          <label className="zv-checkbox-zeile">
            <input type="checkbox" checked={bestaetigt} onChange={(e) => setBestaetigt(e.target.checked)} />
            Ich habe die Frist mit der Datenschutzbeauftragten oder dem Datenschutzbeauftragten abgestimmt.
          </label>
        </>
      )}

      <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
        <button className="zv-btn" onClick={speichern} disabled={!geaendert || speichert || (loescht && !bestaetigt)}>
          <ISpeichern />
          {speichert ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </section>
  );
}

/**
 * Darf der Hersteller freigegebene Rückmeldungen lesen (migrations/0073)?
 * Standard aus: Rückmeldungen können Freitext und Screenshots enthalten, und
 * ohne ausdrückliche Entscheidung des Trägers verlässt davon nichts das Haus.
 */
function RueckmeldungWeitergabe({
  mandant,
  onMandantAktualisiert,
}: {
  mandant: MandantDto;
  onMandantAktualisiert: (m: MandantDto) => void;
}) {
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function umschalten(aktiv: boolean) {
    if (speichert) return;
    setSpeichert(true);
    setFehler(null);
    try {
      onMandantAktualisiert(await api.mandantRueckmeldungWeitergabeSetzen(aktiv));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <section className="zv-einstellungen-abschnitt">
      <h3>Rückmeldungen an den Hersteller</h3>
      <p className="zv-sub">
        Mitarbeitende können Ideen und Fehler direkt aus der Anwendung melden, mit einem Screenshot, in dem alle Texte
        unkenntlich gemacht sind. Die Geschäftsführung entscheidet über die Freigabe. Nur wenn Sie die Weitergabe
        einschalten, darf der Hersteller freigegebene Rückmeldungen lesen und umsetzen; nicht freigegebene sieht er nie.
        Bilder werden 30 Tage, Einträge 365 Tage nach Abschluss gelöscht.
      </p>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <label className="zv-checkbox-zeile">
        <input type="checkbox" checked={mandant.rueckmeldungWeitergabe} disabled={speichert} onChange={(e) => umschalten(e.target.checked)} />
        Freigegebene Rückmeldungen an den Hersteller weitergeben
      </label>
    </section>
  );
}
