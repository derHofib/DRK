import type {
  BelegungsverlaufEintragDto,
  BenutzerListEintragDto,
  KassenbuchungDto,
  KassenbuchungTyp,
  KlientDetailDto,
  KlientListEintragDto,
  LoginRequest,
  LoginResponse,
  MandantDto,
  StandortDto,
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

export const api = {
  login: (payload: LoginRequest) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  eigenerMandant: () => request<MandantDto>("/mandant/me"),
  benutzerListe: () => request<BenutzerListEintragDto[]>("/benutzer"),

  standorteListe: () => request<StandortDto[]>("/standorte"),
  standortAnlegen: (payload: { name: string; adresse: string }) =>
    request<StandortDto>("/standorte", { method: "POST", body: JSON.stringify(payload) }),

  zimmerListe: () => request<ZimmerListEintragDto[]>("/zimmer"),
  zimmerAnlegen: (payload: { standortId: string; nummer: string }) =>
    request<ZimmerListEintragDto>("/zimmer", { method: "POST", body: JSON.stringify(payload) }),
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

  belegungEinziehen: (payload: { zimmerId: string; klientId: string; einzug: string }) =>
    request("/belegungen", { method: "POST", body: JSON.stringify(payload) }),
  belegungAusziehen: (id: string, auszug: string) =>
    request(`/belegungen/${id}`, { method: "PATCH", body: JSON.stringify({ auszug }) }),

  kassenbuchungenListe: (klientId?: string) =>
    request<KassenbuchungDto[]>(`/kassenbuchungen${klientId ? `?klientId=${klientId}` : ""}`),
  kassenbuchungAnlegen: (payload: {
    klientId: string;
    datum: string;
    betragCent: number;
    verwendungszweck: string;
    typ: KassenbuchungTyp;
    isoJahr?: number;
    isoWoche?: number;
    unterschriftBase64?: string;
  }) => request<KassenbuchungDto>("/kassenbuchungen", { method: "POST", body: JSON.stringify(payload) }),
  kassenbuchungStornieren: (id: string, grund: string) =>
    request<KassenbuchungDto>(`/kassenbuchungen/${id}/stornieren`, {
      method: "PATCH",
      body: JSON.stringify({ grund }),
    }),
  wochenuebersicht: (isoJahr: number, isoWoche: number) =>
    request<WochenuebersichtEintragDto[]>(`/kassenbuchungen/wochenuebersicht?jahr=${isoJahr}&kw=${isoWoche}`),

  // Binaerbild, kein JSON -- deshalb nicht ueber request<T>(), das braucht
  // ausserdem den Auth-Header, den ein rohes <img src="..."> nicht mitschickt.
  unterschriftBildUrl: async (kassenbuchungId: string): Promise<string> => {
    const token = getToken();
    const res = await fetch(`/api/kassenbuchungen/${kassenbuchungId}/unterschrift`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Unterschrift konnte nicht geladen werden (${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};
