import type {
  AnwaerterDto,
  ChatAnfrageAnnahmeDto,
  ChatAnfrageDto,
  ChatAnfrageEingabe,
  ChatAnfrageZielDto,
  MitarbeiterProfilEigenDto,
  MitarbeiterProfilFuerKlientDto,
  MitarbeiterProfilKollegeDto,
  ChatDto,
  ChatKontaktDto,
  ChatKontaktEingabe,
  ChatNachrichtDto,
  ChatNachrichtEingabe,
  ChatNachrichtenSeiteDto,
  KlientEmailAenderungLinkDto,
  KlientEmailAendernPruefungDto,
  KlientZugangDto,
  TerminAnlegenEingabe,
  TerminAntwort,
  TerminDto,
  AnwaerterStatus,
  AccountTypDto,
  AufgabeDto,
  AufgabenAnzahlDto,
  AufgabePrioritaet,
  BelegungsverlaufEintragDto,
  BenutzerListEintragDto,
  DashboardDto,
  DelegationDto,
  HzlRhythmus,
  KassenbuchungDto,
  KassenbuchungTypDto,
  KlientDetailDto,
  KlientKontaktDto,
  KlientListEintragDto,
  KlientStammdatenDto,
  KostenuebernahmeDto,
  LoginRequest,
  LoginResponse,
  MandantDto,
  OrgUnitDto,
  PositionDto,
  RechnungDetailDto,
  RechnungDto,
  RechnungStatus,
  RechtRegistryEintragDto,
  SimulationDto,
  StandortDto,
  StandortUebersichtDto,
  RaumplanDto,
  TagDto,
  TagesberichtDto,
  TotpEinrichtenResponse,
  WochenuebersichtEintragDto,
  SucheErgebnisDto,
  SucheGruppe,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";

const TOKEN_KEY = "zimmerakte_token";

export interface KassenbuchungAnlegenPayload {
  klientId?: string;
  standortId?: string;
  datum: string;
  betragCent: number;
  verwendungszweck?: string;
  typId: string;
  isoJahr?: number;
  isoWoche?: number;
  unterschriftBase64?: string;
  teilnehmerKlientIds?: string[];
  teilnehmerBenutzerIds?: string[];
}

/**
 * Fehler mit HTTP-Status: manche Aufrufer muessen 403 ("dieses Recht fehlt,
 * den Bereich gar nicht erst zeigen") von echten Fehlern unterscheiden --
 * allein am Meldungstext ginge das nicht.
 */
export class ApiFehler extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Live-Rueckmeldung: ein abgelaufener/ungueltiger Token zeigte bisher nur
 * eine rote Fehlermeldung MITTEN in der laufenden Seite ("Token ungültig
 * oder abgelaufen."), die Seite blieb aber stehen -- wer nicht genau
 * hinsah, wusste nicht, dass er sich neu anmelden muss. App.tsx registriert
 * hier einmalig einen Handler, der stattdessen sofort zur Login-Seite
 * zurueckschaltet (mit einer kurzen, dezenten Erklaerung statt der rohen
 * Server-Meldung). Modul-globaler Callback statt Context/Redux: request()
 * unten ist eine einfache Funktion ausserhalb jeder Komponente, hat also
 * keinen anderen Weg, React-State zu erreichen.
 */
let beiSitzungAbgelaufen: ((warKlient: boolean) => void) | null = null;
export function aufSitzungAbgelaufen(fn: (warKlient: boolean) => void): void {
  beiSitzungAbgelaufen = fn;
}

/** Token verwerfen und App.tsx melden; ob es ein Klient-Token war, muss VOR dem Verwerfen gelesen werden. */
function sitzungBeenden(): void {
  const warKlient = istKlientToken();
  clearToken();
  beiSitzungAbgelaufen?.(warKlient);
}

/**
 * Reiner Anzeige-Hinweis ohne Signaturpruefung (z.B. "ist diese Aufgabe mir
 * zugewiesen?" in Aufgaben.tsx). Die Autoritaet bleibt der Server -- RLS und
 * die Rechtepruefung in aufgabe.service.ts werten app.benutzer_id aus dem
 * verifizierten JWT aus, nie diesen Wert hier.
 */
export function tokenBenutzerId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const nutzlast = token.split(".")[1];
    if (!nutzlast) return null;
    const json = atob(nutzlast.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Welche Art Sitzung der gespeicherte Token ist. Bewusst aus dem JWT-Feld
 * `typ` gelesen statt in einem zweiten localStorage-Schluessel gemerkt: ein
 * zweiter Schluessel koennte vom Token abweichen (z. B. nach einem
 * ueberschriebenen Token in einem anderen Tab) und dann die falsche Shell
 * waehlen -- die Mitarbeitenden-Shell erzeugt mit einem Klient-Token nur
 * 401-Antworten und beendet damit die Sitzung. Reiner Anzeige-Hinweis wie
 * tokenBenutzerId(); die Autoritaet bleibt der Server.
 */
export function istKlientToken(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const nutzlast = token.split(".")[1];
    if (!nutzlast) return false;
    return JSON.parse(atob(nutzlast.replace(/-/g, "+").replace(/_/g, "/")))?.typ === "klient_access";
  } catch {
    return false;
  }
}

/**
 * ohneToken: fuer Aufrufe vor/ausserhalb einer Sitzung (Klient-Login,
 * Einladungs- und E-Mail-Links). Ein noch gespeicherter Mitarbeitenden-Token
 * wuerde sonst mitgeschickt, und ein 401 der Link-Pruefung wuerde als
 * "Sitzung abgelaufen" die fremde Sitzung beenden.
 */
async function request<T>(path: string, init?: RequestInit, ohneToken = false): Promise<T> {
  const token = ohneToken ? null : getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // Die Raten-Schranke (@nestjs/throttler, siehe auth.controller.ts) gibt
    // eine englische Systemmeldung ("ThrottlerException: Too Many Requests")
    // zurueck, die roh angezeigt sonst wie ein Fehlerbild aussieht statt wie
    // eine verstaendliche Rueckmeldung -- deshalb hier fest uebersetzt, vor
    // jedem Body-Parsing.
    if (res.status === 429) {
      throw new Error(
        path.startsWith("/auth")
          ? "Zu viele Anmeldeversuche. Bitte warten Sie eine Minute, bevor Sie es erneut versuchen."
          : "Zu viele Anfragen in kurzer Zeit. Bitte warten Sie einen Moment."
      );
    }
    // Nur wenn WIR einen Token mitgeschickt haben, ist ein 401 ein
    // abgelaufener/ungueltiger Token (siehe auth.guard.ts) -- ein
    // fehlgeschlagener Login-Versuch selbst (falsches Passwort/falscher
    // Code) laeuft ohne Token und soll normal als Formularfehler erscheinen,
    // nicht ploetzlich zur Login-Seite "zurueckspringen".
    if (res.status === 401 && token) {
      sitzungBeenden();
    }
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiFehler(body.message ?? `Anfrage fehlgeschlagen (${res.status})`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Fuer Binaerdateien (Bilder, PDFs) statt JSON -- deshalb nicht ueber
// request<T>(), das braucht ausserdem den Auth-Header, den ein rohes
// <img src="..."> nicht mitschickt.
async function blobUrl(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Datei konnte nicht geladen werden (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Anders als blobUrl() oben (fuer "im Browser anzeigen") stoesst das hier
// einen echten Datei-Download mit eigenem Dateinamen an -- dafuer gab es
// bisher kein Muster im Projekt (alle bisherigen Downloads waren "in neuem
// Tab oeffnen"). Ein kurzlebiges <a download> ist der uebliche Weg dafuer.
async function dateiHerunterladen(path: string, dateiname: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Datei konnte nicht geladen werden (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ChatUngelesenDto {
  ungelesen: number;
  offeneAnfragen?: number;
}

export interface KlientIchDto {
  klientId: string;
  anzeigename: string;
  mandant: { id: string; name: string; akzentfarbe: string; dunkelGrundfarbe: string };
}

export interface KlientEinladungDto {
  einladungsLink: string;
  laeuftAbAm: string;
}

/** Server-Sent-Event aus GET /chat/ereignisse; bewusst offen typisiert, damit neue Arten den Client nicht brechen. */
export interface ChatEreignis {
  chatId: string | null;
  art: "nachricht" | "teilnehmer" | "chat" | "resync" | "anfrage" | (string & {});
  anfrageId?: string;
}

const SSE_BACKOFF_START_MS = 1000;
const SSE_BACKOFF_MAX_MS = 30000;

/**
 * Abonniert den Chat-Stream per fetch statt EventSource: EventSource kann
 * keinen Authorization-Header senden, und den Token in die URL zu legen
 * wuerde ihn in Server- und Proxy-Logs tragen. Nach jedem Abbruch wird mit
 * wachsender Wartezeit (1 bis 30 s) neu verbunden; weil dabei Ereignisse
 * verloren gegangen sein koennen, wird nach einer WIEDER-Verbindung ein
 * synthetisches "resync" geliefert (der Server sendet es nur bei einem
 * eigenen DB-Abbruch). Rueckgabe: Funktion zum Beenden.
 */
export function abonniereChatEreignisse(onEreignis: (e: ChatEreignis) => void): () => void {
  const abbruch = new AbortController();
  let wartezeit = SSE_BACKOFF_START_MS;
  let schonVerbunden = false;

  async function lauf() {
    while (!abbruch.signal.aborted) {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch("/api/chat/ereignisse", {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
          signal: abbruch.signal,
        });
        if (res.status === 401) {
          sitzungBeenden();
          return;
        }
        if (!res.ok || !res.body) throw new Error(`Stream abgelehnt (${res.status})`);
        wartezeit = SSE_BACKOFF_START_MS;
        if (schonVerbunden) onEreignis({ chatId: null, art: "resync" });
        schonVerbunden = true;

        const leser = res.body.getReader();
        const dekoder = new TextDecoder();
        let puffer = "";
        for (;;) {
          const { done, value } = await leser.read();
          if (done) break;
          puffer += dekoder.decode(value, { stream: true });
          let ende: number;
          while ((ende = puffer.indexOf("\n\n")) >= 0) {
            const block = puffer.slice(0, ende);
            puffer = puffer.slice(ende + 2);
            let ereignisName = "message";
            const daten: string[] = [];
            for (const zeile of block.split("\n")) {
              if (zeile.startsWith(":")) continue;
              if (zeile.startsWith("event:")) ereignisName = zeile.slice(6).trim();
              else if (zeile.startsWith("data:")) daten.push(zeile.slice(5).trimStart());
            }
            if (ereignisName !== "chat" || daten.length === 0) continue;
            try {
              onEreignis(JSON.parse(daten.join("\n")) as ChatEreignis);
            } catch {
              // Kaputtes Ereignis ueberspringen -- der naechste Stand kommt per REST.
            }
          }
        }
      } catch {
        if (abbruch.signal.aborted) return;
      }
      await new Promise<void>((fertig) => {
        const timer = window.setTimeout(fertig, wartezeit);
        abbruch.signal.addEventListener("abort", () => (window.clearTimeout(timer), fertig()), { once: true });
      });
      wartezeit = Math.min(wartezeit * 2, SSE_BACKOFF_MAX_MS);
    }
  }
  void lauf();
  return () => abbruch.abort();
}

export const api = {
  dashboard: (standortId?: string) => request<DashboardDto>(`/dashboard${standortId ? `?standortId=${standortId}` : ""}`),

  login: (payload: LoginRequest) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  loginTotp: (pendingToken: string, code: string) =>
    request<{ accessToken: string }>("/auth/login/totp", {
      method: "POST",
      body: JSON.stringify({ pendingToken, code }),
    }),

  totpStatus: () => request<{ aktiviert: boolean }>("/auth/totp/status"),
  totpEinrichten: () => request<TotpEinrichtenResponse>("/auth/totp/einrichten", { method: "POST" }),
  totpAktivieren: (code: string) =>
    request<{ aktiviert: boolean }>("/auth/totp/aktivieren", { method: "POST", body: JSON.stringify({ code }) }),
  totpDeaktivieren: (code: string) =>
    request<{ aktiviert: boolean }>("/auth/totp/deaktivieren", { method: "POST", body: JSON.stringify({ code }) }),

  passwortAendern: (aktuellesPasswort: string, neuesPasswort: string) =>
    request<{ ok: true }>("/auth/passwort", {
      method: "PATCH",
      body: JSON.stringify({ aktuellesPasswort, neuesPasswort }),
    }),
  passwortResetEinloesen: (token: string, neuesPasswort: string) =>
    request<{ ok: true }>("/auth/passwort-reset/einloesen", {
      method: "POST",
      body: JSON.stringify({ token, neuesPasswort }),
    }),

  eigenerMandant: () => request<MandantDto>("/mandant/me"),
  mandantAkzentfarbeSetzen: (akzentfarbe: string) =>
    request<MandantDto>("/mandant/me", { method: "PATCH", body: JSON.stringify({ akzentfarbe }) }),
  mandantDunkelGrundfarbeSetzen: (dunkelGrundfarbe: string) =>
    request<MandantDto>("/mandant/me", { method: "PATCH", body: JSON.stringify({ dunkelGrundfarbe }) }),
  mandantChatLoeschfristSetzen: (tage: number) =>
    request<MandantDto>("/mandant/me/chat-loeschfrist", { method: "PATCH", body: JSON.stringify({ tage }) }),
  benutzerListe: () => request<BenutzerListEintragDto[]>("/benutzer"),
  // Das eigene Konto (Name, Positionen) -- fuer den Benutzerblock der Seitenleiste.
  benutzerIch: () => request<BenutzerListEintragDto>("/benutzer/ich"),
  benutzerAnlegen: (payload: { name: string; email: string; passwort: string }) =>
    request<BenutzerListEintragDto>("/benutzer", { method: "POST", body: JSON.stringify(payload) }),
  passwortResetErstellen: (benutzerId: string) =>
    request<{ token: string; laeuftAbAm: string }>(`/benutzer/${benutzerId}/passwort-reset`, { method: "POST" }),
  benutzerAktivSetzen: (benutzerId: string, aktiv: boolean) =>
    request<{ id: string; aktiv: boolean }>(`/benutzer/${benutzerId}/aktiv`, {
      method: "PATCH",
      body: JSON.stringify({ aktiv }),
    }),
  benutzerStandorteSetzen: (benutzerId: string, standortIds: string[]) =>
    request<string[]>(`/benutzer/${benutzerId}/standorte`, { method: "PUT", body: JSON.stringify({ standortIds }) }),

  standorteListe: () => request<StandortDto[]>("/standorte"),
  standortUebersicht: (id: string) => request<StandortUebersichtDto>(`/standorte/${id}/uebersicht`),
  raumplan: (standortId: string) => request<RaumplanDto>(`/standorte/${standortId}/raumplan`),
  raumAnlegen: (standortId: string, payload: { name: string; etage: string }) =>
    request<{ id: string }>(`/standorte/${standortId}/raeume`, { method: "POST", body: JSON.stringify(payload) }),
  raumAktualisieren: (standortId: string, raumId: string, payload: { name?: string; etage?: string; aktiv?: boolean }) =>
    request<{ id: string }>(`/standorte/${standortId}/raeume/${raumId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  raumplanPositionenSetzen: (
    standortId: string,
    payload: { etage: string; positionen: { art: "zimmer" | "raum"; id: string; x: number; y: number }[] }
  ) => request<{ gespeichert: number }>(`/standorte/${standortId}/raumplan/positionen`, { method: "PUT", body: JSON.stringify(payload) }),
  grundrissUrl: (standortId: string, etage: string) =>
    blobUrl(`/standorte/${standortId}/grundriss?etage=${encodeURIComponent(etage)}`),
  grundrissLoeschen: (standortId: string, etage: string) =>
    request<{ geloescht: boolean }>(`/standorte/${standortId}/grundriss?etage=${encodeURIComponent(etage)}`, { method: "DELETE" }),
  // Roher Body statt JSON/Base64 (siehe api/src/common/roh-koerper.ts) --
  // deshalb kein request(), das Content-Type fest auf JSON setzt.
  grundrissHochladen: async (standortId: string, etage: string, datei: File): Promise<void> => {
    const token = getToken();
    const res = await fetch(`/api/standorte/${standortId}/grundriss?etage=${encodeURIComponent(etage)}`, {
      method: "PUT",
      headers: {
        "Content-Type": datei.type,
        "X-Dateiname": encodeURIComponent(datei.name),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: datei,
    });
    if (res.status === 401 && token) {
      sitzungBeenden();
    }
    if (!res.ok) {
      if (res.status === 413) throw new Error("Die Datei ist zu groß (maximal 8 MB).");
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message ?? `Upload fehlgeschlagen (${res.status})`);
    }
  },
  standortAnlegen: (payload: { name: string; adresse: string }) =>
    request<StandortDto>("/standorte", { method: "POST", body: JSON.stringify(payload) }),
  standortAktualisieren: (id: string, payload: { name?: string; adresse?: string; aktiv?: boolean }) =>
    request<StandortDto>(`/standorte/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  zimmerListe: () => request<ZimmerListEintragDto[]>("/zimmer"),
  zimmerAnlegen: (payload: { standortId: string; nummer: string; etage?: string; kapazitaet?: number }) =>
    request<ZimmerListEintragDto>("/zimmer", { method: "POST", body: JSON.stringify(payload) }),
  zimmerAktualisieren: (id: string, payload: { nummer: string; etage?: string }) =>
    request<ZimmerListEintragDto>(`/zimmer/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  zimmerDeaktivieren: (id: string) => request<ZimmerListEintragDto>(`/zimmer/${id}/deaktivieren`, { method: "PATCH" }),
  zimmerKapazitaetAendern: (id: string, neueKapazitaet: number) =>
    request<ZimmerListEintragDto>(`/zimmer/${id}/kapazitaet`, {
      method: "PATCH",
      body: JSON.stringify({ neueKapazitaet }),
    }),
  zimmerKapazitaetEntscheiden: (antragId: string, entscheidung: "bestaetigt" | "abgelehnt", grund?: string) =>
    request<ZimmerListEintragDto>(`/zimmer/kapazitaetsantraege/${antragId}`, {
      method: "PATCH",
      body: JSON.stringify({ entscheidung, grund }),
    }),
  belegungsverlauf: (zimmerId: string) =>
    request<BelegungsverlaufEintragDto[]>(`/zimmer/${zimmerId}/belegungsverlauf`),
  zimmerWartelisteHinzufuegen: (zimmerId: string, klientId: string) =>
    request<ZimmerListEintragDto>(`/zimmer/${zimmerId}/warteliste`, {
      method: "POST",
      body: JSON.stringify({ klientId }),
    }),
  zimmerWartelisteEntfernen: (zimmerId: string, eintragId: string) =>
    request<ZimmerListEintragDto>(`/zimmer/${zimmerId}/warteliste/${eintragId}`, { method: "DELETE" }),

  klientenListe: (archiviert = false) =>
    request<KlientListEintragDto[]>(`/klienten${archiviert ? "?archiviert=true" : ""}`),
  klient: (id: string) => request<KlientDetailDto>(`/klienten/${id}`),
  klientAnlegen: (payload: {
    vorname: string;
    nachname: string;
    geburtsdatum: string;
    aktenzeichen: string;
    amt: string;
    hzlRhythmus: "monatlich" | "woechentlich";
  }) => request<KlientDetailDto>("/klienten", { method: "POST", body: JSON.stringify(payload) }),
  klientAnonymisieren: (id: string) => request<KlientDetailDto>(`/klienten/${id}/anonymisieren`, { method: "PATCH" }),
  klientArchivieren: (id: string) => request<KlientDetailDto>(`/klienten/${id}/archivieren`, { method: "PATCH" }),
  klientEntarchivieren: (id: string) =>
    request<KlientDetailDto>(`/klienten/${id}/entarchivieren`, { method: "PATCH" }),
  klientArchivPdfHerunterladen: (klientId: string, archivId: string, dateiname: string) =>
    dateiHerunterladen(`/klienten/${klientId}/archiv/${archivId}/pdf`, dateiname),

  anwaerterListe: (status: AnwaerterStatus = "offen") => request<AnwaerterDto[]>(`/anwaerter?status=${status}`),
  anwaerterAnlegen: (payload: {
    vorname: string;
    nachname: string;
    geburtsdatum?: string;
    telefon?: string;
    email?: string;
    anfragendeStelle?: string;
    notiz?: string;
  }) => request<AnwaerterDto>("/anwaerter", { method: "POST", body: JSON.stringify(payload) }),
  anwaerterAktualisieren: (
    id: string,
    payload: Partial<{
      vorname: string;
      nachname: string;
      geburtsdatum: string;
      telefon: string;
      email: string;
      anfragendeStelle: string;
      notiz: string;
    }>
  ) => request<AnwaerterDto>(`/anwaerter/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  anwaerterLoeschen: (id: string) => request<{ ok: true }>(`/anwaerter/${id}`, { method: "DELETE" }),
  anwaerterAnnehmen: (id: string, payload: { aktenzeichen: string; amt: string; hzlRhythmus: HzlRhythmus }) =>
    request<KlientDetailDto>(`/anwaerter/${id}/annehmen`, { method: "PATCH", body: JSON.stringify(payload) }),
  anwaerterAblehnen: (id: string, grund: string) =>
    request<AnwaerterDto>(`/anwaerter/${id}/ablehnen`, { method: "PATCH", body: JSON.stringify({ grund }) }),

  // Alle Felder optional und einzeln uebergebbar: das Formular speichert pro
  // Datenblatt-Abschnitt, ein leerer String loescht ein Feld bewusst (siehe
  // KlientStammdatenService.setzen() im Backend).
  klientStammdatenSetzen: (id: string, payload: Partial<Omit<KlientStammdatenDto, "bezugsbetreuerName" | "aktualisiertAm">>) =>
    request<KlientStammdatenDto>(`/klienten/${id}/stammdaten`, { method: "PATCH", body: JSON.stringify(payload) }),

  klientKontaktHinzufuegen: (
    klientId: string,
    payload: { beziehung?: string; name: string; adresse?: string; email?: string; telefon?: string }
  ) => request<KlientKontaktDto>(`/klienten/${klientId}/kontakte`, { method: "POST", body: JSON.stringify(payload) }),
  klientKontaktAktualisieren: (
    klientId: string,
    kontaktId: string,
    payload: { beziehung?: string; name?: string; adresse?: string; email?: string; telefon?: string }
  ) =>
    request<KlientKontaktDto>(`/klienten/${klientId}/kontakte/${kontaktId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  klientKontaktLoeschen: (klientId: string, kontaktId: string) =>
    request<{ ok: true }>(`/klienten/${klientId}/kontakte/${kontaktId}`, { method: "DELETE" }),

  belegungEinziehen: (payload: { zimmerId: string; klientId: string; einzug: string }) =>
    request("/belegungen", { method: "POST", body: JSON.stringify(payload) }),
  belegungAusziehen: (id: string, auszug: string) =>
    request(`/belegungen/${id}`, { method: "PATCH", body: JSON.stringify({ auszug }) }),
  belegungBearbeiten: (id: string, payload: { einzug: string; auszug: string | null }) =>
    request(`/belegungen/${id}/bearbeiten`, { method: "PATCH", body: JSON.stringify(payload) }),

  kassenbuchungenListe: (filter?: { klientId?: string; standortId?: string }) => {
    const query = new URLSearchParams();
    if (filter?.klientId) query.set("klientId", filter.klientId);
    if (filter?.standortId) query.set("standortId", filter.standortId);
    const text = query.toString();
    return request<KassenbuchungDto[]>(`/kassenbuchungen${text ? `?${text}` : ""}`);
  },
  // idempotenzSchluessel: von der Offline-Warteschlange (offline/warteschlange.ts)
  // beim Erfassen erzeugt und bei jedem Versuch gleich -- der Server legt dafuer
  // hoechstens eine Buchung an (Migration 0062).
  kassenbuchungAnlegen: (payload: KassenbuchungAnlegenPayload, idempotenzSchluessel?: string) =>
    request<KassenbuchungDto>("/kassenbuchungen", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: idempotenzSchluessel ? { "Idempotency-Key": idempotenzSchluessel } : undefined,
    }),

  kassenbuchungTypenListe: () => request<KassenbuchungTypDto[]>("/kassenbuchungstypen"),
  kassenbuchungTypAnlegen: (payload: { bezeichnung: string; kommentarPflicht: boolean }) =>
    request<KassenbuchungTypDto>("/kassenbuchungstypen", { method: "POST", body: JSON.stringify(payload) }),
  kassenbuchungTypAktualisieren: (
    id: string,
    payload: { bezeichnung?: string; kommentarPflicht?: boolean; aktiv?: boolean }
  ) =>
    request<KassenbuchungTypDto>(`/kassenbuchungstypen/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  kassenbuchungStornoBeantragen: (id: string, grund: string) =>
    request<KassenbuchungDto>(`/kassenbuchungen/${id}/storno-antrag`, {
      method: "POST",
      body: JSON.stringify({ grund }),
    }),
  kassenbuchungStornoEntscheiden: (antragId: string, entscheidung: "genehmigt" | "abgelehnt", grund?: string) =>
    request<KassenbuchungDto>(`/kassenbuchungen/storno-antraege/${antragId}`, {
      method: "PATCH",
      body: JSON.stringify({ entscheidung, grund }),
    }),
  wochenuebersicht: (isoJahr: number, isoWoche: number, standortId?: string) =>
    request<WochenuebersichtEintragDto[]>(
      `/kassenbuchungen/wochenuebersicht?jahr=${isoJahr}&kw=${isoWoche}${standortId ? `&standortId=${standortId}` : ""}`
    ),

  suche: (q: string) => request<SucheErgebnisDto>(`/suche?q=${encodeURIComponent(q)}`),
  sucheZuletzt: (eintraege: { gruppe: SucheGruppe; id: string }[]) =>
    request<SucheErgebnisDto>("/suche/zuletzt", { method: "POST", body: JSON.stringify({ eintraege }) }),
  kassenbuchDarfBuchen: () => request<{ darf: boolean }>("/kassenbuchungen/darf-buchen"),
  hzlUebergabeEntsperren: (passwort: string) =>
    request<{ ok: true }>("/kassenbuchungen/hzl-uebergabe/entsperren", { method: "POST", body: JSON.stringify({ passwort }) }),

  unterschriftBildUrl: (kassenbuchungId: string) => blobUrl(`/kassenbuchungen/${kassenbuchungId}/unterschrift`),

  kostenuebernahmenListe: (klientId: string) =>
    request<KostenuebernahmeDto[]>(`/kostenuebernahmen?klientId=${klientId}`),
  kostenuebernahmeAnlegen: (payload: { klientId: string; amt: string; von: string; bis?: string }) =>
    request<KostenuebernahmeDto>("/kostenuebernahmen", { method: "POST", body: JSON.stringify(payload) }),
  kostenuebernahmeBeenden: (id: string, bis: string) =>
    request<KostenuebernahmeDto>(`/kostenuebernahmen/${id}/beenden`, {
      method: "PATCH",
      body: JSON.stringify({ bis }),
    }),

  rechnungenListe: (klientId?: string) =>
    request<RechnungDto[]>(`/rechnungen${klientId ? `?klientId=${klientId}` : ""}`),
  rechnung: (id: string) => request<RechnungDetailDto>(`/rechnungen/${id}`),
  rechnungAnlegen: (payload: {
    klientId: string;
    betragCent: number;
    beschreibung: string;
    dokumentBase64?: string;
    dokumentDateiname?: string;
    dokumentMimeType?: string;
  }) => request<RechnungDto>("/rechnungen", { method: "POST", body: JSON.stringify(payload) }),
  rechnungStatusAendern: (id: string, status: RechnungStatus, grund?: string) =>
    request<RechnungDto>(`/rechnungen/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, grund }) }),
  rechnungDokumentUrl: (rechnungId: string) => blobUrl(`/rechnungen/${rechnungId}/dokument`),

  tagesberichteListe: (klientId?: string) =>
    request<TagesberichtDto[]>(`/tagesberichte${klientId ? `?klientId=${klientId}` : ""}`),
  tagesberichtAnlegen: (payload: {
    klientId: string;
    datum: string;
    text: string;
    tagNamen?: string[];
    dokumente?: { base64: string; dateiname: string; mimeType: string }[];
  }) => request<TagesberichtDto>("/tagesberichte", { method: "POST", body: JSON.stringify(payload) }),
  tagesberichtTagHinzufuegen: (tagesberichtId: string, name: string) =>
    request<TagesberichtDto>(`/tagesberichte/${tagesberichtId}/tags`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  tagesberichtTagEntfernen: (tagesberichtId: string, tagId: string) =>
    request<{ ok: true }>(`/tagesberichte/${tagesberichtId}/tags/${tagId}`, { method: "DELETE" }),
  tagesberichtDokumentHinzufuegen: (
    tagesberichtId: string,
    dokument: { base64: string; dateiname: string; mimeType: string }
  ) =>
    request<TagesberichtDto>(`/tagesberichte/${tagesberichtId}/dokumente`, {
      method: "POST",
      body: JSON.stringify(dokument),
    }),
  tagesberichtDokumentUrl: (tagesberichtId: string, dokumentId: string) =>
    blobUrl(`/tagesberichte/${tagesberichtId}/dokumente/${dokumentId}`),
  tagsListe: () => request<TagDto[]>("/tags"),

  aufgabenListe: (filter?: {
    zimmerId?: string;
    zugewiesenAn?: string;
    nurEigene?: boolean;
    offen?: boolean;
    faelligBis?: string;
    prioritaet?: AufgabePrioritaet;
    sortierung?: "faelligkeit" | "prioritaet";
  }) => {
    const params = new URLSearchParams();
    if (filter?.zimmerId) params.set("zimmerId", filter.zimmerId);
    if (filter?.zugewiesenAn) params.set("zugewiesenAn", filter.zugewiesenAn);
    if (filter?.nurEigene) params.set("nurEigene", "true");
    if (filter?.offen !== undefined) params.set("offen", String(filter.offen));
    if (filter?.faelligBis) params.set("faelligBis", filter.faelligBis);
    if (filter?.prioritaet) params.set("prioritaet", filter.prioritaet);
    if (filter?.sortierung) params.set("sortierung", filter.sortierung);
    const qs = params.toString();
    return request<AufgabeDto[]>(`/aufgaben${qs ? `?${qs}` : ""}`);
  },
  aufgabenAnzahlOffen: () => request<AufgabenAnzahlDto>("/aufgaben/anzahl-offen"),
  aufgabeAnlegen: (payload: {
    titel: string;
    beschreibung?: string;
    prioritaet?: AufgabePrioritaet;
    faelligAm?: string;
    zimmerId?: string;
    zugewiesenAn?: string;
  }) => request<AufgabeDto>("/aufgaben", { method: "POST", body: JSON.stringify(payload) }),
  aufgabeAktualisieren: (
    id: string,
    payload: {
      titel?: string;
      beschreibung?: string | null;
      faelligAm?: string | null;
      prioritaet?: AufgabePrioritaet;
      zugewiesenAn?: string | null;
    }
  ) => request<AufgabeDto>(`/aufgaben/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  aufgabeErledigen: (id: string) => request<AufgabeDto>(`/aufgaben/${id}/erledigen`, { method: "PATCH" }),
  aufgabeLoeschen: (id: string) => request<{ ok: true }>(`/aufgaben/${id}`, { method: "DELETE" }),

  // Organigramm-Modul (Organigramm-Plan, Lieferreihenfolge Schritt 7/UI).
  organigrammOrgUnits: () => request<OrgUnitDto[]>("/organigramm/org-units"),
  organigrammPositionen: () => request<PositionDto[]>("/organigramm/positions"),
  organigrammAccountTypen: () => request<AccountTypDto[]>("/organigramm/account-typen"),
  organigrammAccountTypAnlegen: (payload: { name: string; kategorie?: "intern" | "extern" }) =>
    request<AccountTypDto>("/organigramm/account-typen", { method: "POST", body: JSON.stringify(payload) }),
  organigrammAccountTypAktualisieren: (id: string, payload: { name?: string }) =>
    request<AccountTypDto>(`/organigramm/account-typen/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  organigrammAccountTypRechteSetzen: (
    id: string,
    rechte: { modul: string; aktion: string; scope: string; erlaubt: boolean }[]
  ) =>
    request<AccountTypDto>(`/organigramm/account-typen/${id}/rechte`, {
      method: "PUT",
      body: JSON.stringify({ rechte }),
    }),
  rechteRegistry: () => request<RechtRegistryEintragDto[]>("/rechte/registry"),
  // "Anzeigen als…" -- genau eines von benutzerId/positionId, s. rechte.controller.ts.
  rechteSimulation: (query: { benutzerId: string } | { positionId: string }) =>
    request<SimulationDto>(`/rechte/simulation?${new URLSearchParams(query as Record<string, string>).toString()}`),
  organigrammOrgUnitAnlegen: (payload: { typ: "bereich" | "team"; name: string; parentId: string }) =>
    request<OrgUnitDto>("/organigramm/org-units", { method: "POST", body: JSON.stringify(payload) }),
  organigrammOrgUnitAktualisieren: (id: string, payload: { name?: string; parentId?: string }) =>
    request<OrgUnitDto>(`/organigramm/org-units/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  organigrammPositionAnlegen: (payload: {
    orgUnitId: string;
    titel: string;
    typ?: "linie" | "stabsstelle";
    accountTypId: string;
    sollBesetzung?: number;
    gueltigAb?: string;
  }) => request<PositionDto>("/organigramm/positions", { method: "POST", body: JSON.stringify(payload) }),
  organigrammPositionBesetzen: (positionId: string, payload: { benutzerId: string; gueltigAb?: string }) =>
    request<PositionDto>(`/organigramm/positions/${positionId}/besetzen`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  organigrammBesetzungBeenden: (positionId: string, besetzungId: string, payload: { gueltigBis?: string }) =>
    request<PositionDto>(`/organigramm/positions/${positionId}/besetzung/${besetzungId}/beenden`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  organigrammPositionDeaktivieren: (positionId: string) =>
    request<PositionDto>(`/organigramm/positions/${positionId}/deaktivieren`, { method: "PATCH" }),
  organigrammPositionAktualisieren: (
    positionId: string,
    payload: {
      titel?: string;
      accountTypId?: string;
      parentPositionId?: string;
      sollBesetzung?: number;
      gueltigBis?: string | null;
      istGeplant?: boolean;
    }
  ) => request<PositionDto>(`/organigramm/positions/${positionId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  organigrammExportPdf: () => dateiHerunterladen("/organigramm/export/pdf", "organigramm.pdf"),
  organigrammWeitereEinheitenSetzen: (positionId: string, orgUnitIds: string[]) =>
    request<PositionDto>(`/organigramm/positions/${positionId}/weitere-einheiten`, {
      method: "PUT",
      body: JSON.stringify({ orgUnitIds }),
    }),
  organigrammOrgUnitsReihenfolge: (elternId: string, geordneteIds: string[]) =>
    request<void>("/organigramm/org-units/reihenfolge", {
      method: "PUT",
      body: JSON.stringify({ elternId, geordneteIds }),
    }),
  organigrammPositionenReihenfolge: (orgUnitId: string, parentPositionId: string | null, geordneteIds: string[]) =>
    request<void>("/organigramm/positions/reihenfolge", {
      method: "PUT",
      body: JSON.stringify({ orgUnitId, parentPositionId, geordneteIds }),
    }),

  // Vertretung (Organigramm-Plan, Lieferreihenfolge Schritt 8/UI).
  delegationenMeine: () => request<DelegationDto[]>("/delegationen/meine"),
  delegationAnlegen: (payload: {
    vertreterBenutzerId: string;
    von: string;
    bis: string;
    umfang: "alle" | "auswahl";
    sensibleRechteEingeschlossen?: boolean;
    rechte?: { modul: string; aktion: string }[];
  }) => request<DelegationDto>("/delegationen", { method: "POST", body: JSON.stringify(payload) }),
  delegationGenehmigen: (id: string) => request<DelegationDto>(`/delegationen/${id}/genehmigen`, { method: "PATCH" }),
  delegationWiderrufen: (id: string) => request<DelegationDto>(`/delegationen/${id}/widerrufen`, { method: "PATCH" }),

  // Klient-Zugang: Anmeldung und Links (ohne Mitarbeitenden-Token, siehe request())
  klientLogin: (payload: LoginRequest) =>
    request<{ accessToken: string }>("/auth/klient/login", { method: "POST", body: JSON.stringify(payload) }, true),
  klientEinladungEinloesen: (token: string, neuesPasswort: string) =>
    request<{ ok: true }>(
      "/auth/klient/einladung/einloesen",
      { method: "POST", body: JSON.stringify({ token, neuesPasswort }) },
      true
    ),
  klientEmailAendernPruefen: (token: string) =>
    request<KlientEmailAendernPruefungDto>(`/auth/klient/email-aendern/${encodeURIComponent(token)}`, undefined, true),
  klientEmailAendernEinloesen: (token: string, neueEmail: string, passwort: string) =>
    request<{ ok: true }>(
      "/auth/klient/email-aendern/einloesen",
      { method: "POST", body: JSON.stringify({ token, neueEmail, passwort }) },
      true
    ),
  klientIch: () => request<KlientIchDto>("/auth/klient/ich"),

  // Chat-Anfragen: Klient:innen stellen sie, Mitarbeitende beantworten sie.
  // Mitarbeiter-Profil
  profilEigenes: () => request<MitarbeiterProfilEigenDto>("/profil/ich"),
  profilEigenesSpeichern: (profil: MitarbeiterProfilEigenDto) =>
    request<MitarbeiterProfilEigenDto>("/profil/ich", { method: "PUT", body: JSON.stringify(profil) }),
  profilKollege: (benutzerId: string) => request<MitarbeiterProfilKollegeDto>(`/profil/kollegen/${benutzerId}`),
  mitarbeiterProfilFuerKlient: (benutzerId: string) =>
    request<MitarbeiterProfilFuerKlientDto>(`/mitarbeiter-profil/${benutzerId}`),
  chatAnfrageZiele: () => request<ChatAnfrageZielDto[]>("/chat/anfragen/ziele"),
  chatAnfragen: () => request<ChatAnfrageDto[]>("/chat/anfragen"),
  chatAnfrageStellen: (eingabe: ChatAnfrageEingabe) =>
    request<ChatAnfrageDto>("/chat/anfragen", { method: "POST", body: JSON.stringify(eingabe) }),
  chatAnfrageAnnehmen: (id: string) => request<ChatAnfrageAnnahmeDto>(`/chat/anfragen/${id}/annehmen`, { method: "POST" }),
  chatAnfrageAblehnen: (id: string, begruendung?: string) =>
    request<ChatAnfrageDto>(`/chat/anfragen/${id}/ablehnen`, {
      method: "POST",
      body: JSON.stringify(begruendung ? { begruendung } : {}),
    }),
  chatAnfrageZurueckziehen: (id: string) => request<ChatAnfrageDto>(`/chat/anfragen/${id}`, { method: "DELETE" }),

  // Chat (Mitarbeitende und Klient:innen teilen sich diese Endpunkte).
  chatListe: () => request<ChatDto[]>("/chat"),
  chatEinzeln: (id: string) => request<ChatDto>(`/chat/${id}`),
  chatKontakte: () => request<ChatKontaktDto[]>("/chat/kontakte"),
  chatUngelesen: () => request<ChatUngelesenDto>("/chat/ungelesen"),
  chatDirektAnlegen: (ziel: ChatKontaktEingabe) =>
    request<ChatDto>("/chat/direkt", { method: "POST", body: JSON.stringify(ziel) }),
  chatGruppeAnlegen: (name: string, teilnehmer: ChatKontaktEingabe[]) =>
    request<ChatDto>("/chat/gruppe", { method: "POST", body: JSON.stringify({ name, teilnehmer }) }),
  chatUmbenennen: (id: string, name: string) =>
    request<ChatDto>(`/chat/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  chatTeilnehmerHinzufuegen: (id: string, ziel: ChatKontaktEingabe) =>
    request<ChatDto>(`/chat/${id}/teilnehmer`, { method: "POST", body: JSON.stringify(ziel) }),
  chatTeilnahmeBeenden: (id: string, teilnehmerId: string) =>
    request<{ entfernt: true }>(`/chat/${id}/teilnehmer/${teilnehmerId}`, { method: "DELETE" }),
  chatNachrichten: (id: string, vor?: string, limit = 50) =>
    request<ChatNachrichtenSeiteDto>(`/chat/${id}/nachrichten?limit=${limit}${vor ? `&vor=${vor}` : ""}`),
  chatSenden: (id: string, eingabe: ChatNachrichtEingabe) =>
    request<ChatNachrichtDto>(`/chat/${id}/nachrichten`, { method: "POST", body: JSON.stringify(eingabe) }),
  // Roher Body wie beim Grundriss; Dateityp und -name stehen in Header/Query.
  chatBildSenden: async (id: string, datei: File, text?: string): Promise<ChatNachrichtDto> => {
    const token = getToken();
    const query = new URLSearchParams({ dateiname: datei.name || "bild" });
    if (text?.trim()) query.set("text", text.trim());
    const res = await fetch(`/api/chat/${id}/bilder?${query}`, {
      method: "POST",
      headers: { "Content-Type": datei.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: datei,
    });
    if (res.status === 401 && token) {
      sitzungBeenden();
    }
    if (!res.ok) {
      if (res.status === 413) throw new ApiFehler("Das Bild ist zu groß (maximal 8 MB).", 413);
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiFehler(body.message ?? `Bild konnte nicht gesendet werden (${res.status})`, res.status);
    }
    return res.json() as Promise<ChatNachrichtDto>;
  },
  chatAnhangUrl: (anhangId: string) => blobUrl(`/chat/anhaenge/${anhangId}`),
  chatNachrichtLoeschen: (nachrichtId: string) =>
    request<ChatNachrichtDto>(`/chat/nachrichten/${nachrichtId}`, { method: "DELETE" }),
  chatGelesen: (id: string) => request<{ gelesen: true }>(`/chat/${id}/gelesen`, { method: "POST" }),

  // Kalender
  termine: (von: string, bis: string) =>
    request<TerminDto[]>(`/kalender/termine?von=${encodeURIComponent(von)}&bis=${encodeURIComponent(bis)}`),
  terminEinzeln: (id: string) => request<TerminDto>(`/kalender/termine/${id}`),
  terminAnlegen: (eingabe: TerminAnlegenEingabe) =>
    request<TerminDto>("/kalender/termine", { method: "POST", body: JSON.stringify(eingabe) }),
  terminAendern: (
    id: string,
    payload: { titel?: string; beschreibung?: string | null; ort?: string | null; beginn?: string; ende?: string; ganztaegig?: boolean }
  ) => request<TerminDto>(`/kalender/termine/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  terminAbsagen: (id: string) => request<TerminDto>(`/kalender/termine/${id}/absagen`, { method: "POST" }),
  terminAntworten: (id: string, antwort: TerminAntwort) =>
    request<TerminDto>(`/kalender/termine/${id}/antwort`, { method: "POST", body: JSON.stringify({ antwort }) }),
  terminUebernehmen: (id: string) => request<TerminDto>(`/kalender/termine/${id}/uebernehmen`, { method: "POST" }),
  terminIcsHerunterladen: (id: string) => dateiHerunterladen(`/kalender/termine/${id}/ics`, "termin.ics"),

  // Zugang der Klient:innen zur App (Verwaltung durch Mitarbeitende)
  klientZugang: (klientId: string) => request<KlientZugangDto>(`/klienten/${klientId}/zugang`),
  klientZugangEinladen: (klientId: string, email: string) =>
    request<KlientEinladungDto>(`/klienten/${klientId}/zugang`, { method: "POST", body: JSON.stringify({ email }) }),
  klientZugangNeuEinladen: (klientId: string, email?: string) =>
    request<KlientEinladungDto>(`/klienten/${klientId}/zugang/neu-einladen`, {
      method: "POST",
      body: JSON.stringify(email ? { email } : {}),
    }),
  klientZugangEmailAendernLink: (klientId: string) =>
    request<KlientEmailAenderungLinkDto>(`/klienten/${klientId}/zugang/email-aendern-link`, { method: "POST" }),
  klientZugangAktivSetzen: (klientId: string, aktiv: boolean) =>
    request<KlientZugangDto>(`/klienten/${klientId}/zugang`, { method: "PATCH", body: JSON.stringify({ aktiv }) }),
};
