import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { ChatSession, type StreamEvent } from "./chat-session.js";

export interface DesktopServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly session?: ChatSession;
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createDesktopServer(options: DesktopServerOptions = {}): Server {
  const session = options.session ?? new ChatSession();
  const host = options.host ?? process.env.DEV_AGENT_DESKTOP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.DEV_AGENT_DESKTOP_PORT ?? 4317);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    try {
      if (req.method === "GET" && url.pathname === "/") {
        await serveFile(res, join(publicDir, "index.html"), ".html");
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/public/")) {
        const relative = url.pathname.slice("/public/".length);
        const filePath = join(publicDir, relative);
        if (!filePath.startsWith(publicDir)) {
          res.writeHead(400).end("invalid path");
          return;
        }
        await serveFile(res, filePath, extname(filePath));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        await handleChat(req, res, session);
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  server.on("error", (error) => {
    console.error(`[desktop] server error: ${error.message}`);
  });

  return server;
}

async function serveFile(res: ServerResponse, filePath: string, ext: string): Promise<void> {
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch {
    // Missing files, directories, and unreadable paths are client errors.
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  res.writeHead(200, { "content-type": mimeTypes[ext] ?? "application/octet-stream" });
  res.end(content);
}

async function handleChat(req: IncomingMessage, res: ServerResponse, session: ChatSession): Promise<void> {
  const body = await readBody(req);
  let parsed: { message?: unknown };
  try {
    parsed = JSON.parse(body) as { message?: unknown };
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "request body must be valid JSON" }));
    return;
  }
  const message = typeof parsed.message === "string" ? parsed.message.trim() : "";

  if (!message) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "message is required" }));
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`retry: 3000\n\n`);

  const emit = (event: StreamEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  };

  try {
    await session.run(message, emit);
  } catch (error) {
    emit({ type: "error", data: { message: error instanceof Error ? error.message : String(error) } });
  }

  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export function startServer(options: DesktopServerOptions = {}): Promise<Server> {
  const server = createDesktopServer(options);
  const host = options.host ?? process.env.DEV_AGENT_DESKTOP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.DEV_AGENT_DESKTOP_PORT ?? 4317);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error" as never, reject as never);
      resolve(server);
    });
  });
}
