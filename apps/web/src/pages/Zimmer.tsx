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
import { Modal } from "../components/Modal";
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
  ILeerVerlauf,
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
import { Datumsfeld, Zeitraumfeld } from "../components/Datumsfeld";

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
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const [bearbeitetesZimmer, setBearbeitetesZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [bearbeitenFehler, setBearbeitenFehler] = useState<string | null>(null);

  const [zuweisungsZimmer, setZuweisungsZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [zuweisungFehler, setZuweisungFehler] = useState<string | null>(null);
  // Gesetzt, wenn "Klient zuweisen" von einer Warteliste aus geoeffnet wurde
  // -- dann ist der Klient schon festgelegt, kein Dropdown noetig.
  const [wartelistenKlient, setWartelistenKlient] = useState<{ id: string; name: string } | null>(null);

  const [wartelisteZimmer, setWartelisteZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [wartelisteFehler, setWartelisteFehler] = useState<string | null>(null);
  const [auszugBewohner, setAuszugBewohner] = useState<{ zimmer: ZimmerListEintragDto; bewohner: ZimmerBewohnerDto } | null>(
    null
  );
  const [auszugFehler, setAuszugFehler] = useState<string | null>(null);

  const [bearbeiteteBelegung, setBearbeiteteBelegung] = useState<BelegungsverlaufEintragDto | null>(null);
  const [belegungBearbeitenFehler, setBelegungBearbeitenFehler] = useState<string | null>(null);

  const [kapazitaetZimmer, setKapazitaetZimmer] = useState<ZimmerListEintragDto | null>(null);
  const [kapazitaetFehler, setKapazitaetFehler] = useState<string | null>(null);
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
      let zielStandortId = standortAuswahl;
      if (zielStandortId === NEUER_STANDORT) {
        const name = String(form.get("standortName") ?? "").trim();
        const neuerStandort = await api.standortAnlegen({
          name,
          strasse: String(form.get("standortStrasse") ?? "").trim(),
          plz: String(form.get("standortPlz") ?? "").trim() || null,
          ort: String(form.get("standortOrt") ?? "").trim() || null,
        });
        zielStandortId = neuerStandort.id;
      }
      const anschrift = String(form.get("anschrift") ?? "").trim();
      await api.zimmerAnlegen({
        standortId: zielStandortId,
        nummer,
        etage: etage || undefined,
        kapazitaet,
        anschrift: anschrift || null,
      });
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
        anschrift: String(form.get("anschrift") ?? "").trim() || null,
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
      if (ausgewaehltesZimmerId === zimmerId) panelSchliessen();
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
        klientId: wartelistenKlient?.id ?? String(form.get("klientId")),
        einzug: String(form.get("einzug")),
      });
      setZuweisungsZimmer(null);
      setWartelistenKlient(null);
      ladeZimmer();
      ladeKlienten();
      ladeVerlauf();
    } catch (err) {
      setZuweisungFehler(err instanceof Error ? err.message : "Klient:in konnte nicht zugewiesen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function wartelisteHinzufuegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!wartelisteZimmer) return;
    const form = new FormData(e.currentTarget);
    setWartelisteFehler(null);
    setWirdGespeichert(true);
    try {
      await api.zimmerWartelisteHinzufuegen(wartelisteZimmer.id, String(form.get("klientId")));
      setWartelisteZimmer(null);
      ladeZimmer();
    } catch (err) {
      setWartelisteFehler(err instanceof Error ? err.message : "Klient:in konnte nicht auf die Warteliste gesetzt werden.");
    } finally {
      setWirdGespeichert(false);
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
      ladeVerlauf();
    } catch (err) {
      setAuszugFehler(err instanceof Error ? err.message : "Auszug konnte nicht eingetragen werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function belegungBearbeiten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bearbeiteteBelegung) return;
    const form = new FormData(e.currentTarget);
    setBelegungBearbeitenFehler(null);
    setWirdGespeichert(true);
    try {
      const auszug = String(form.get("auszug"));
      await api.belegungBearbeiten(bearbeiteteBelegung.id, {
        einzug: String(form.get("einzug")),
        auszug: auszug === "" ? null : auszug,
      });
      setBearbeiteteBelegung(null);
      ladeZimmer();
      ladeKlienten();
      ladeVerlauf();
    } catch (err) {
      setBelegungBearbeitenFehler(err instanceof Error ? err.message : "Belegung konnte nicht geändert werden.");
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
                onClick={() => {
                  setBearbeitenFehler(null);
                  setBearbeitetesZimmer(z);
                }}
              >
                <IBearbeiten />
                Zimmer bearbeiten
              </button>
              {!antrag && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setKapazitaetFehler(null);
                    setKapazitaetZimmer(z);
                  }}
                >
                  <IKapazitaet />
                  Kapazität ändern
                </button>
              )}
              {frei && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setZuweisungFehler(null);
                    setZuweisungsZimmer(z);
                  }}
                >
                  <IEinziehen />
                  Klient:in zuweisen
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWartelisteFehler(null);
                  setWartelisteZimmer(z);
                }}
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
                  onClick={() => {
                    setZuweisungFehler(null);
                    setZuweisungsZimmer(z);
                  }}
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
                        onClick={() => {
                          setAuszugFehler(null);
                          setAuszugBewohner({ zimmer: z, bewohner: bew });
                        }}
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
                onClick={() => {
                  setWartelisteFehler(null);
                  setWartelisteZimmer(z);
                }}
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
                          setZuweisungFehler(null);
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
                        onClick={() => {
                          setBelegungBearbeitenFehler(null);
                          setBearbeiteteBelegung(v);
                        }}
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
                  const StatusIcon = STATUS_ICON[z.status];
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
        <Modal titel="Neues Zimmer" onClose={() => setFormularOffen(false)}>
          <form onSubmit={zimmerAnlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}

            {!einStandort && (
              <>
            <div className="zv-field">
              <label htmlFor="zimmer-standort">Standort</label>
              <select
                id="zimmer-standort"
                value={standortAuswahl}
                onChange={(e) => setStandortAuswahl(e.target.value)}
              >
                {standorte
                  .filter((s) => s.aktiv && (!standortIds || standortIds.includes(s.id)))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                {!eingebettet && <option value={NEUER_STANDORT}>+ Neuen Standort anlegen…</option>}
              </select>
            </div>

            {standortAuswahl === NEUER_STANDORT && (
              <>
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-name">Name des Standorts</label>
                  <input id="zimmer-standort-name" name="standortName" placeholder="z. B. Wohnheim Nordstraße" required autoFocus />
                </div>
                <div className="zv-field">
                  <label htmlFor="zimmer-standort-strasse">Straße und Hausnummer</label>
                  <input id="zimmer-standort-strasse" name="standortStrasse" autoComplete="street-address" required />
                </div>
                <div className="zv-field-row">
                  <div className="zv-field">
                    <label htmlFor="zimmer-standort-plz">PLZ</label>
                    <input id="zimmer-standort-plz" name="standortPlz" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required />
                  </div>
                  <div className="zv-field">
                    <label htmlFor="zimmer-standort-ort">Ort</label>
                    <input id="zimmer-standort-ort" name="standortOrt" required />
                  </div>
                </div>
              </>
            )}
              </>
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

            <ZimmerAnschriftFeld id="zimmer-anschrift" />

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
            <ZimmerAnschriftFeld id="zimmer-bearbeiten-anschrift" vorgabe={bearbeitetesZimmer.anschrift} />
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
        <Modal
          titel={`Klient zuweisen — Zimmer ${zuweisungsZimmer.nummer}`}
          onClose={() => {
            setZuweisungsZimmer(null);
            setWartelistenKlient(null);
          }}
        >
          <form onSubmit={klientZuweisen}>
            {zuweisungFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {zuweisungFehler}
              </div>
            )}
            {wartelistenKlient ? (
              <div className="zv-field">
                <label>Klient:in</label>
                <p className="zv-sub" style={{ margin: 0 }}>
                  {wartelistenKlient.name} (von der Warteliste)
                </p>
              </div>
            ) : (
              <div className="zv-field">
                <label htmlFor="zuweisung-klient">Klient:in</label>
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
                  <span className="zv-sub-inline">Alle Klient:innen haben bereits ein Zimmer.</span>
                )}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="zuweisung-einzug">Einzugsdatum</label>
              <Datumsfeld id="zuweisung-einzug" name="einzug" required defaultValue={heuteBerlin()} schnellwahl="heute" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IEinziehen />
              {wirdGespeichert ? "Speichert…" : "Einziehen"}
            </button>
          </form>
        </Modal>
      )}

      {wartelisteZimmer && (
        <Modal
          titel={`Zur Warteliste — Zimmer ${wartelisteZimmer.nummer}`}
          onClose={() => setWartelisteZimmer(null)}
        >
          <form onSubmit={wartelisteHinzufuegen}>
            {wartelisteFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {wartelisteFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="warteliste-klient">Klient:in</label>
              <select id="warteliste-klient" name="klientId" required autoFocus defaultValue="">
                <option value="" disabled>
                  Bitte wählen
                </option>
                {klienten
                  .filter(
                    (k) =>
                      k.aktuellesZimmer?.id !== wartelisteZimmer.id &&
                      !wartelisteZimmer.warteliste.some((w) => w.klientId === k.id)
                  )
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.vorname} {k.nachname}
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
              <Datumsfeld id="auszug-datum" name="auszug" required autoFocus defaultValue={heuteBerlin()} schnellwahl="heute" />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert}>
              <IAuszug />
              {wirdGespeichert ? "Speichert…" : "Auszug speichern"}
            </button>
          </form>
        </Modal>
      )}

      {bearbeiteteBelegung && (
        <Modal titel={`Belegung bearbeiten — ${bearbeiteteBelegung.name}`} onClose={() => setBearbeiteteBelegung(null)}>
          <form onSubmit={belegungBearbeiten}>
            {belegungBearbeitenFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {belegungBearbeitenFehler}
              </div>
            )}
            <p className="zv-sub" style={{ margin: "0 0 12px" }}>
              Nutzen, wenn sich ein Einzug oder Auszug verzögert oder sich geändert hat.
            </p>
            <div className="zv-field-row">
              <Zeitraumfeld
                von={{ id: "belegung-bearbeiten-einzug", name: "einzug", label: "Einzugsdatum", required: true }}
                bis={{ id: "belegung-bearbeiten-auszug", name: "auszug", label: "Auszugsdatum (optional)" }}
                defaultVon={bearbeiteteBelegung.einzug}
                defaultBis={bearbeiteteBelegung.auszug ?? ""}
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
 * Eigene Wohnanschrift einer Wohnung (Einzelwohnen, Migration 0079): dort
 * ist der Standort das Buero, die Klient:innen wohnen verstreut. Jede
 * Wohnung bleibt ein Zimmer, damit Belegung, Plaetze und Raumplan
 * unveraendert funktionieren -- nur die Anschrift kommt dazu.
 */
function ZimmerAnschriftFeld({ id, vorgabe }: { id: string; vorgabe?: string | null }) {
  return (
    <div className="zv-field">
      <label htmlFor={id}>Eigene Wohnanschrift (optional)</label>
      <input id={id} name="anschrift" defaultValue={vorgabe ?? ""} placeholder="Straße Nr., PLZ Ort" aria-describedby={`${id}-hinweis`} />
      <p id={`${id}-hinweis`} className="zv-sub">
        Nur wenn die Wohnung nicht unter der Anschrift des Standorts liegt, etwa im Einzelwohnen.
      </p>
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
