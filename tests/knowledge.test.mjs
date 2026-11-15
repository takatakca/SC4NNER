// Connaissances TAKATAK (Knowledge AI) : GET /api/knowledge — recherche en
// arrière-plan dans le catalogue public de takatakca/knowledgeAI, réservée
// aux comptes connectés du studio. Lecture seule, provenance filtrée,
// dégradation propre (liste vide) quand l'API publique ne répond pas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import worker from "../dist/server/index.js";
import { createApp } from "../server/app.mjs";

// Jeton d'essai seulement (jamais une vraie valeur), assemblé par morceaux.
const TOKEN = ["jeton", "de", "test", "provisionnement"].join("-");

async function start(dbPath, env = {}) {
  const app = createApp({
    dbPath,
    worker,
    env: { TRUSTED_PROXY_HOPS: "0", ...env },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, { body, cookie, headers = {}, redirect } = {}) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      redirect: redirect || "follow",
      headers: {
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { app, origin, call };
}

function fakeV1(session) {
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, session }));
    });
  });
  return {
    async url() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function fakeKnowledge(handler) {
  const state = { calls: 0, lastUrl: "" };
  const server = createServer((req, res) => {
    state.calls += 1;
    state.lastUrl = req.url || "";
    handler(req, res);
  });
  return {
    state,
    async url() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function takatakLogin(call) {
  const startRes = await call("/auth/start", { redirect: "manual" });
  assert.equal(startRes.status, 303);
  const state = new URL(startRes.headers.get("location")).searchParams.get(
    "state",
  );
  const stateCookie = startRes.headers
    .getSetCookie()
    .find((c) => c.startsWith("__Host-sc4nner_state="))
    .split(";")[0];
  const cb = await call(
    `/auth/callback?code=${"c".repeat(43)}&state=${state}`,
    { cookie: stateCookie, redirect: "manual" },
  );
  assert.equal(cb.status, 303);
  return cb.headers
    .getSetCookie()
    .find((c) => c.startsWith("__Host-label_session="))
    .split(";")[0];
}

const sessionA = {
  masterIdentityId: "identite-test-kb",
  displayName: "Testeur KB",
  email: "kb@example.com",
  productCode: "sc4nner",
  entitlements: ["sc4nner_free"],
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

test("knowledge : session requise, provenance filtrée, échec propre", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1(sessionA);
  const v1Base = await v1.url();
  const knowledge = fakeKnowledge((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        total: 2,
        results: [
          {
            title: "MIELAISSA",
            section: "project",
            excerpt: "Projet client miel.",
            source_url:
              "https://github.com/takatakca/knowledgeAI/blob/main/projects/MIELAISSA.md",
          },
          {
            title: "Entrée étrangère",
            section: "project",
            excerpt: "Ne doit pas passer le filtre de provenance.",
            source_url: "https://example.com/ailleurs",
          },
        ],
      }),
    );
  });
  const knowledgeBase = await knowledge.url();
  const { app, call } = await start(join(dir, "k.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${v1Base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${v1Base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: TOKEN,
    KNOWLEDGE_AI_API_URL: knowledgeBase,
  });
  try {
    // Sans session : refusé, et l'API publique n'est jamais appelée.
    const anon = await call("/api/knowledge?q=miel");
    assert.equal(anon.status, 401);
    assert.equal(knowledge.state.calls, 0);

    const cookie = await takatakLogin(call);

    // Requête vide : réponse locale, aucun appel en amont.
    const empty = await (await call("/api/knowledge?q=%20", { cookie })).json();
    assert.deepEqual(empty, { ok: true, total: 0, results: [] });
    assert.equal(knowledge.state.calls, 0);

    // Recherche réelle : seuls les résultats du corpus knowledgeAI passent,
    // réduits aux champs sûrs (titre, section, extrait, source).
    const found = await (await call("/api/knowledge?q=miel", { cookie })).json();
    assert.equal(found.ok, true);
    assert.equal(found.total, 2);
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].title, "MIELAISSA");
    assert.match(found.results[0].source_url, /knowledgeAI/);
    assert.match(knowledge.state.lastUrl, /\/api\/search\?q=miel/);
  } finally {
    await app.close();
    await v1.close();
    await knowledge.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("knowledge : API publique en échec = liste vide, jamais un blocage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1(sessionA);
  const v1Base = await v1.url();
  const knowledge = fakeKnowledge((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "indisponible" }));
  });
  const knowledgeBase = await knowledge.url();
  const { app, call } = await start(join(dir, "k2.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${v1Base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${v1Base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: TOKEN,
    KNOWLEDGE_AI_API_URL: knowledgeBase,
  });
  try {
    const cookie = await takatakLogin(call);
    const res = await call("/api/knowledge?q=miel", { cookie });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: false, total: 0, results: [] });
  } finally {
    await app.close();
    await v1.close();
    await knowledge.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
