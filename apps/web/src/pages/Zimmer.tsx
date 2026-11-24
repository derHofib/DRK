import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import type {
  AufgabeDto,
  AufgabePrioritaet,
  BelegungsverlaufEintragDto,
  BenutzerListEintragDto,
  KlientListEintragDto,
  OffenerKapazitaetsantragDto,
  StandortDto,
  ZimmerBewohnerDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";
import { ZIMMERSTATUS_LABEL } from "@zimmerakte/shared";
import { api, tokenBenutzerId } from "../api/client";
import { formatDatum, heuteBerlin, initialen } from "../format";
import { filterTextAus, type ListenExport } from "../export/listenExport";
import { AufgabeKompakt } from "../components/AufgabeZeile";
import { AktionsMenue } from "../components/AktionsMenue";
import { Seitenpanel, useAngedockt } from "../components/Seitenpanel";
import { KlientDetail } from "./KlientDetail";
import { GrundAbfrage } from "../components/GrundAbfrage";
import { Filterleiste, OptionenFilter, trifftSuche } from "../components/Listenfilter";
import { Leerzustand } from "../components/Leerzustand";
import {
  IAbbrechen,
  IAblehnen,
  IAufgaben,
  IAufklappen,
  IAuszug,
  IBearbeiten,
  IDeaktivieren,
  IEinziehen,
  IFehler,
  IGenehmigen,
  IGeplant,
  IKapazitaet,
  ILeerZimmer,
  ILoeschen,
  IOrdnerOffen,
  INeu,
  ISpeichern,
  ISVergeben,
  ISZugeordnet,
  IStandort,
  IZimmer,
  IVerlauf,
  IWarteliste,
  IZuklappen,
} from "../components/icons";
import { Datumsfeld } from "../components/Datumsfeld";
import {
  AuszugFenster,
  BelegungBearbeitenFenster,
  KapazitaetFenster,
  KlientZuweisenFenster,
  NEUER_STANDORT,
  WartelisteFenster,
  ZimmerAnlegenFenster,
  ZimmerBearbeitenFenster,
} from "./zimmer/ZimmerFenster";

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
/**
 * Mit "standortIds" arbeitet die Seite eingebettet im Standort-Bereich
 * (StandortRaeume.tsx, Ansicht "Verwalten"): dieselben Funktionen wie im
 * Hauptmenue "Zimmer" -- anlegen, bearbeiten, deaktivieren, einziehen,
 * Auszug, Warteliste, Kapazitaet, Verlauf, Aufgaben --, aber nur fuer die
 * dort gewaehlten Standorte, ohne eigene Ueberschrift. Die Standortwahl
 * kommt von der Belegungsseite (standortPille); Standort-Ueberschriften und
 * die Standortauswahl beim Anlegen erscheinen nur, wenn es mehrere sind. Bewusst
 * KEINE zweite Kopie der Logik: zwei Implementierungen derselben
 * Belegungsregeln wuerden auseinanderlaufen.
 */
type ZimmerSortierung = "nummer-auf" | "nummer-ab" | "frei-zuerst";
const ZIMMER_SORTIERUNG_LABEL: Record<ZimmerSortierung, string> = {
  "nummer-auf": "Nummer aufsteigend",
  "nummer-ab": "Nummer absteigend",
  "frei-zuerst": "Freie Plätze zuerst",
};

export function Zimmer({
  standortIds,
  standortPille,
}: {
  standortIds?: string[];
  /** Standortwahl der Belegungsseite, eingebettet als erste Pille der Filterleiste (sonst stuende sie in einer zweiten Zeile darueber). */
  standortPille?: ReactNode;
} = {}) {
  const aktuelleBenutzerId = tokenBenutzerId();

  const [zimmer, setZimmer] = useState<ZimmerListEintragDto[]>([]);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  // Zimmer-Panel (Rueckmeldung d5f8252d): EIN ausgewaehltes Zimmer statt
  // je Karte aufklappbarer Bereiche fuer Aufgaben, Verlauf und Warteliste.
  const [ausgewaehltesZimmerId, setAusgewaehltesZimmerId] = useState<string | null>(null);
  const [akteKlientId, setAkteKlientId] = useState<string | null>(null);
  const [verlauf, setVerlauf] = useState<BelegungsverlaufEintragDto[]>([]);
  const [ganzerVerlauf, setGanzerVerlauf] = useState(false);

  const [formularOffen, setFormularOffen] = useState(false);
  const eingebettet = standortIds !== undefined;
  // Eingebettet mit genau einem Standort: kein Standortbezug in der Oberflaeche noetig.
  const einStandort = standortIds?.length === 1 ? standortIds[0] : undefined;
  const [standortAuswahl, setStandortAuswahl] = useState<string>(standortIds?.[0] ?? NEUER_STANDORT);

  const [bearbeitetesZimmer, setBearbeitetesZimmer] = useState<ZimmerListEintragDto | null>(null);

  const [zuweisungsZimmer, setZuweisungsZimmer] = useState<ZimmerListEintragDto | null>(null);
  // Gesetzt, wenn "Klient zuweisen" von einer Warteliste aus geoeffnet wurde
  // -- dann ist der Klient schon festgelegt, kein Dropdown noetig.
  const [wartelistenKlient, setWartelistenKlient] = useState<{ id: string; name: string } | null>(null);

  const [wartelisteZimmer, setWartelisteZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [auszugBewohner, setAuszugBewohner] = useState<{ zimmer: ZimmerListEintragDto; bewohner: ZimmerBewohnerDto } | null>(
    null
  );

  const [bearbeiteteBelegung, setBearbeiteteBelegung] = useState<BelegungsverlaufEintragDto | null>(null);

  const [kapazitaetZimmer, setKapazitaetZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [kapazitaetAblehnenAntrag, setKapazitaetAblehnenAntrag] = useState<OffenerKapazitaetsantragDto | null>(null);

  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [aufgabenAnzahl, setAufgabenAnzahl] = useState<Record<string, number>>({});
  const [ueberfaelligAnzahl, setUeberfaelligAnzahl] = useState<Record<string, number>>({});
  const [aufgabenImZimmer, setAufgabenImZimmer] = useState<AufgabeDto[]>([]);
  const [aufgabenAnsicht, setAufgabenAnsicht] = useState<"offen" | "erledigt">("offen");
  const [aufgabeFormOffen, setAufgabeFormOffen] = useState(false);
  const [aufgabeFormFehler, setAufgabeFormFehler] = useState<string | null>(null);
  const angedockt = useAngedockt();

  function ladeZimmer() {
    api.zimmerListe().then(setZimmer).catch((err) => setFehler(err.message));
  }

  function ladeAufgabenAnzahl() {
    api
      .aufgabenAnzahlOffen()
      .then((a) => {
        setAufgabenAnzahl(a.jeZimmer);
        setUeberfaelligAnzahl(a.ueberfaelligJeZimmer);
      })
      .catch(() => {});
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
        if (ersterAktiver && !eingebettet) setStandortAuswahl(ersterAktiver.id);
      })
      .catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    ladeZimmer();
    ladeStandorte();
    ladeKlienten();
    ladeAufgabenAnzahl();
    api.benutzerListe().then(setBenutzerListe).catch(() => {});
  }, []);

  function formularOeffnen() {
    setFormularOffen(true);
  }

  async function zimmerDeaktivieren(zimmerId: string) {
    try {
      await api.zimmerDeaktivieren(zimmerId);
      if (ausgewaehltesZimmerId === zimmerId) panelSchliessen();
      ladeZimmer();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zimmer konnte nicht deaktiviert werden.");
    }
  }

  async function wartelisteEntfernen(zimmerId: string, eintragId: string) {
    try {
      await api.zimmerWartelisteEntfernen(zimmerId, eintragId);
      ladeZimmer();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Eintrag konnte nicht entfernt werden.");
    }
  }

  async function kapazitaetEntscheiden(
    antrag: OffenerKapazitaetsantragDto,
    entscheidung: "bestaetigt" | "abgelehnt",
    grund?: string
  ) {
    try {
      await api.zimmerKapazitaetEntscheiden(antrag.id, entscheidung, grund);
      ladeZimmer();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Kapazitätsänderung konnte nicht entschieden werden.");
    }
  }

  /**
   * Reiner Anzeige-Hinweis (der Server prueft es erneut, siehe
   * kapazitaetEntscheiden() in zimmer.service.ts): wer das Recht
   * zimmer.kapazitaet-entscheiden hat, darf bestaetigen/ablehnen -- aber
   * nie die eigene Anfrage. Das Recht selbst kann clientseitig nicht
   * geprueft werden, deshalb nur die Selbstantrags-Sperre als Hinweis;
   * alles andere entscheidet ausschliesslich der Server.
   */
  function darfKapazitaetEntscheiden(antrag: OffenerKapazitaetsantragDto): boolean {
    return antrag.beantragtVonId !== aktuelleBenutzerId;
  }

  function zimmerOeffnen(zimmerId: string) {
    // Zweiter Klick auf dieselbe Karte schliesst wieder -- wie ein Umschalter.
    if (ausgewaehltesZimmerId === zimmerId) {
      panelSchliessen();
      return;
    }
    setAusgewaehltesZimmerId(zimmerId);
    setAkteKlientId(null);
    setGanzerVerlauf(false);
    setAufgabeFormOffen(false);
    setAufgabeFormFehler(null);
    setAufgabenAnsicht("offen");
  }

  function panelSchliessen() {
    setAusgewaehltesZimmerId(null);
    setAkteKlientId(null);
  }

  // Wechselt die Standortwahl der Belegungsseite, gehoert das offene Zimmer
  // nicht mehr zur sichtbaren Auswahl.
  const standortSchluessel = standortIds?.join(",") ?? "";
  useEffect(() => {
    panelSchliessen();
  }, [standortSchluessel]);

  /** 90 Tage: genug fuer "was war hier zuletzt los", ohne dass die Liste ueber Jahre waechst. */
  function erledigtSeit(): string {
    return new Date(Date.parse(`${heuteBerlin()}T12:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  }

  function aufgabenFilter(zimmerId: string, ansicht: "offen" | "erledigt") {
    return ansicht === "offen" ? { zimmerId, offen: true } : { zimmerId, offen: false, erledigtSeit: erledigtSeit() };
  }

  // Abbruch-Flag: wer schnell Zimmer fuer Zimmer durchklickt, darf nicht die
  // Aufgaben des vorletzten Zimmers sehen, nur weil dessen Antwort spaeter kam.
  useEffect(() => {
    if (!ausgewaehltesZimmerId) return;
    let abgebrochen = false;
    setAufgabenImZimmer([]);
    api
      .aufgabenListe(aufgabenFilter(ausgewaehltesZimmerId, aufgabenAnsicht))
      .then((liste) => !abgebrochen && setAufgabenImZimmer(liste))
      .catch((err) => !abgebrochen && setFehler(err instanceof Error ? err.message : "Aufgaben konnten nicht geladen werden."));
    return () => {
      abgebrochen = true;
    };
  }, [ausgewaehltesZimmerId, aufgabenAnsicht]);

  useEffect(() => {
    if (!ausgewaehltesZimmerId) return;
    let abgebrochen = false;
    setVerlauf([]);
    api
      .belegungsverlauf(ausgewaehltesZimmerId)
      .then((v) => !abgebrochen && setVerlauf(v))
      .catch((err) => !abgebrochen && setFehler(err instanceof Error ? err.message : "Belegungsverlauf konnte nicht geladen werden."));
    return () => {
      abgebrochen = true;
    };
  }, [ausgewaehltesZimmerId]);

  function ladeVerlauf() {
    if (!ausgewaehltesZimmerId) return;
    api.belegungsverlauf(ausgewaehltesZimmerId).then(setVerlauf).catch(() => {});
  }

  async function ladeAufgaben() {
    if (!ausgewaehltesZimmerId) return;
    try {
      setAufgabenImZimmer(await api.aufgabenListe(aufgabenFilter(ausgewaehltesZimmerId, aufgabenAnsicht)));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Aufgaben konnten nicht geladen werden.");
    }
  }

  async function aufgabeImZimmerAnlegen(e: FormEvent<HTMLFormElement>, zimmerId: string) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const titel = String(form.get("titel") ?? "").trim();
    if (!titel) return;
    setAufgabeFormFehler(null);
    try {
      await api.aufgabeAnlegen({
        titel,
        zimmerId,
        prioritaet: form.get("prioritaet") as AufgabePrioritaet,
        faelligAm: String(form.get("faelligAm") ?? "") || undefined,
        zugewiesenAn: String(form.get("zugewiesenAn") ?? "") || undefined,
      });
      formElement.reset();
      setAufgabeFormOffen(false);
      await ladeAufgaben();
      ladeAufgabenAnzahl();
    } catch (err) {
      setAufgabeFormFehler(err instanceof Error ? err.message : "Aufgabe konnte nicht angelegt werden.");
    }
  }

  async function aufgabeErledigen(aufgabeId: string) {
    try {
      await api.aufgabeErledigen(aufgabeId);
      await ladeAufgaben();
      ladeAufgabenAnzahl();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Aufgabe konnte nicht erledigt werden.");
    }
  }

  async function aufgabeZuweisenAendern(aufgabeId: string, zugewiesenAn: string | null) {
    try {
      await api.aufgabeAktualisieren(aufgabeId, { zugewiesenAn });
      await ladeAufgaben();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Zuweisung konnte nicht geändert werden.");
    }
  }

  async function aufgabeImZimmerLoeschen(aufgabeId: string) {
    try {
      await api.aufgabeLoeschen(aufgabeId);
      await ladeAufgaben();
      ladeAufgabenAnzahl();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Aufgabe konnte nicht gelöscht werden.");
    }
  }

  const [suche, setSuche] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [standortFilter, setStandortFilter] = useState("");
  const [etageFilter, setEtageFilter] = useState("");
  const [sortierung, setSortierung] = useState<ZimmerSortierung>("nummer-auf");

  const imBereich = zimmer.filter((z) => !standortIds || standortIds.includes(z.standortId));
  const sichtbareZimmer = useMemo(() => {
    const nummer = (a: ZimmerListEintragDto, b: ZimmerListEintragDto) => a.nummer.localeCompare(b.nummer, "de", { numeric: true });
    return imBereich
      .filter(
        (z) =>
          (!statusFilter || z.status === statusFilter) &&
          (!standortFilter || z.standortId === standortFilter) &&
          (!etageFilter || z.etage === etageFilter) &&
          trifftSuche(suche, [z.nummer, z.etage, z.standortName, ...z.bewohner.map((b) => b.name)]),
      )
      .sort((a, b) => {
        switch (sortierung) {
          case "nummer-auf":
            return nummer(a, b);
          case "nummer-ab":
            return nummer(b, a);
          case "frei-zuerst":
            return b.kapazitaet - b.bewohner.length - (a.kapazitaet - a.bewohner.length) || nummer(a, b);
        }
      });
    // imBereich ist von zimmer/standortIds abgeleitet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zimmer, standortIds, statusFilter, standortFilter, etageFilter, suche, sortierung]);
  function zimmerExport(): ListenExport {
    return {
      titel: "Zimmer und Belegung",
      dateiname: "zimmer-belegung",
      filterText: filterTextAus([
        ["Status", statusFilter ? ZIMMERSTATUS_LABEL[statusFilter as keyof typeof ZIMMERSTATUS_LABEL] : ""],
        ["Standort", standortOptionen.find((o) => o.wert === standortFilter)?.label],
        ["Etage", etageFilter],
        ["Suche", suche.trim()],
      ]),
      spalten: [
        { titel: "Standort", breite: 14 },
        { titel: "Zimmer", breite: 8 },
        { titel: "Etage", breite: 8 },
        { titel: "Status", breite: 12 },
        { titel: "Belegt / Plätze", breite: 10 },
        { titel: "Bewohner:innen", breite: 40 },
      ],
      zeilen: sichtbareZimmer.map((z) => [
        z.standortName,
        z.nummer,
        z.etage,
        ZIMMERSTATUS_LABEL[z.status],
        `${z.bewohner.length} / ${z.kapazitaet}`,
        z.bewohner
          .map((b) => `${b.name} (seit ${formatDatum(b.einzug)}${b.auszug ? `, Auszug ${formatDatum(b.auszug)}` : ""})`)
          .join("; "),
      ]),
    };
  }
  const zimmerFilterAktiv = Boolean(statusFilter || standortFilter || etageFilter || suche.trim());
  const standortOptionen = [...new Map(imBereich.map((z) => [z.standortId, z.standortName])).entries()]
    .map(([wert, label]) => ({ wert, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));
  const etageOptionen = [...new Set(imBereich.map((z) => z.etage))].map((e) => ({ wert: e, label: e }));

  const gruppen = sichtbareZimmer.reduce<Record<string, ZimmerListEintragDto[]>>((acc, z) => {
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

  /**
   * Inhalt des Zimmer-Panels. Aufbau wie die Klientenakte (Kopf mit einer
   * Hauptaktion, seltene Aktionen im Menue), aber Abschnitte untereinander
   * statt Reiter: ein Zimmer hat wenig Inhalt, und Reiter wuerden die
   * Aufgaben von der Belegung trennen -- genau den Ueberblick, um den es in
   * der Rueckmeldung ging. Aufgaben stehen deshalb ganz oben.
   */
  function zimmerPanel(z: ZimmerListEintragDto) {
    const StatusIcon = STATUS_ICON[z.status];
    const offen = aufgabenAnzahl[z.id] ?? 0;
    const ueberfaellig = ueberfaelligAnzahl[z.id] ?? 0;
    const frei = z.bewohner.length < z.kapazitaet;
    const antrag = z.offenerKapazitaetsantrag;
    const verlaufSichtbar = ganzerVerlauf ? verlauf : verlauf.slice(0, 3);

    return (
      <div className="zv-akte zv-zimmer-panel">
        <header className="zv-akte-kopf">
          <span className="zv-initialen-kachel zv-zimmer-kachel" aria-hidden="true">
            {z.nummer}
          </span>
          <div className="zv-akte-titel">
            <h2>
              Zimmer {z.nummer}
              <span className={`zv-pill zv-pill-${z.status}`}>
                <StatusIcon />
                {ZIMMERSTATUS_LABEL[z.status]}
              </span>
            </h2>
            <p className="zv-akte-meta">
              {[z.standortName, z.etage, `${z.bewohner.length} von ${z.kapazitaet} ${z.kapazitaet === 1 ? "Platz" : "Plätzen"} belegt`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="zv-akte-aktionen">
            <button
              type="button"
              className="zv-btn"
              onClick={() => {
                setAufgabenAnsicht("offen");
                setAufgabeFormFehler(null);
                setAufgabeFormOffen(true);
              }}
            >
              <INeu />
              Aufgabe
            </button>
            <AktionsMenue label={`Weitere Aktionen zu Zimmer ${z.nummer}`}>
              <button
                type="button"
                role="menuitem"
                onClick={() => setBearbeitetesZimmer(z)}
              >
                <IBearbeiten />
                Zimmer bearbeiten
              </button>
              {!antrag && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setKapazitaetZimmer(z)}
                >
                  <IKapazitaet />
                  Kapazität ändern
                </button>
              )}
              {frei && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setZuweisungsZimmer(z)}
                >
                  <IEinziehen />
                  Klient:in zuweisen
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => setWartelisteZimmer(z)}
              >
                <IWarteliste />
                Zur Warteliste hinzufügen
              </button>
              {z.bewohner.length === 0 && (
                <button type="button" role="menuitem" className="zv-menue-gefahr" onClick={() => zimmerDeaktivieren(z.id)}>
                  <IDeaktivieren />
                  Zimmer deaktivieren
                </button>
              )}
            </AktionsMenue>
          </div>
        </header>

        {antrag && (
          <div className="zv-hinweis zv-hinweis-info">
            Kapazitätsänderung {antrag.alteKapazitaet} → {antrag.neueKapazitaet} beantragt von {antrag.beantragtVonName}
            {darfKapazitaetEntscheiden(antrag) && (
              <div className="zv-vorschau-zeile" style={{ marginTop: "var(--zv-space-1)" }}>
                <button className="zv-link-btn" onClick={() => kapazitaetEntscheiden(antrag, "bestaetigt")}>
                  <IGenehmigen />
                  Bestätigen
                </button>
                <button className="zv-link-btn" onClick={() => setKapazitaetAblehnenAntrag(antrag)}>
                  <IAblehnen />
                  Ablehnen
                </button>
              </div>
            )}
          </div>
        )}

        <div className="zv-zimmer-abschnitte">
          <section aria-label="Aufgaben">
            <div className="zv-abschnittskopf">
              <h3>
                Aufgaben{" "}
                <span className="zv-abschnitt-zaehler">
                  {offen} offen{ueberfaellig > 0 ? ` · ${ueberfaellig} überfällig` : ""}
                </span>
              </h3>
              <div className="zv-segmented" role="group" aria-label="Aufgaben anzeigen">
                {(["offen", "erledigt"] as const).map((ansicht) => (
                  <button
                    key={ansicht}
                    type="button"
                    className={aufgabenAnsicht === ansicht ? "active" : undefined}
                    aria-pressed={aufgabenAnsicht === ansicht}
                    onClick={() => setAufgabenAnsicht(ansicht)}
                  >
                    {ansicht === "offen" ? "Offen" : "Erledigt"}
                  </button>
                ))}
              </div>
            </div>
            {aufgabeFormFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {aufgabeFormFehler}
              </div>
            )}
            {aufgabenImZimmer.length === 0 ? (
              <p className="zv-rand-leer">
                {aufgabenAnsicht === "offen" ? "Keine offenen Aufgaben." : "In den letzten 90 Tagen nichts erledigt."}
              </p>
            ) : (
              <ul className="zv-zimmer-liste">
                {aufgabenImZimmer.map((a) => (
                  <AufgabeKompakt
                    key={a.id}
                    aufgabe={a}
                    benutzerListe={benutzerListe}
                    aktuelleBenutzerId={aktuelleBenutzerId}
                    onErledigen={() => aufgabeErledigen(a.id)}
                    onZuweisenAendern={(bid) => aufgabeZuweisenAendern(a.id, bid)}
                    onLoeschen={() => aufgabeImZimmerLoeschen(a.id)}
                  />
                ))}
              </ul>
            )}
            {aufgabenAnsicht === "erledigt" && aufgabenImZimmer.length > 0 && (
              <p className="zv-rand-leer">Erledigt in den letzten 90 Tagen.</p>
            )}
            {aufgabenAnsicht === "offen" &&
              (aufgabeFormOffen ? (
                <form className="zv-zimmer-aufgabe-neu" onSubmit={(e) => aufgabeImZimmerAnlegen(e, z.id)}>
                  <input name="titel" placeholder="Neue Aufgabe, z. B. Fenstergriff defekt" aria-label="Titel der Aufgabe" required autoFocus />
                  <select name="prioritaet" defaultValue="normal" aria-label="Priorität">
                    <option value="niedrig">Niedrig</option>
                    <option value="normal">Normal</option>
                    <option value="hoch">Hoch</option>
                  </select>
                  <Datumsfeld name="faelligAm" aria-label="Fälligkeit" groesse="kompakt" schnellwahl="faelligkeit" />
                  <select name="zugewiesenAn" defaultValue="" aria-label="Zuweisen an">
                    <option value="">Niemand</option>
                    {benutzerListe.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button className="zv-btn zv-btn-klein" type="submit">
                    <ISpeichern />
                    Anlegen
                  </button>
                  <button className="zv-btn zv-btn-sekundaer zv-btn-klein" type="button" onClick={() => setAufgabeFormOffen(false)}>
                    <IAbbrechen />
                    Abbrechen
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="zv-link-btn zv-zimmer-neu-link"
                  onClick={() => {
                    setAufgabeFormFehler(null);
                    setAufgabeFormOffen(true);
                  }}
                >
                  <INeu />
                  Aufgabe zu Zimmer {z.nummer} anlegen
                </button>
              ))}
          </section>

          <section aria-label="Belegung">
            <div className="zv-abschnittskopf">
              <h3>
                Belegung{" "}
                <span className="zv-abschnitt-zaehler">
                  {z.bewohner.length} von {z.kapazitaet} {z.kapazitaet === 1 ? "Platz" : "Plätzen"}
                </span>
              </h3>
              {frei && (
                <button
                  type="button"
                  className="zv-link-btn"
                  onClick={() => setZuweisungsZimmer(z)}
                >
                  <IEinziehen />
                  Klient:in zuweisen
                </button>
              )}
            </div>
            {z.bewohner.length === 0 ? (
              <p className="zv-rand-leer">Niemand wohnt in diesem Zimmer.</p>
            ) : (
              <ul className="zv-zimmer-liste">
                {z.bewohner.map((bew) => (
                  <li key={bew.belegungId} className="zv-zimmer-person">
                    <span className="zv-initialen-kachel" aria-hidden="true">
                      {initialen(bew.name)}
                    </span>
                    <div className="zv-zimmer-person-text">
                      <strong>{bew.name}</strong>
                      <span className="zv-zimmer-meta">
                        seit {formatDatum(bew.einzug)}
                        {bew.auszug && (
                          <span className="zv-pill zv-pill-info">
                            <IGeplant />
                            Auszug geplant {formatDatum(bew.auszug)}
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="zv-zimmer-zeilen-aktionen">
                      <button type="button" className="zv-link-btn" onClick={() => setAkteKlientId(bew.id)}>
                        <IOrdnerOffen />
                        Akte
                      </button>
                      <button
                        type="button"
                        className="zv-link-btn"
                        onClick={() => setAuszugBewohner({ zimmer: z, bewohner: bew })}
                      >
                        <IAuszug />
                        Auszug
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Warteliste">
            <div className="zv-abschnittskopf">
              <h3>
                Warteliste <span className="zv-abschnitt-zaehler">{z.warteliste.length}</span>
              </h3>
              <button
                type="button"
                className="zv-link-btn"
                onClick={() => setWartelisteZimmer(z)}
              >
                <INeu />
                Hinzufügen
              </button>
            </div>
            {z.warteliste.length === 0 ? (
              <p className="zv-rand-leer">Noch niemand auf der Warteliste.</p>
            ) : (
              <ul className="zv-zimmer-liste">
                {z.warteliste.map((w, i) => (
                  <li key={w.id} className="zv-zimmer-zeile">
                    <div className="zv-zimmer-person-text">
                      <strong>
                        {i + 1}. {w.klientName}
                      </strong>
                      <span className="zv-zimmer-meta">
                        seit {formatDatum(w.eingetragenAm.slice(0, 10))}
                        {w.eingetragenVonName ? ` · ${w.eingetragenVonName}` : ""}
                      </span>
                    </div>
                    <span className="zv-zimmer-zeilen-aktionen">
                      <button
                        type="button"
                        className="zv-link-btn"
                        onClick={() => {
                          setWartelistenKlient({ id: w.klientId, name: w.klientName });
                          setZuweisungsZimmer(z);
                        }}
                      >
                        <IEinziehen />
                        Einziehen
                      </button>
                      <button type="button" className="zv-link-btn" onClick={() => wartelisteEntfernen(z.id, w.id)}>
                        <ILoeschen />
                        Entfernen
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Belegungsverlauf">
            <div className="zv-abschnittskopf">
              <h3>Belegungsverlauf</h3>
              {verlauf.length > 3 && (
                <button type="button" className="zv-link-btn" onClick={() => setGanzerVerlauf((g) => !g)}>
                  {ganzerVerlauf ? <IZuklappen /> : <IVerlauf />}
                  {ganzerVerlauf ? "Weniger anzeigen" : `Ganzer Verlauf (${verlauf.length})`}
                </button>
              )}
            </div>
            {verlauf.length === 0 ? (
              <p className="zv-rand-leer">Noch keine Belegung erfasst.</p>
            ) : (
              <ul className="zv-zimmer-liste">
                {verlaufSichtbar.map((v) => (
                  <li key={v.id} className="zv-zimmer-zeile">
                    <div className="zv-zimmer-person-text">
                      <strong>{v.name}</strong>
                      <span className="zv-zimmer-meta">
                        {v.geplant ? (
                          <>Geplant ab {formatDatum(v.einzug)}</>
                        ) : (
                          <>
                            {formatDatum(v.einzug)} – {v.istAktuell ? "heute" : formatDatum(v.auszug!)}
                          </>
                        )}
                        {(v.geplant || (v.istAktuell && v.auszug)) && (
                          <span className="zv-pill zv-pill-info">
                            <IGeplant />
                            {v.geplant ? "Geplant" : `Auszug geplant ${formatDatum(v.auszug!)}`}
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="zv-zimmer-zeilen-aktionen">
                      <button
                        type="button"
                        className="zv-link-btn"
                        onClick={() => setBearbeiteteBelegung(v)}
                      >
                        <IBearbeiten />
                        Bearbeiten
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    );
  }

  const ausgewaehltesZimmer = zimmer.find((z) => z.id === ausgewaehltesZimmerId) ?? null;

  return (
    <div className={ausgewaehltesZimmer && angedockt ? "zv-neben-angedocktem-panel" : undefined}>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        {eingebettet ? <span /> : <h2>Zimmer</h2>}
        <button className="zv-btn" onClick={formularOeffnen}>
          <INeu />
          Neues Zimmer
        </button>
      </div>

      {zimmer.length === 0 && standortPille && (
        <div className="zv-filterleiste" role="search" aria-label="Standort wählen">
          {standortPille}
        </div>
      )}
      {zimmer.length > 0 && (
        <>
          <Filterleiste
            ariaLabel="Zimmer filtern und sortieren"
            suche={{ wert: suche, onChange: setSuche, placeholder: "Zimmer, Bewohner:in…", ariaLabel: "Zimmer durchsuchen" }}
            zusatz={[
              ...(eingebettet
                ? []
                : [
                    {
                      id: "standort",
                      label: "Standort",
                      icon: <IStandort />,
                      wert: standortOptionen.find((o) => o.wert === standortFilter)?.label ?? null,
                      optionen: standortOptionen,
                      gewaehlt: standortFilter || null,
                      onWaehlen: setStandortFilter,
                      onEntfernen: () => setStandortFilter(""),
                    },
                  ]),
              {
                id: "etage",
                label: "Etage",
                icon: <IAufklappen />,
                wert: etageFilter || null,
                optionen: etageOptionen,
                gewaehlt: etageFilter || null,
                onWaehlen: setEtageFilter,
                onEntfernen: () => setEtageFilter(""),
              },
            ]}
            sortierung={{
              optionen: (Object.keys(ZIMMER_SORTIERUNG_LABEL) as ZimmerSortierung[]).map((o) => ({ wert: o, label: ZIMMER_SORTIERUNG_LABEL[o] })),
              wert: sortierung,
              onWaehlen: (o) => setSortierung(o as ZimmerSortierung),
            }}
            aktiv={zimmerFilterAktiv}
            exportListe={zimmerExport}
            onZuruecksetzen={() => {
              setStatusFilter("");
              setStandortFilter("");
              setEtageFilter("");
              setSuche("");
            }}
          >
            {standortPille}
            <OptionenFilter
              icon={<IZimmer />}
              label="Status"
              optionen={Object.entries(ZIMMERSTATUS_LABEL).map(([wert, label]) => ({ wert, label }))}
              wert={statusFilter}
              onWaehlen={setStatusFilter}
            />
          </Filterleiste>
          <div className="zv-sub-inline" aria-live="polite" style={{ marginBottom: "var(--zv-space-3)" }}>
            {sichtbareZimmer.length} Zimmer · {ZIMMER_SORTIERUNG_LABEL[sortierung]}
          </div>
          {sichtbareZimmer.length === 0 && <Leerzustand icon={ILeerZimmer}>Keine Zimmer für diese Auswahl.</Leerzustand>}
        </>
      )}

      {Object.entries(gruppen).map(([standortName, raum]) => (
        <div key={standortName} style={{ marginBottom: 28 }}>
          {!einStandort && (
            <div className="zv-seiten-kopf">
              <h2>
                <IStandort style={{ verticalAlign: "-3px", marginRight: 6 }} />
                {standortName}
              </h2>
            </div>
          )}
          {nachEtageGruppieren(raum).map(([etage, raumInEtage]) => (
            <div key={etage} style={{ marginBottom: 20 }}>
              <h3 className="zv-etagen-kopf">{etage}</h3>
              <div className="zv-room-grid">
                {raumInEtage.map((z) => {
                  return (
                  <button
                    key={z.id}
                    type="button"
                    className={`zv-room-card zv-room-card-knopf${ausgewaehltesZimmerId === z.id ? " zv-aktiv" : ""}`}
                    aria-pressed={ausgewaehltesZimmerId === z.id}
                    onClick={() => zimmerOeffnen(z.id)}
                  >
                    <ZimmerKarteInhalt
                      zimmer={z}
                      offeneAufgaben={aufgabenAnzahl[z.id] ?? 0}
                      ueberfaelligeAufgaben={ueberfaelligAnzahl[z.id] ?? 0}
                    />
                  </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}

      {zimmer.length === 0 && !fehler && (
        <Leerzustand icon={ILeerZimmer} aktion={<button type="button" className="zv-btn zv-btn-sekundaer" onClick={formularOeffnen}>Zimmer anlegen</button>}>
          Noch keine Zimmer angelegt.
        </Leerzustand>
      )}

      <Seitenpanel angedockt label="Zimmerdetails" offen={ausgewaehltesZimmer !== null} onSchliessen={panelSchliessen}>
        {ausgewaehltesZimmer &&
          (akteKlientId ? (
            <KlientDetail
              key={akteKlientId}
              klientId={akteKlientId}
              zurueckText={`Zurück zu Zimmer ${ausgewaehltesZimmer.nummer}`}
              onZurueck={() => setAkteKlientId(null)}
            />
          ) : (
            zimmerPanel(ausgewaehltesZimmer)
          ))}
      </Seitenpanel>

      <datalist id="zv-etagen-vorschlaege">
        {etagenVorschlaege.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>

      {formularOffen && (
        <ZimmerAnlegenFenster
          standorte={standorte}
          standortIds={standortIds}
          einStandort={einStandort}
          eingebettet={eingebettet}
          standortAuswahl={standortAuswahl}
          onStandortAuswahl={setStandortAuswahl}
          onSchliessen={() => setFormularOffen(false)}
          onAngelegt={() => {
            setFormularOffen(false);
            ladeZimmer();
            ladeStandorte();
          }}
        />
      )}

      {bearbeitetesZimmer && (
        <ZimmerBearbeitenFenster
          zimmer={bearbeitetesZimmer}
          onSchliessen={() => setBearbeitetesZimmer(null)}
          onGespeichert={() => {
            setBearbeitetesZimmer(null);
            ladeZimmer();
          }}
        />
      )}

      {zuweisungsZimmer && (
        <KlientZuweisenFenster
          zimmer={zuweisungsZimmer}
          wartelistenKlient={wartelistenKlient}
          klienten={klienten}
          onSchliessen={() => {
            setZuweisungsZimmer(null);
            setWartelistenKlient(null);
          }}
          onGespeichert={() => {
            setZuweisungsZimmer(null);
            setWartelistenKlient(null);
            ladeZimmer();
            ladeKlienten();
            ladeVerlauf();
          }}
        />
      )}

      {wartelisteZimmer && (
        <WartelisteFenster
          zimmer={wartelisteZimmer}
          klienten={klienten}
          onSchliessen={() => setWartelisteZimmer(null)}
          onGespeichert={() => {
            setWartelisteZimmer(null);
            ladeZimmer();
          }}
        />
      )}

      {auszugBewohner && (
        <AuszugFenster
          zimmer={auszugBewohner.zimmer}
          bewohner={auszugBewohner.bewohner}
          onSchliessen={() => setAuszugBewohner(null)}
          onGespeichert={() => {
            setAuszugBewohner(null);
            ladeZimmer();
            ladeKlienten();
            ladeVerlauf();
          }}
        />
      )}

      {bearbeiteteBelegung && (
        <BelegungBearbeitenFenster
          belegung={bearbeiteteBelegung}
          onSchliessen={() => setBearbeiteteBelegung(null)}
          onGespeichert={() => {
            setBearbeiteteBelegung(null);
            ladeZimmer();
            ladeKlienten();
            ladeVerlauf();
          }}
        />
      )}

      {kapazitaetZimmer && (
        <KapazitaetFenster
          zimmer={kapazitaetZimmer}
          onSchliessen={() => setKapazitaetZimmer(null)}
          onGespeichert={() => {
            setKapazitaetZimmer(null);
            ladeZimmer();
          }}
        />
      )}

      {kapazitaetAblehnenAntrag && (
        <GrundAbfrage
          titel="Kapazitätsänderung ablehnen"
          label="Grund für die Ablehnung"
          bestaetigenText="Ablehnen"
          onAbbrechen={() => setKapazitaetAblehnenAntrag(null)}
          onBestaetigen={(grund) => {
            kapazitaetEntscheiden(kapazitaetAblehnenAntrag, "abgelehnt", grund);
            setKapazitaetAblehnenAntrag(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Kurzinfo auf der Zimmerkarte. Alle Handlungen sind ins Panel gewandert
 * (Rueckmeldung d5f8252d): die Karte hatte bis zu acht Links und wurde beim
 * Aufklappen der Aufgaben so lang, dass die Nachbarkarten im Raster
 * mitsprangen. Die ganze Karte ist jetzt ein Knopf.
 *
 * Ueberfaellig ist NICHT nur rot (WCAG 1.4.1): eigenes Warn-Icon statt des
 * Aufgaben-Icons und ein ausgeschriebener Text fuer Screenreader.
 */
function ZimmerKarteInhalt({
  zimmer: z,
  offeneAufgaben,
  ueberfaelligeAufgaben,
}: {
  zimmer: ZimmerListEintragDto;
  offeneAufgaben: number;
  ueberfaelligeAufgaben: number;
}) {
  const StatusIcon = STATUS_ICON[z.status];
  const naechsterAuszug = z.bewohner
    .map((b) => b.auszug)
    .filter((a): a is string => Boolean(a))
    .sort()[0];
  const aufgabenText =
    ueberfaelligeAufgaben > 0
      ? `${offeneAufgaben} offene Aufgaben, davon ${ueberfaelligeAufgaben} überfällig`
      : `${offeneAufgaben} offene Aufgaben`;

  return (
    <>
      <span className="zv-room-head">
        <span className="zv-room-nummer">{z.nummer}</span>
        <span className="zv-room-pillen">
          {offeneAufgaben > 0 && (
            <span className={`zv-pill ${ueberfaelligeAufgaben > 0 ? "zv-pill-danger" : "zv-pill-offen"}`} title={aufgabenText}>
              {ueberfaelligeAufgaben > 0 ? <IFehler /> : <IAufgaben />}
              <span aria-hidden="true">{offeneAufgaben}</span>
              <span className="zv-sr-only">{aufgabenText}</span>
            </span>
          )}
          <span className={`zv-pill zv-pill-${z.status}`}>
            <StatusIcon />
            {ZIMMERSTATUS_LABEL[z.status]}
          </span>
        </span>
      </span>
      <span className={`zv-room-namen${z.bewohner.length === 0 ? " zv-room-namen-leer" : ""}`}>
        {z.bewohner.length === 0 ? "Keine Klient:in zugeordnet" : z.bewohner.map((b) => b.name).join(", ")}
      </span>
      <span className="zv-room-fuss">
        <span>
          {z.bewohner.length} / {z.kapazitaet} {z.kapazitaet === 1 ? "Platz belegt" : "Plätze belegt"}
        </span>
        {naechsterAuszug && (
          <span className="zv-pill zv-pill-info">
            <IGeplant />
            Auszug {formatDatum(naechsterAuszug)}
          </span>
        )}
        {z.warteliste.length > 0 && (
          <span className="zv-pill" title={`${z.warteliste.length} auf der Warteliste`}>
            <IWarteliste />
            <span aria-hidden="true">{z.warteliste.length}</span>
            <span className="zv-sr-only">{z.warteliste.length} auf der Warteliste</span>
          </span>
        )}
        {z.offenerKapazitaetsantrag && (
          <span className="zv-pill zv-pill-info">
            <IKapazitaet />
            Antrag offen
          </span>
        )}
      </span>
    </>
  );
}
