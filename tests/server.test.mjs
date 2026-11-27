// Le serveur Node (Coolify) : vraie écoute HTTP, vraie base SQLite sur disque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import worker from "../dist/server/index.js";
import { createApp } from "../server/app.mjs";

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

// Session forgée directement en base (la connexion locale n'existe
// plus) : le cookie vaut le secret, la base garde son empreinte SHA-256,
// comme après un échange TAKATAK V1.
function mintSession(
  dbPath,
  { owner = "sc4nner", displayName = "essai" } = {},
) {
  const secret = "a1".repeat(32);
  const token = createHash("sha256").update(secret).digest("hex");
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "INSERT OR REPLACE INTO sessions(token,owner,display_name,expires) VALUES(?,?,?,?)",
  ).run(token, owner, displayName, Date.now() + 28800000);
  db.close();
  return `__Host-label_session=${secret}`;
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
      account: "not_configured",
      linkedAccounts: 0,
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

test("session forgée, sauvegarde, puis les étiquettes survivent à un redémarrage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const dbPath = join(dir, "b.db");
  let run = await start(dbPath);
  try {
    const cookie = mintSession(dbPath);
    // Une écriture d'une autre origine est refusée, session ou non.
    assert.equal(
      (
        await run.call("/api/labels", {
          body: label,
          cookie,
          headers: { Origin: "https://ailleurs.test" },
        })
      ).status,
      403,
    );

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

test("sans compte lié : /api/release le dit, la santé reste verte, /api/login n'existe plus", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const { app, call } = await start(join(dir, "d.db"));
  try {
    assert.equal((await call("/api/health")).status, 200);
    assert.equal(
      (await (await call("/api/release")).json()).account,
      "not_configured",
    );
    // La route de l'ancien compte local a disparu : elle tombe sur la
    // garde de session, comme toute route /api sans session.
    assert.equal(
      (await call("/api/login", { body: { username: "a", password: "b" } }))
        .status,
      401,
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
      email: null,
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
    // Sans session, rien de A n'est visible non plus.
    assert.equal((await call("/api/labels")).status, 401);
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

test("vérifications facultatives : sauvegarde jamais bloquée, contournement disparu, studio visuel conservé", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sc4nner-"));
  const dbPath = join(dir, "h.db");
  const { app, call } = await start(dbPath);
  const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  try {
    const admin = mintSession(dbPath, { displayName: "essai" });
    // Rien n'est confirmé (pas de GTIN, aucun dossier) : la sauvegarde
    // passe quand même. Les vérifications sont des points facultatifs,
    // elles ne bloquent plus rien (ordre du propriétaire, 2026-11-27).
    const saved = await (
      await call("/api/labels", { body: label, cookie: admin })
    ).json();
    assert.ok(saved.id);
    // Les anciens endpoints de contournement n'existent plus.
    assert.equal(
      (
        await call("/api/labels/override", {
          body: { id: saved.id, issue: "x", note: "y" },
          cookie: admin,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("/api/override-code", {
          body: { code: "2468" },
          cookie: admin,
        })
      ).status,
      404,
    );
    // Aucun code maître n'est créé ni stocké.
    const db = new DatabaseSync(dbPath);
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE key='override_code'").get(),
      undefined,
    );
    db.close();
    // Studio visuel : éléments posés, fond personnalisé et code-barres en
    // image sont conservés tels quels par la sauvegarde.
    const free = structuredClone(label);
    free.payload.config.background = "#102030";
    free.payload.config.elements = [
      {
        id: "el-1",
        kind: "text",
        x: 12,
        y: 9,
        widthMm: 60,
        rotation: 0,
        text: "Miel crémeux",
        fontSizeMm: 5,
        bold: true,
        colour: "#95661B",
        align: "center",
      },
      {
        id: "el-2",
        kind: "barcodeImage",
        x: 100,
        y: 10,
        widthMm: 37,
        rotation: 90,
        image: TINY_PNG,
        imageRatio: 1.4,
      },
    ];
    const freeSaved = await (
      await call("/api/labels", { body: free, cookie: admin })
    ).json();
    assert.ok(freeSaved.id);
    const list = await (await call("/api/labels", { cookie: admin })).json();
    const found = list.labels.find((x) => x.id === freeSaved.id);
    assert.equal(found.payload.config.background, "#102030");
    assert.equal(found.payload.config.elements.length, 2);
    assert.equal(found.payload.config.elements[0].x, 12);
    assert.equal(found.payload.config.elements[1].rotation, 90);
    assert.ok(
      found.payload.config.elements[1].image.startsWith("data:image/png"),
    );
    // Logo : une image GIF est refusée, un PNG est conservé tel quel.
    const gif = structuredClone(label);
    gif.payload.config.logoImage =
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    assert.equal(
      (await call("/api/labels", { body: gif, cookie: admin })).status,
      400,
    );
    const png = structuredClone(label);
    png.payload.config.logoImage = TINY_PNG;
    png.payload.config.honeyPreset = true;
    png.payload.config.noBestBefore = true;
    assert.equal(
      (await call("/api/labels", { body: png, cookie: admin })).status,
      200,
    );
    const pngList = await (await call("/api/labels", { cookie: admin })).json();
    const withLogo = pngList.labels.find((x) => x.payload.config.logoImage);
    assert.ok(withLogo.payload.config.logoImage.startsWith("data:image/png"));
    assert.equal(withLogo.payload.config.honeyPreset, true);
  } finally {
    await app.close();
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
