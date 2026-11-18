import type { FormularDefinition } from "@zimmerakte/shared";

/**
 * Beispielformulare fuer die Tests (frueher die mitgelieferte
 * Vorlagenbibliothek). Die Vorlagen sind mit der Rueckmeldung „Formulare"
 * (18.11.2026: „ich brauche keine Vorlagen") aus der Anwendung entfallen;
 * als realistische, vollstaendig ausgefuellte Definitionen mit Abschnitten,
 * Logik, Berechnung und Vorausfuellung bleiben sie die Testgrundlage. Die
 * Tests legen sie ueber den Editor-Weg an (anlegen, Entwurf speichern,
 * veroeffentlichen).
 */
export interface FormularVorlage {
  schluessel: string;
  name: string;
  beschreibung: string;
  definition: FormularDefinition;
}

const KOPF_KLIENT = {
  typ: "abschnitt" as const,
  schluessel: "kopf",
  beschriftung: "Klient:in",
  kinder: [
    { typ: "anzeige" as const, schluessel: "klient_name", beschriftung: "Name", quelle: "klient.name" as const },
    { typ: "anzeige" as const, schluessel: "klient_geburtsdatum", beschriftung: "Geburtsdatum", quelle: "klient.geburtsdatum" as const },
    { typ: "anzeige" as const, schluessel: "klient_aktenzeichen", beschriftung: "Aktenzeichen", quelle: "klient.aktenzeichen" as const },
  ],
};

