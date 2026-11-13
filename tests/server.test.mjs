// Le serveur Node (Coolify) : vraie écoute HTTP, vraie base SQLite sur disque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pbkdf2Sync } from "node:crypto";
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
  const call = (path, { body, cookie, headers = {} } = {}) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { app, origin, call };
}

const label = {
  title: "Miel de test 250 g",
  payload: {
    product: { name: "Miel de test", sku: "TEST-250", size: "250 g" },
    // Réglages complets, comme ceux que le formulaire envoie.
    config: {
      widthMm: 200,
      heightMm: 80,
      seamMm: 5,
      dpi: 300,
      orientation: "ladder",
      theme: "honey",
      brand: "MARQUE DE TEST",
      nameFr: "Miel",
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
  },
};

test("pages, santé, version et espace privé sans connexion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const { app, call } = await start(join(dir, "a.db"));
  try {
    const home = await call("/");
    assert.equal(home.status, 200);
    assert.match(await home.text(), /SC4NNER/);
    assert.equal((await call("/app.js")).status, 200);
    const health = await call("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, database: "ready" });
    assert.deepEqual(await (await call("/api/release")).json(), {
      name: "SC4NNER",
      commit: null,
      account: "configured",
    });
    assert.equal((await call("/api/labels")).status, 401);
    // L'en-tête d'identité de l'ancien hébergement ne donne aucun accès ici.
    assert.equal(
      (
        await call("/api/labels", {
          headers: { "oai-authenticated-user-id": "intrus" },
        })
      ).status,
      401,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("connexion, sauvegarde, puis les étiquettes survivent à un redémarrage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const dbPath = join(dir, "b.db");
  let run = await start(dbPath);
  try {
    assert.equal(
      (
        await run.call("/api/login", {
          body: { username: "essai", password: "Mot-De-Passe-De-Test" },
          headers: { Origin: "https://ailleurs.test" },
        })
      ).status,
      403,
    );
    const login = await run.call("/api/login", {
      body: { username: "essai", password: "Mot-De-Passe-De-Test" },
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);
    const cookie = setCookie.split(";")[0];

    const saved = await run.call("/api/labels", { body: label, cookie });
    assert.equal(saved.status, 200);
    const { id, version } = await saved.json();
    assert.equal(version, 1);
    // Modifier sans numéro de version : refusé, rien n'est écrasé.
    assert.equal(
      (await run.call("/api/labels", { body: { ...label, id }, cookie }))
        .status,
      409,
    );

    await run.app.close();
    run = await start(dbPath);
    const list = await run.call("/api/labels", { cookie });
    assert.equal(list.status, 200);
    const { labels } = await list.json();
    assert.equal(labels.length, 1);
    assert.equal(labels[0].payload.product.sku, "TEST-250");
  } finally {
    await run.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mauvais mots de passe : la même adresse est bloquée avant l'espace entier", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const { app, call } = await start(join(dir, "c.db"));
  try {
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await call("/api/login", {
            body: { username: "essai", password: "faux" },
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await call("/api/login", {
          body: { username: "essai", password: "Mot-De-Passe-De-Test" },
        })
      ).status,
      429,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sans compte configuré : la connexion répond 503, la santé reste verte", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const { app, call } = await start(join(dir, "d.db"), {
    SC4NNER_USERNAME: "",
    SC4NNER_SALT: "",
    SC4NNER_PASSWORD_HASH: "",
  });
  try {
    assert.equal((await call("/api/health")).status, 200);
    assert.equal(
      (await (await call("/api/release")).json()).account,
      "not_configured",
    );
    assert.equal(
      (await call("/api/login", { body: { username: "a", password: "b" } }))
        .status,
      503,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
