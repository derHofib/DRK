import { useEffect, useState } from "react";
import type {
  BenutzerListEintragDto,
  MitarbeiterProfilKollegeDto,
  MitarbeiterZustaendigkeitDto,
  ZustaendigKlientenDto,
  ZustaendigVertretungDto,
} from "@zimmerakte/shared";
import { api } from "../api/client";
import { formatDatum } from "../format";
import { personFarbStil } from "../personFarbe";
import { MitarbeiterProfilKarte } from "./MitarbeiterProfilKarte";
import { Seitenpanel } from "./Seitenpanel";
import { IBezugsbetreuung, IErreichbarkeit, IFehler, IInfo, IMail, INeuerChat, ISperre, IVertretung, IVor } from "./icons";

/**
 * Wofuer eine Person zustaendig ist (Rueckmeldung 29e0f19d): Bezugsklient:innen
 * und Vertretungen in einem Seitenpanel, wie bei den Klient:innen. Konzept:
 * /mnt/project-files/mitarbeiter-detail/. Ersetzt das fruehere Profil-Fenster;
 * der Profilinhalt steht unten im Panel.
 */
export function MitarbeiterDetail({
  person,
  onSchliessen,
  onKlientOeffnen,
  onChatOeffnen,
}: {
  person: BenutzerListEintragDto | null;
  onSchliessen: () => void;
  onKlientOeffnen?: (klientId: string) => void;
  onChatOeffnen?: (chatId: string) => void;
}) {
  const [daten, setDaten] = useState<MitarbeiterZustaendigkeitDto | null>(null);
  const [profil, setProfil] = useState<MitarbeiterProfilKollegeDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Das Panel bleibt fuer die Ausfahr-Animation im DOM (Seitenpanel.tsx);
  // deshalb die zuletzt gezeigte Person merken statt sofort leer zu rendern.
  const [gezeigt, setGezeigt] = useState<BenutzerListEintragDto | null>(null);

  useEffect(() => {
    if (!person) return;
    setGezeigt(person);
    setDaten(null);
    setProfil(null);
    setFehler(null);
    let aktuell = true;
    api
      .mitarbeiterZustaendigkeit(person.id)
      .then((d) => aktuell && setDaten(d))
      .catch((err) => aktuell && setFehler(err instanceof Error ? err.message : "Zuständigkeiten konnten nicht geladen werden."));
    // Das Profil ist Zugabe: fehlt es, bleibt das Panel trotzdem nutzbar.
    api
      .profilKollege(person.id)
      .then((p) => aktuell && setProfil(p))
      .catch(() => undefined);
    return () => {
      aktuell = false;
    };
  }, [person]);

  async function nachricht() {
    if (!gezeigt || !onChatOeffnen) return;
    try {
      const chat = await api.chatDirektAnlegen({ benutzerId: gezeigt.id });
      onChatOeffnen(chat.id);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Chat konnte nicht geöffnet werden.");
    }
  }

  const p = gezeigt;
  const telefon = profil?.telefon ?? null;
  const email = profil?.emailDienstlich ?? null;
  const ortText = p ? ortVon(p) : null;
  const vertrittZahl = daten?.vertritt.filter((v) => v.laeuft).reduce((s, v) => s + anzahl(v.klienten), 0) ?? 0;
  const laufendBis = daten?.vertritt.filter((v) => v.laeuft).map((v) => v.bis).sort()[0];
  const selbst = daten?.wirdVertretenVon[0];

  return (
    <Seitenpanel offen={person !== null} onSchliessen={onSchliessen}>
      {p && (
        <div className="zv-ma-detail">
          <div className="zv-ma-kopf">
            <span className="zv-ma-kachel" style={personFarbStil(p.farbIndex)} aria-hidden="true">
              {kuerzel(p.name)}
            </span>
            <div className="zv-ma-kopf-text">
              <h2 className="zv-ma-name">{p.name}</h2>
              <div className="zv-ma-unter">
                {[p.positionen.map((x) => x.titel).join(", ") || "Keine Position", ortText].filter(Boolean).join(" · ")}
                {!p.aktiv && " · deaktiviert"}
              </div>
              <div className="zv-ma-knoepfe">
                {onChatOeffnen && p.aktiv && (
                  <button type="button" className="zv-btn zv-btn-klein" onClick={nachricht}>
                    <INeuerChat />
                    Nachricht
                  </button>
                )}
                {telefon && (
                  // tel: nimmt nur Ziffern und "+" (wie MitarbeiterProfilKarte).
                  <a className="zv-btn zv-btn-still zv-btn-klein" href={`tel:${telefon.replace(/[^\d+]/g, "")}`}>
                    <IErreichbarkeit />
                    {telefon}
                  </a>
                )}
                {email && (
                  <a className="zv-btn zv-btn-still zv-btn-klein" href={`mailto:${email}`}>
                    <IMail />
                    E-Mail
                  </a>
                )}
              </div>
            </div>
          </div>

          {fehler && (
            <div className="zv-hinweis zv-hinweis-fehler">
              <IFehler />
              {fehler}
            </div>
          )}

          {!daten && !fehler && <p className="zv-sub">Wird geladen …</p>}

          {daten && (
            <>
              <div className="zv-ma-zahlen">
                <div className="zv-ma-zahl">
                  <b>{anzahl(daten.bezug)}</b>
                  <span>{anzahl(daten.bezug) === 1 ? "Bezugsklient:in" : "Bezugsklient:innen"}</span>
                </div>
                {vertrittZahl > 0 && laufendBis && (
                  <div className="zv-ma-zahl">
                    <b>+{vertrittZahl}</b>
                    <span>als Vertretung bis {formatDatum(laufendBis).slice(0, 6)}</span>
                  </div>
                )}
                {selbst && (
                  <div className="zv-ma-zahl">
                    <b>{zeitraumKurz(selbst)}</b>
                    <span>{selbst.laeuft ? "wird vertreten" : "wird vertreten (geplant)"}</span>
                  </div>
                )}
              </div>

              {!daten.aktiv && anzahl(daten.bezug) > 0 && (
                <div className="zv-hinweis zv-hinweis-achtung">
                  <IFehler />
                  {daten.name} ist deaktiviert, steht aber noch bei {klientenText(anzahl(daten.bezug))} als Bezugsbetreuung.
                  Bitte in der Akte eine neue Bezugsbetreuung eintragen.
                </div>
              )}

              <section className="zv-ma-abschnitt" aria-label="Bezugsbetreuung">
                <div className="zv-ma-abschnitt-kopf">
                  <IBezugsbetreuung />
                  <h3>Bezugsbetreuung</h3>
                  {anzahl(daten.bezug) > 0 && <span className="zv-sub-inline">{klientenText(anzahl(daten.bezug))}</span>}
                </div>
                {anzahl(daten.bezug) === 0 ? (
                  <p className="zv-sub">{daten.name} ist bei keiner Klientin und keinem Klienten als Bezugsbetreuung eingetragen.</p>
                ) : (
                  <KlientenListe klienten={daten.bezug} onKlientOeffnen={onKlientOeffnen} />
                )}
              </section>

              <section className="zv-ma-abschnitt" aria-label="Vertretung">
                <div className="zv-ma-abschnitt-kopf">
                  <IVertretung />
                  <h3>Vertretung</h3>
                </div>
                {daten.vertritt.length === 0 && daten.wirdVertretenVon.length === 0 ? (
                  <p className="zv-sub">Gerade und demnächst keine Vertretung.</p>
                ) : (
                  <>
                    {daten.vertritt.map((v) => (
                      <VertretungKarte key={v.delegationId} titel={`Vertritt ${v.name}`} v={v} onKlientOeffnen={onKlientOeffnen} />
                    ))}
                    {daten.wirdVertretenVon.map((v) => (
                      <VertretungKarte key={v.delegationId} titel={`Wird vertreten von ${v.name}`} v={v} />
                    ))}
                  </>
                )}
                <p className="zv-ma-hinweis">
                  <IInfo />
                  Gezeigt werden genehmigte Vertretungen, die laufen oder noch kommen. Welche Rechte weitergegeben wurden,
                  sehen nur die Beteiligten.
                </p>
              </section>
            </>
          )}

          {profil && (profil.erreichbarkeit || profil.bevorzugteKontaktart || profil.ueberMich) && (
            <section className="zv-ma-abschnitt" aria-label="Profil">
              <div className="zv-ma-abschnitt-kopf">
                <h3>Profil</h3>
              </div>
              <MitarbeiterProfilKarte inhalt={{ ...profil, telefon: null, emailDienstlich: null }} leerText="" />
            </section>
          )}
        </div>
      )}
    </Seitenpanel>
  );
}

