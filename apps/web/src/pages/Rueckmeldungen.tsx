import { useCallback, useEffect, useState } from "react";
import {
  RUECKMELDUNG_STATUS_LABEL,
  type MandantDto,
  type RueckmeldungDetailDto,
  type RueckmeldungEntscheidung,
  type RueckmeldungListeDto,
  type RueckmeldungStatus,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { IErfolg, IFehler, ILeerAnwaerter } from "../components/icons";
import { Leerzustand } from "../components/Leerzustand";
import { Seitenpanel } from "../components/Seitenpanel";

const FILTER: { wert: RueckmeldungStatus | ""; label: string }[] = [
  { wert: "neu", label: "Eingegangen" },
  { wert: "freigegeben", label: "Freigegeben" },
  { wert: "rueckfrage", label: "Rückfrage" },
  { wert: "in_arbeit", label: "In Umsetzung" },
  { wert: "umgesetzt", label: "Umgesetzt" },
  { wert: "abgelehnt", label: "Abgelehnt" },
  { wert: "duplikat", label: "Duplikat" },
  { wert: "", label: "Alle" },
];

const PILL: Record<RueckmeldungStatus, string> = {
  neu: "zv-pill zv-pill-info",
  freigegeben: "zv-pill zv-pill-ok",
  rueckfrage: "zv-pill zv-pill-achtung",
  in_arbeit: "zv-pill zv-pill-teilweise",
  umgesetzt: "zv-pill zv-pill-erledigt",
  abgelehnt: "zv-pill zv-pill-danger",
  duplikat: "zv-pill",
};

const datum = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Eingang der Rückmeldungen -- nur für Accounts mit dem Recht
 * rueckmeldungen.verwalten (Geschäftsführung). Die Freigabe hier entscheidet,
 * ob der Hersteller den Eintrag lesen darf; ob er es überhaupt darf, steht in
 * den Einstellungen (Weitergabe), und die Seite sagt offen, welcher Fall gilt.
 */
export function Rueckmeldungen({ mandant, onGeaendert }: { mandant: MandantDto | null; onGeaendert: () => void }) {
  const [filter, setFilter] = useState<RueckmeldungStatus | "">("neu");
  const [liste, setListe] = useState<RueckmeldungListeDto[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenId, setOffenId] = useState<string | null>(null);

  const laden = useCallback(() => {
    api
      .rueckmeldungListe(filter || undefined)
      .then((l) => {
        setListe(l);
        setFehler(null);
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen."));
  }, [filter]);

  useEffect(laden, [laden]);

  return (
    <div>
      <div className="zv-seiten-kopf">
        <h2>Rückmeldungen</h2>
        <div className="zv-field-inline">
          <label htmlFor="rueckmeldung-filter">Anzeigen</label>
          <select id="rueckmeldung-filter" value={filter} onChange={(e) => setFilter(e.target.value as RueckmeldungStatus | "")}>
            {FILTER.map((f) => (
              <option key={f.wert} value={f.wert}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mandant && !mandant.rueckmeldungWeitergabe && (
        <div className="zv-hinweis zv-hinweis-info">
          Die Weitergabe an den Hersteller ist ausgeschaltet: auch freigegebene Rückmeldungen bleiben bei Ihnen. Sie
          schalten sie in den Einstellungen ein.
        </div>
      )}
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      {liste && liste.length === 0 && !fehler && <Leerzustand icon={ILeerAnwaerter}>Keine Rückmeldungen für diese Auswahl.</Leerzustand>}

      <div className="zv-karten-liste">
        {liste?.map((r) => (
          <button key={r.id} type="button" className="zv-info-karte zv-info-karte-klickbar" onClick={() => setOffenId(r.id)}>
            <strong>{r.titel}</strong>
            <span className="zv-sub-inline">
              {r.art === "idee" ? "Idee" : "Fehler"} · {r.erstelltVonName} · {datum(r.erstelltAm)}
              {r.hatBild ? " · mit Screenshot" : ""}
            </span>
            <span className={PILL[r.status]}>{RUECKMELDUNG_STATUS_LABEL[r.status]}</span>
          </button>
        ))}
      </div>

      <Seitenpanel offen={offenId !== null} onSchliessen={() => setOffenId(null)}>
        {offenId && (
          <Detail
            key={offenId}
            id={offenId}
            weitergabe={mandant?.rueckmeldungWeitergabe ?? false}
            onGeaendert={() => {
              laden();
              onGeaendert();
            }}
          />
        )}
      </Seitenpanel>
    </div>
  );
}

function Detail({ id, weitergabe, onGeaendert }: { id: string; weitergabe: boolean; onGeaendert: () => void }) {
  const [r, setR] = useState<RueckmeldungDetailDto | null>(null);
  const [bildUrl, setBildUrl] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [notiz, setNotiz] = useState("");
  const [arbeitet, setArbeitet] = useState(false);

  useEffect(() => {
    let abgebrochen = false;
    let url: string | null = null;
    api
      .rueckmeldungDetail(id)
      .then(async (d) => {
        if (abgebrochen) return;
        setR(d);
        setNotiz(d.entscheidungsnotiz ?? "");
        if (d.hatBild) {
          url = await api.rueckmeldungBildUrl(id).catch(() => null);
          if (!abgebrochen) setBildUrl(url);
        }
      })
      .catch((err) => !abgebrochen && setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen."));
    return () => {
      abgebrochen = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  async function entscheiden(status: RueckmeldungEntscheidung) {
    if (arbeitet) return;
    setArbeitet(true);
    setFehler(null);
    try {
      setR(await api.rueckmeldungEntscheiden(id, status, notiz.trim() || undefined));
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setArbeitet(false);
    }
  }

  async function bildVerwerfen() {
    if (arbeitet) return;
    setArbeitet(true);
    try {
      await api.rueckmeldungBildVerwerfen(id);
      setBildUrl(null);
      setR((alt) => (alt ? { ...alt, hatBild: false } : alt));
      onGeaendert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Verwerfen fehlgeschlagen.");
    } finally {
      setArbeitet(false);
    }
  }

  if (!r) {
    return fehler ? (
      <div className="zv-hinweis zv-hinweis-fehler">
        <IFehler />
        {fehler}
      </div>
    ) : (
      <p className="zv-sub">Lädt…</p>
    );
  }

  const gesperrt = r.status === "umgesetzt";
  return (
    <div>
      <h3>{r.titel}</h3>
      <p>
        <span className={PILL[r.status]}>{RUECKMELDUNG_STATUS_LABEL[r.status]}</span>{" "}
        <span className="zv-sub-inline">
          {r.art === "idee" ? "Idee" : "Fehler"} · Priorität {r.prioritaet} · {r.erstelltVonName} · {datum(r.erstelltAm)}
        </span>
      </p>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <h4>{r.art === "idee" ? "Was soll sich ändern?" : "Was ist passiert?"}</h4>
      <p style={{ whiteSpace: "pre-wrap" }}>{r.beschreibung}</p>
      {r.erwartet && (
        <>
          <h4>{r.art === "idee" ? "Warum?" : "Erwartet"}</h4>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.erwartet}</p>
        </>
      )}

      {r.hatBild && bildUrl && (
        <>
          <h4>Screenshot</h4>
          <img src={bildUrl} alt="Screenshot der Seite, Texte sind unkenntlich gemacht" style={{ maxWidth: "100%", borderRadius: "var(--zv-radius-s)", border: "1px solid var(--zv-border)" }} />
          {!gesperrt && (
            <p>
              <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={bildVerwerfen} disabled={arbeitet}>
                Screenshot verwerfen
              </button>
              <span className="zv-sub-inline"> Falls doch etwas Personenbezogenes zu erkennen ist.</span>
            </p>
          )}
        </>
      )}

      <h4>Rahmenbedingungen</h4>
      <dl className="zv-detail-liste">
        {Object.entries(r.kontext).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
      </dl>

      {r.bearbeitungsnotiz && (
        <div className="zv-hinweis zv-hinweis-info">
          <strong>Notiz aus der Umsetzung:</strong> {r.bearbeitungsnotiz}
        </div>
      )}
      {r.prUrl && (
        <p>
          <a href={r.prUrl} target="_blank" rel="noreferrer noopener">
            Umsetzung ansehen
          </a>
        </p>
      )}

      {gesperrt ? (
        <div className="zv-hinweis zv-hinweis-erfolg">
          <IErfolg />
          Umgesetzt – abgeschlossen.
        </div>
      ) : (
        <>
          <div className="zv-field">
            <label htmlFor="rueckmeldung-notiz">Notiz an die meldende Person bzw. den Hersteller (bei Rückfrage und Ablehnung Pflicht)</label>
            <textarea id="rueckmeldung-notiz" rows={2} maxLength={2000} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
          </div>
          {r.status !== "freigegeben" && r.status !== "in_arbeit" && (
            <p className="zv-sub-inline">
              {weitergabe
                ? "Mit der Freigabe darf der Hersteller diese Rückmeldung lesen und umsetzen."
                : "Die Freigabe bleibt intern, solange die Weitergabe an den Hersteller ausgeschaltet ist."}
            </p>
          )}
          <div className="zv-aktionszeile">
            {r.status !== "freigegeben" && r.status !== "in_arbeit" && (
              <button type="button" className="zv-btn" onClick={() => entscheiden("freigegeben")} disabled={arbeitet}>
                Freigeben
              </button>
            )}
            <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => entscheiden("rueckfrage")} disabled={arbeitet || !notiz.trim()}>
              Rückfrage
            </button>
            <button type="button" className="zv-btn zv-btn-sekundaer" onClick={() => entscheiden("duplikat")} disabled={arbeitet}>
              Duplikat
            </button>
            <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => entscheiden("abgelehnt")} disabled={arbeitet || !notiz.trim()}>
              Ablehnen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
