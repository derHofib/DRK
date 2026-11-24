import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { BenutzerListEintragDto, DelegationDto, DelegationEffektiverStatus, RechtRegistryEintragDto, StandortDto } from "@zimmerakte/shared";
import { DELEGATION_EFFEKTIVER_STATUS_LABEL } from "@zimmerakte/shared";
import { api, tokenBenutzerId } from "../api/client";
import { formatDatum } from "../format";
import { Leerzustand } from "../components/Leerzustand";
import { Modal } from "../components/Modal";
import { IAbbrechen, IAblehnen, IFehler, IGenehmigen, ILeerVertretung, INeu, ISpeichern, IStornieren } from "../components/icons";
import { Zeitraumfeld } from "../components/Datumsfeld";

/**
 * Eigene Statusfarben, aber ausschliesslich ueber die vorhandenen
 * .zv-pill-*-Klassen aus app.css (CLAUDE.md Regel 7: keine Farbliterale in
 * der Komponente). "genehmigt" (noch nicht begonnen) bekommt bewusst eine
 * eigene Farbe statt dieselbe wie "beantragt" -- beides sind unterschiedliche
 * Wartezustaende (wartet auf Entscheidung vs. wartet auf den Starttermin).
 */
const STATUS_PILL: Record<DelegationEffektiverStatus, string> = {
  beantragt: "zv-pill-info",
  genehmigt: "zv-pill-offen",
  aktiv: "zv-pill-ok",
  abgelaufen: "zv-pill-vergeben",
  widerrufen: "zv-pill-danger",
};

/** "Du vertrittst X" / "X vertritt dich" -- je nachdem, welche der beiden Rollen der eingeloggte Benutzer einnimmt. */
function richtungText(d: DelegationDto, benutzerId: string | null): string {
  if (d.vertreterBenutzerId === benutzerId) return `Du vertrittst ${d.vertretenerName}`;
  return `${d.vertreterName} vertritt dich`;
}

type WiderrufZiel = { delegation: DelegationDto; alsAblehnung: boolean };

