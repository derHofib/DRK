import { CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import { formatBelegnummer } from "@zimmerakte/shared";
import type {
  BenutzerListEintragDto,
  KassenbuchungDto,
  KassenbuchungTypDto,
  KlientListEintragDto,
  StandortDto,
  WochenuebersichtEintragDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { einreihen, entfernen, senden, useWarteschlange } from "../offline/warteschlange";
import { GrundAbfrage } from "../components/GrundAbfrage";
import { KassenbuchJournal, laufsalden, neuesterZuerst } from "../components/KassenbuchJournal";
import { Leerzustand } from "../components/Leerzustand";
import { StandortReiter } from "../components/StandortReiter";
import { Modal } from "../components/Modal";
import {
  IAblehnen,
  IAuszahlen,
  IFehler,
  IGenehmigen,
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
  ISperre,
  IStandort,
  IStornieren,
  IUnterschrift,
  IVor,
  IZurueckPfeil,
} from "../components/icons";
import { SignaturePad } from "../components/SignaturePad";
import type { UebergabeStart } from "./HzlUebergabe";
import { formatBetrag, formatDatum, kontextzeile } from "../format";

type JournalFilter = "alle" | "einnahmen" | "ausgaben" | "stornos";
const JOURNAL_FILTER_LABEL: Record<JournalFilter, string> = {
  alle: "Alle",
  einnahmen: "Einnahmen",
  ausgaben: "Ausgaben",
  stornos: "Stornos",
};

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

/**
 * "buchungen": die Buchungslisten. "hzl": die HZL-Wochenuebersicht -- ein
 * eigener Menue-Unterpunkt unter Kassenbuch (siehe navigation.ts), damit das
 * Kassenbuch selbst nur Buchungen zeigt. Beide teilen sich Formular, Daten
 * und den Standort-Filter, deshalb eine Komponente statt zwei.
 */
export function Kassenbuch({
  ansicht = "buchungen",
  onUebergabeStarten,
  startFilterKlientId,
  startNeueBuchung,
}: {
  ansicht?: "buchungen" | "hzl";
  onUebergabeStarten?: (start: UebergabeStart) => void;
  /** Aus der Befehlspalette: Liste auf diese Person eingrenzen. */
  startFilterKlientId?: string;
  /** Aus der Befehlspalette: das Buchungsformular sofort oeffnen. */
  startNeueBuchung?: boolean;
}) {
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [standorte, setStandorte] = useState<StandortDto[]>([]);
  const [mitarbeitende, setMitarbeitende] = useState<BenutzerListEintragDto[]>([]);
  const [typen, setTypen] = useState<KassenbuchungTypDto[]>([]);
  const [buchungen, setBuchungen] = useState<KassenbuchungDto[]>([]);
  const [filterKlientId, setFilterKlientId] = useState(startFilterKlientId ?? "");
  const [journalFilter, setJournalFilter] = useState<JournalFilter>("alle");
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
  const [typId, setTypId] = useState("");
  const [unterschrift, setUnterschrift] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  // Kommt eine wartende Buchung an (Warteschlange wird kuerzer), Liste und
  // Wochenuebersicht nachladen -- sonst fehlte sie hier bis zum naechsten
  // Seitenwechsel.
  const warteschlange = useWarteschlange();
  const wartendAnzahl = warteschlange.filter((e) => e.status === "wartet").length;
  const vorherWartend = useRef(wartendAnzahl);
  useEffect(() => {
    if (wartendAnzahl < vorherWartend.current) {
      ladeBuchungen();
      ladeUebersicht(uebersichtJahr, uebersichtWoche);
    }
    vorherWartend.current = wartendAnzahl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wartendAnzahl]);

  const [offeneUnterschrift, setOffeneUnterschrift] = useState<{ buchungId: string; url: string } | null>(null);
  const [stornoBeantragenBuchung, setStornoBeantragenBuchung] = useState<KassenbuchungDto | null>(null);
  const [stornoAblehnenBuchung, setStornoAblehnenBuchung] = useState<KassenbuchungDto | null>(null);

  // Der Standort-Filter oben wirkt serverseitig (GET /kassenbuchungen
  // ?standortId=) -- dort gilt zusaetzlich die Standort-Zuordnung der
  // angemeldeten Person; die Auswahl unten enthaelt ohnehin nur eigene
  // Standorte (api.standorteListe()).
  function ladeBuchungen(standortId: string = filterStandortId) {
    if (ansicht === "hzl") return;
    api
      .kassenbuchungenListe(standortId ? { standortId } : undefined)
      .then(setBuchungen)
      .catch((err) => setFehler(err.message));
  }

  function ladeUebersicht(jahr: number, woche: number, standortId: string = filterStandortId) {
    if (ansicht !== "hzl") return;
    api
      .wochenuebersicht(jahr, woche, standortId || undefined)
      .then(setUebersicht)
      .catch((err) => setFehler(err.message));
  }

  useEffect(() => {
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
    api.standorteListe().then(setStandorte).catch((err) => setFehler(err.message));
    api.benutzerListe().then(setMitarbeitende).catch((err) => setFehler(err.message));
    api.kassenbuchungTypenListe().then(setTypen).catch((err) => setFehler(err.message));
  }, []);

  useEffect(() => {
    ladeBuchungen(filterStandortId);
    ladeUebersicht(uebersichtJahr, uebersichtWoche, filterStandortId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStandortId]);

  // Der HZL-Systemtyp (kassenbuchung_typ.ist_hzl) ist der Standard beim
  // Oeffnen des Formulars fuer eine Klienten-Buchung -- entspricht dem
  // frueheren festen Default "hzl". Faellt auf den ersten aktiven Typ
  // zurueck, falls die Liste noch nicht geladen ist.
  function standardTypId(): string {
    return typen.find((t) => t.istHzl)?.id ?? typen.find((t) => t.aktiv)?.id ?? "";
  }

  const gewaehlterTyp = typen.find((t) => t.id === typId);
  const istHzlTyp = gewaehlterTyp?.istHzl ?? false;
  const kommentarPflicht = gewaehlterTyp?.kommentarPflicht ?? true;
  const typenFuerZiel = typen.filter((t) => t.aktiv && (ziel === "klient" || !t.istHzl));

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

  // Vorab-Pruefung, damit niemand erst nach der Unterschrift erfaehrt, dass
  // die Buchung am fehlenden Recht scheitert (der Server prueft trotzdem).
  const [uebergabePruefung, setUebergabePruefung] = useState(false);
  async function uebergabeStarten(klientIds: string[]) {
    if (!onUebergabeStarten || klientIds.length === 0) return;
    setUebergabePruefung(true);
    setFehler(null);
    try {
      const { darf } = await api.kassenbuchDarfBuchen();
      if (!darf) {
        setFehler("Mit diesem Konto dürfen keine Kassenbuchungen erfasst werden – die Übergabe wurde nicht gestartet.");
        return;
      }
      onUebergabeStarten({ jahr: uebersichtJahr, woche: uebersichtWoche, standortId: filterStandortId || null, klientIds });
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Die Berechtigung konnte nicht geprüft werden.");
    } finally {
      setUebergabePruefung(false);
    }
  }

  function neueBuchungOeffnen() {
    setVorbelegung(null);
    setZiel("klient");
    setFormStandortId("");
    setTypId(standardTypId());
    setRichtung("einzahlung");
    setUnterschrift(null);
    setFormFehler(null);
    setFormularOffen(true);
  }

  // Aus der Befehlspalette: erst oeffnen, wenn die Buchungstypen da sind --
  // sonst bliebe der vorbelegte Typ leer.
  const startFormularErledigt = useRef(false);
  useEffect(() => {
    if (startNeueBuchung && !startFormularErledigt.current && typen.length > 0) {
      startFormularErledigt.current = true;
      neueBuchungOeffnen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNeueBuchung, typen]);

  function formularOeffnenFuer(klientId: string) {
    setVorbelegung({ klientId, isoJahr: uebersichtJahr, isoWoche: uebersichtWoche });
    setZiel("klient");
    setFormStandortId("");
    setTypId(standardTypId());
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
    if (neu === "standort" && istHzlTyp) {
      setTypId(typen.find((t) => t.aktiv && !t.istHzl)?.id ?? "");
    }
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
      // Erst einreihen, dann senden -- auch mit Verbindung. Reisst sie
      // mitten in der Anfrage ab, bleibt der Eintrag liegen und wird mit
      // demselben Schluessel erneut gesendet (offline/warteschlange.ts).
      const eintrag = einreihen({
        klientId: ziel === "klient" ? String(form.get("klientId")) : undefined,
        standortId: ziel === "standort" ? String(form.get("standortId")) : undefined,
        datum: String(form.get("datum")),
        betragCent,
        verwendungszweck: String(form.get("verwendungszweck") ?? ""),
        typId,
        isoJahr: istHzlTyp ? Number(form.get("isoJahr")) : undefined,
        isoWoche: istHzlTyp ? Number(form.get("isoWoche")) : undefined,
        unterschriftBase64: unterschrift ?? undefined,
        teilnehmerKlientIds: ziel === "standort" ? form.getAll("teilnehmerKlientIds").map(String) : undefined,
        teilnehmerBenutzerIds: ziel === "standort" ? form.getAll("teilnehmerBenutzerIds").map(String) : undefined,
      });
      const { ergebnis, fehler: sendeFehler } = await senden(eintrag);
      if (ergebnis === "abgelehnt") {
        // Das Formular ist noch offen: die Person korrigiert hier, statt den
        // Eintrag spaeter in der Warteschlange zu finden.
        entfernen(eintrag.schluessel);
        setFormFehler(sendeFehler instanceof Error ? sendeFehler.message : "Buchung konnte nicht gespeichert werden.");
        return;
      }
      setFormularOffen(false);
      setVorbelegung(null);
      setUnterschrift(null);
      // "wartet": kein Nachladen -- ohne Netz schluege es nur mit einer
      // Fehlermeldung fehl. Die Warteschlangen-Leiste der Shell zeigt den
      // Eintrag, der Effekt oben laedt nach, sobald er angekommen ist.
      if (ergebnis === "gebucht") {
        ladeBuchungen();
        ladeUebersicht(uebersichtJahr, uebersichtWoche);
      }
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Buchung konnte nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  // Wer selbst entscheiden darf (siehe darfStornoEntscheiden), bewilligt sich
  // damit im selben Zug -- der Server macht daraus sofort einen Storno (siehe
  // stornoBeantragen() in kassenbuchung.service.ts). Fuer alle anderen bleibt
  // es ein Antrag, der erst nach Bewilligung wirkt. Der Grund kommt ueber das
  // GrundAbfrage-Modal weiter unten, nicht mehr per window.prompt() -- das
  // wird in installierten PWAs (v.a. iOS Standalone) haeufig unterdrueckt.
  async function stornoBeantragen(buchung: KassenbuchungDto, grund: string) {
    try {
      await api.kassenbuchungStornoBeantragen(buchung.id, grund);
      ladeBuchungen();
      ladeUebersicht(uebersichtJahr, uebersichtWoche);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Storno-Antrag konnte nicht gestellt werden.");
    }
  }

  async function stornoEntscheiden(buchung: KassenbuchungDto, entscheidung: "genehmigt" | "abgelehnt", grund?: string) {
    if (!buchung.offenerStornoantrag) return;
    try {
      await api.kassenbuchungStornoEntscheiden(buchung.offenerStornoantrag.id, entscheidung, grund);
      ladeBuchungen();
      ladeUebersicht(uebersichtJahr, uebersichtWoche);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Storno-Antrag konnte nicht entschieden werden.");
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

  const aktiveStandortGesamt = aktive(standortBuchungen);
  const standortGesamtsaldo = summeCent(aktiveStandortGesamt);

  // Journal: laufender Saldo ueber die ungefilterte Menge, Filter wirken nur
  // auf die Anzeige (siehe laufsalden()). "Stornos" zeigt auch Buchungen mit
  // offenem Antrag -- die sind auf dem Weg dorthin und sonst nirgends gebuendelt.
  const klientSalden = laufsalden(klientBuchungen);
  const standortSalden = laufsalden(standortBuchungen);
  const zeigeKlientJournal = neuesterZuerst(
    gefilterteBuchungen.filter((b) =>
      journalFilter === "alle"
        ? true
        : journalFilter === "einnahmen"
          ? b.betragCent > 0 && !b.storniert
          : journalFilter === "ausgaben"
            ? b.betragCent < 0 && !b.storniert
            : b.storniert || b.offenerStornoantrag !== null,
    ),
  );

  function unterschriftBild(b: KassenbuchungDto) {
    return offeneUnterschrift?.buchungId === b.id ? (
      <img src={offeneUnterschrift.url} alt="Unterschrift" style={{ maxHeight: 100, display: "block" }} />
    ) : null;
  }

  function zeilenAktionen(b: KassenbuchungDto) {
    return (
      <>
        {b.hatUnterschrift && (
          <button className="zv-link-btn" onClick={() => unterschriftAnzeigen(b.id)}>
            <IUnterschrift />
            Unterschrift
          </button>
        )}
        {!b.storniert && !b.offenerStornoantrag && (
          <button className="zv-link-btn" onClick={() => setStornoBeantragenBuchung(b)}>
            <IStornieren />
            Storno beantragen
          </button>
        )}
        {b.offenerStornoantrag && (
          <>
            <button className="zv-link-btn" onClick={() => stornoEntscheiden(b, "genehmigt")}>
              <IGenehmigen />
              Genehmigen
            </button>
            <button className="zv-link-btn" onClick={() => setStornoAblehnenBuchung(b)}>
              <IAblehnen />
              Ablehnen
            </button>
          </>
        )}
      </>
    );
  }

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
          <p className="zv-kontextzeile">{kontextzeile()}</p>
          <h2>{ansicht === "hzl" ? "HZL" : "Kassenbuch"}</h2>
          <p className="zv-sub" style={{ margin: "2px 0 0" }}>
            {(() => {
              const standortName = filterStandortId
                ? standorte.find((s) => s.id === filterStandortId)?.name
                : standorte.length === 1
                  ? standorte[0].name
                  : undefined;
              if (ansicht === "hzl") {
                return standortName
                  ? `Wöchentliche Auszahlungen am Standort ${standortName}`
                  : "Wöchentliche Auszahlungen (Hilfe zum Lebensunterhalt)";
              }
              return standortName ? `Buchungen am Standort ${standortName}` : "Alle Buchungen aller Klienten";
            })()}
          </p>
        </div>
        {ansicht === "buchungen" && (
        <button
          className="zv-btn"
          onClick={neueBuchungOeffnen}
        >
          <INeu />
          Neue Buchung
        </button>
        )}
      </div>

      <StandortReiter
        eintraege={[{ id: null, label: "Alle Standorte" }, ...standorte.map((st) => ({ id: st.id, label: st.name }))]}
        aktiv={filterStandortId || null}
        onWaehle={(id) => setFilterStandortId(id ?? "")}
      />

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
                <label htmlFor="kassenbuch-typ">Typ</label>
                <select id="kassenbuch-typ" name="typId" value={typId} onChange={(e) => setTypId(e.target.value)}>
                  {typenFuerZiel.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.bezeichnung}
                    </option>
                  ))}
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

            {istHzlTyp && ziel === "klient" && (
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
                <label htmlFor="kassenbuch-verwendungszweck">
                  {kommentarPflicht ? "Verwendungszweck" : "Kommentar"}
                </label>
                <input id="kassenbuch-verwendungszweck" name="verwendungszweck" required={kommentarPflicht} />
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

      {ansicht === "hzl" && (
      <section className="zv-hzl-flaeche" aria-label="HZL-Woche">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <h3 className="zv-abschnittstitel">KW {uebersichtWoche}</h3>
            {uebersicht.length > 0 && (
              <>
                <p className="zv-hzl-fortschritt-text">
                  <span className="zv-mono">{bezahltAnzahl}</span> von <span className="zv-mono">{uebersicht.length}</span>{" "}
                  ausgezahlt
                </p>
                <div
                  className="zv-laufzeit zv-hzl-balken"
                  role="img"
                  aria-label={`${bezahltAnzahl} von ${uebersicht.length} ausgezahlt`}
                >
                  <div style={{ width: `${(bezahltAnzahl / uebersicht.length) * 100}%` }} />
                </div>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            {uebersicht.some((e) => !e.bezahlt) && (
              <button
                type="button"
                className="zv-btn zv-btn-sekundaer"
                disabled={uebergabePruefung}
                onClick={() => void uebergabeStarten(uebersicht.filter((e) => !e.bezahlt).map((e) => e.klientId))}
              >
                <IUnterschrift />
                Alle offenen nacheinander
              </button>
            )}
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
          <div className="zv-journal-wrapper" role="region" aria-label="HZL-Auszahlungen der Woche" tabIndex={0}>
            <table className="zv-journal">
              <thead>
                <tr>
                  <th>Klient:in</th>
                  <th>Status</th>
                  <th className="zv-journal-zahl">Betrag</th>
                  <th>
                    <span className="zv-sr-only">Aktion</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {uebersicht.map((e) => (
                  <tr key={e.klientId}>
                    <td>{e.klientName}</td>
                    <td>
                      <span className={`zv-pill ${e.bezahlt ? "zv-pill-ok" : "zv-pill-achtung"}`}>
                        {e.bezahlt ? <ISErledigt /> : <ISOffen />}
                        {e.bezahlt ? "Ausgezahlt" : "Offen"}
                      </span>
                      {e.bezahlt && e.datum && <span className="zv-todo-meta"> am {formatDatum(e.datum)}</span>}
                    </td>
                    <td className="zv-journal-zahl zv-mono">
                      {e.bezahlt && e.betragCent !== null ? formatBetrag(e.betragCent) : ""}
                    </td>
                    <td className="zv-journal-aktionen">
                      {!e.bezahlt && (
                        <>
                          <button
                            type="button"
                            className="zv-btn zv-btn-klein"
                            disabled={uebergabePruefung}
                            onClick={() => void uebergabeStarten([e.klientId])}
                          >
                            <IUnterschrift />
                            Auszahlen + unterschreiben
                          </button>
                          <button type="button" className="zv-link-btn" onClick={() => formularOeffnenFuer(e.klientId)}>
                            <IAuszahlen />
                            Manuell buchen
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {ansicht === "buchungen" && (
      <>
      <section className="zv-kassenstand" aria-label="Kassenstand">
        <div>
          <p className="zv-lage-label">Kassenstand</p>
          <p className="zv-kassenstand-wert zv-mono">{formatBetrag(gesamtsaldo)}</p>
          <p className="zv-lage-folge">{aktiveGesamt.length} Buchungen, ohne stornierte</p>
        </div>
        <div>
          <p className="zv-lage-label">Standort-Kasse</p>
          <p className="zv-kassenstand-wert zv-kassenstand-klein zv-mono">{formatBetrag(standortGesamtsaldo)}</p>
          <p className="zv-lage-folge">{aktiveStandortGesamt.length} Buchungen</p>
        </div>
      </section>

      <div className="zv-journal-werkzeug">
        <div className="zv-segmented" role="group" aria-label="Art der Buchung">
          {(Object.keys(JOURNAL_FILTER_LABEL) as JournalFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={journalFilter === f ? "active" : ""}
              aria-pressed={journalFilter === f}
              onClick={() => setJournalFilter(f)}
            >
              {JOURNAL_FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="zv-field" style={{ maxWidth: 260, margin: 0 }}>
          <select aria-label="Nach Klient:in filtern" value={filterKlientId} onChange={(e) => setFilterKlientId(e.target.value)}>
            <option value="">Alle Klient:innen</option>
            {klienten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.vorname} {k.nachname}
              </option>
            ))}
          </select>
        </div>
      </div>

      {zeigeKlientJournal.length === 0 ? (
        <Leerzustand
          icon={ILeerKassenbuch}
          aktion={
            klientBuchungen.length === 0 ? (
              <button type="button" className="zv-btn zv-btn-sekundaer" onClick={neueBuchungOeffnen}>
                Erste Buchung anlegen
              </button>
            ) : undefined
          }
        >
          {klientBuchungen.length === 0 ? "Noch keine Buchungen erfasst." : "Keine Buchung passt zu diesem Filter."}
        </Leerzustand>
      ) : (
        <KassenbuchJournal
          buchungen={zeigeKlientJournal}
          salden={klientSalden}
          bezugLabel="Klient:in"
          bezug={(b) => b.klientName}
          zusatz={(b) =>
            [b.typBezeichnung + (b.isoJahr && b.isoWoche ? ` · KW ${b.isoWoche}` : ""), b.gebuchtVonName]
              .filter(Boolean)
              .join(" · ")
          }
          aktionen={zeilenAktionen}
          unterschrift={unterschriftBild}
        />
      )}
      <p className="zv-journal-hinweis">
        <ISperre />
        Buchungen sind unveränderlich. Korrekturen nur per Storno.
      </p>

      <div className="zv-seiten-kopf" style={{ marginTop: "var(--zv-space-6)" }}>
        <div>
          <h3 className="zv-abschnittstitel">Standort-Buchungen</h3>
          <p className="zv-sub" style={{ margin: "2px 0 0" }}>
            Spaßgeld für Freizeitveranstaltungen und Ähnliches — dem Haus zugeordnet, nicht einzelnen Klient:innen.
          </p>
        </div>
      </div>

      {standortBuchungen.length === 0 ? (
        <Leerzustand icon={ILeerStandorte}>Noch keine Standort-Buchungen erfasst.</Leerzustand>
      ) : (
        <KassenbuchJournal
          buchungen={neuesterZuerst(standortBuchungen)}
          salden={standortSalden}
          bezugLabel="Standort"
          bezug={(b) => b.standortName}
          zusatz={(b) =>
            [
              b.typBezeichnung,
              b.gebuchtVonName,
              b.teilnehmer.length > 0
                ? b.teilnehmer.length === 1
                  ? b.teilnehmer[0].name
                  : `${b.teilnehmer.length} Teilnehmende`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
          aktionen={zeilenAktionen}
          unterschrift={unterschriftBild}
        />
      )}
      </>
      )}

      {stornoBeantragenBuchung && (
        <GrundAbfrage
          titel="Storno beantragen"
          label={`Grund für den Storno-Antrag zu „${stornoBeantragenBuchung.verwendungszweck}"`}
          bestaetigenText="Storno beantragen"
          onAbbrechen={() => setStornoBeantragenBuchung(null)}
          onBestaetigen={(grund) => {
            stornoBeantragen(stornoBeantragenBuchung, grund);
            setStornoBeantragenBuchung(null);
          }}
        />
      )}

      {stornoAblehnenBuchung && (
        <GrundAbfrage
          titel="Storno-Antrag ablehnen"
          label="Grund für die Ablehnung"
          bestaetigenText="Ablehnen"
          onAbbrechen={() => setStornoAblehnenBuchung(null)}
          onBestaetigen={(grund) => {
            stornoEntscheiden(stornoAblehnenBuchung, "abgelehnt", grund);
            setStornoAblehnenBuchung(null);
          }}
        />
      )}
    </div>
  );
}
