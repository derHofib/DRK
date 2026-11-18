import { ANHEFTPUNKTE, type AnheftModus, type FormularDetailDto, type FormularKennzahlenDto, type StandortDto } from "@zimmerakte/shared";
import { IBearbeiten, IEinstellungen, ISichtbar } from "../../components/icons";
import { formatDatum, formatUhrzeit } from "../../format";

/**
 * Reiter „Übersicht“ (Rueckmeldung „Aufbau Formular“, Bild 1 im Konzept
 * /mnt/project-files/formular-aufbau/). Beantwortet zwei Fragen auf einen
 * Blick: welche Version ist wo (in Entwicklung / wird ausgefuellt / abgeloest)
 * und wie oft wird das Formular tatsaechlich ausgefuellt.
 */

const MODUS_KURZ: Record<AnheftModus, string> = { automatisch: "automatisch dabei", dazunehmen: "zum Dazunehmen" };

function zeitpunkt(iso: string): string {
  const d = iso.slice(0, 10);
  const heute = new Date();
  const h = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;
  const g = new Date(heute.getTime() - 86_400_000);
  const gestern = `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, "0")}-${String(g.getDate()).padStart(2, "0")}`;
  // Datum in Berliner Zeit, nicht UTC: kurz nach Mitternacht waere es sonst „gestern“.
  const lokal = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(iso));
  const tag = lokal === h ? "heute" : lokal === gestern ? "gestern" : formatDatum(lokal || d);
  return `${tag}, ${formatUhrzeit(iso)}`;
}

