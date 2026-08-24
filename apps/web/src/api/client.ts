import type { BenutzerListEintragDto, LoginRequest, LoginResponse, MandantDto } from "@zimmerakte/shared";

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

  return res.json() as Promise<T>;
}

export const api = {
  login: (payload: LoginRequest) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  eigenerMandant: () => request<MandantDto>("/mandant/me"),
  benutzerListe: () => request<BenutzerListEintragDto[]>("/benutzer"),
};