export const FORMULAR_VORLAGEN: readonly FormularVorlage[] = [
  {
    schluessel: "tagesbericht",
    name: "Tagesbericht",
    beschreibung: "Strukturierter Tagesbericht: Befinden, Tagesstruktur, Termine und Besonderheiten.",
    definition: {
      bezugsdatumFeld: "datum",
      bausteine: [
        KOPF_KLIENT,
        {
          typ: "abschnitt",
          schluessel: "rahmen",
          beschriftung: "Rahmen",
          kinder: [
            { typ: "datum", schluessel: "datum", beschriftung: "Datum", pflicht: true, nichtInZukunft: true, vorausfuellen: { quelle: "zeit.heute", art: "vorschlag" } },
            { typ: "kurztext", schluessel: "wohnung", beschriftung: "Wohnung", vorausfuellen: { quelle: "belegung.wohnung", art: "festgehalten" } },
            { typ: "kurztext", schluessel: "bezugsbetreuung", beschriftung: "Bezugsbetreuung", vorausfuellen: { quelle: "klient.bezugsbetreuung", art: "festgehalten" } },
          ],
        },
        {
          typ: "abschnitt",
          schluessel: "befinden",
          beschriftung: "Befinden",
          kinder: [
            { typ: "skala", schluessel: "stimmung", beschriftung: "Stimmung", min: 1, max: 5, labelMin: "sehr schlecht", labelMax: "sehr gut", pflicht: true },
            {
              typ: "auswahl",
              schluessel: "tagesstruktur",
              beschriftung: "Tagesstruktur eingehalten?",
              pflicht: true,
              optionen: [
                { wert: "ja", label: "ja" },
                { wert: "teilweise", label: "teilweise" },
                { wert: "nein", label: "nein" },
              ],
            },
            {
              typ: "langtext",
              schluessel: "tagesstruktur_grund",
              beschriftung: "Was ist nicht gelungen?",
              sichtbarWenn: { feld: "tagesstruktur", op: "eine_von", wert: ["teilweise", "nein"] },
              pflicht: true,
            },
            {
              typ: "mehrfachauswahl",
              schluessel: "termine",
              beschriftung: "Wahrgenommene Termine",
              optionen: [
                { wert: "arzt", label: "Arzt / Therapie" },
                { wert: "amt", label: "Amt / Jobcenter" },
                { wert: "schule", label: "Schule / Ausbildung / Arbeit" },
                { wert: "sonstiges", label: "Sonstiges" },
              ],
            },
          ],
        },
        { typ: "langtext", schluessel: "bericht", beschriftung: "Bericht", pflicht: true, hilfetext: "Was ist heute passiert? Absprachen, Beobachtungen, Gespräche." },
        { typ: "langtext", schluessel: "intern_notiz", beschriftung: "Interne Notiz an das Team", intern: true },
      ],
    },
  },
  {
    schluessel: "nachtdienst",
    name: "Nachtdienstprotokoll",
    beschreibung: "Verlauf der Nacht, Vorfälle mit Uhrzeiten und Meldung an die Leitung.",
    definition: {
      bezugsdatumFeld: "datum",
      bausteine: [
        KOPF_KLIENT,
        {
          typ: "abschnitt",
          schluessel: "rahmen",
          beschriftung: "Dienst",
          kinder: [
            { typ: "datum", schluessel: "datum", beschriftung: "Nacht vom", pflicht: true, nichtInZukunft: true, vorausfuellen: { quelle: "zeit.heute", art: "vorschlag" } },
            { typ: "kurztext", schluessel: "wohnung", beschriftung: "Wohnung", vorausfuellen: { quelle: "belegung.wohnung", art: "festgehalten" } },
            { typ: "mitarbeitende", schluessel: "anwesend", beschriftung: "Im Dienst", pflicht: true },
          ],
        },
        {
          typ: "abschnitt",
          schluessel: "verlauf",
          beschriftung: "Verlauf der Nacht",
          kinder: [
            {
              typ: "auswahl",
              schluessel: "schlaf_qualitaet",
              beschriftung: "Wie war die Nacht?",
              pflicht: true,
              optionen: [
                { wert: "ruhig", label: "ruhig" },
                { wert: "unruhig", label: "unruhig" },
                { wert: "schlaflos", label: "schlaflos" },
              ],
            },
            { typ: "uhrzeit", schluessel: "zu_bett", beschriftung: "Uhrzeit zu Bett" },
            { typ: "ja_nein", schluessel: "vorfall", beschriftung: "Gab es einen Vorfall?", pflicht: true, hilfetext: "Auch kleinere Konflikte eintragen." },
          ],
        },
        {
          typ: "abschnitt",
          schluessel: "vorfall_abschnitt",
          beschriftung: "Vorfall",
          sichtbarWenn: { feld: "vorfall", op: "ist", wert: true },
          kinder: [
            {
              typ: "auswahl",
              schluessel: "vorfall_art",
              beschriftung: "Art des Vorfalls",
              pflicht: true,
              optionen: [
                { wert: "konflikt", label: "Konflikt mit Mitbewohner:in" },
                { wert: "selbstgefaehrdung", label: "Selbstgefährdung" },
                { wert: "gewalt", label: "Gewalt" },
                { wert: "polizei", label: "Polizeieinsatz" },
                { wert: "sonstiges", label: "Sonstiges" },
              ],
            },
            { typ: "uhrzeit", schluessel: "vorfall_beginn", beschriftung: "Beginn", pflicht: true },
            { typ: "uhrzeit", schluessel: "vorfall_ende", beschriftung: "Ende" },
            {
              typ: "berechnung",
              schluessel: "vorfall_dauer",
              beschriftung: "Dauer der Intervention",
              einheit: "Minuten",
              nachkommastellen: 0,
              ausdruck: { fn: "dauer_minuten", von: "vorfall_beginn", bis: "vorfall_ende" },
            },
            {
              typ: "uhrzeit",
              schluessel: "leitung_informiert",
              beschriftung: "Leitung informiert um",
              pflicht: { feld: "vorfall_art", op: "eine_von", wert: ["selbstgefaehrdung", "gewalt", "polizei"] },
            },
            { typ: "langtext", schluessel: "vorfall_beschreibung", beschriftung: "Beschreibung", pflicht: true },
          ],
        },
        { typ: "langtext", schluessel: "uebergabe", beschriftung: "Übergabe an den Frühdienst" },
        { typ: "langtext", schluessel: "intern_einschaetzung", beschriftung: "Interne Einschätzung", intern: true },
      ],
    },
  },
  {
    schluessel: "hausbesuch",
    name: "Hausbesuch",
    beschreibung: "Besuch in der Wohnung: Anwesende, Dauer, Zustand, Vereinbarungen.",
    definition: {
      bezugsdatumFeld: "datum",
      bausteine: [
        KOPF_KLIENT,
        {
          typ: "abschnitt",
          schluessel: "rahmen",
          beschriftung: "Besuch",
          kinder: [
            { typ: "datum", schluessel: "datum", beschriftung: "Datum des Besuchs", pflicht: true, nichtInZukunft: true, vorausfuellen: { quelle: "zeit.heute", art: "vorschlag" } },
            { typ: "kurztext", schluessel: "wohnung", beschriftung: "Wohnung", vorausfuellen: { quelle: "belegung.wohnung", art: "festgehalten" } },
            { typ: "uhrzeit", schluessel: "beginn", beschriftung: "Beginn", pflicht: true },
            {
              typ: "uhrzeit",
              schluessel: "ende",
              beschriftung: "Ende",
              pflicht: true,
              pruefungen: [{ op: "groesser", feld: "beginn", meldung: "Das Ende muss nach dem Beginn liegen." }],
            },
            { typ: "berechnung", schluessel: "dauer", beschriftung: "Dauer", einheit: "Minuten", nachkommastellen: 0, ausdruck: { fn: "dauer_minuten", von: "beginn", bis: "ende" } },
            { typ: "mitarbeitende", schluessel: "anwesend", beschriftung: "Anwesend (Mitarbeitende)", pflicht: true },
            { typ: "ja_nein", schluessel: "angetroffen", beschriftung: "Klient:in angetroffen?", pflicht: true },
            {
              typ: "langtext",
              schluessel: "nicht_angetroffen_grund",
              beschriftung: "Was wurde unternommen?",
              sichtbarWenn: { feld: "angetroffen", op: "ist", wert: false },
              pflicht: true,
            },
          ],
        },
        {
          typ: "abschnitt",
          schluessel: "besuch",
          beschriftung: "Eindruck",
          sichtbarWenn: { feld: "angetroffen", op: "ist", wert: true },
          kinder: [
            {
              typ: "auswahl",
              schluessel: "zustand_wohnung",
              beschriftung: "Zustand der Wohnung",
              optionen: [
                { wert: "gut", label: "gut" },
                { wert: "mittel", label: "in Ordnung" },
                { wert: "schlecht", label: "verbesserungsbedürftig" },
              ],
            },
            {
              typ: "hinweis",
              schluessel: "hinweis_zustand",
              beschriftung: "Bei verbesserungsbedürftigem Zustand bitte eine Vereinbarung mit Frist festhalten.",
              ton: "warnung",
              sichtbarWenn: { feld: "zustand_wohnung", op: "ist", wert: "schlecht" },
            },
            { typ: "langtext", schluessel: "gespraech", beschriftung: "Gesprächsinhalt", pflicht: true },
            { typ: "langtext", schluessel: "vereinbarungen", beschriftung: "Vereinbarungen" },
          ],
        },
        { typ: "langtext", schluessel: "intern_einschaetzung", beschriftung: "Interne Einschätzung", intern: true },
      ],
    },
  },
];