function tageSeit(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function vergleichText(jetzt: number, vorher: number): string {
  if (vorher === 0) return jetzt === 0 ? "keine im Vormonat" : "im Vormonat keine";
  const p = Math.round(((jetzt - vorher) / vorher) * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)} % zum Vormonat`;
}

export function FormularUebersicht({
  d,
  k,
  fehler,
  standorte,
  onVersionAnsehen,
  onEntwurfOeffnen,
  onEinstellungen,
}: {
  d: FormularDetailDto;
  k: FormularKennzahlenDto | null;
  fehler: string | null;
  standorte: StandortDto[];
  onVersionAnsehen: (nummer: number) => void;
  onEntwurfOeffnen: () => void;
  onEinstellungen: () => void;
}) {
  const neuesteVeroeffentlichte = d.veroeffentlichteVersion;
  const proTag = k ? (k.letzte30Tage / 30).toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "";

  return (
    <div className="zv-fo">
      {fehler && <p className="zv-hinweis zv-hinweis-fehler">{fehler}</p>}
      <div className="zv-fo-kennzahlen">
        <div className="zv-fo-karte">
          <span className="zv-sub">Ausgefüllt insgesamt</span>
          <strong className="zv-fo-zahl zv-mono">{k ? k.gesamt : "…"}</strong>
          <span className="zv-sub">{k?.seit ? `seit ${formatDatum(k.seit.slice(0, 10))} · alle Versionen` : "noch nie abgeschlossen"}</span>
        </div>
        <div className="zv-fo-karte">
          <span className="zv-sub">Letzte 30 Tage</span>
          <strong className="zv-fo-zahl zv-mono">{k ? k.letzte30Tage : "…"}</strong>
          <span className="zv-sub">{k ? `≈ ${proTag} am Tag · ${vergleichText(k.letzte30Tage, k.vorige30Tage)}` : ""}</span>
        </div>
        <div className="zv-fo-karte">
          <span className="zv-sub">Angefangen, nicht abgeschlossen</span>
          <strong className="zv-fo-zahl zv-mono">{k ? k.offen : "…"}</strong>
          <span className="zv-sub">
            {k?.aeltesterOffenerSeit ? `ältestes seit ${tageSeit(k.aeltesterOffenerSeit) === 0 ? "heute" : `${tageSeit(k.aeltesterOffenerSeit)} ${tageSeit(k.aeltesterOffenerSeit) === 1 ? "Tag" : "Tagen"}`}` : "keine offenen"}
          </span>
        </div>
        <div className="zv-fo-karte">
          <span className="zv-sub">Zuletzt ausgefüllt</span>
          <strong className="zv-fo-zahl zv-fo-zahl-text">{k ? (k.zuletzt ? zeitpunkt(k.zuletzt.am) : "noch nie") : "…"}</strong>
          <span className="zv-sub">{k?.zuletzt?.standortName ?? (k?.zuletzt ? "ohne Standort" : "")}</span>
        </div>
      </div>

      <div className="zv-fo-reihe">
        <section className="zv-fo-karte" aria-labelledby="zv-fo-versionen">
          <div className="zv-fo-karte-kopf">
            <h3 id="zv-fo-versionen">Versionen</h3>
            <span className="zv-sub">{d.versionen.length === 1 ? "eine Version" : `${d.versionen.length} Versionen`}</span>
          </div>
          <ul className="zv-fo-versionen">
            {d.versionen.map((v) => {
              const entwurf = v.veroeffentlichtAm === null;
              const aktuell = v.nummer === neuesteVeroeffentlichte;
              // Abgeloest seit = Veroeffentlichung der naechsthoeheren veroeffentlichten Version.
              const nachfolger = d.versionen.filter((x) => x.veroeffentlichtAm && x.nummer > v.nummer).pop();
              return (
                <li key={v.nummer} className={!entwurf && !aktuell ? "zv-fo-version-alt" : undefined}>
                  <span className="zv-fo-versionsnummer zv-mono">{v.nummer}</span>
                  <span className="zv-fo-version-text">
                    {entwurf ? (
                      <span className="zv-pill zv-pill-frist">In Entwicklung</span>
                    ) : aktuell && d.status !== "stillgelegt" ? (
                      <span className="zv-pill zv-pill-ok">Veröffentlicht · wird ausgefüllt</span>
                    ) : aktuell ? (
                      <span className="zv-pill">Stillgelegt</span>
                    ) : (
                      <span className="zv-pill">Abgelöst</span>
                    )}
                    <span className="zv-sub">
                      {entwurf
                        ? "noch nicht veröffentlicht"
                        : `${formatDatum(v.veroeffentlichtAm!.slice(0, 10))}${nachfolger?.veroeffentlichtAm ? ` bis ${formatDatum(nachfolger.veroeffentlichtAm.slice(0, 10))}` : ""}${v.veroeffentlichtVonName ? `, von ${v.veroeffentlichtVonName}` : ""}`}
                    </span>
                  </span>
                  <span className="zv-fo-version-anzahl zv-mono">{entwurf ? "–" : `${v.anzahlProtokolle} ${v.anzahlProtokolle === 1 ? "Protokoll" : "Protokolle"}`}</span>
                  {entwurf && d.status !== "stillgelegt" ? (
                    <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={onEntwurfOeffnen}>
                      <IBearbeiten size={14} />
                      Weiter bearbeiten
                    </button>
                  ) : (
                    <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein" onClick={() => onVersionAnsehen(v.nummer)}>
                      <ISichtbar size={14} />
                      Ansehen
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="zv-fo-karte" aria-labelledby="zv-fo-angebot">
          <h3 id="zv-fo-angebot">Wo es angeboten wird</h3>
          <dl className="zv-fo-angebot">
            <dt>Standorte</dt>
            <dd>
              {d.standortIds.length === 0
                ? "alle, auch künftige"
                : `${d.standortIds.length} von ${standorte.length}: ${standorte
                    .filter((s) => d.standortIds.includes(s.id))
                    .map((s) => s.name)
                    .join(", ")}`}
            </dd>
            <dt>Klientenakte › Protokolle</dt>
            <dd>immer</dd>
            {d.anheftungen.map((a) => (
              <FragmentZeile key={a.anheftpunkt} titel={ANHEFTPUNKTE[a.anheftpunkt].label} text={`${MODUS_KURZ[a.modus]}${a.pflicht ? " · Pflicht" : ""}`} />
            ))}
            {d.status !== "veroeffentlicht" && (
              <>
                <dt>Zurzeit</dt>
                <dd>{d.status === "stillgelegt" ? "nirgends, stillgelegt" : "nirgends, noch in Entwicklung"}</dd>
              </>
            )}
          </dl>
          <button type="button" className="zv-btn zv-btn-sekundaer zv-btn-klein zv-fo-rechts" onClick={onEinstellungen}>
            <IEinstellungen size={14} />
            Einstellungen ändern
          </button>
        </section>
      </div>

      <div className="zv-fo-reihe">
        <section className="zv-fo-karte" aria-labelledby="zv-fo-wochen">
          <div className="zv-fo-karte-kopf">
            <h3 id="zv-fo-wochen">Ausgefüllt je Woche</h3>
            <span className="zv-sub">letzte 12 Wochen · nur abgeschlossene</span>
          </div>
          {k ? <Wochen k={k} aktuell={neuesteVeroeffentlichte} /> : <p className="zv-sub">Wird geladen…</p>}
        </section>

        <section className="zv-fo-karte" aria-labelledby="zv-fo-standorte">
          <h3 id="zv-fo-standorte">Je Standort (30 Tage)</h3>
          {k && <Standorte k={k} />}
          <h3 className="zv-fo-zwischentitel">Zuletzt ausgefüllt</h3>
          {k && k.letzte.length === 0 && <p className="zv-sub">Noch nichts, das Sie sehen dürfen.</p>}
          {k && k.letzte.length > 0 && (
            <ul className="zv-fo-letzte">
              {k.letzte.map((l) => (
                <li key={l.id}>
                  <span className="zv-mono">{zeitpunkt(l.abgeschlossenAm)}</span>
                  <span>
                    {l.klientInitialen}
                    {l.standortName ? ` · ${l.standortName}` : ""}
                  </span>
                  <span className="zv-sub">Version {l.versionNummer}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function FragmentZeile({ titel, text }: { titel: string; text: string }) {
  return (
    <>
      <dt>{titel}</dt>
      <dd>{text}</dd>
    </>
  );
}

function Wochen({ k, aktuell }: { k: FormularKennzahlenDto; aktuell: number | null }) {
  const summen = k.wochen.map((w) => Object.values(w.jeVersion).reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...summen);
  const versionen = [...new Set(k.wochen.flatMap((w) => Object.keys(w.jeVersion).map(Number)))].sort((a, b) => a - b);
  const aeltere = versionen.some((v) => v !== aktuell);
  if (summen.every((s) => s === 0)) return <p className="zv-sub">In den letzten 12 Wochen wurde es nicht ausgefüllt.</p>;
  return (
    <>
      <div className="zv-fo-wochen" role="img" aria-label={`Ausgefüllt je Woche: ${k.wochen.map((w, i) => `KW ${w.kw}: ${summen[i]}`).join(", ")}`}>
        {k.wochen.map((w, i) => (
          <div key={w.wocheAb} className="zv-fo-woche" title={`KW ${w.kw}: ${summen[i]}`}>
            <span className="zv-fo-woche-zahl zv-mono">{summen[i] || ""}</span>
            <div className="zv-fo-saeule" style={{ height: `${(summen[i] / max) * 100}%` }}>
              {versionen.map((v) =>
                w.jeVersion[String(v)] ? (
                  <span
                    key={v}
                    className={v === aktuell ? "zv-fo-teil zv-fo-teil-aktuell" : "zv-fo-teil"}
                    style={{ flexGrow: w.jeVersion[String(v)] }}
                  />
                ) : null,
              )}
            </div>
            <span className="zv-fo-woche-kw">KW {w.kw}</span>
          </div>
        ))}
      </div>
      <div className="zv-fo-legende">
        {aktuell !== null && (
          <span>
            <i className="zv-fo-teil-aktuell" /> Version {aktuell}
          </span>
        )}
        {aeltere && (
          <span>
            <i /> {versionen.filter((v) => v !== aktuell).length === 1 ? `Version ${versionen.find((v) => v !== aktuell)}` : "ältere Versionen"}
          </span>
        )}
      </div>
    </>
  );
}

function Standorte({ k }: { k: FormularKennzahlenDto }) {
  const max = Math.max(1, ...k.standorte.map((s) => s.anzahl), k.ohneStandort);
  return (
    <ul className="zv-fo-standorte">
      {k.standorte.map((s) => (
        <li key={s.id} className={s.zugelassen ? undefined : "zv-fo-standort-aus"}>
          <span>{s.name}</span>
          {s.zugelassen || s.anzahl > 0 ? (
            <span className="zv-fo-balken" style={{ width: `${(s.anzahl / max) * 100}%` }} />
          ) : (
            <span className="zv-sub">nicht zugelassen</span>
          )}
          <span className="zv-mono">{s.zugelassen || s.anzahl > 0 ? s.anzahl : ""}</span>
        </li>
      ))}
      {k.ohneStandort > 0 && (
        <li>
          <span>ohne Belegung</span>
          <span className="zv-fo-balken" style={{ width: `${(k.ohneStandort / max) * 100}%` }} />
          <span className="zv-mono">{k.ohneStandort}</span>
        </li>
      )}
    </ul>
  );
}
