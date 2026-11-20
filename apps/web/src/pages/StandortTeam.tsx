import { useState } from "react";
import {
  ABWESENHEIT_ART_LABEL,
  type MitarbeiterProfilKollegeDto,
  type StandortTeamDto,
  type StandortTeamPersonDto,
} from "@zimmerakte/shared";
import { api, tokenBenutzerId } from "../api/client";
import { MitarbeiterProfilKarte } from "../components/MitarbeiterProfilKarte";
import { Modal } from "../components/Modal";
import {
  IAufklappen,
  IBezugsbetreuung,
  IErreichbarkeit,
  IFehler,
  IMitarbeitende,
  INachrichten,
  IOrganigramm,
  IPerson,
  IStandort,
  ITelefonat,
  IZuklappen,
} from "../components/icons";
import { formatDatum, heuteBerlin } from "../format";
import { personFarbStil } from "../personFarbe";

/**
 * "Leitung & Team" im Standort-Steckbrief als kleine Karten (Rueckmeldung
 * "Standorte Mitarbeiter", Konzept standort-team). Vorher stand hier nur
 * die Zahl der Mitarbeitenden -- wer da arbeitet, wie man sie erreicht und
 * wer heute fehlt, musste man woanders suchen.
 *
 * Jede Zeile einer Karte erscheint nur, wenn es dazu etwas gibt: eine Karte
 * ohne Angaben ist klein, nicht voller "–".
 *
 * Bewusst KEIN "heute im Dienst": es gibt keinen Dienstplan, die App weiss
 * nur, wer abwesend ist. Deshalb gibt es nur eine Markierung fuer abwesend.
 */

/** Ab so vielen Teammitgliedern (ohne Leitung) wird eingeklappt. */
const EINKLAPPEN_AB = 9;
const EINGEKLAPPT_SICHTBAR = 6;