function KlientenListe({ klienten, onKlientOeffnen }: { klienten: ZustaendigKlientenDto; onKlientOeffnen?: (id: string) => void }) {
  return (
    <>
      <ul className="zv-ma-liste">
        {klienten.sichtbar.map((k) => {
          const ort = [k.standortName, k.zimmerNummer ? `Zimmer ${k.zimmerNummer}` : null].filter(Boolean).join(" · ") || "Zurzeit ohne Zimmer";
          const inhalt = (
            <>
              <span className="zv-ma-zeile-text">
                <b>{k.name}</b>
                <small>{ort}</small>
              </span>
              {onKlientOeffnen && <IVor />}
            </>
          );
          return (
            <li key={k.klientId}>
              {onKlientOeffnen ? (
                <button type="button" className="zv-ma-zeile" onClick={() => onKlientOeffnen(k.klientId)} title="Akte öffnen">
                  {inhalt}
                </button>
              ) : (
                <div className="zv-ma-zeile">{inhalt}</div>
              )}
            </li>
          );
        })}
      </ul>
      {klienten.verborgen > 0 && (
        <p className="zv-ma-hinweis">
          <ISperre />
          {klienten.sichtbar.length > 0 ? `${klienten.verborgen} weitere` : klientenText(klienten.verborgen)}{" "}
          {klienten.verborgen === 1 ? "an einem Standort, den du nicht siehst" : "an Standorten, die du nicht siehst"}
        </p>
      )}
    </>
  );
}

