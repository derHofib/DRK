import { CSSProperties, FormEvent, useEffect, useState } from "react";
import type { AccountTypDto, RechtRegistryEintragDto } from "@zimmerakte/shared";
import { api } from "../../api/client";
import { Modal } from "../../components/Modal";
import { Seitenpanel } from "../../components/Seitenpanel";
import { IAnpassen, IBearbeiten, IFehler, INeu, ISpeichern } from "../../components/icons";

/**
 * Scope ist in der DB/API absichtlich freier Text (keine DB-Enum, siehe
 * account_typ_recht), aber die Rechte-Engine kennt nur diese acht Werte
 * (Organigramm-Plan, Abschnitt "Rechte-Engine"). Die Auswahl hier bietet
 * deshalb genau diese Liste an, statt ein Freitextfeld zu zeigen.
 */
export const SCOPE_LABEL: Record<string, string> = {
  own: "Eigene",
  team: "Team",
  wohngruppe: "Wohngruppe",
  subtree: "Teilbaum (Linie)",
  einrichtung: "Einrichtung",
  bereich: "Bereich",
  tenant: "Trägerweit",
  assigned: "Zugewiesen",
};
const SCOPE_OPTIONEN = Object.keys(SCOPE_LABEL);

/**
 * Rechte-Matrix einer einzelnen Account-Typ-Zeile (Organigramm-Plan: "Matrix
 * als Grid-Komponente aus der registry.ts, dieselbe Liste wie
 * serverseitig"). Eine Zeile ohne Eintrag in `karte` ist ein impliziter
 * Deny -- exakt wie eine fehlende account_typ_recht-Zeile serverseitig.
 * Sammelt Aenderungen lokal und schreibt sie erst auf "Speichern" komplett
 * (PUT ersetzt die gesamte Rechte-Menge, kein Sinn in einem Request pro
 * Zelle).
 */
