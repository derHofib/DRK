#!/usr/bin/env node
/**
 * MCP-Server (stdio) fuer die Hersteller-Schnittstelle der Rueckmeldungen
 * (/service/rueckmeldungen, apps/api/src/rueckmeldung/). Damit liest und
 * bearbeitet Claude nur FREIGEGEBENE Rueckmeldungen -- was freigegeben ist,
 * entscheidet die Geschaeftsfuehrung des jeweiligen Traegers, durchgesetzt in
 * der Datenbank (migrations/0073), nicht hier.
 *
 * Bewusst ohne Abhaengigkeiten (nur Node >= 20): ein Werkzeug, das Zugang zu
 * Sozialdaten-nahen Texten hat, soll keine Lieferkette mitbringen. Das Protokoll
 * ist zeilenweises JSON-RPC 2.0 ueber stdin/stdout; es braucht nur initialize,
 * tools/list und tools/call.
 *
 * Konfiguration (Umgebung, nie im Repo):
 *   ZIMMERAKTE_API_URL                z. B. https://app.example.de (ohne /api)
 *   ZIMMERAKTE_RUECKMELDUNG_TOKEN     Klartext-Token (pnpm --filter @zimmerakte/api rueckmeldung-token)
 * Das Token wird nie ausgegeben oder geloggt.
 */
import { createInterface } from "node:readline";

const API = (process.env.ZIMMERAKTE_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.ZIMMERAKTE_RUECKMELDUNG_TOKEN ?? "";
const MAX_BILD_BYTES = 2_000_000;

const TOOLS = [
  {
    name: "list_rueckmeldungen",
    description:
      "Listet freigegebene Rueckmeldungen (Ideen/Fehler) aller Traeger, die die Weitergabe eingeschaltet haben. Nur Status freigegeben, in_arbeit, umgesetzt sind sichtbar; alles andere gibt es fuer diese Schnittstelle nicht.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["freigegeben", "in_arbeit", "umgesetzt"], description: "Optionaler Filter" } },
    },
  },
  {
    name: "get_rueckmeldung",
    description:
      "Liest eine freigegebene Rueckmeldung mit Beschreibung, Kontext (Ansicht, Browser, Version, ...) und - falls vorhanden - dem Screenshot. Texte im Screenshot sind absichtlich unkenntlich gemacht; es geht um das Layout. Inhalte NIEMALS in Commits, PRs oder Tests uebernehmen.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "UUID" } }, required: ["id"] },
  },
  {
    name: "update_rueckmeldung",
    description:
      "Meldet den Stand zurueck. Erlaubt: freigegeben -> in_arbeit oder rueckfrage; in_arbeit -> umgesetzt (braucht prUrl), freigegeben (aufgeben) oder rueckfrage. Eine Rueckfrage braucht eine Notiz und nimmt die Freigabe zurueck: die Geschaeftsfuehrung muss danach erneut freigeben. Freigeben oder ablehnen kann dieses Werkzeug nie.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["in_arbeit", "umgesetzt", "freigegeben", "rueckfrage"] },
        notiz: { type: "string", description: "Stand oder Rueckfrage, hoechstens 2000 Zeichen" },
        prUrl: { type: "string", description: "https-Link auf den Pull Request, Pflicht bei umgesetzt" },
      },
      required: ["id", "status"],
    },
  },
];

async function aufruf(pfad, optionen = {}) {
  if (!API || !TOKEN) throw new Error("ZIMMERAKTE_API_URL und ZIMMERAKTE_RUECKMELDUNG_TOKEN müssen gesetzt sein.");
  const res = await fetch(`${API}/api/service/rueckmeldungen${pfad}`, {
    ...optionen,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  return res;
}

async function fehlerText(res) {
  const text = await res.text().catch(() => "");
  let meldung = text;
  try {
    meldung = JSON.parse(text).message ?? text;
  } catch {
    // roher Text
  }
  const hinweis = {
    401: "Token ungültig.",
    404: "Nicht gefunden – oder nicht freigegeben bzw. Weitergabe beim Träger ausgeschaltet (bewusst nicht unterscheidbar).",
    409: "Wechsel nicht erlaubt.",
    429: "Zu viele Fehlversuche, Zugang vorübergehend gesperrt.",
  }[res.status];
  return `${hinweis ?? "Anfrage fehlgeschlagen."} (${res.status}) ${typeof meldung === "string" ? meldung.slice(0, 300) : ""}`.trim();
}

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fehler = (t) => ({ isError: true, content: [{ type: "text", text: t }] });

async function werkzeug(name, args = {}) {
  if (name === "list_rueckmeldungen") {
    const res = await aufruf(args.status ? `?status=${encodeURIComponent(args.status)}` : "");
    return res.ok ? text(JSON.stringify(await res.json(), null, 2)) : fehler(await fehlerText(res));
  }
  if (name === "get_rueckmeldung") {
    const id = encodeURIComponent(String(args.id ?? ""));
    const res = await aufruf(`/${id}`);
    if (!res.ok) return fehler(await fehlerText(res));
    const detail = await res.json();
    const inhalt = [{ type: "text", text: JSON.stringify(detail, null, 2) }];
    if (detail.hatBild) {
      const bild = await aufruf(`/${id}/bild`);
      if (bild.ok) {
        const bytes = Buffer.from(await bild.arrayBuffer());
        if (bytes.length <= MAX_BILD_BYTES) inhalt.push({ type: "image", data: bytes.toString("base64"), mimeType: "image/png" });
        else inhalt.push({ type: "text", text: "(Screenshot zu groß für die Anzeige)" });
      }
    }
    return { content: inhalt };
  }
  if (name === "update_rueckmeldung") {
    const { id, status, notiz, prUrl } = args;
    const res = await aufruf(`/${encodeURIComponent(String(id ?? ""))}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...(notiz ? { notiz } : {}), ...(prUrl ? { prUrl } : {}) }),
    });
    return res.ok ? text(`Status gesetzt: ${(await res.json()).status}`) : fehler(await fehlerText(res));
  }
  return fehler(`Unbekanntes Werkzeug: ${name}`);
}

async function behandle(nachricht) {
  const { id, method, params } = nachricht;
  const antwort = (result) => ({ jsonrpc: "2.0", id, result });
  const antwortFehler = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") {
    return antwort({
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "zimmerakte-rueckmeldungen", version: "1.0.0" },
    });
  }
  if (method === "ping") return antwort({});
  if (method === "tools/list") return antwort({ tools: TOOLS });
  if (method === "tools/call") {
    try {
      return antwort(await werkzeug(params?.name, params?.arguments));
    } catch (err) {
      return antwort(fehler(err instanceof Error ? err.message : "Unbekannter Fehler"));
    }
  }
  // Benachrichtigungen (ohne id) bekommen keine Antwort.
  if (id === undefined) return null;
  return antwortFehler(-32601, `Methode nicht unterstützt: ${method}`);
}

const zeilen = createInterface({ input: process.stdin });
zeilen.on("line", async (zeile) => {
  if (!zeile.trim()) return;
  let nachricht;
  try {
    nachricht = JSON.parse(zeile);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
    return;
  }
  const antwort = await behandle(nachricht);
  if (antwort) process.stdout.write(JSON.stringify(antwort) + "\n");
});