function VertretungKarte({ titel, v, onKlientOeffnen }: { titel: string; v: ZustaendigVertretungDto; onKlientOeffnen?: (id: string) => void }) {
  const meta = [`${formatDatum(v.von)} bis ${formatDatum(v.bis)}`, v.standorte.length > 0 ? `mit ${v.standorte.length === 1 ? "Standort" : "Standorten"} ${v.standorte.join(", ")}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`zv-ma-vkarte${v.laeuft ? "" : " zv-ma-vkarte-geplant"}`}>
      <div className="zv-ma-vtitel">
        {titel}
        {v.laeuft ? (
          <span className="zv-pill zv-pill-ok">
            <span className="zv-pill-text">läuft</span>
          </span>
        ) : (
          <span className="zv-pill">
            <span className="zv-pill-text">ab {formatDatum(v.von).slice(0, 6)}</span>
          </span>
        )}
      </div>
      <div className="zv-ma-vmeta">{meta}</div>
      {v.klienten && anzahl(v.klienten) > 0 && (
        <>
          <div className="zv-ma-vmeta">In dieser Zeit mit zuständig für:</div>
          <KlientenListe klienten={v.klienten} onKlientOeffnen={onKlientOeffnen} />
        </>
      )}
    </div>
  );
}

function anzahl(k: ZustaendigKlientenDto | null): number {
  return k ? k.sichtbar.length + k.verborgen : 0;
}

function klientenText(n: number): string {
  return n === 1 ? "1 Klient:in" : `${n} Klient:innen`;
}

function kuerzel(name: string): string {
  const teile = name.trim().split(/\s+/);
  return ((teile[0]?.[0] ?? "") + (teile.length > 1 ? teile[teile.length - 1][0] : "")).toUpperCase();
}

function ortVon(p: BenutzerListEintragDto): string | null {
  if (p.sicht.alle) return null;
  const eigene = p.sicht.eintraege.filter((e) => e.herkunft !== "vertretung").map((e) => e.standortName);
  return eigene.length > 0 ? eigene.join(", ") : null;
}

function zeitraumKurz(v: ZustaendigVertretungDto): string {
  return `${formatDatum(v.von).slice(0, 6)}–${formatDatum(v.bis).slice(0, 6)}`;
}
