import { FormEvent, useCallback, useEffect, useState } from "react";
import type { KlientZugangDto } from "@zimmerakte/shared";
import { ApiFehler, api } from "../api/client";
import { formatDatum } from "../format";
import { IBestaetigen, IDeaktivieren, IAktivieren, IFehler, IKopieren, IMail, IResetLink } from "./icons";

interface ErzeugterLink {
  art: "einladung" | "email-aendern";
  url: string;
  laeuftAbAm: string;
  adresse: string;
}

const STATUS_TEXT: Record<KlientZugangDto["status"], { label: string; pill: string }> = {
  keiner: { label: "Kein Zugang", pill: "zv-pill-vergeben" },
  eingeladen: { label: "Eingeladen", pill: "zv-pill-offen" },
  aktiv: { label: "Aktiv", pill: "zv-pill-ok" },
  deaktiviert: { label: "Deaktiviert", pill: "zv-pill-danger" },
};

function mailtoFuer(l: ErzeugterLink): string {
  const bis = formatDatum(l.laeuftAbAm.slice(0, 10));
  const betreff = l.art === "einladung" ? "Ihre Einladung zur hecaso-App" : "E-Mail-Adresse in der hecaso-App ändern";
  const zeilen =
    l.art === "einladung"
      ? ["Guten Tag,", "", "Sie wurden zur hecaso-App eingeladen. Über diesen Link legen Sie Ihr Passwort fest:", "", l.url, "", `Der Link ist bis zum ${bis} gültig und kann nur einmal verwendet werden.`, "", "Viele Grüße"]
      : ["Guten Tag,", "", "über diesen Link können Sie die E-Mail-Adresse für Ihren Zugang zur hecaso-App ändern. Halten Sie dafür Ihr Passwort bereit:", "", l.url, "", `Der Link ist bis zum ${bis} gültig und kann nur einmal verwendet werden.`, "", "Viele Grüße"];
  return `mailto:${encodeURIComponent(l.adresse)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(zeilen.join("\r\n"))}`;
}

async function inZwischenablage(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Kein Clipboard-API (z. B. unsicherer Kontext): ueber ein markiertes Feld kopieren.
    const feld = document.createElement("textarea");
    feld.value = text;
    feld.style.position = "fixed";
    feld.style.opacity = "0";
    document.body.appendChild(feld);
    feld.select();
    try {
      return document.execCommand("copy");
    } finally {
      feld.remove();
    }
  }
}

