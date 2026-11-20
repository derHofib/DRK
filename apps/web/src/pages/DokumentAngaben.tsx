import { useEffect, useState } from "react";
import type { TraegerAngabenDto, TraegerDateiDto } from "@zimmerakte/shared";
import { api } from "../api/client";
import { IErfolg, IFehler, IHochladen, ILoeschen, ISpeichern } from "../components/icons";
import { formatDatum } from "../format";

/**
 * Einstellungen › Träger › Angaben für Dokumente (Konzept „formular-pdf",
 * Fassung 2): NUR Daten, kein Design. Jeder PDF-Export eines Formulars
 * entscheidet selbst, ob und wo diese Angaben erscheinen (Platzhalter wie
 * {traeger.name}). Deshalb gibt es hier auch keine Vorschau eines Briefkopfs:
 * es gibt keinen einen Briefkopf.
 */

const FELDER: { schluessel: keyof TraegerAngabenDto; label: string; hinweis?: string; breit?: boolean }[] = [
  { schluessel: "name", label: "Name des Trägers", hinweis: "So, wie er im Briefkopf stehen soll, z. B. mit gGmbH.", breit: true },
  { schluessel: "hauptsitz", label: "Hauptsitz (Anschrift)", hinweis: "Für die Rücksendezeile über dem Anschriftfeld.", breit: true },
  { schluessel: "telefon", label: "Telefon" },
  { schluessel: "email", label: "E-Mail" },
  { schluessel: "website", label: "Website" },
  { schluessel: "geschaeftsfuehrung", label: "Geschäftsführung" },
  { schluessel: "registergericht", label: "Registergericht" },
  { schluessel: "registernummer", label: "Registernummer" },
  { schluessel: "steuernummer", label: "Steuernummer" },
  { schluessel: "bank", label: "Bank" },
  { schluessel: "iban", label: "IBAN" },
  { schluessel: "bic", label: "BIC" },
];

function groesseText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function DokumentAngaben() {
  const [angaben, setAngaben] = useState<TraegerAngabenDto | null>(null);
  const [gespeichert, setGespeichert] = useState<TraegerAngabenDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    api
      .dokumentAngaben()
      .then((a) => {
        setAngaben(a);
        setGespeichert(a);
      })
      .catch((e: Error) => setFehler(e.message));
  }, []);

  const geaendert = angaben !== null && JSON.stringify(angaben) !== JSON.stringify(gespeichert);

  async function speichern() {
    if (!angaben) return;
    setSpeichert(true);
    setFehler(null);
    try {
      const neu = await api.dokumentAngabenSpeichern(angaben);
      setAngaben(neu);
      setGespeichert(neu);
      setErfolg("Gespeichert. Neue PDFs verwenden die Angaben sofort.");
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <>
      <section className="zv-einstellungen-abschnitt zv-einstellungen-abschnitt-breit">
        <h3>Angaben zum Träger</h3>
        <p className="zv-sub">
          Daten für Briefköpfe, Infospalten und Fußzeilen. Ob und wo sie erscheinen, entscheidet jeder PDF-Export eines
          Formulars selbst. Leere Angaben fallen in den PDFs samt ihrer Zeile weg.
        </p>
        {fehler && (
          <div className="zv-hinweis zv-hinweis-fehler">
            <IFehler />
            {fehler}
          </div>
        )}
        {erfolg && !geaendert && (
          <div className="zv-hinweis zv-hinweis-erfolg">
            <IErfolg />
            {erfolg}
          </div>
        )}
        {angaben && (
          <div className="zv-dok-angaben">
            {FELDER.map((f) => (
              <div key={f.schluessel} className={`zv-field${f.breit ? " zv-dok-angaben-breit" : ""}`}>
                <label htmlFor={`dok-${f.schluessel}`}>{f.label}</label>
                <input
                  id={`dok-${f.schluessel}`}
                  value={angaben[f.schluessel] ?? ""}
                  onChange={(e) => {
                    setAngaben({ ...angaben, [f.schluessel]: e.target.value || null });
                    setErfolg(null);
                  }}
                />
                <span className="zv-sub-inline">
                  <code>{`{traeger.${f.schluessel}}`}</code>
                  {f.hinweis ? ` · ${f.hinweis}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
          <button className="zv-btn" onClick={speichern} disabled={!geaendert || speichert}>
            <ISpeichern />
            {speichert ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </section>
      <Logos />
    </>
  );
}

function Logos() {
  const [dateien, setDateien] = useState<TraegerDateiDto[]>([]);
  const [bilder, setBilder] = useState<Record<string, string>>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  async function laden() {
    try {
      const d = await api.traegerDateien();
      setDateien(d);
      // Vorschaubild nur fuer Rasterbilder; ein PDF-Logo zeigt sein Symbol.
      for (const x of d) {
        if (x.mime !== "application/pdf" && !bilder[x.id]) {
          api.traegerDateiUrl(x.id).then((url) => setBilder((b) => ({ ...b, [x.id]: url }))).catch(() => undefined);
        }
      }
    } catch (e) {
      setFehler((e as Error).message);
    }
  }

  useEffect(() => {
    void laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="zv-einstellungen-abschnitt zv-einstellungen-abschnitt-breit">
      <h3>Logos</h3>
      <p className="zv-sub">
        PNG, JPEG, SVG oder PDF (z. B. das Logo aus der Briefvorlage). Ein PDF-Logo bleibt im Ausdruck gestochen scharf.
        Welches Logo ein Export zeigt, wählen Sie beim Gestalten des Exports.
      </p>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}
      <ul className="zv-dok-logos">
        {dateien.map((d) => (
          <li key={d.id}>
            <span className="zv-dok-logo-bild">{bilder[d.id] ? <img src={bilder[d.id]} alt="" /> : <span className="zv-sub">PDF</span>}</span>
            <span className="zv-dok-logo-text">
              <strong>{d.name}</strong>
              <span className="zv-sub">
                {groesseText(d.groesse)} · hochgeladen am {formatDatum(d.hochgeladenAm.slice(0, 10))} ·{" "}
                {d.benutzt > 0 ? `in ${d.benutzt} Export${d.benutzt === 1 ? "" : "en"} benutzt` : "nicht benutzt"}
              </span>
            </span>
            <button
              type="button"
              className="zv-btn zv-btn-sekundaer zv-btn-klein"
              disabled={d.benutzt > 0}
              title={d.benutzt > 0 ? "Wird in einem PDF-Export benutzt" : undefined}
              onClick={async () => {
                try {
                  await api.traegerDateiLoeschen(d.id);
                  await laden();
                } catch (e) {
                  setFehler((e as Error).message);
                }
              }}
            >
              <ILoeschen />
              Löschen
            </button>
          </li>
        ))}
        {dateien.length === 0 && <li className="zv-sub">Noch kein Logo hochgeladen.</li>}
      </ul>
      <label className={`zv-btn zv-btn-sekundaer${laedt ? " is-disabled" : ""}`}>
        <IHochladen />
        {laedt ? "Lädt hoch…" : "Logo hochladen"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,application/pdf"
          hidden
          disabled={laedt}
          onChange={async (e) => {
            const input = e.currentTarget;
            const datei = input.files?.[0];
            if (!datei) return;
            setLaedt(true);
            setFehler(null);
            try {
              await api.logoHochladen(datei);
              await laden();
            } catch (err) {
              setFehler((err as Error).message);
            } finally {
              setLaedt(false);
              input.value = "";
            }
          }}
        />
      </label>
    </section>
  );
}
