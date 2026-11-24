import { ReactNode, useEffect, useState } from "react";
import type {
  HilfeplanDto,
  VerlaufDto,
  KlientDetailDto,
  KostenuebernahmeDto,
  TagesberichtDto,
} from "@zimmerakte/shared";
import { HZL_RHYTHMUS_LABEL } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Leerzustand } from "../../components/Leerzustand";
import { ILeerTagesberichte } from "../../components/icons";
import { formatBetrag, formatDatum, heuteBerlin, lokalesDatum } from "../../format";
import { verlaufArtLabel, verlaufKlasse } from "../klient/VerlaufTab";
import { berichtFormularTexte } from "../Tagesberichte";
import { type FinanzTeil } from "../KlientDetail";

export function alterIn(geburtsdatum: string): number {
  const heute = new Date();
  const [j, m, t] = geburtsdatum.slice(0, 10).split("-").map(Number);
  let alter = heute.getFullYear() - j;
  if (heute.getMonth() + 1 < m || (heute.getMonth() + 1 === m && heute.getDate() < t)) alter -= 1;
  return alter;
}

function tageBis(datum: string): number {
  const [j, m, t] = datum.slice(0, 10).split("-").map(Number);
  const heute = new Date();
  return Math.round(
    (Date.UTC(j, m - 1, t) - Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate())) / 86_400_000,
  );
}

/**
 * Ueberblick (Konzept klienten-ansicht, 3.4): feste Reihenfolge nach
 * Wichtigkeit -- Auf einen Blick, Braucht Aufmerksamkeit, Zuletzt im
 * Verlauf, Kontakte. Im Seitenpanel eine Spalte, im Vollbild zwei; welche,
 * entscheidet die Breite der Akte (Container-Abfrage in app.css), nicht die
 * des Fensters. Geschrieben wird ueber "+ Eintrag" im Kopf, deshalb gibt es
 * hier keinen Schnelleintrag mehr (der legte einen Tagesbericht an, was die
 * Rueckmeldung "Überblick / Chronik" ausdruecklich nicht wollte).
 */
