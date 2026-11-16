// node --test tools/rueckmeldung-mcp
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let api;
let port;
const anfragen = [];

before(async () => {
  api = createServer((req, res) => {
    anfragen.push({ methode: req.method, url: req.url, auth: req.headers.authorization });
    if (req.headers.authorization !== "Bearer geheim") {
      res.writeHead(401).end(JSON.stringify({ message: "Unauthorized" }));
    } else if (req.url === "/api/service/rueckmeldungen") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify([{ id: "1", titel: "Filter" }]));
    } else if (req.url === "/api/service/rueckmeldungen/1") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "1", titel: "Filter", hatBild: true }));
    } else if (req.url === "/api/service/rueckmeldungen/1/bild") {
      res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
    } else if (req.url === "/api/service/rueckmeldungen/2/status") {
      res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Wechsel freigegeben -> umgesetzt ist nicht erlaubt." }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  port = api.address().port;
});
after(() => api.close());

/** Startet den Server, sendet die Zeilen, liefert die Antworten nach id. */
async function sprich(nachrichten, env = {}) {
  const kind = spawn("node", [new URL("./index.mjs", import.meta.url).pathname], {
    env: { ...process.env, ZIMMERAKTE_API_URL: `http://127.0.0.1:${port}`, ZIMMERAKTE_RUECKMELDUNG_TOKEN: "geheim", ...env },
  });
  const antworten = new Map();
  let puffer = "";
  kind.stdout.on("data", (d) => {
    puffer += d;
    let i;
    while ((i = puffer.indexOf("\n")) >= 0) {
      const zeile = puffer.slice(0, i);
      puffer = puffer.slice(i + 1);
      if (zeile.trim()) {
        const j = JSON.parse(zeile);
        antworten.set(j.id, j);
      }
    }
  });
  for (const n of nachrichten) kind.stdin.write(JSON.stringify(n) + "\n");
  const erwartet = nachrichten.filter((n) => n.id !== undefined).length;
  for (let t = 0; t < 100 && antworten.size < erwartet; t++) await new Promise((r) => setTimeout(r, 50));
  kind.kill();
  return antworten;
}

const rufe = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

test("initialize und tools/list nennen genau die drei Werkzeuge", async () => {
  const a = await sprich([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]);
  assert.equal(a.get(1).result.protocolVersion, "2025-03-26");
  assert.deepEqual(a.get(2).result.tools.map((t) => t.name), ["list_rueckmeldungen", "get_rueckmeldung", "update_rueckmeldung"]);
  // Kein Werkzeug zum Freigeben oder Ablehnen: der Status-Enum kennt beides nicht.
  const status = a.get(2).result.tools[2].inputSchema.properties.status.enum;
  assert.ok(!status.includes("abgelehnt") && !status.includes("neu"));
});

test("list reicht das Token als Bearer weiter", async () => {
  anfragen.length = 0;
  const a = await sprich([rufe(1, "list_rueckmeldungen", {})]);
  assert.match(a.get(1).result.content[0].text, /Filter/);
  assert.equal(anfragen[0].auth, "Bearer geheim");
});

test("get liefert Detail und Screenshot als Bild", async () => {
  const a = await sprich([rufe(1, "get_rueckmeldung", { id: "1" })]);
  const inhalt = a.get(1).result.content;
  assert.equal(inhalt[0].type, "text");
  assert.equal(inhalt[1].type, "image");
  assert.equal(inhalt[1].mimeType, "image/png");
  assert.deepEqual(Buffer.from(inhalt[1].data, "base64"), PNG);
});

test("ein 409 der API wird zum lesbaren Werkzeugfehler, nicht zum Absturz", async () => {
  const a = await sprich([rufe(1, "update_rueckmeldung", { id: "2", status: "umgesetzt", prUrl: "https://example.test/pr/1" })]);
  assert.equal(a.get(1).result.isError, true);
  assert.match(a.get(1).result.content[0].text, /nicht erlaubt/);
});

test("falsches Token: Fehlertext ohne das Token", async () => {
  const a = await sprich([rufe(1, "list_rueckmeldungen", {})], { ZIMMERAKTE_RUECKMELDUNG_TOKEN: "falsch" });
  assert.equal(a.get(1).result.isError, true);
  assert.match(a.get(1).result.content[0].text, /Token ungültig/);
  assert.ok(!JSON.stringify(a.get(1)).includes("falsch\""));
});

test("ohne Konfiguration sagt das Werkzeug, was fehlt", async () => {
  const a = await sprich([rufe(1, "list_rueckmeldungen", {})], { ZIMMERAKTE_API_URL: "", ZIMMERAKTE_RUECKMELDUNG_TOKEN: "" });
  assert.equal(a.get(1).result.isError, true);
  assert.match(a.get(1).result.content[0].text, /ZIMMERAKTE_API_URL/);
});
