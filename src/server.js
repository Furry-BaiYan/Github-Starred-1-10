import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchTop10Starred, getLatestSnapshot } from "./github.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function execDetached(command, args, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const child = spawn(command, args, {
        stdio: "ignore",
        windowsHide: true,
        ...options
      });
      child.once("error", () => finish(false));
      child.once("exit", (code) => finish(code === 0));
      setTimeout(() => {
        child.unref();
        finish(true);
      }, 1500).unref();
    } catch {
      finish(false);
    }
  });
}

export async function openInBrowser(url) {
  if (process.platform === "win32") {
    const normalized = new URL(url).href;
    const escapedUrl = normalized.replace(/&/g, "^&");
    // 1. Primary: cmd.exe `start "" /b <url>` with windowsVerbatimArguments (avoids `\"` escaping)
    const okStart = await execDetached(
      "cmd.exe",
      ["/c", "start", '""', "/b", escapedUrl],
      { windowsVerbatimArguments: true }
    );
    if (okStart) return true;

    // 2. Fallback: Win32 ShellExecute URL protocol handler
    const okRundll = await execDetached("rundll32.exe", [
      "url.dll,FileProtocolHandler",
      url
    ]);
    if (okRundll) return true;

    // 3. Final fallback: Windows Explorer shell URL open
    return execDetached("explorer.exe", [url]);
  }

  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  return execDetached(opener, [url], { detached: true });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) {
      throw new Error("Payload too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createWebServerController({ chatSession, onSnapshotUpdate } = {}) {
  let server = null;
  let serverUrl = null;
  let serverPort = null;
  const sseClients = new Set();

  function broadcastEvent(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  async function handleRequest(req, res) {
    try {
      const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const pathname = reqUrl.pathname;

      if (req.method === "GET" && pathname === "/api/top10") {
        const force = reqUrl.searchParams.get("refresh") === "1";
        const snapshot = await fetchTop10Starred({ force });
        if (force) {
          broadcastEvent("top10", snapshot);
          onSnapshotUpdate?.(snapshot);
        }
        return sendJson(res, 200, snapshot);
      }

      if (req.method === "GET" && pathname === "/api/status") {
        const snap = getLatestSnapshot();
        return sendJson(res, 200, {
          ok: true,
          url: serverUrl,
          port: serverPort,
          fetchedAt: snap?.fetchedAt || null,
          source: snap?.source || null,
          count: snap?.items?.length || 0
        });
      }

      if (req.method === "GET" && pathname === "/api/chat") {
        return sendJson(res, 200, {
          ok: true,
          messages: chatSession ? chatSession.getHistory() : []
        });
      }

      if (req.method === "POST" && pathname === "/api/chat") {
        const body = await readJsonBody(req);
        const text = String(body?.text || "").trim();
        if (!text) {
          return sendJson(res, 400, { ok: false, error: "消息内容不能为空" });
        }
        if (!chatSession) {
          return sendJson(res, 200, { ok: true, reply: null, messages: [] });
        }
        const entry = chatSession.handleUserMessage(text, { origin: "web" });
        const messages = chatSession.getHistory();
        broadcastEvent("chat", { ...entry, messages });
        return sendJson(res, 200, {
          ok: true,
          ...entry,
          messages
        });
      }

      if (req.method === "GET" && pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
        const snap = getLatestSnapshot();
        if (snap) {
          res.write(`event: top10\ndata: ${JSON.stringify(snap)}\n\n`);
        }
        sseClients.add(res);
        req.on("close", () => {
          sseClients.delete(res);
        });
        return;
      }

      // Serve static files from public/
      const relativeTarget = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const resolvedPath = path.resolve(PUBLIC_DIR, relativeTarget);
      if (!resolvedPath.startsWith(PUBLIC_DIR + path.sep) && resolvedPath !== PUBLIC_DIR) {
        return sendJson(res, 403, { ok: false, error: "Forbidden" });
      }

      try {
        const stat = await fs.stat(resolvedPath);
        const filePath = stat.isDirectory()
          ? path.join(resolvedPath, "index.html")
          : resolvedPath;
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          "Cache-Control": "no-cache"
        });
        res.end(content);
      } catch {
        sendJson(res, 404, { ok: false, error: "Not Found" });
      }
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err?.message || "Internal Server Error"
      });
    }
  }

  function tryListen(port, host = "127.0.0.1") {
    return new Promise((resolve, reject) => {
      const srv = http.createServer(handleRequest);
      srv.once("error", (err) => {
        reject(err);
      });
      srv.listen(port, host, () => {
        const addr = srv.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        resolve({ srv, actualPort });
      });
    });
  }

  async function start({ preferredPort = Number(process.env.PORT) || 3000, autoOpen = true } = {}) {
    const shouldOpen = autoOpen && process.env.NO_AUTO_OPEN !== "1";
    if (server && serverUrl) {
      const opened = shouldOpen ? await openInBrowser(serverUrl) : false;
      return { url: serverUrl, port: serverPort, alreadyRunning: true, opened };
    }
    let bound = null;
    for (let offset = 0; offset <= 15; offset++) {
      const candidate = preferredPort + offset;
      try {
        bound = await tryListen(candidate);
        break;
      } catch (err) {
        if (err.code !== "EADDRINUSE") throw err;
      }
    }
    if (!bound) {
      bound = await tryListen(0);
    }

    server = bound.srv;
    serverPort = bound.actualPort;
    serverUrl = `http://127.0.0.1:${serverPort}`;

    const opened = shouldOpen ? await openInBrowser(serverUrl) : false;

    return { url: serverUrl, port: serverPort, alreadyRunning: false, opened };
  }

  async function stop() {
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // Ignore
      }
    }
    sseClients.clear();
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
    server = null;
    serverUrl = null;
    serverPort = null;
  }

  return {
    start,
    stop,
    broadcastEvent,
    getStatus: () => ({
      running: Boolean(server && serverUrl),
      url: serverUrl,
      port: serverPort
    })
  };
}