export function Vertretung() {
  const benutzerId = tokenBenutzerId();

  const [delegationen, setDelegationen] = useState<DelegationDto[]>([]);
  const [benutzerListe, setBenutzerListe] = useState<BenutzerListEintragDto[]>([]);
  const [registry, setRegistry] = useState<RechtRegistryEintragDto[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  // Fuer "Standorte" im Antrag: alle Standorte des Traegers, aus denen nur
  // die eigenen angeboten werden (Migration 0084).
  const [standorte, setStandorte] = useState<StandortDto[]>([]);

  const [neuOffen, setNeuOffen] = useState(false);
  const [umfang, setUmfang] = useState<"alle" | "auswahl">("alle");
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const [widerrufZiel, setWiderrufZiel] = useState<WiderrufZiel | null>(null);
  const [wirdEntschieden, setWirdEntschieden] = useState(false);

  function laden() {
    api
      .delegationenMeine()
      .then(setDelegationen)
      .catch((err) => setFehler(err instanceof Error ? err.message : "Vertretungen konnten nicht geladen werden."));
  }

  useEffect(() => {
    laden();
    api.benutzerListe().then(setBenutzerListe).catch(() => {});
  }, []);

  /**
   * Analog zu organigramm/AccountTypen.tsx (Account-Typ-Verwaltung): GET /rechte/registry
   * haengt an organigramm.manage-permissions, einem deutlich engeren Recht
   * als das, was diese Seite sonst braucht (nur @Authenticated(), siehe
   * delegation.controller.ts) -- heute praktisch nur Geschaeftsfuehrung-
   * Konten (siehe organigramm-lesen.e2e-spec.ts fuer dieselbe Einschraenkung
   * bei den Organigramm-Leseendpunkten). Deshalb NICHT im Haupt-laden() der
   * Seite mitgeladen, sondern erst bei Bedarf -- ein Konto ohne dieses Recht
   * soll beim blossen Oeffnen von "Vertretung" keinen Fehlerbanner sehen.
   * Bleibt registry leer (403), zeigt die Checkbox-Liste bei umfang=auswahl
   * schlicht "Keine delegierbaren Rechte verfügbar" -- umfang="alle" bleibt
   * fuer alle anderen Rollen uneingeschraenkt nutzbar.
   */
  function neuOeffnen() {
    setFormFehler(null);
    setUmfang("alle");
    setNeuOffen(true);
    if (registry.length === 0) api.rechteRegistry().then(setRegistry).catch(() => {});
    if (standorte.length === 0) api.standorteListe().then(setStandorte).catch(() => {});
  }

  // Man gibt nur weiter, was man selbst sieht (der Server prueft dasselbe).
  // Eigene Standorte sind vorbelegt; wer alle sieht (Leitung), muss bewusst
  // waehlen -- sonst wuerde aus einer Urlaubsvertretung still eine
  // traegerweite Sicht.
  const eigeneSicht = benutzerListe.find((b) => b.id === benutzerId)?.sicht ?? null;
  const standortWahl: { id: string; name: string; vorbelegt: boolean }[] = !eigeneSicht
    ? []
    : eigeneSicht.alle
      ? standorte.filter((s) => s.aktiv).map((s) => ({ id: s.id, name: s.name, vorbelegt: false }))
      : eigeneSicht.eintraege
          .filter((e) => e.herkunft !== "vertretung")
          .map((e) => ({ id: e.standortId, name: e.standortName, vorbelegt: true }));

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFormFehler(null);
    setWirdGespeichert(true);
    try {
      const umfangWert = String(form.get("umfang") ?? "alle") as "alle" | "auswahl";
      const rechte =
        umfangWert === "auswahl"
          ? form.getAll("rechte").map((eintrag) => {
              const [modul, aktion] = String(eintrag).split(".");
              return { modul, aktion };
            })
          : undefined;
      await api.delegationAnlegen({
        vertreterBenutzerId: String(form.get("vertreterBenutzerId") ?? ""),
        von: String(form.get("von") ?? ""),
        bis: String(form.get("bis") ?? ""),
        umfang: umfangWert,
        sensibleRechteEingeschlossen: form.get("sensibleRechteEingeschlossen") === "on",
        rechte,
        standortIds: form.getAll("standortIds").map(String),
      });
      setNeuOffen(false);
      setUmfang("alle");
      laden();
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Vertretung konnte nicht beantragt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function genehmigen(id: string) {
    setFehler(null);
    try {
      await api.delegationGenehmigen(id);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Vertretung konnte nicht genehmigt werden.");
    }
  }

  async function widerrufen() {
    if (!widerrufZiel) return;
    setFehler(null);
    setWirdEntschieden(true);
    try {
      await api.delegationWiderrufen(widerrufZiel.delegation.id);
      setWiderrufZiel(null);
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Vertretung konnte nicht widerrufen werden.");
    } finally {
      setWirdEntschieden(false);
    }
  }

  const vertreterOptionen = benutzerListe.filter((b) => b.id !== benutzerId && b.aktiv);
  const delegierbareRechte = registry.filter((r) => !r.nieDelegierbar);

  return (
    <div>
      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-seiten-kopf">
        <h2>Vertretung</h2>
        <button className="zv-btn" onClick={neuOeffnen}>
          <INeu />
          Neue Vertretung beantragen
        </button>
      </div>

      {delegationen.length === 0 && !fehler && (
        <Leerzustand icon={ILeerVertretung} aktion={<button type="button" className="zv-btn zv-btn-sekundaer" onClick={neuOeffnen}>Vertretung beantragen</button>}>
          Noch keine Vertretung beantragt oder erhalten.
        </Leerzustand>
      )}

      {delegationen.length > 0 && (
        <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1.6fr 1.3fr 1fr 2fr" } as CSSProperties}>
          <div className="zv-liste-kopf">
            <span>Vertretung</span>
            <span>Zeitraum</span>
            <span>Umfang</span>
            <span>Status</span>
            <span></span>
          </div>
          {delegationen.map((d) => {
            const istVertreter = d.vertreterBenutzerId === benutzerId;
            const istVertretener = d.vertretenerBenutzerId === benutzerId;
            const zeigeEntscheiden = istVertreter && d.effektiverStatus === "beantragt";
            // Widerrufen ist fachlich dieselbe Aktion wie "Ablehnen" eines
            // eigenen Antrags -- deshalb hier nur fuer Zeilen, die nicht
            // schon Genehmigen/Ablehnen zeigen (sonst zwei Knoepfe fuer
            // denselben PATCH-Aufruf in derselben Zeile).
            const zeigeWiderruf =
              !zeigeEntscheiden &&
              (istVertreter || istVertretener) &&
              (d.effektiverStatus === "beantragt" || d.effektiverStatus === "genehmigt" || d.effektiverStatus === "aktiv");

            return (
              <div key={d.id} className="zv-info-karte">
                <span className="zv-liste-zelle-titel">{richtungText(d, benutzerId)}</span>
                <span className="zv-liste-zelle" data-label="Zeitraum">
                  {formatDatum(d.von)} – {formatDatum(d.bis)}
                </span>
                <span className="zv-liste-zelle" data-label="Umfang">
                  {d.umfang === "alle" ? "Alle Rechte" : "Ausgewählte Rechte"}
                  {d.sensibleRechteEingeschlossen && <span className="zv-sub-inline">inkl. sensibler Rechte</span>}
                  {d.standorte.length > 0 && (
                    <span className="zv-sub-inline" style={{ display: "block", marginLeft: 0 }}>
                      + {d.standorte.map((s) => s.name).join(", ")}
                    </span>
                  )}
                </span>
                <span className="zv-liste-zelle" data-label="Status">
                  <span className={`zv-pill ${STATUS_PILL[d.effektiverStatus]}`}>
                    {DELEGATION_EFFEKTIVER_STATUS_LABEL[d.effektiverStatus]}
                  </span>
                </span>
                <span className="zv-liste-zelle-aktionen">
                  {zeigeEntscheiden && (
                    <>
                      <button className="zv-link-btn" onClick={() => genehmigen(d.id)}>
                        <IGenehmigen />
                        Genehmigen
                      </button>
                      <button className="zv-link-btn" onClick={() => setWiderrufZiel({ delegation: d, alsAblehnung: true })}>
                        <IAblehnen />
                        Ablehnen
                      </button>
                    </>
                  )}
                  {zeigeWiderruf && (
                    <button className="zv-link-btn" onClick={() => setWiderrufZiel({ delegation: d, alsAblehnung: false })}>
                      <IStornieren />
                      Widerrufen
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {neuOffen && (
        <Modal titel="Neue Vertretung beantragen" onClose={() => setNeuOffen(false)}>
          <form onSubmit={anlegen}>
            {formFehler && (
              <div className="zv-hinweis zv-hinweis-fehler">
                <IFehler />
                {formFehler}
              </div>
            )}
            <div className="zv-field">
              <label htmlFor="vertretung-vertreter">Vertreter/in</label>
              <select id="vertretung-vertreter" name="vertreterBenutzerId" required defaultValue="" autoFocus>
                <option value="" disabled>
                  Bitte wählen…
                </option>
                {vertreterOptionen.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="zv-field-row">
              <Zeitraumfeld
                von={{ id: "vertretung-von", name: "von", label: "Von", required: true }}
                bis={{ id: "vertretung-bis", name: "bis", label: "Bis", required: true }}
              />
            </div>
            <div className="zv-field">
              <label htmlFor="vertretung-umfang">Umfang</label>
              <select
                id="vertretung-umfang"
                name="umfang"
                value={umfang}
                onChange={(e) => setUmfang(e.target.value as "alle" | "auswahl")}
              >
                <option value="alle">Alle eigenen Rechte</option>
                <option value="auswahl">Nur ausgewählte Rechte</option>
              </select>
            </div>
            {umfang === "auswahl" && (
              <div className="zv-field">
                <label>Delegierte Rechte</label>
                {delegierbareRechte.length === 0 ? (
                  <p className="zv-sub">Keine delegierbaren Rechte verfügbar.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {delegierbareRechte.map((r) => (
                      <label key={`${r.modul}.${r.aktion}`} className="zv-checkbox-zeile">
                        <input type="checkbox" name="rechte" value={`${r.modul}.${r.aktion}`} />
                        {r.modul} · {r.aktion}
                        {r.sensibel && <span className="zv-sub-inline">sensibel</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {standortWahl.length > 0 && (
              <fieldset className="zv-vertretung-standorte">
                <legend>Standorte</legend>
                <p className="zv-sub">Während der Vertretung sieht deine Vertretung zusätzlich die Klient:innen und die Dokumentation von:</p>
                {standortWahl.map((s) => (
                  <label key={s.id} className="zv-checkbox-zeile">
                    <input type="checkbox" name="standortIds" value={s.id} defaultChecked={s.vorbelegt} />
                    {s.name}
                  </label>
                ))}
                <p className="zv-sub">
                  {eigeneSicht?.alle
                    ? "Du siehst alle Standorte. Damit daraus keine trägerweite Sicht wird, ist nichts vorbelegt. Ohne Haken gibt die Vertretung nur Rechte weiter."
                    : "Vorbelegt mit deinen Standorten. Mehr, als du selbst siehst, lässt sich nicht weitergeben."}
                </p>
              </fieldset>
            )}
            <label className="zv-checkbox-zeile" style={{ marginTop: 8 }}>
              <input type="checkbox" name="sensibleRechteEingeschlossen" />
              Auch sensible Rechte einschließen
            </label>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Beantragen"}
            </button>
          </form>
        </Modal>
      )}

      {widerrufZiel && (
        <Modal
          titel={widerrufZiel.alsAblehnung ? "Vertretung ablehnen" : "Vertretung widerrufen"}
          onClose={() => setWiderrufZiel(null)}
        >
          <p className="zv-sub" style={{ marginTop: 0 }}>
            {widerrufZiel.alsAblehnung
              ? `Lehnt den Antrag von ${widerrufZiel.delegation.vertretenerName} ab.`
              : `Beendet die Vertretung zwischen ${widerrufZiel.delegation.vertretenerName} und ${widerrufZiel.delegation.vertreterName} sofort.`}
          </p>
          <div className="zv-vorschau-zeile" style={{ marginTop: 16 }}>
            <button className="zv-btn" type="button" onClick={widerrufen} disabled={wirdEntschieden}>
              {widerrufZiel.alsAblehnung ? <IAblehnen /> : <IStornieren />}
              {wirdEntschieden ? "Speichert…" : widerrufZiel.alsAblehnung ? "Ablehnen" : "Widerrufen"}
            </button>
            <button className="zv-btn zv-btn-still" type="button" onClick={() => setWiderrufZiel(null)}>
              <IAbbrechen />
              Abbrechen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