export function UeberblickTab({
  klient,
  berichte,
  mitVerlauf,
  verlaufStand,
  onGanzerVerlauf,
  onKontakte,
  onFinanzen,
  onHilfeplan,
}: {
  klient: KlientDetailDto;
  berichte: TagesberichtDto[];
  mitVerlauf: boolean;
  verlaufStand: number;
  onGanzerVerlauf: () => void;
  onKontakte: () => void;
  onFinanzen: (teil: FinanzTeil) => void;
  onHilfeplan: () => void;
}) {
  const [kostenuebernahme, setKostenuebernahme] = useState<KostenuebernahmeDto | null | undefined>(undefined);
  const [barbetragCent, setBarbetragCent] = useState<number | null>(null);
  const [hilfeplan, setHilfeplan] = useState<HilfeplanDto | null>(null);
  const [verlauf, setVerlauf] = useState<VerlaufDto | null>(null);

  useEffect(() => {
    const heute = heuteBerlin();
    api
      .kostenuebernahmenListe(klient.id)
      .then((liste) => {
        const aktuelle = liste
          .filter((k) => k.von <= heute && (k.bis === null || k.bis >= heute))
          .sort((a, b) => b.von.localeCompare(a.von));
        // Abgelaufen ohne Nachfolger ist genau der Fall, der Aufmerksamkeit braucht.
        const juengste = [...liste].sort((a, b) => b.von.localeCompare(a.von))[0] ?? null;
        setKostenuebernahme(aktuelle[0] ?? (juengste && juengste.bis && juengste.bis < heute ? juengste : null));
      })
      .catch(() => setKostenuebernahme(null));
    // Stornierte Buchungen zaehlen nicht -- wie im Kassenstand (siehe
    // kassenbuchung.service.ts: Saldo nur ueber NOT storniert).
    api
      .kassenbuchungenListe({ klientId: klient.id })
      .then((liste) => setBarbetragCent(liste.filter((b) => !b.storniert).reduce((summe, b) => summe + b.betragCent, 0)))
      .catch(() => setBarbetragCent(null));
    api
      .hilfeplaeneListe(klient.id)
      .then((liste) => {
        const laufend = liste
          .filter((p) => p.von <= heute && (p.bis === null || p.bis >= heute))
          .sort((a, b) => b.von.localeCompare(a.von));
        setHilfeplan(laufend[0] ?? null);
      })
      .catch(() => setHilfeplan(null));
  }, [klient.id]);

  useEffect(() => {
    if (!mitVerlauf) return;
    api.verlauf(klient.id).then(setVerlauf).catch(() => setVerlauf(null));
  }, [klient.id, mitVerlauf, verlaufStand]);

  const ku = kostenuebernahme;
  const kuGesamt = ku && ku.bis ? Math.max(1, tageBis(ku.bis) - tageBis(ku.von)) : null;
  const kuVerbleibend = ku && ku.bis ? tageBis(ku.bis) : null;
  const kuFortschritt = kuGesamt && kuVerbleibend !== null ? Math.min(100, Math.max(0, ((kuGesamt - kuVerbleibend) / kuGesamt) * 100)) : 0;

  // Nur, was jetzt Handeln verlangt. Ist nichts davon faellig, entfaellt der
  // ganze Block -- ein "nichts zu tun" waere eine Zeile, die man jedes Mal
  // liest, ohne dass sie etwas sagt.
  const achtung: { schluessel: string; titel: string; meta: string; balken?: number; onKlick?: () => void }[] = [];
  if (ku && kuVerbleibend !== null && kuVerbleibend <= 30) {
    achtung.push({
      schluessel: "ku",
      titel: kuVerbleibend < 0 ? "Kostenübernahme abgelaufen" : "Kostenübernahme endet bald",
      meta: `${ku.amt} · ${kuVerbleibend < 0 ? `seit ${formatDatum(ku.bis!)}` : `noch ${kuVerbleibend} ${kuVerbleibend === 1 ? "Tag" : "Tage"}, bis ${formatDatum(ku.bis!)}`}`,
      balken: kuFortschritt,
      onKlick: () => onFinanzen("kostenuebernahmen"),
    });
  }
  if (hilfeplan?.naechstesGespraech && tageBis(hilfeplan.naechstesGespraech) <= 14) {
    const t = tageBis(hilfeplan.naechstesGespraech);
    achtung.push({
      schluessel: "hp-gespraech",
      titel: t < 0 ? "Hilfeplangespräch überfällig" : "Hilfeplangespräch steht an",
      meta: `${t < 0 ? "war am" : "am"} ${formatDatum(hilfeplan.naechstesGespraech)}`,
      onKlick: onHilfeplan,
    });
  }
  if (hilfeplan?.bis && tageBis(hilfeplan.bis) <= 30) {
    achtung.push({
      schluessel: "hp-ende",
      titel: "Hilfeplan-Fortschreibung fällig",
      meta: `Hilfeplan läuft bis ${formatDatum(hilfeplan.bis)}`,
      onKlick: onHilfeplan,
    });
  }
  if (klient.aktuellesZimmer?.auszug) {
    achtung.push({
      schluessel: "auszug",
      titel: "Auszug geplant",
      meta: `am ${formatDatum(klient.aktuellesZimmer.auszug)} aus Zimmer ${klient.aktuellesZimmer.nummer}`,
    });
  }
  for (const w of verlauf?.wiedervorlagen ?? []) {
    achtung.push({
      schluessel: `wv-${w.schluessel}`,
      titel: w.titel,
      meta: `${w.herkunft === "aufgabe" ? "Aufgabe" : "Wiedervorlage"}${w.datum ? ` · ${formatDatum(w.datum)}` : ""}`,
      onKlick: onGanzerVerlauf,
    });
  }

  const blick: [string, ReactNode][] = [
    [
      "Zimmer",
      klient.aktuellesZimmer ? `${klient.aktuellesZimmer.nummer} · ${klient.aktuellesZimmer.standortName}` : "kein Zimmer",
    ],
    ["seit", klient.aufnahmeAm ? <span className="zv-mono">{formatDatum(klient.aufnahmeAm)}</span> : "–"],
    ["Bezugsbetreuung", klient.stammdaten?.bezugsbetreuerName ?? "–"],
    ["Amt", klient.amt],
    ["Aktenzeichen", <span className="zv-mono">{klient.aktenzeichen}</span>],
    ["HZL", HZL_RHYTHMUS_LABEL[klient.hzlRhythmus]],
    ["Barbetrag", <span className="zv-mono">{barbetragCent === null ? "–" : formatBetrag(barbetragCent)}</span>],
  ];

  const letzteZeilen = (verlauf?.zeilen ?? []).slice(0, 5);

  return (
    <div className="zv-ueberblick">
      <div className="zv-ueberblick-haupt">
        <section className="zv-ueberblick-verlauf" aria-label="Zuletzt im Verlauf">
          <div className="zv-abschnittskopf">
            <h3>Zuletzt im Verlauf</h3>
            <button type="button" className="zv-link-btn" onClick={onGanzerVerlauf}>
              {mitVerlauf ? "Ganzer Verlauf" : "Alle Tagesberichte"}
            </button>
          </div>
          {mitVerlauf ? (
            verlauf === null ? null : letzteZeilen.length === 0 ? (
              <p className="zv-rand-leer">Noch nichts im Verlauf. Neue Einträge über „+ Eintrag“ oben.</p>
            ) : (
              <ol className="zv-chronik">
                {letzteZeilen.map((z) => (
                  <li key={z.schluessel} className={verlaufKlasse(z)}>
                    <span className="zv-chronik-datum zv-mono">
                      {formatDatum(z.ganztaegig ? z.zeitpunkt.slice(0, 10) : lokalesDatum(new Date(z.zeitpunkt)))}
                    </span>
                    <span className="zv-chronik-text">
                      <span className="zv-chronik-titel">
                        <span className="zv-verlauf-punkt" aria-hidden="true" />
                        <span className="zv-verlauf-art">{verlaufArtLabel(z)}</span>
                        {z.titel}
                      </span>
                      {z.text && <span className="zv-chronik-inhalt">{z.text}</span>}
                      {z.autorName && <span className="zv-todo-meta">{z.autorName}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )
          ) : berichte.length === 0 ? (
            <Leerzustand icon={ILeerTagesberichte}>Noch kein Tagesbericht.</Leerzustand>
          ) : (
            <ol className="zv-chronik">
              {berichte.slice(0, 5).map((b) => (
                <li key={b.id}>
                  <span className="zv-chronik-datum zv-mono">{formatDatum(b.datum)}</span>
                  <span className="zv-chronik-text">
                    <span className="zv-chronik-inhalt">{b.text || berichtFormularTexte(b).join(" · ")}</span>
                    <span className="zv-todo-meta">{b.autorName ?? "unbekannt"}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="zv-ueberblick-kontakte" aria-label="Kontakte">
          <div className="zv-abschnittskopf">
            <h3>Kontakte</h3>
            <button type="button" className="zv-link-btn" onClick={onKontakte}>
              Alle
            </button>
          </div>
          {klient.kontakte.length === 0 ? (
            <p className="zv-rand-leer">Keine Kontakte erfasst.</p>
          ) : (
            <ul className="zv-rand-liste zv-ueberblick-liste">
              {klient.kontakte.slice(0, 4).map((k) => (
                <li key={k.id}>
                  <span className="zv-todo-titel">{k.name}</span>
                  <span className="zv-todo-meta">{[k.beziehung, k.telefon].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="zv-ueberblick-rand">
        <section className="zv-ueberblick-blick" aria-label="Auf einen Blick">
          <div className="zv-abschnittskopf">
            <h3>Auf einen Blick</h3>
          </div>
          <dl className="zv-kennwerte">
            {blick.map(([label, wert]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{wert}</dd>
              </div>
            ))}
          </dl>
        </section>

        {achtung.length > 0 && (
          <section className="zv-ueberblick-achtung" aria-label="Braucht Aufmerksamkeit">
            <div className="zv-abschnittskopf">
              <h3>Braucht Aufmerksamkeit</h3>
            </div>
            <ul className="zv-achtung-liste">
              {achtung.map((a) => (
                <li key={a.schluessel}>
                  {a.onKlick ? (
                    <button type="button" className="zv-achtung-eintrag" onClick={a.onKlick}>
                      <AchtungInhalt titel={a.titel} meta={a.meta} balken={a.balken} />
                    </button>
                  ) : (
                    <div className="zv-achtung-eintrag">
                      <AchtungInhalt titel={a.titel} meta={a.meta} balken={a.balken} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function AchtungInhalt({ titel, meta, balken }: { titel: string; meta: string; balken?: number }) {
  return (
    <>
      <span className="zv-todo-titel">{titel}</span>
      <span className="zv-todo-meta">{meta}</span>
      {balken !== undefined && (
        <span className="zv-laufzeit" role="img" aria-label={`${Math.round(balken)} Prozent der Laufzeit vergangen`}>
          <span style={{ width: `${balken}%` }} />
        </span>
      )}
    </>
  );
}