export function KlientZugang({ klientId }: { klientId: string }) {
  const [zugang, setZugang] = useState<KlientZugangDto | null>(null);
  const [verborgen, setVerborgen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [email, setEmail] = useState("");
  const [neueEmail, setNeueEmail] = useState("");
  const [link, setLink] = useState<ErzeugterLink | null>(null);
  const [kopiert, setKopiert] = useState<boolean | null>(null);

  const laden = useCallback(() => {
    api
      .klientZugang(klientId)
      .then((z) => {
        setZugang(z);
        setFehler(null);
      })
      // 403 = kein Recht "zugang-verwalten": den Bereich dann gar nicht erst zeigen.
      .catch((err) => (err instanceof ApiFehler && err.status === 403 ? setVerborgen(true) : setFehler(err instanceof Error ? err.message : "Zugang konnte nicht geladen werden.")));
  }, [klientId]);

  useEffect(laden, [laden]);

  async function aktion(fn: () => Promise<void>, fallback: string) {
    setLaeuft(true);
    setFehler(null);
    try {
      await fn();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : fallback);
    } finally {
      setLaeuft(false);
    }
  }

  function zeigeLink(art: ErzeugterLink["art"], pfad: string, laeuftAbAm: string, adresse: string) {
    setKopiert(null);
    setLink({ art, url: `${window.location.origin}${pfad}`, laeuftAbAm, adresse });
  }

  function einladen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const adresse = email.trim();
    void aktion(async () => {
      const r = await api.klientZugangEinladen(klientId, adresse);
      zeigeLink("einladung", r.einladungsLink, r.laeuftAbAm, adresse);
      setEmail("");
      laden();
    }, "Einladung fehlgeschlagen.");
  }

  function neuEinladen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const korrigiert = neueEmail.trim();
    void aktion(async () => {
      const r = await api.klientZugangNeuEinladen(klientId, korrigiert || undefined);
      zeigeLink("einladung", r.einladungsLink, r.laeuftAbAm, korrigiert || zugang?.email || "");
      setNeueEmail("");
      laden();
    }, "Neu einladen fehlgeschlagen.");
  }

  function emailLink() {
    void aktion(async () => {
      const r = await api.klientZugangEmailAendernLink(klientId);
      zeigeLink("email-aendern", r.link, r.laeuftAbAm, zugang?.email ?? "");
      laden();
    }, "Link konnte nicht erzeugt werden.");
  }

  function aktivSetzen(aktiv: boolean) {
    void aktion(async () => {
      setZugang(await api.klientZugangAktivSetzen(klientId, aktiv));
      if (!aktiv) setLink(null);
    }, "Änderung fehlgeschlagen.");
  }

  if (verborgen) return null;

  const status = zugang?.status ?? "keiner";
  return (
    <div className="zv-card zv-card-weit" data-testid="klient-zugang">
      <div className="zv-seiten-kopf" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Zugang zur App</h3>
        {zugang && <span className={`zv-pill ${STATUS_TEXT[status].pill}`}>{STATUS_TEXT[status].label}</span>}
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}

      {zugang && zugang.email && (
        <p className="zv-sub" style={{ marginTop: 0 }}>
          E-Mail-Adresse: <strong>{zugang.email}</strong>
          {status === "eingeladen" && zugang.einladungLaeuftAbAm && (zugang.einladungAbgelaufen ? " · Einladung abgelaufen" : ` · Einladung gültig bis ${formatDatum(zugang.einladungLaeuftAbAm.slice(0, 10))}`)}
        </p>
      )}

      {link && (
        <div className="zv-hinweis zv-hinweis-info zv-zugang-link" role="status">
          <div style={{ width: "100%", minWidth: 0 }}>
            <strong>{link.art === "einladung" ? "Einladungslink" : "Link zum Ändern der E-Mail-Adresse"}</strong>
            <p style={{ margin: "4px 0" }}>
              Dieser Link wird nur einmal angezeigt. Bitte jetzt kopieren oder per E-Mail versenden. Gültig bis {formatDatum(link.laeuftAbAm.slice(0, 10))}.
            </p>
            <input className="zv-field-inline" readOnly value={link.url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
            <div className="zv-aktionszeile" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="zv-btn zv-btn-klein"
                onClick={async () => setKopiert(await inZwischenablage(link.url))}
              >
                {kopiert ? <IBestaetigen /> : <IKopieren />}
                {kopiert ? "Kopiert" : "Link kopieren"}
              </button>
              <a className="zv-btn zv-btn-sekundaer zv-btn-klein" href={mailtoFuer(link)} style={{ textDecoration: "none" }}>
                <IMail />
                Per E-Mail senden
              </a>
              <button type="button" className="zv-btn zv-btn-still zv-btn-klein" onClick={() => setLink(null)}>
                Fertig
              </button>
            </div>
            {kopiert === false && <p className="zv-fehlertext" style={{ margin: "4px 0 0" }}>Kopieren nicht möglich. Bitte den Link im Feld markieren und von Hand kopieren.</p>}
          </div>
        </div>
      )}

      {zugang && status === "keiner" && (
        <form onSubmit={einladen} className="zv-inline-zeile">
          <div className="zv-field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label htmlFor="zugang-email">E-Mail-Adresse der Person</label>
            <input id="zugang-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </div>
          <button className="zv-btn" type="submit" disabled={laeuft || !email.trim()}>
            <IMail />
            Einladen
          </button>
        </form>
      )}

      {zugang && (status === "eingeladen" || status === "aktiv") && (
        <form onSubmit={neuEinladen} className="zv-inline-zeile">
          {status === "eingeladen" && (
            <div className="zv-field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label htmlFor="zugang-neue-email">Korrigierte E-Mail-Adresse (optional)</label>
              <input id="zugang-neue-email" type="email" value={neueEmail} onChange={(e) => setNeueEmail(e.target.value)} autoComplete="off" />
            </div>
          )}
          <button className="zv-btn zv-btn-sekundaer" type="submit" disabled={laeuft}>
            <IResetLink />
            Neu einladen
          </button>
        </form>
      )}

      {zugang && (status === "aktiv" || status === "deaktiviert" || status === "eingeladen") && (
        <div className="zv-aktionszeile">
          {status === "aktiv" && (
            <button type="button" className="zv-btn zv-btn-sekundaer" onClick={emailLink} disabled={laeuft}>
              <IResetLink />
              Link zum Ändern der E-Mail erzeugen
            </button>
          )}
          {status === "deaktiviert" ? (
            <button type="button" className="zv-btn" onClick={() => aktivSetzen(true)} disabled={laeuft}>
              <IAktivieren />
              Zugang aktivieren
            </button>
          ) : (
            <button type="button" className="zv-btn zv-btn-gefahr" onClick={() => aktivSetzen(false)} disabled={laeuft}>
              <IDeaktivieren />
              Zugang deaktivieren
            </button>
          )}
        </div>
      )}
    </div>
  );
}
