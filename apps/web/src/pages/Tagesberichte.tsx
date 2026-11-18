import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import type { KlientListEintragDto, ProtokollDto, TagDto, TagesberichtAenderungDto, TagesberichtDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { dateiZuBase64 } from "../datei";
import { formatDatum, heuteBerlin } from "../format";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { NeuerTagesberichtFenster } from "../components/NeuerTagesbericht";
import { ProtokollAnsicht } from "../components/ProtokollFormular";
import {
  SCHNELLWAHL_LABEL,
  SORTIERUNG_LABEL,
  gruppiereNachKlient,
  sortiere,
  zeitraumFuer,
  type Schnellwahl,
  type Sortierung,
} from "./tagesberichte-filter";
import {
  IAbbrechen,
  IDokument,
  IFehler,
  IFilterLoeschen,
  IKalender,
  IKlienten,
  ILeerTagesberichte,
  INeu,
  IPerson,
  ISortierung,
  ISpeichern,
  ISuche,
  ITag,
} from "../components/icons";
import { FilterAuswahl, FilterPille } from "../components/Filterleiste";
import { AktionsMenue } from "../components/AktionsMenue";
import { ExportMenue } from "../components/ExportMenue";
import { filterTextAus, type ListenExport } from "../export/listenExport";

/**
 * Zeile eines Tagesberichts -- wird sowohl vom allgemeinen Menuepunkt hier
 * (zeigeKlient=true, Klient als Titel-Spalte) als auch vom Tab in der
 * Klientenakte (zeigeKlient=false, Datum als Titel-Spalte, kein
 * Klient-Feld noetig) verwendet. Tags UND Dokumente lassen sich direkt in
 * der Zeile entfernen bzw. ueber ein kleines Feld nachtraeglich hinzufuegen
 * -- "kann kein muss, kann auch nachtraeglich hinzugefuegt werden".
 */
export function TagesberichtZeile({
  bericht,
  zeigeKlient,
  onTagEntfernen,
  onTagHinzufuegen,
  onDokumentHinzufuegen,
  onGeaendert,
}: {
  bericht: TagesberichtDto;
  zeigeKlient: boolean;
  onTagEntfernen: (tagId: string) => void;
  onTagHinzufuegen: (name: string) => void;
  onDokumentHinzufuegen: (base64: string, dateiname: string, mimeType: string) => void;
  /** Nach erfolgreichem Bearbeiten: Liste neu laden. */
  onGeaendert: () => void;
}) {
  const [neuerTag, setNeuerTag] = useState("");
  const [bearbeiten, setBearbeiten] = useState<{ text: string; datum: string } | null>(null);
  const [bearbeitenFehler, setBearbeitenFehler] = useState<string | null>(null);
  const [historie, setHistorie] = useState<TagesberichtAenderungDto[] | null>(null);
  const [historieOffen, setHistorieOffen] = useState(false);
  const [offenesDokument, setOffenesDokument] = useState<{ id: string; url: string } | null>(null);

  async function dokumentAnzeigen(dokumentId: string) {
    if (offenesDokument?.id === dokumentId) {
      setOffenesDokument(null);
      return;
    }
    const url = await api.tagesberichtDokumentUrl(bericht.id, dokumentId);
    setOffenesDokument({ id: dokumentId, url });
  }

  // Gleiches Muster wie bei Rechnungsdokumenten (RechnungenTab in
  // KlientDetail.tsx): ohne ausdrueckliches revokeObjectURL haelt der
  // Browser die Blob-URL im Speicher, auch nach dem Schliessen/Wechseln.
  useEffect(() => {
    if (!offenesDokument) return;
    const url = offenesDokument.url;
    return () => URL.revokeObjectURL(url);
  }, [offenesDokument]);

  // Neu laden, sobald eine weitere Aenderung protokolliert wurde (Tag, Dokument,
  // Bearbeitung) -- sonst zeigt eine geoeffnete Historie veralteten Stand.
  useEffect(() => {
    if (!historieOffen) return;
    api
      .tagesberichtHistorie(bericht.id)
      .then(setHistorie)
      .catch(() => setHistorie([]));
  }, [historieOffen, bericht.id, bericht.anzahlAenderungen]);

  async function speichern(e: FormEvent) {
    e.preventDefault();
    if (!bearbeiten) return;
    setBearbeitenFehler(null);
    try {
      // Ein Formular-Tagesbericht darf ohne Freitext bleiben (Migration 0077):
      // dann nur das Datum schicken, der Server verlangt sonst Text.
      await api.tagesberichtBearbeiten(bericht.id, { text: bearbeiten.text.trim() ? bearbeiten.text : undefined, datum: bearbeiten.datum });
      setBearbeiten(null);
      onGeaendert();
    } catch (err) {
      setBearbeitenFehler(err instanceof Error ? err.message : "Tagesbericht konnte nicht gespeichert werden.");
    }
  }

  async function dateiAusgewaehlt(e: ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    e.target.value = "";
    if (!datei) return;
    const base64 = await dateiZuBase64(datei);
    onDokumentHinzufuegen(base64, datei.name, datei.type || "application/octet-stream");
  }

  return (
    <div className="zv-info-karte">
      <span className="zv-liste-zelle-titel">{zeigeKlient ? bericht.klientName : formatDatum(bericht.datum)}</span>
      {zeigeKlient && (
        <span className="zv-liste-zelle" data-label="Datum">
          <strong>{formatDatum(bericht.datum)}</strong>
        </span>
      )}
      <span className="zv-liste-zelle" data-label="Bericht">
        {bearbeiten ? (
          <form onSubmit={speichern} style={{ display: "grid", gap: 8 }}>
            <input
              type="date"
              value={bearbeiten.datum}
              max={heuteBerlin()}
              onChange={(e) => setBearbeiten({ ...bearbeiten, datum: e.target.value })}
              aria-label="Datum des Tagesberichts"
            />
            <textarea
              value={bearbeiten.text}
              rows={4}
              onChange={(e) => setBearbeiten({ ...bearbeiten, text: e.target.value })}
              aria-label="Text des Tagesberichts"
            />
            {bearbeitenFehler && <div role="alert">{bearbeitenFehler}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={(!bearbeiten.text.trim() && Boolean(bericht.text)) || !bearbeiten.datum}>
                Speichern
              </button>
              <button type="button" onClick={() => setBearbeiten(null)}>
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Ohne Freitext ist das Formular der Bericht und steht oben. */}
            {bericht.text ? bericht.text : <TagesberichtProtokolle protokolle={bericht.protokolle} />}
            {bericht.autorName && <div className="zv-sub-inline">Verfasst von {bericht.autorName}</div>}
            {bericht.text && <TagesberichtProtokolle protokolle={bericht.protokolle} />}
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              {bericht.bearbeitbar && (
                <button
                  type="button"
                  className="zv-link-btn"
                  style={{ fontSize: "var(--zv-text-xs)" }}
                  onClick={() => setBearbeiten({ text: bericht.text, datum: bericht.datum })}
                >
                  Bearbeiten
                </button>
              )}
              {bericht.anzahlAenderungen > 0 && (
                <button
                  type="button"
                  className="zv-link-btn"
                  style={{ fontSize: "var(--zv-text-xs)" }}
                  aria-expanded={historieOffen}
                  onClick={() => setHistorieOffen((o) => !o)}
                >
                  Historie ({bericht.anzahlAenderungen})
                </button>
              )}
            </div>
          </>
        )}
        {historieOffen && historie && <AenderungsHistorie eintraege={historie} />}
      </span>
      <span className="zv-liste-zelle" data-label="Tags">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {bericht.tags.map((t) => (
            <span key={t.id} className="zv-pill zv-pill-info">
              <ITag />
              {t.name}
              <button
                type="button"
                aria-label={`Tag ${t.name} entfernen`}
                onClick={() => onTagEntfernen(t.id)}
                style={{
                  display: "inline-flex",
                  background: "none",
                  border: "none",
                  padding: 0,
                  marginLeft: 2,
                  cursor: "pointer",
                  color: "inherit",
                }}
              >
                <IAbbrechen style={{ width: 12, height: 12 }} />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onTagHinzufuegen(neuerTag);
              setNeuerTag("");
            }}
            style={{ display: "inline-flex" }}
          >
            <input
              value={neuerTag}
              onChange={(e) => setNeuerTag(e.target.value)}
              list="zv-tag-vorschlaege"
              placeholder="+ Tag"
              aria-label="Tag hinzufügen"
              style={{
                width: 90,
                fontSize: "var(--zv-text-xs)",
                padding: "2px 6px",
                border: "1px solid var(--zv-border)",
                borderRadius: "var(--zv-radius-s)",
                background: "var(--zv-bg)",
                color: "var(--zv-text)",
              }}
            />
          </form>
        </div>
      </span>
      <span className="zv-liste-zelle" data-label="Dokumente">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {bericht.dokumente.map((d) => (
            <button
              key={d.id}
              type="button"
              className="zv-pill zv-pill-info"
              style={{ border: "none", cursor: "pointer" }}
              onClick={() => dokumentAnzeigen(d.id)}
              title={d.dateiname}
            >
              <IDokument />
              {d.dateiname}
            </button>
          ))}
          <label className="zv-link-btn" style={{ fontSize: "var(--zv-text-xs)" }}>
            <IDokument style={{ width: 12, height: 12 }} />
            + Dokument
            <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={dateiAusgewaehlt} />
          </label>
        </div>
        {offenesDokument && (
          <div className="zv-sub-inline" style={{ marginTop: 4 }}>
            <a href={offenesDokument.url} target="_blank" rel="noreferrer">
              Dokument in neuem Tab öffnen
            </a>
          </div>
        )}
      </span>
    </div>
  );
}

function zeitpunkt(iso: string): string {
  const d = new Date(iso);
  return `${formatDatum(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d))}, ${new Intl.DateTimeFormat(
    "de-DE",
    { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }
  ).format(d)} Uhr`;
}

/** Neueste Aenderung zuerst; "bearbeitet" zeigt den fruehere Text, nicht nur dass es eine Aenderung gab. */
function AenderungsHistorie({ eintraege }: { eintraege: TagesberichtAenderungDto[] }) {
  return (
    <ul className="zv-sub-inline" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 8 }}>
      {eintraege.map((e) => {
        const wer = e.geaendertVonName ?? "Unbekannt";
        const kopf = `${zeitpunkt(e.geaendertAm)} · ${wer}`;
        return (
          <li key={e.id}>
            <strong>{kopf}</strong>
            <div>
              {e.art === "tag_hinzugefuegt" && `Tag „${e.tagName}“ hinzugefügt`}
              {e.art === "tag_entfernt" && `Tag „${e.tagName}“ entfernt`}
              {e.art === "dokument_hinzugefuegt" && `Dokument „${e.dokumentName}“ hinzugefügt`}
              {e.art === "bearbeitet" && (
                <>
                  {e.datumAlt !== e.datumNeu && (
                    <div>
                      Datum: {formatDatum(e.datumAlt ?? "")} → {formatDatum(e.datumNeu ?? "")}
                    </div>
                  )}
                  {e.textAlt !== e.textNeu && (
                    <>
                      <div>Früherer Text:</div>
                      <blockquote style={{ margin: "2px 0", whiteSpace: "pre-wrap" }}>{e.textAlt}</blockquote>
                    </>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TagVorschlaegeDatalist({ tags }: { tags: TagDto[] }) {
  return (
    <datalist id="zv-tag-vorschlaege">
      {tags.map((t) => (
        <option key={t.id} value={t.name} />
      ))}
    </datalist>
  );
}

export function Tagesberichte({ startKlientId }: { startKlientId?: string } = {}) {
  const [berichte, setBerichte] = useState<TagesberichtDto[]>([]);
  const [klienten, setKlienten] = useState<KlientListEintragDto[]>([]);
  const [tagVorschlaege, setTagVorschlaege] = useState<TagDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [formularOffen, setFormularOffen] = useState(Boolean(startKlientId));

  // Zeitraum wird serverseitig gefiltert (kann ueber Jahre gross werden);
  // Klient-Filter und Sortierung arbeiten auf der geladenen Liste, damit sie
  // ohne Nachladen sofort reagieren.
  const [schnellwahl, setSchnellwahl] = useState<Schnellwahl | null>("alle");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [klientFilter, setKlientFilter] = useState("");
  const [sortierung, setSortierung] = useState<Sortierung>("datum-neu");
  const [suche, setSuche] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [autorFilter, setAutorFilter] = useState("");
  // Tag- und Autor-Filter sind Zusatzfilter: erst ueber "+ Filter" sichtbar,
  // damit die Leiste im Normalfall schmal bleibt.
  const [zusatz, setZusatz] = useState<{ tag: boolean; autor: boolean }>({ tag: false, autor: false });

  function laden() {
    api
      .tagesberichteListe({ von, bis })
      .then((liste) => {
        setBerichte(liste);
        setFehler(null);
      })
      .catch((err) => setFehler(err.message));
    api.tagsListe().then(setTagVorschlaege).catch(() => {});
  }

  useEffect(() => {
    if (von && bis && von > bis) return;
    laden();
  }, [von, bis]);

  useEffect(() => {
    api.klientenListe().then(setKlienten).catch((err) => setFehler(err.message));
  }, []);

  function schnellwahlWaehlen(wahl: Schnellwahl) {
    const z = zeitraumFuer(wahl);
    setSchnellwahl(wahl);
    setVon(z.von);
    setBis(z.bis);
  }

  const zeitraumUngueltig = Boolean(von && bis && von > bis);
  const sichtbar = useMemo(() => {
    const q = suche.trim().toLocaleLowerCase("de");
    const gefiltert = berichte.filter(
      (b) =>
        (!klientFilter || b.klientId === klientFilter) &&
        (!tagFilter || b.tags.some((t) => t.name === tagFilter)) &&
        (!autorFilter || b.autorName === autorFilter) &&
        (!q ||
          [b.text, b.klientName, b.autorName ?? "", ...b.tags.map((t) => t.name), ...berichtFormularTexte(b)].some((f) =>
            f.toLocaleLowerCase("de").includes(q)
          ))
    );
    return sortiere(gefiltert, sortierung);
  }, [berichte, klientFilter, tagFilter, autorFilter, suche, sortierung]);
  const tagOptionen = useMemo(
    () => [...new Set(berichte.flatMap((b) => b.tags.map((t) => t.name)))].sort((a, b) => a.localeCompare(b, "de")),
    [berichte]
  );
  const autorOptionen = useMemo(
    () => [...new Set(berichte.map((b) => b.autorName).filter((a): a is string => Boolean(a)))].sort((a, b) => a.localeCompare(b, "de")),
    [berichte]
  );
  const zeitraumText = schnellwahl
    ? SCHNELLWAHL_LABEL[schnellwahl]
    : [von && formatDatum(von), bis && formatDatum(bis)].filter(Boolean).join(" – ") || null;
  const klientText = klienten.find((k) => k.id === klientFilter);
  function alleZuruecksetzen() {
    schnellwahlWaehlen("alle");
    setKlientFilter("");
    setTagFilter("");
    setAutorFilter("");
    setSuche("");
    setZusatz({ tag: false, autor: false });
  }
  const nachKlientSortiert = sortierung === "klient-az" || sortierung === "klient-za";
  const gruppen = useMemo(() => (nachKlientSortiert ? gruppiereNachKlient(sichtbar) : []), [sichtbar, nachKlientSortiert]);
  // Exportiert wird die gerade sichtbare Auswahl in der angezeigten Sortierung.
  function berichteExport(): ListenExport {
    return {
      titel: "Tagesberichte",
      dateiname: "tagesberichte",
      filterText: filterTextAus([
        ["Zeitraum", zeitraumText],
        ["Klient:in", klientText ? `${klientText.vorname} ${klientText.nachname}` : ""],
        ["Tag", tagFilter],
        ["Verfasst von", autorFilter],
        ["Suche", suche.trim()],
      ]),
      spalten: [
        { titel: "Datum", breite: 9 },
        { titel: "Klient:in", breite: 15 },
        { titel: "Verfasst von", breite: 14 },
        { titel: "Tags", breite: 12 },
        { titel: "Bericht", breite: 50 },
      ],
      zeilen: sichtbar.map((b) => [
        formatDatum(b.datum),
        b.klientName,
        b.autorName ?? "",
        b.tags.map((t) => t.name).join(", "),
        // Ein Formular-Tagesbericht hat oft keinen Freitext -- ohne die
        // Kurzfassung waere seine Zeile im Export leer.
        [...berichtFormularTexte(b), b.text].filter(Boolean).join("\n"),
      ]),
    };
  }
  const filterAktiv = Boolean(von || bis || klientFilter || tagFilter || autorFilter || suche.trim());

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

  const heute = heuteBerlin();

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Tagesberichte</h2>
        <button
          className="zv-btn"
          onClick={() => setFormularOffen(true)}
        >
          <INeu />
          Neuer Tagesbericht
        </button>
      </div>

      {formularOffen && (
        <NeuerTagesberichtFenster
          klienten={klienten.filter((k) => !k.archiviertAm)}
          // Ist die Liste nach einer Klient:in gefiltert, ist sie vorausgewaehlt.
          startKlientId={startKlientId ?? (klientFilter || undefined)}
          onClose={() => setFormularOffen(false)}
          onAngelegt={() => {
            setFormularOffen(false);
            laden();
          }}
        />
      )}

      <TagVorschlaegeDatalist tags={tagVorschlaege} />

      <div className="zv-filterleiste" role="search" aria-label="Tagesberichte filtern und sortieren">
        <label className="zv-filter-suche">
          <ISuche />
          <input
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Suchen…"
            aria-label="Tagesberichte durchsuchen"
          />
        </label>

        <FilterPille
          icon={<IKalender />}
          label="Zeitraum"
          wert={von || bis ? (zeitraumText ? `: ${zeitraumText}` : "") : null}
          onEntfernen={() => schnellwahlWaehlen("alle")}
        >
          {(schliessen) => (
            <>
              <FilterAuswahl
                optionen={(Object.keys(SCHNELLWAHL_LABEL) as Schnellwahl[]).map((w) => ({ wert: w, label: SCHNELLWAHL_LABEL[w] }))}
                gewaehlt={schnellwahl}
                onWaehlen={(w) => {
                  schnellwahlWaehlen(w);
                  schliessen();
                }}
              />
              <div className="zv-filter-datumsfelder">
                <div className="zv-field">
                  <label htmlFor="tb-von">Von</label>
                  <input
                    id="tb-von"
                    type="date"
                    value={von}
                    max={bis || undefined}
                    onChange={(e) => {
                      setSchnellwahl(null);
                      setVon(e.target.value);
                    }}
                  />
                </div>
                <div className="zv-field">
                  <label htmlFor="tb-bis">Bis</label>
                  <input
                    id="tb-bis"
                    type="date"
                    value={bis}
                    min={von || undefined}
                    onChange={(e) => {
                      setSchnellwahl(null);
                      setBis(e.target.value);
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </FilterPille>

        <FilterPille
          icon={<IKlienten />}
          label="Klient:in"
          wert={klientText ? `: ${klientText.vorname} ${klientText.nachname}` : null}
          onEntfernen={() => setKlientFilter("")}
        >
          {(schliessen) => (
            <FilterAuswahl
              optionen={klienten.map((k) => ({ wert: k.id, label: `${k.vorname} ${k.nachname}` }))}
              gewaehlt={klientFilter || null}
              onWaehlen={(id) => {
                setKlientFilter(id);
                schliessen();
              }}
            />
          )}
        </FilterPille>

        {zusatz.tag && (
          <FilterPille icon={<ITag />} label="Tag" wert={tagFilter ? `: ${tagFilter}` : null} onEntfernen={() => setTagFilter("")} startOffen={!tagFilter}>
            {(schliessen) => (
              <FilterAuswahl
                optionen={tagOptionen.map((t) => ({ wert: t, label: t }))}
                gewaehlt={tagFilter || null}
                onWaehlen={(t) => {
                  setTagFilter(t);
                  schliessen();
                }}
              />
            )}
          </FilterPille>
        )}
        {zusatz.autor && (
          <FilterPille
            icon={<IPerson />}
            label="Verfasst von"
            wert={autorFilter ? `: ${autorFilter}` : null}
            onEntfernen={() => setAutorFilter("")}
            startOffen={!autorFilter}
          >
            {(schliessen) => (
              <FilterAuswahl
                optionen={autorOptionen.map((a) => ({ wert: a, label: a }))}
                gewaehlt={autorFilter || null}
                onWaehlen={(a) => {
                  setAutorFilter(a);
                  schliessen();
                }}
              />
            )}
          </FilterPille>
        )}

        {(!zusatz.tag || !zusatz.autor) && (
          <AktionsMenue label="Filter hinzufügen" variante="pille" beschriftung="Filter" icon={<INeu />}>
            {!zusatz.tag && (
              <button type="button" role="menuitem" onClick={() => setZusatz((z) => ({ ...z, tag: true }))}>
                <ITag /> Tag
              </button>
            )}
            {!zusatz.autor && (
              <button type="button" role="menuitem" onClick={() => setZusatz((z) => ({ ...z, autor: true }))}>
                <IPerson /> Verfasst von
              </button>
            )}
          </AktionsMenue>
        )}

        <span className="zv-filter-trenner" aria-hidden="true" />

        <FilterPille icon={<ISortierung />} label="Sortierung" wert={null}>
          {(schliessen) => (
            <FilterAuswahl
              optionen={(Object.keys(SORTIERUNG_LABEL) as Sortierung[]).map((o) => ({ wert: o, label: SORTIERUNG_LABEL[o] }))}
              gewaehlt={sortierung}
              onWaehlen={(o) => {
                setSortierung(o);
                schliessen();
              }}
            />
          )}
        </FilterPille>

        <span className="zv-filter-trenner" aria-hidden="true" />
        <ExportMenue erzeuge={berichteExport} />

        <button
          type="button"
          className="zv-icon-btn"
          aria-label="Alle Filter zurücksetzen"
          title="Alle Filter zurücksetzen"
          disabled={!filterAktiv}
          onClick={alleZuruecksetzen}
        >
          <IFilterLoeschen />
        </button>
      </div>

      {zeitraumUngueltig && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          „Von“ liegt nach „Bis“ – bitte den Zeitraum korrigieren.
        </div>
      )}
      <div className="zv-sub-inline" aria-live="polite" style={{ marginBottom: "var(--zv-space-3)" }}>
        {sichtbar.length} {sichtbar.length === 1 ? "Bericht" : "Berichte"} · {SORTIERUNG_LABEL[sortierung]}
      </div>

      {sichtbar.length === 0 ? (
        filterAktiv ? (
          <Leerzustand icon={ILeerTagesberichte}>Keine Tagesberichte für diese Auswahl.</Leerzustand>
        ) : (
          <Leerzustand
            icon={ILeerTagesberichte}
            aktion={
              <button
                type="button"
                className="zv-btn zv-btn-sekundaer"
                onClick={() => setFormularOffen(true)}
              >
                Tagesbericht schreiben
              </button>
            }
          >
            Noch keine Tagesberichte erfasst.
          </Leerzustand>
        )
      ) : (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "1.1fr 1fr 2.6fr 1.5fr 1.5fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Klient:in</span>
            <span>Datum</span>
            <span>Bericht</span>
            <span>Tags</span>
            <span>Dokumente</span>
          </div>
          {(nachKlientSortiert ? gruppen : [{ klientId: "", klientName: "", berichte: sichtbar }]).map((g) => (
            <div key={g.klientId || "alle"} className="zv-gruppe">
              {nachKlientSortiert && (
                <h3 className="zv-gruppe-kopf">
                  {g.klientName} <span className="zv-sub-inline">({g.berichte.length})</span>
                </h3>
              )}
              {g.berichte.map((b) => (
                <TagesberichtZeile
                  key={b.id}
                  bericht={b}
                  zeigeKlient
                  onTagEntfernen={(tagId) => tagEntfernen(b.id, tagId)}
                  onTagHinzufuegen={(name) => tagHinzufuegen(b.id, name)}
                  onDokumentHinzufuegen={(base64, dateiname, mimeType) => dokumentHinzufuegen(b.id, base64, dateiname, mimeType)}
                  onGeaendert={laden}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Formularname und Kurzfassung je angeheftetem Protokoll -- fuer Suche und Export. */
export function berichtFormularTexte(b: TagesberichtDto): string[] {
  return (b.protokolle ?? []).map((p) => (p.kurzfassung ? `${p.formularName}: ${p.kurzfassung}` : p.formularName));
}

/**
 * Protokolle, die zusammen mit dem Tagesbericht abgeschlossen wurden
 * (angeheftete Formulare). Lesen hier, korrigieren in der Klientenakte unter
 * Protokolle -- dort gibt es Grund und Historie.
 */
export function TagesberichtProtokolle({ protokolle }: { protokolle: TagesberichtDto["protokolle"] }) {
  const [offen, setOffen] = useState<ProtokollDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  if (!protokolle?.length) return null;
  return (
    <div className="zv-tagesbericht-protokolle">
      {protokolle.map((p) => (
        <div key={p.id} className="zv-tagesbericht-protokoll-zeile">
          <button
            type="button"
            className="zv-pill zv-pill-info zv-tagesbericht-protokoll"
            onClick={() => {
              setFehler(null);
              api
                .protokoll(p.id)
                .then(setOffen)
                .catch((err) => setFehler(err instanceof Error ? err.message : "Protokoll konnte nicht geladen werden."));
            }}
          >
            <IDokument />
            {p.formularName}
          </button>
          {p.kurzfassung && <span className="zv-tagesbericht-kurzfassung">{p.kurzfassung}</span>}
        </div>
      ))}
      {fehler && <span className="zv-feld-fehler">{fehler}</span>}
      {offen && (
        <Modal titel={offen.formularName} onClose={() => setOffen(null)}>
          <p className="zv-protokoll-meta zv-protokoll-modal-text">
            Gehört zu diesem Tagesbericht. Korrigieren lässt es sich in der Klientenakte unter Protokolle.
          </p>
          <ProtokollAnsicht definition={offen.definition} werte={offen.werte} anzeige={offen.anzeige} quellen={offen.quellen} personen={offen.personen} />
        </Modal>
      )}
    </div>
  );
}
