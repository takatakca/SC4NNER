// SC4NNER — serveur Node pour Coolify (ou tout hôte Docker).
// Il fait tourner le même gestionnaire que l'hébergement Sites (worker.mjs),
// avec une base SQLite persistante à la place de D1. Aucun secret ici :
// tout vient des variables d'environnement (voir .env.example et DEPLOY.md).
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY_BYTES = 700_000;
const LOGIN_FAILURES_PER_IP = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Ouvre la base et applique les migrations de `drizzle/` une seule fois chacune. */
export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((row) => row.name),
  );
  const files = readdirSync(join(root, "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(root, "drizzle", name), "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations(name,applied_at) VALUES(?,?)").run(
        name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}

/** Interface D1 (prepare / bind / first / all / run / batch) au-dessus de node:sqlite. */
export function d1(db) {
  const cache = new Map();
  const statement = (sql) => {
    let prepared = cache.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      cache.set(sql, prepared);
    }
    return prepared;
  };
  const runNow = (sql, args) => ({
    meta: { changes: Number(statement(sql).run(...args).changes) },
  });
  const bound = (sql, args) => ({
    bind: (...next) =>
      bound(
        sql,
        next.map((value) => (value === undefined ? null : value)),
      ),
    async first() {
      return statement(sql).get(...args) ?? null;
    },
    async all() {
      return { results: statement(sql).all(...args) };
    },
    async run() {
      return runNow(sql, args);
    },
    runSync: () => runNow(sql, args),
  });
  return {
    prepare: (sql) => bound(sql, []),
    // Tout ou rien, comme D1.
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => item.runSync());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * @param {{ dbPath: string, worker: { fetch: Function }, env?: Record<string, string | undefined> }} options
 */
export function createApp({ dbPath, worker, env = process.env }) {
  const db = openDatabase(dbPath);
  const workerEnv = {
    DB: d1(db),
    // Un déploiement = un espace. L'en-tête d'identité de l'hébergement Sites
    // n'existe pas ici; il est retiré de chaque requête plus bas.
    WORKSPACE_ID: env.SC4NNER_WORKSPACE_ID || "sc4nner",
    DEMO_USERNAME: env.SC4NNER_USERNAME || env.DEMO_USERNAME,
    DEMO_SALT: env.SC4NNER_SALT || env.DEMO_SALT,
    DEMO_PASSWORD_HASH: env.SC4NNER_PASSWORD_HASH || env.DEMO_PASSWORD_HASH,
  };
  const accountConfigured = Boolean(
    workerEnv.DEMO_USERNAME &&
      workerEnv.DEMO_SALT &&
      workerEnv.DEMO_PASSWORD_HASH,
  );
  const baseUrl = (env.APP_BASE_URL || "").replace(/\/+$/, "");
  const proxyHops = Math.max(0, Number(env.TRUSTED_PROXY_HOPS ?? 1) || 0);
  const commit = /^[a-f0-9]{40}$/.test(env.SOURCE_COMMIT || "")
    ? env.SOURCE_COMMIT
    : null;
  const failures = new Map();

  const clientIp = (req) => {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (proxyHops > 0 && forwarded.length >= proxyHops)
      return forwarded[forwarded.length - proxyHops];
    return req.socket.remoteAddress || "unknown";
  };
  const publicOrigin = (req) => {
    if (baseUrl) return baseUrl;
    const host = String(req.headers.host || "");
    if (!/^[a-z0-9.\-:[\]]+$/i.test(host)) return null;
    const proto =
      proxyHops > 0
        ? String(req.headers["x-forwarded-proto"] || "http")
            .split(",")[0]
            .trim()
        : "http";
    return `${proto === "https" ? "https" : "http"}://${host}`;
  };

  const server = createServer(async (req, res) => {
    try {
      const origin = publicOrigin(req);
      if (!origin) return json(res, 400, { error: "Requête invalide." });
      const url = new URL(req.url || "/", origin);
      const method = req.method || "GET";

      if (url.pathname === "/api/release" && method === "GET")
        return json(res, 200, {
          name: "SC4NNER",
          commit,
          account: accountConfigured ? "configured" : "not_configured",
        });

      const isLogin = url.pathname === "/api/login" && method === "POST";
      const ip = clientIp(req);
      if (isLogin) {
        const entry = failures.get(ip);
        if (
          entry &&
          entry.until > Date.now() &&
          entry.count >= LOGIN_FAILURES_PER_IP
        )
          return json(res, 429, {
            error: "Trop de tentatives. Réessayez dans 15 minutes.",
          });
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (
          value === undefined ||
          name === "oai-authenticated-user-id" ||
          name === "host" ||
          name === "connection" ||
          name === "transfer-encoding"
        )
          continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const hasBody = method !== "GET" && method !== "HEAD";
      const body = hasBody ? await readBody(req) : undefined;
      const response = await worker.fetch(
        new Request(url, { method, headers, body }),
        workerEnv,
      );

      if (isLogin) {
        if (response.status === 401) {
          const now = Date.now();
          const entry = failures.get(ip);
          if (entry && entry.until > now) entry.count += 1;
          else failures.set(ip, { count: 1, until: now + LOGIN_WINDOW_MS });
          if (failures.size > 5000)
            for (const [key, value] of failures)
              if (value.until <= now) failures.delete(key);
        } else if (response.status === 200) failures.delete(ip);
      }

      const out = {};
      for (const [name, value] of response.headers)
        if (name !== "set-cookie") out[name] = value;
      const cookies = response.headers.getSetCookie();
      if (cookies.length) out["set-cookie"] = cookies;
      res.writeHead(response.status, out);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (error?.status === 413)
        return json(res, 413, { error: "Fichier trop volumineux." });
      console.error("[sc4nner] requête en échec", error?.name);
      if (!res.headersSent)
        json(res, 500, { error: "Action impossible. Réessayez." });
      else res.end();
    }
  });

  return {
    server,
    accountConfigured,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections?.();
      }),
  };
}
