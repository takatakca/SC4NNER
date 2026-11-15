// Lien inventaire TAKATAK : le studio lit le catalogue V1 de la personne
// connectée (serveur à serveur), et l'étiquette garde la référence du
// produit. Vrai serveur Node, vraie base SQLite, faux V1 local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pbkdf2Sync } from "node:crypto";
import { createServer } from "node:http";
import worker from "../dist/server/index.js";
import { createApp } from "../server/app.mjs";

const account = {
  SC4NNER_USERNAME: "essai",
  SC4NNER_SALT: "sel-de-test-seulement",
  SC4NNER_PASSWORD_HASH: pbkdf2Sync(
    "Mot-De-Passe-De-Test",
    "sel-de-test-seulement",
    100000,
    32,
    "sha256",
  ).toString("hex"),
};

async function start(dbPath, env = {}) {
  const app = createApp({
    dbPath,
    worker,
    env: { TRUSTED_PROXY_HOPS: "0", ...account, ...env },
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

// Faux TAKATAK V1 : /exchange donne la session, /inventory donne le
// catalogue configuré et note la demande (jeton, corps).
function fakeV1({ session, catalog, catalogStatus = 200 }) {
  const seen = { exchange: null, inventory: null };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const entry = { auth: req.headers.authorization, body: raw };
      if (req.url === "/exchange") {
        seen.exchange = entry;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, session }));
      } else if (req.url === "/inventory") {
        seen.inventory = entry;
        res.writeHead(catalogStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify(catalog));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      }
    });
  });
  return {
    seen,
    async url() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const catalog = {
  ok: true,
  linked: true,
  workspaces: [
    {
      clientId: "11111111-1111-4111-8111-111111111111",
      clientName: "Atelier Miel",
      brands: [{ id: "22222222-2222-4222-8222-222222222222", name: "MIEL AISSA" }],
      products: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          businessBrandId: "22222222-2222-4222-8222-222222222222",
          name: "Miel de fleurs sauvages",
          sku: "AISSA-500",
          category: "Honey",
          size: "500 g",
          ingredients: "Miel",
          gtin: "012345678905",
          priceCents: 1299,
          quantity: 42,
          threshold: 10,
        },
      ],
    },
  ],
};

const session = {
  masterIdentityId: "identite-inventaire-1",
  displayName: "Testeur Inventaire",
  productCode: "sc4nner",
  entitlements: ["sc4nner_free"],
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

const labelWithLink = {
  title: "MIEL AISSA — Miel de fleurs sauvages — 500 g",
  payload: {
    product: {
      name: "Miel de fleurs sauvages",
      sku: "AISSA-500",
      size: "500 g",
      gtin: "012345678905",
    },
    config: {
      widthMm: 200,
      heightMm: 80,
      seamMm: 5,
      dpi: 300,
      orientation: "ladder",
      theme: "honey",
      brand: "MIEL AISSA",
      nameFr: "Miel de fleurs sauvages",
      ingredientsFr: "Miel",
      business: "Entreprise de test",
      origin: "",
      grade: "",
      colour: "",
      storage: "",
      notes: "",
      lot: "",
      bestBefore: "",
    },
    inventory: {
      productId: "33333333-3333-4333-8333-333333333333",
      clientId: "11111111-1111-4111-8111-111111111111",
      businessBrandId: "22222222-2222-4222-8222-222222222222",
      brandName: "MIEL AISSA",
      name: "Miel de fleurs sauvages",
      sku: "AISSA-500",
      gtin: "012345678905",
      category: "Honey",
    },
  },
};

async function takatakLogin(call) {
  const startRes = await call("/auth/start", { redirect: "manual" });
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

test("inventaire TAKATAK : catalogue lu via le pont, lien gardé sur l'étiquette", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1({ session, catalog });
  const base = await v1.url();
  const { app, call } = await start(join(dir, "inv.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: "jeton-de-service-de-test-assez-long",
  });
  try {
    // Sans session : refusé.
    assert.equal((await call("/api/inventory/products")).status, 401);
    const cookie = await takatakLogin(call);
    // Le catalogue arrive, et V1 a reçu le jeton + la bonne identité.
    const res = await call("/api/inventory/products", { cookie });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.linked, true);
    assert.equal(data.workspaces.length, 1);
    assert.equal(data.workspaces[0].products[0].sku, "AISSA-500");
    assert.equal(data.workspaces[0].products[0].quantity, 42);
    assert.equal(
      v1.seen.inventory.auth,
      "Bearer jeton-de-service-de-test-assez-long",
    );
    assert.deepEqual(JSON.parse(v1.seen.inventory.body), {
      masterIdentityId: "identite-inventaire-1",
    });
    // L'étiquette sauvegardée garde la référence du produit d'inventaire.
    assert.equal(
      (await call("/api/labels", { body: labelWithLink, cookie })).status,
      200,
    );
    const labels = (await (await call("/api/labels", { cookie })).json())
      .labels;
    assert.equal(labels.length, 1);
    assert.equal(
      labels[0].payload.inventory.productId,
      "33333333-3333-4333-8333-333333333333",
    );
    assert.equal(labels[0].payload.inventory.sku, "AISSA-500");
    // Le compte atelier n'a pas d'inventaire V1.
    const login = await call("/api/login", {
      body: { username: "essai", password: "Mot-De-Passe-De-Test" },
    });
    const wcookie = login.headers.get("set-cookie").split(";")[0];
    assert.deepEqual(
      await (await call("/api/inventory/products", { cookie: wcookie })).json(),
      { ok: true, linked: false, reason: "workshop", workspaces: [] },
    );
  } finally {
    await app.close();
    await v1.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inventaire TAKATAK : V1 en panne répond 502, jamais un faux catalogue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1({ session, catalog: { ok: false }, catalogStatus: 500 });
  const base = await v1.url();
  const { app, call } = await start(join(dir, "inv2.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: "jeton-de-service-de-test-assez-long",
  });
  try {
    const cookie = await takatakLogin(call);
    const res = await call("/api/inventory/products", { cookie });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /injoignable/);
  } finally {
    await app.close();
    await v1.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
