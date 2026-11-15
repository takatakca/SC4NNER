// Le serveur Node (Coolify) : vraie écoute HTTP, vraie base SQLite sur disque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pbkdf2Sync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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

// Faux TAKATAK V1, pour les essais seulement : il répond à /exchange avec
// la session configurée et note la demande reçue (jeton, code).
function fakeV1(initial) {
  let current = initial;
  let last = null;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      last = { auth: req.headers.authorization, body: raw };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(current));
    });
  });
  return {
    server,
    last: () => last,
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

const v1Session = (masterIdentityId, displayName, overrides = {}) => ({
  ok: true,
  session: {
    masterIdentityId,
    displayName,
    productCode: "sc4nner",
    entitlements: ["sc4nner_free"],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
  },
});

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
      takatak: "not_configured",
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

test("connexion TAKATAK : lancement, échange, session et isolement par identité", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1(v1Session("identite-test-aaa", "Testeur A"));
  const base = await v1.url();
  const { app, call } = await start(join(dir, "e.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: "jeton-de-service-de-test-assez-long",
  });
  try {
    assert.equal((await (await call("/api/release")).json()).takatak, "ready");
    const startRes = await call("/auth/start", { redirect: "manual" });
    assert.equal(startRes.status, 303);
    const location = startRes.headers.get("location");
    assert.ok(location.startsWith(`${base}/launch?state=`));
    const state = new URL(location).searchParams.get("state");
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    const stateCookie = startRes.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-sc4nner_state="))
      .split(";")[0];
    // État qui ne correspond pas : refusé, sans toucher à V1.
    const bad = await call(
      `/auth/callback?code=${"c".repeat(43)}&state=${"x".repeat(43)}`,
      { cookie: stateCookie, redirect: "manual" },
    );
    assert.equal(bad.headers.get("location"), "/?auth=invalid");
    assert.equal(v1.last(), null);
    // Bon état : échange serveur à serveur, session, retour sur /.
    const cb = await call(`/auth/callback?code=${"c".repeat(43)}&state=${state}`, {
      cookie: stateCookie,
      redirect: "manual",
    });
    assert.equal(cb.status, 303);
    assert.equal(cb.headers.get("location"), "/");
    assert.equal(
      v1.last().auth,
      "Bearer jeton-de-service-de-test-assez-long",
    );
    assert.equal(JSON.parse(v1.last().body).code, "c".repeat(43));
    const cookie = cb.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-label_session="))
      .split(";")[0];
    assert.deepEqual(await (await call("/api/session", { cookie })).json(), {
      signedIn: true,
      username: "Testeur A",
      via: "takatak-v1",
      role: "employee",
    });
    // L'étiquette de A lui appartient.
    assert.equal((await call("/api/labels", { body: label, cookie })).status, 200);
    assert.equal(
      (await (await call("/api/labels", { cookie })).json()).labels.length,
      1,
    );
    // Deuxième identité : elle ne voit rien de A.
    v1.set(v1Session("identite-test-bbb", "Testeur B"));
    const startB = await call("/auth/start", { redirect: "manual" });
    const stateB = new URL(startB.headers.get("location")).searchParams.get(
      "state",
    );
    const stateCookieB = startB.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-sc4nner_state="))
      .split(";")[0];
    const cbB = await call(
      `/auth/callback?code=${"c".repeat(43)}&state=${stateB}`,
      { cookie: stateCookieB, redirect: "manual" },
    );
    const cookieB = cbB.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-label_session="))
      .split(";")[0];
    assert.equal(
      (await (await call("/api/labels", { cookie: cookieB })).json()).labels
        .length,
      0,
    );
    // Le compte atelier ne voit rien de A non plus.
    const login = await call("/api/login", {
      body: { username: "essai", password: "Mot-De-Passe-De-Test" },
    });
    const wcookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await (await call("/api/labels", { cookie: wcookie })).json()).labels
        .length,
      0,
    );
    assert.deepEqual(await (await call("/api/session", { cookie: wcookie })).json(), {
      signedIn: true,
      username: "essai",
      via: "workshop",
      role: "admin",
    });
  } finally {
    await app.close();
    await v1.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("connexion TAKATAK : produit, droit ou session expirée refusés", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const v1 = fakeV1(v1Session("identite-test-ccc", "Testeur C"));
  const base = await v1.url();
  const { app, call } = await start(join(dir, "f.db"), {
    TAKATAK_SC4NNER_LAUNCH_URL: `${base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: "jeton-de-service-de-test-assez-long",
  });
  try {
    const tryCallback = async () => {
      const startRes = await call("/auth/start", { redirect: "manual" });
      const state = new URL(startRes.headers.get("location")).searchParams.get(
        "state",
      );
      const stateCookie = startRes.headers
        .getSetCookie()
        .find((c) => c.startsWith("__Host-sc4nner_state="))
        .split(";")[0];
      return call(`/auth/callback?code=${"c".repeat(43)}&state=${state}`, {
        cookie: stateCookie,
        redirect: "manual",
      });
    };
    v1.set(v1Session("identite-test-ccc", "Testeur C", { productCode: "autre" }));
    assert.equal(
      (await tryCallback()).headers.get("location"),
      "/?auth=refused",
    );
    v1.set(
      v1Session("identite-test-ccc", "Testeur C", {
        entitlements: ["autre_droit"],
      }),
    );
    assert.equal(
      (await tryCallback()).headers.get("location"),
      "/?auth=refused",
    );
    v1.set(
      v1Session("identite-test-ccc", "Testeur C", {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    assert.equal(
      (await tryCallback()).headers.get("location"),
      "/?auth=refused",
    );
  } finally {
    await app.close();
    await v1.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("override : code maître haché, employé avec code, directeur avec note, aucune falsification", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const dbPath = join(dir, "h.db");
  const v1 = fakeV1(v1Session("identite-test-ddd", "Employe D"));
  const base = await v1.url();
  const { app, call } = await start(dbPath, {
    TAKATAK_SC4NNER_LAUNCH_URL: `${base}/launch`,
    TAKATAK_SC4NNER_EXCHANGE_URL: `${base}/exchange`,
    TAKATAK_SC4NNER_SERVICE_TOKEN: "jeton-de-service-de-test-assez-long",
  });
  const GS1_ISSUE =
    "Add the product’s assigned GS1 UPC/EAN for a retail barcode.";
  try {
    const login = await call("/api/login", {
      body: { username: "essai", password: "Mot-De-Passe-De-Test" },
    });
    const admin = login.headers.get("set-cookie").split(";")[0];
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
    const employee = cb.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-label_session="))
      .split(";")[0];

    const empSaved = await (
      await call("/api/labels", { body: label, cookie: employee })
    ).json();
    // Aucun code maître encore : l'employé est refusé même avec un code.
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: empSaved.id, issue: GS1_ISSUE, code: "2468" },
          cookie: employee,
        })
      ).status,
      403,
    );
    // L'employé ne peut pas créer le code maître.
    assert.equal(
      (
        await call("/api/override-code", {
          body: { code: "2468" },
          cookie: employee,
        })
      ).status,
      403,
    );
    // Le directeur refuse un code mal formé, puis crée le bon.
    assert.equal(
      (
        await call("/api/override-code", {
          body: { code: "123" },
          cookie: admin,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/api/override-code", {
          body: { code: "2468" },
          cookie: admin,
        })
      ).status,
      200,
    );
    // Employé : sans code → 400 ; mauvais code → 403 ; bon code → 200.
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: empSaved.id, issue: GS1_ISSUE },
          cookie: employee,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: empSaved.id, issue: GS1_ISSUE, code: "0000" },
          cookie: employee,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: empSaved.id, issue: GS1_ISSUE, code: "2468" },
          cookie: employee,
        })
      ).status,
      200,
    );
    // Doublon → 409 ; prérequis qui ne bloque pas → 400.
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: empSaved.id, issue: GS1_ISSUE, code: "2468" },
          cookie: employee,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: empSaved.id, issue: "Prérequis imaginaire", code: "2468" },
          cookie: employee,
        })
      ).status,
      400,
    );
    // Traçabilité : l'entrée est consignée au modèle de l'employé.
    const empList = await (await call("/api/labels", { cookie: employee })).json();
    const entries = empList.labels[0].payload.config.overrides;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].issue, GS1_ISSUE);
    assert.equal(entries[0].role, "employee");
    assert.equal(entries[0].method, "code");
    assert.equal(entries[0].by, "Employe D");
    assert.ok(entries[0].at);
    // Falsification : une sauvegarde ordinaire ne forge pas d'override.
    const forged = structuredClone(label);
    forged.id = empSaved.id;
    forged.version = empList.labels[0].version;
    forged.payload.config.overrides = [
      {
        issue: "faux",
        by: "faux",
        role: "admin",
        method: "note",
        note: "faux",
        at: "2026-01-01T00:00:00.000Z",
      },
    ];
    assert.equal(
      (await call("/api/labels", { body: forged, cookie: employee })).status,
      200,
    );
    const afterForge = await (
      await call("/api/labels", { cookie: employee })
    ).json();
    assert.equal(afterForge.labels[0].payload.config.overrides.length, 1);
    assert.equal(
      afterForge.labels[0].payload.config.overrides[0].method,
      "code",
    );
    // Logo : une image GIF est refusée, un PNG est conservé tel quel.
    const gif = structuredClone(label);
    gif.payload.config.logoImage =
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    assert.equal(
      (await call("/api/labels", { body: gif, cookie: employee })).status,
      400,
    );
    const png = structuredClone(label);
    png.payload.config.logoImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    png.payload.config.honeyPreset = true;
    png.payload.config.noBestBefore = true;
    assert.equal(
      (await call("/api/labels", { body: png, cookie: employee })).status,
      200,
    );
    const pngList = await (
      await call("/api/labels", { cookie: employee })
    ).json();
    const withLogo = pngList.labels.find((x) => x.payload.config.logoImage);
    assert.ok(withLogo.payload.config.logoImage.startsWith("data:image/png"));
    assert.equal(withLogo.payload.config.honeyPreset, true);
    // Directeur : note obligatoire, puis consignée avec son nom.
    const admSaved = await (
      await call("/api/labels", { body: label, cookie: admin })
    ).json();
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: admSaved.id, issue: GS1_ISSUE },
          cookie: admin,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/api/labels/override", {
          body: {
            id: admSaved.id,
            issue: GS1_ISSUE,
            note: "Vérifié avec le fournisseur, dossier 12.",
          },
          cookie: admin,
        })
      ).status,
      200,
    );
    const admList = await (await call("/api/labels", { cookie: admin })).json();
    const admEntry = admList.labels[0].payload.config.overrides[0];
    assert.equal(admEntry.method, "note");
    assert.equal(admEntry.role, "admin");
    assert.equal(admEntry.by, "essai");
    assert.match(admEntry.note, /fournisseur/);
    // Le code maître n'est jamais stocké en clair.
    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare("SELECT value FROM settings WHERE key='override_code'")
      .get();
    db.close();
    assert.ok(row);
    assert.ok(!row.value.includes("2468"));
    assert.match(row.value, /"hash":"[a-f0-9]{64}"/);
  } finally {
    await app.close();
    await v1.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sans pont TAKATAK : /auth/start répond 503 et /api/release le dit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const { app, call } = await start(join(dir, "g.db"));
  try {
    assert.equal(
      (await (await call("/api/release")).json()).takatak,
      "not_configured",
    );
    assert.equal((await call("/auth/start", { redirect: "manual" })).status, 503);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
