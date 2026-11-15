// Provisionnement des comptes TAKATAK liés : POST /api/provision (jeton de
// service, idempotent), alimentation du lien par le callback d'échange, et
// reflet fidèle dans /api/release et /api/session. Vraie écoute HTTP, vraie
// base SQLite sur disque, faux TAKATAK V1 local — comme tests/server.test.mjs.
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
const WRONG_TOKEN = ["mauvais", "jeton", "de", "test", "0000"].join("-");

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

// Pont configuré mais jamais appelé (adresses localhost valides).
const bridgeEnv = {
  TAKATAK_SC4NNER_LAUNCH_URL: "http://127.0.0.1:9/launch",
  TAKATAK_SC4NNER_EXCHANGE_URL: "http://127.0.0.1:9/exchange",
  TAKATAK_SC4NNER_SERVICE_TOKEN: TOKEN,
};

// Faux TAKATAK V1 : répond à l'échange avec la session configurée.
function fakeV1(initial) {
  let current = initial;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(current));
    });
  });
  return {
    set: (next) => {
      current = next;
    },
    async url() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const v1Session = (masterIdentityId, displayName, email) => ({
  ok: true,
  session: {
    masterIdentityId,
    displayName,
    ...(email ? { email } : {}),
    productCode: "sc4nner",
    entitlements: ["sc4nner_free"],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  },
});

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
  assert.equal(cb.headers.get("location"), "/");
  return cb.headers
    .getSetCookie()
    .find((c) => c.startsWith("__Host-label_session="))
    .split(";")[0];
}

test("provision : jeton requis, validation, idempotence, release fidèle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const { app, call } = await start(join(dir, "p.db"), bridgeEnv);
  try {
    // Aucun compte atelier dans cet env. : l'état de départ est réel.
    const before = await (await call("/api/release")).json();
    assert.equal(before.account, "not_configured");
    assert.equal(before.linkedAccounts, 0);

    const payload = {
      masterIdentityId: "identite-test-aaa",
      email: "a@example.com",
      displayName: "Testeur A",
    };
    // Sans jeton, puis avec un mauvais jeton : refusé, rien n'est créé.
    assert.equal((await call("/api/provision", { body: payload })).status, 401);
    assert.equal(
      (
        await call("/api/provision", {
          body: payload,
          headers: { Authorization: `Bearer ${WRONG_TOKEN}` },
        })
      ).status,
      401,
    );
    // Corps invalides : identité trop courte, courriel malformé, produit autre.
    const auth = { Authorization: `Bearer ${TOKEN}` };
    assert.equal(
      (
        await call("/api/provision", {
          body: { ...payload, masterIdentityId: "x" },
          headers: auth,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/api/provision", {
          body: { ...payload, email: "pas-un-courriel" },
          headers: auth,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/api/provision", {
          body: { ...payload, productCode: "autre-produit" },
          headers: auth,
        })
      ).status,
      400,
    );
    assert.equal(
      (await (await call("/api/release")).json()).linkedAccounts,
      0,
    );

    // Premier appel : le lien est créé ; /api/release le reflète aussitôt.
    const first = await call("/api/provision", { body: payload, headers: auth });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      ok: true,
      provisioned: true,
      created: true,
    });
    const after = await (await call("/api/release")).json();
    assert.equal(after.account, "configured");
    assert.equal(after.linkedAccounts, 1);

    // Second appel, même identité, courriel corrigé : mise à jour, pas de doublon.
    const again = await call("/api/provision", {
      body: { ...payload, email: "a2@example.com" },
      headers: auth,
    });
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), {
      ok: true,
      provisioned: true,
      created: false,
    });
    assert.equal(
      (await (await call("/api/release")).json()).linkedAccounts,
      1,
    );

    // Une deuxième identité provisionne SA copie, pas celle de la première.
    const second = await call("/api/provision", {
      body: {
        masterIdentityId: "identite-test-bbb",
        email: "b@example.com",
        displayName: "Testeur B",
      },
      headers: auth,
    });
    assert.deepEqual(await second.json(), {
      ok: true,
      provisioned: true,
      created: true,
    });
    assert.equal(
      (await (await call("/api/release")).json()).linkedAccounts,
      2,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("flux complet : le courriel échangé alimente le lien ; chaque session affiche SON courriel", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1(v1Session("identite-test-aaa", "Testeur A", "a@example.com"));
  const base = await v1.url();
  const { app, call } = await start(join(dir, "f.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: TOKEN,
  });
  try {
    // Connexion de A : le callback crée le lien depuis la session échangée,
    // sans aucun appel à /api/provision.
    const cookieA = await takatakLogin(call);
    const sessionA = await (await call("/api/session", { cookie: cookieA })).json();
    assert.equal(sessionA.email, "a@example.com");
    assert.equal(sessionA.username, "Testeur A");
    assert.equal(
      (await (await call("/api/release")).json()).linkedAccounts,
      1,
    );

    // Connexion de B : sa session affiche SON courriel, celle de A reste la sienne.
    v1.set(v1Session("identite-test-bbb", "Testeur B", "b@example.com"));
    const cookieB = await takatakLogin(call);
    const sessionB = await (await call("/api/session", { cookie: cookieB })).json();
    assert.equal(sessionB.email, "b@example.com");
    assert.equal(
      (await (await call("/api/session", { cookie: cookieA })).json()).email,
      "a@example.com",
    );
    assert.equal(
      (await (await call("/api/release")).json()).linkedAccounts,
      2,
    );

    // Un provisionnement explicite met à jour le lien de B seulement.
    const prov = await call("/api/provision", {
      body: {
        masterIdentityId: "identite-test-bbb",
        email: "b-pro@example.com",
        displayName: "Testeur B",
      },
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.deepEqual(await prov.json(), {
      ok: true,
      provisioned: true,
      created: false,
    });
    assert.equal(
      (await (await call("/api/session", { cookie: cookieB })).json()).email,
      "b-pro@example.com",
    );
    assert.equal(
      (await (await call("/api/session", { cookie: cookieA })).json()).email,
      "a@example.com",
    );
  } finally {
    await app.close();
    await v1.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("échange sans courriel : la session fonctionne, email null, aucun lien créé", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1(v1Session("identite-test-ccc", "Testeur C"));
  const base = await v1.url();
  const { app, call } = await start(join(dir, "g.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: TOKEN,
  });
  try {
    const cookie = await takatakLogin(call);
    const session = await (await call("/api/session", { cookie })).json();
    assert.equal(session.signedIn, true);
    assert.equal(session.email, null);
    const release = await (await call("/api/release")).json();
    assert.equal(release.linkedAccounts, 0);
    assert.equal(release.account, "not_configured");
  } finally {
    await app.close();
    await v1.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