export function StandortTeam({
  team,
  onOrganigramm,
  onStandortOeffnen,
  onChatOeffnen,
}: {
  team: StandortTeamDto;
  onOrganigramm?: () => void;
  /** Weitere Standorte einer Person als Link; ohne: nur der Name. */
  onStandortOeffnen?: (standortId: string) => void;
  /** Ohne: kein Nachricht-Knopf (z. B. wo es keinen Chat-Sprung gibt). */
  onChatOeffnen?: (chatId: string) => void;
}) {
  const [alleOffen, setAlleOffen] = useState(false);
  const [profil, setProfil] = useState<{ person: StandortTeamPersonDto; inhalt: MitarbeiterProfilKollegeDto | null } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const ich = tokenBenutzerId();

  const leitung = team.personen.filter((p) => p.istLeitung);
  const rest = team.personen.filter((p) => !p.istLeitung);
  const eingeklappt = !alleOffen && rest.length >= EINKLAPPEN_AB;
  const sichtbar = eingeklappt ? rest.slice(0, EINGEKLAPPT_SICHTBAR) : rest;
  const abwesend = team.personen.filter((p) => p.abwesenheit).length;

  async function profilOeffnen(person: StandortTeamPersonDto) {
    setFehler(null);
    setProfil({ person, inhalt: null });
    try {
      setProfil({ person, inhalt: await api.profilKollege(person.benutzerId) });
    } catch (err) {
      setProfil(null);
      setFehler(err instanceof Error ? err.message : "Profil konnte nicht geladen werden.");
    }
  }

  async function nachricht(person: StandortTeamPersonDto) {
    if (!onChatOeffnen) return;
    setFehler(null);
    try {
      const chat = await api.chatDirektAnlegen({ benutzerId: person.benutzerId });
      onChatOeffnen(chat.id);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Chat konnte nicht geöffnet werden.");
    }
  }

  const karte = (p: StandortTeamPersonDto) => (
    <TeamKarte
      key={p.benutzerId}
      person={p}
      istIch={p.benutzerId === ich}
      onProfil={() => profilOeffnen(p)}
      onNachricht={onChatOeffnen ? () => nachricht(p) : undefined}
      onStandortOeffnen={onStandortOeffnen}
    />
  );

  return (
    <section className="zv-steckbrief-leitung" aria-label="Leitung und Team">
      <div className="zv-abschnittskopf">
        <h3>
          Leitung & Team
          {team.anzahl > 0 && (
            <span className="zv-team-kopfzahl">
              {team.anzahl === 1 ? "1 Person" : `${team.anzahl} Personen`}
              {abwesend > 0 && ` · ${abwesend} heute abwesend`}
            </span>
          )}
        </h3>
        {onOrganigramm && (
          <button type="button" className="zv-link-btn" onClick={onOrganigramm}>
            <IOrganigramm />
            <span className="zv-team-link-text">Im Organigramm</span>
          </button>
        )}
      </div>

      {fehler && (
        <div className="zv-hinweis zv-hinweis-fehler" role="alert">
          <IFehler />
          {fehler}
        </div>
      )}

      <h4 className="zv-team-gruppe">Leitung</h4>
      {leitung.length === 0 && team.unbesetzteLeitung.length === 0 ? (
        <p className="zv-sub zv-team-leer">
          Keine Leitung im Organigramm. Die Leitung ergibt sich aus der besetzten Position am Standort im Organigramm.
        </p>
      ) : (
        <ul className="zv-team-karten">
          {leitung.map(karte)}
          {team.unbesetzteLeitung.map((titel, i) => (
            <li key={`offen-${i}`} className="zv-team-karte zv-team-karte-offen">
              <div className="zv-team-kopf">
                <span className="zv-team-kuerzel zv-team-kuerzel-offen" aria-hidden="true">
                  <IPerson />
                </span>
                <div className="zv-team-name-block">
                  <span className="zv-team-name">Stelle unbesetzt</span>
                  <span className="zv-team-position">{titel}</span>
                </div>
              </div>
              {onOrganigramm && (
                <div className="zv-team-fuss">
                  <button type="button" className="zv-link-btn" onClick={onOrganigramm}>
                    <IOrganigramm />
                    Im Organigramm besetzen
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h4 className="zv-team-gruppe">Team</h4>
      {rest.length === 0 ? (
        <p className="zv-sub zv-team-leer">
          Noch niemand zugeordnet. Personen kommen über „Mitarbeitende“ (Standort zuordnen) oder eine Position im Organigramm dazu.
        </p>
      ) : (
        <>
          <ul className="zv-team-karten">{sichtbar.map(karte)}</ul>
          {rest.length >= EINKLAPPEN_AB && (
            <button type="button" className="zv-team-mehr" onClick={() => setAlleOffen((o) => !o)} aria-expanded={!eingeklappt}>
              {eingeklappt ? <IAufklappen /> : <IZuklappen />}
              {eingeklappt ? `Alle ${rest.length} anzeigen` : "Weniger anzeigen"}
            </button>
          )}
        </>
      )}

      {profil && (
        <Modal titel={`Profil — ${profil.person.name}`} onClose={() => setProfil(null)}>
          {profil.inhalt === null ? (
            <p className="zv-sub">Wird geladen …</p>
          ) : (
            <>
              {profil.person.positionTitel && <p className="zv-sub">{profil.person.positionTitel}</p>}
              <MitarbeiterProfilKarte inhalt={profil.inhalt} leerText={`${profil.person.name} hat noch kein Profil ausgefüllt.`} />
              {profil.person.bezugKlienten > 0 && (
                <p className="zv-sub">Bezugsbetreuung hier: {klientenText(profil.person.bezugKlienten)}</p>
              )}
            </>
          )}
        </Modal>
      )}
    </section>
  );
}

function klientenText(n: number): string {
  return n === 1 ? "1 Klient:in" : `${n} Klient:innen`;
}

/** "Abwesend heute" / "Abwesend bis Fr 27.11." -- mit Grund nur, wenn der Server ihn mitliefert. */
function abwesendText(a: NonNullable<StandortTeamPersonDto["abwesenheit"]>): string {
  // Das Label ist fuer Satzmitte gedacht ("krank"); hier steht es vorn.
  const label = a.art ? ABWESENHEIT_ART_LABEL[a.art] : "Abwesend";
  const vorne = label.charAt(0).toUpperCase() + label.slice(1);
  if (a.bis === heuteBerlin()) return `${vorne} heute`;
  const [jahr, monat, tag] = a.bis.split("-").map(Number);
  const wochentag = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(jahr, monat - 1, tag).getDay()];
  return `${vorne} bis ${wochentag} ${formatDatum(a.bis).slice(0, 6)}`;
}

function TeamKarte({
  person: p,
  istIch,
  onProfil,
  onNachricht,
  onStandortOeffnen,
}: {
  person: StandortTeamPersonDto;
  istIch: boolean;
  onProfil: () => void;
  onNachricht?: () => void;
  onStandortOeffnen?: (standortId: string) => void;
}) {
  const kuerzel = p.name
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <li className={`zv-team-karte${p.istLeitung ? " zv-team-karte-leitung" : ""}`}>
      <div className="zv-team-kopf">
        <span
          className={`zv-team-kuerzel zv-person-flaeche${p.abwesenheit ? " zv-team-kuerzel-weg" : ""}`}
          style={personFarbStil(p.farbIndex)}
          aria-hidden="true"
        >
          {kuerzel}
        </span>
        <div className="zv-team-name-block">
          <button type="button" className="zv-team-name" onClick={onProfil}>
            {p.name}
            {istIch && <span className="zv-sub"> (du)</span>}
          </button>
          {p.positionTitel && <span className="zv-team-position">{p.positionTitel}</span>}
        </div>
      </div>
      {p.abwesenheit && <span className="zv-pill zv-pill-frist zv-team-abwesend">{abwesendText(p.abwesenheit)}</span>}
      {(p.bezugKlienten > 0 || p.erreichbarkeit || p.weitereStandorte.length > 0) && (
        <ul className="zv-team-zeilen">
          {p.bezugKlienten > 0 && (
            <li>
              <IBezugsbetreuung />
              Bezug für {klientenText(p.bezugKlienten)}
            </li>
          )}
          {p.erreichbarkeit && (
            <li>
              <IErreichbarkeit />
              {p.erreichbarkeit}
            </li>
          )}
          {p.weitereStandorte.length > 0 && (
            <li>
              <IStandort />
              <span>
                auch{" "}
                {p.weitereStandorte.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ", "}
                    {onStandortOeffnen ? (
                      <button type="button" className="zv-link-btn zv-team-inline-link" onClick={() => onStandortOeffnen(s.id)}>
                        {s.name}
                      </button>
                    ) : (
                      s.name
                    )}
                  </span>
                ))}
              </span>
            </li>
          )}
        </ul>
      )}
      <div className="zv-team-fuss">
        {p.telefon ? (
          // tel: nimmt nur Ziffern und "+" (wie MitarbeiterProfilKarte).
          <a className="zv-team-telefon" href={`tel:${p.telefon.replace(/[^\d+]/g, "")}`} aria-label={`${p.name} anrufen: ${p.telefon}`}>
            <ITelefonat />
            <span className="zv-team-telefon-nummer">{p.telefon}</span>
          </a>
        ) : (
          <span className="zv-sub zv-team-ohne-telefon">kein Diensttelefon</span>
        )}
        <span className="zv-team-knoepfe">
          {onNachricht && !istIch && (
            <button
              type="button"
              className={`zv-icon-btn${p.bevorzugteKontaktart === "chat" ? " zv-team-bevorzugt" : ""}`}
              onClick={onNachricht}
              aria-label={`Nachricht an ${p.name}`}
              title={p.bevorzugteKontaktart === "chat" ? "Nachricht (bevorzugt)" : "Nachricht"}
            >
              <INachrichten />
            </button>
          )}
          <button type="button" className="zv-icon-btn" onClick={onProfil} aria-label={`Profil von ${p.name}`} title="Profil">
            <IMitarbeitende />
          </button>
        </span>
      </div>
    </li>
  );
}