function AccountTypRechteEditor({
  accountTyp,
  registry,
  onAktualisiert,
}: {
  accountTyp: AccountTypDto;
  registry: RechtRegistryEintragDto[];
  onAktualisiert: () => void;
}) {
  const [karte, setKarte] = useState<Map<string, string>>(new Map());
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  useEffect(() => {
    const neu = new Map<string, string>();
    for (const r of accountTyp.rechte) if (r.erlaubt) neu.set(`${r.modul}.${r.aktion}`, r.scope);
    setKarte(neu);
    setFehler(null);
  }, [accountTyp.id, accountTyp.rechte]);

  async function speichern() {
    setFehler(null);
    setWirdGespeichert(true);
    try {
      const rechte = Array.from(karte.entries()).map(([schluessel, scope]) => {
        const [modul, aktion] = schluessel.split(".");
        return { modul, aktion, scope, erlaubt: true };
      });
      await api.organigrammAccountTypRechteSetzen(accountTyp.id, rechte);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Rechte konnten nicht gespeichert werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  if (accountTyp.istVollzugriff) {
    return (
      <div>
        <h3>{accountTyp.name}</h3>
        <p className="zv-sub">
          Alle Rechte, trägerweit -- nicht reduzierbar. Dieser Account-Typ ist die Wildcard für Geschäftsführung
          (Organigramm-Plan) und bekommt deshalb nie einzelne Rechte-Zeilen.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3>{accountTyp.name}</h3>
      <p className="zv-sub" style={{ marginBottom: 16 }}>
        Fehlt eine Zeile hier komplett, gilt sie als „Kein Zugriff" -- ohne dass jemand das pflegen müsste, wenn ein
        neues Modul dazukommt.
      </p>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr" } as CSSProperties}>
        <div className="zv-liste-kopf">
          <span>Modul · Aktion</span>
          <span>Zugriff</span>
        </div>
        {registry.map((r) => {
          const schluessel = `${r.modul}.${r.aktion}`;
          const wert = karte.get(schluessel) ?? "";
          return (
            <div className="zv-info-karte" key={schluessel}>
              <span className="zv-liste-zelle-titel">
                {r.modul} · {r.aktion}
                {r.sensibel && <span className="zv-sub-inline">sensibel</span>}
                {r.nieDelegierbar && <span className="zv-sub-inline">nie delegierbar</span>}
              </span>
              <span className="zv-liste-zelle" data-label="Zugriff">
                <select
                  value={wert}
                  onChange={(e) => {
                    const neu = new Map(karte);
                    if (e.target.value === "") neu.delete(schluessel);
                    else neu.set(schluessel, e.target.value);
                    setKarte(neu);
                  }}
                >
                  <option value="">Kein Zugriff</option>
                  {SCOPE_OPTIONEN.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          );
        })}
      </div>

      <button className="zv-btn zv-btn-block" type="button" onClick={speichern} disabled={wirdGespeichert} style={{ marginTop: 16 }}>
        <ISpeichern />
        {wirdGespeichert ? "Speichert…" : "Speichern"}
      </button>
    </div>
  );
}

/**
 * Account-Typ-Verwaltung -- Organigramm-Plan, Lieferreihenfolge Schritt
 * 7/UI. Liste + Anlegen/Umbenennen nach dem Muster von
 * `KassenbuchTypen.tsx` (`ist_system`-Zeilen mit eingeschränkter Aktion,
 * genau wie dort `istHzl`); die Rechte-Matrix selbst öffnet sich im
 * Seitenpanel, damit sie bei Bedarf per Vollbild mehr Platz bekommt.
 */
export function AccountTypenAnsicht({
  accountTypen,
  registry,
  onAktualisiert,
}: {
  accountTypen: AccountTypDto[];
  registry: RechtRegistryEintragDto[];
  onAktualisiert: () => void;
}) {
  const [neuOffen, setNeuOffen] = useState(false);
  const [umbenennenTyp, setUmbenennenTyp] = useState<AccountTypDto | null>(null);
  const [ausgewaehlteId, setAusgewaehlteId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [wirdGespeichert, setWirdGespeichert] = useState(false);

  const ausgewaehlt = accountTypen.find((a) => a.id === ausgewaehlteId) ?? null;

  async function anlegen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammAccountTypAnlegen({
        name: String(form.get("name") ?? "").trim(),
        kategorie: form.get("kategorie") as "intern" | "extern",
      });
      setNeuOffen(false);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Account-Typ konnte nicht angelegt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  async function umbenennen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!umbenennenTyp) return;
    const form = new FormData(e.currentTarget);
    setFehler(null);
    setWirdGespeichert(true);
    try {
      await api.organigrammAccountTypAktualisieren(umbenennenTyp.id, { name: String(form.get("name") ?? "").trim() });
      setUmbenennenTyp(null);
      onAktualisiert();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Account-Typ konnte nicht umbenannt werden.");
    } finally {
      setWirdGespeichert(false);
    }
  }

  return (
    <div>
      <div className="zv-vorschau-zeile" style={{ marginBottom: 16 }}>
        <button className="zv-btn" type="button" onClick={() => setNeuOffen(true)}>
          <INeu />
          Neuer Account-Typ
        </button>
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler">
          <IFehler />
          {fehler}
        </div>
      )}

      <div className="zv-karten-liste" style={{ "--zv-liste-spalten": "2fr 1fr 1fr 1.6fr" } as CSSProperties}>
        <div className="zv-liste-kopf">
          <span>Name</span>
          <span>Kategorie</span>
          <span>Rechte</span>
          <span></span>
        </div>
        {accountTypen.map((a) => (
          <div className="zv-info-karte" key={a.id}>
            <span className="zv-liste-zelle-titel">
              {a.name}
              {a.istSystem && <span className="zv-sub-inline">Systemvorlage</span>}
            </span>
            <span className="zv-liste-zelle" data-label="Kategorie">
              {a.kategorie === "extern" ? "Extern" : "Intern"}
            </span>
            <span className="zv-liste-zelle" data-label="Rechte">
              {a.istVollzugriff ? "Alle (Vollzugriff)" : `${a.rechte.length} erlaubt`}
            </span>
            <span className="zv-liste-zelle-aktionen">
              <button className="zv-link-btn" type="button" onClick={() => setAusgewaehlteId(a.id)}>
                <IAnpassen />
                Rechte bearbeiten
              </button>
              {!a.istSystem && (
                <button className="zv-link-btn" type="button" onClick={() => setUmbenennenTyp(a)}>
                  <IBearbeiten />
                  Umbenennen
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {neuOffen && (
        <Modal titel="Neuer Account-Typ" onClose={() => setNeuOffen(false)}>
          <form onSubmit={anlegen}>
            <div className="zv-field">
              <label htmlFor="accounttyp-name">Name</label>
              <input id="accounttyp-name" name="name" required autoFocus />
            </div>
            <div className="zv-field">
              <label htmlFor="accounttyp-kategorie">Kategorie</label>
              <select id="accounttyp-kategorie" name="kategorie" defaultValue="intern">
                <option value="intern">Intern</option>
                <option value="extern">Extern</option>
              </select>
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Anlegen"}
            </button>
          </form>
        </Modal>
      )}

      {umbenennenTyp && (
        <Modal titel="Account-Typ umbenennen" onClose={() => setUmbenennenTyp(null)}>
          <form onSubmit={umbenennen}>
            <div className="zv-field">
              <label htmlFor="accounttyp-umbenennen-name">Name</label>
              <input id="accounttyp-umbenennen-name" name="name" defaultValue={umbenennenTyp.name} required autoFocus />
            </div>
            <button className="zv-btn zv-btn-block" type="submit" disabled={wirdGespeichert} style={{ marginTop: 16 }}>
              <ISpeichern />
              {wirdGespeichert ? "Speichert…" : "Speichern"}
            </button>
          </form>
        </Modal>
      )}

      <Seitenpanel offen={ausgewaehlt !== null} onSchliessen={() => setAusgewaehlteId(null)}>
        {ausgewaehlt && <AccountTypRechteEditor accountTyp={ausgewaehlt} registry={registry} onAktualisiert={onAktualisiert} />}
      </Seitenpanel>
    </div>
  );
}
