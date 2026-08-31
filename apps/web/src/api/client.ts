import type {
  BelegungsverlaufEintragDto,
  BenutzerListEintragDto,
  BenutzerRolle,
  DashboardDto,
  KassenbuchungDto,
  KassenbuchungTyp,
  KlientDetailDto,
  KlientListEintragDto,
  KostenuebernahmeDto,
  LoginRequest,
  LoginResponse,
  MandantDto,
  RechnungDetailDto,
  RechnungDto,
  RechnungStatus,
  StandortDto,
  TagDto,
  TagesberichtDto,
  TotpEinrichtenResponse,
  WochenuebersichtEintragDto,
  ZimmerListEintragDto,
} from "@zimmerakte/shared";

const TOKEN_KEY = "zimmerakte_token";

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
 * Liest die Rolle aus der JWT-Nutzlast -- ohne Signaturpruefung, und das ist
 * Absicht.
 *
 * Das hier ist ausschliesslich ein ANZEIGE-Hinweis: welche Bedienelemente
 * ueberhaupt gezeigt werden. Die einzige Autoritaet bleibt der Server --
 * PATCH /mandant/me prueft die Rolle selbst und antwortet mit 403, egal was
 * hier steht. Wer die Nutzlast manipuliert, sieht hoechstens ein Formular,
 * das ihm dann 403 gibt.
 *
 * Bewusst kein eigener /auth/me-Endpunkt fuer eine reine Anzeigefrage.
 */
export function tokenRolle(): BenutzerRolle | null {
  const token = getToken();
  if (!token) return null;
  try {
    const nutzlast = token.split(".")[1];
    if (!nutzlast) return null;
    // base64url -> base64, dann dekodieren.
    const json = atob(nutzlast.replace(/-/g, "+").replace(/_/g, "/"));
    const rolle = JSON.parse(json)?.rolle;
    return typeof rolle === "string" ? (rolle as BenutzerRolle) : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Anfrage fehlgeschlagen (${res.status})`);
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

export const api = {
  dashboard: () => request<DashboardDto>("/dashboard"),

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
  benutzerListe: () => request<BenutzerListEintragDto[]>("/benutzer"),
  benutzerAnlegen: (payload: { name: string; email: string; rolle: BenutzerRolle; passwort: string }) =>
    request<BenutzerListEintragDto>("/benutzer", { method: "POST", body: JSON.stringify(payload) }),
  passwortResetErstellen: (benutzerId: string) =>
    request<{ token: string; laeuftAbAm: string }>(`/benutzer/${benutzerId}/passwort-reset`, { method: "POST" }),
  benutzerStandorteSetzen: (benutzerId: string, standortIds: string[]) =>
    request<string[]>(`/benutzer/${benutzerId}/standorte`, { method: "PUT", body: JSON.stringify({ standortIds }) }),

  standorteListe: () => request<StandortDto[]>("/standorte"),
  standortAnlegen: (payload: { name: string; adresse: string }) =>
    request<StandortDto>("/standorte", { method: "POST", body: JSON.stringify(payload) }),
  standortAktualisieren: (id: string, payload: { name?: string; adresse?: string; aktiv?: boolean }) =>
    request<StandortDto>(`/standorte/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  zimmerListe: () => request<ZimmerListEintragDto[]>("/zimmer"),
  zimmerAnlegen: (payload: { standortId: string; nummer: string; etage?: string }) =>
    request<ZimmerListEintragDto>("/zimmer", { method: "POST", body: JSON.stringify(payload) }),
  zimmerAktualisieren: (id: string, payload: { nummer: string; etage?: string }) =>
    request<ZimmerListEintragDto>(`/zimmer/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  zimmerDeaktivieren: (id: string) => request<ZimmerListEintragDto>(`/zimmer/${id}/deaktivieren`, { method: "PATCH" }),
  belegungsverlauf: (zimmerId: string) =>
    request<BelegungsverlaufEintragDto[]>(`/zimmer/${zimmerId}/belegungsverlauf`),

  klientenListe: () => request<KlientListEintragDto[]>("/klienten"),
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

  belegungEinziehen: (payload: { zimmerId: string; klientId: string; einzug: string }) =>
    request("/belegungen", { method: "POST", body: JSON.stringify(payload) }),
  belegungAusziehen: (id: string, auszug: string) =>
    request(`/belegungen/${id}`, { method: "PATCH", body: JSON.stringify({ auszug }) }),

  kassenbuchungenListe: (klientId?: string) =>
    request<KassenbuchungDto[]>(`/kassenbuchungen${klientId ? `?klientId=${klientId}` : ""}`),
  kassenbuchungAnlegen: (payload: {
    klientId?: string;
    standortId?: string;
    datum: string;
    betragCent: number;
    verwendungszweck: string;
    typ: KassenbuchungTyp;
    isoJahr?: number;
    isoWoche?: number;
    unterschriftBase64?: string;
    teilnehmerKlientIds?: string[];
    teilnehmerBenutzerIds?: string[];
  }) => request<KassenbuchungDto>("/kassenbuchungen", { method: "POST", body: JSON.stringify(payload) }),
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
  wochenuebersicht: (isoJahr: number, isoWoche: number) =>
    request<WochenuebersichtEintragDto[]>(`/kassenbuchungen/wochenuebersicht?jahr=${isoJahr}&kw=${isoWoche}`),

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
};
