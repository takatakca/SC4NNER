import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";
import worker from "../dist/server/index.js";
export function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../drizzle/0000_labels.sql", import.meta.url),
      "utf8",
    ).replaceAll("--> statement-breakpoint", ""),
  );
  // La colonne du nom d'affichage V1, comme la migration 0001 en production.
  db.exec(
    readFileSync(
      new URL("../drizzle/0001_v1_display_name.sql", import.meta.url),
      "utf8",
    ),
  );
  // La table des réglages (code maître d'override haché), migration 0002.
  db.exec(
    readFileSync(
      new URL("../drizzle/0002_settings.sql", import.meta.url),
      "utf8",
    ),
  );
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...x) {
          args = x;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...args) || null;
        },
        async all() {
          return { results: db.prepare(sql).all(...args) };
        },
        async run() {
          const r = db.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
    batch(statements) {
      return Promise.all(statements.map((x) => x.run()));
    },
  };
  return {
    DB,
    DEMO_USERNAME: "test",
    DEMO_SALT: "test-salt-only",
    DEMO_PASSWORD_HASH: pbkdf2Sync(
      "Test-Only-Password",
      "test-salt-only",
      100000,
      32,
      "sha256",
    ).toString("hex"),
  };
}
test("protected login, cookie, CSRF, expiry, owner scoping and logout", async () => {
  const env = fixture();
  const req = (path, body, options = {}) =>
    worker.fetch(
      new Request("https://labels.test/api/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          "oai-authenticated-user-id": "owner-a",
          ...(body
            ? {
                Origin: "https://labels.test",
                "Content-Type": "application/json",
              }
            : {}),
          ...options,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  assert.equal((await req("labels")).status, 401);
  assert.equal(
    (await req("login", { username: "test", password: "wrong" })).status,
    401,
  );
  assert.equal(
    (
      await req(
        "login",
        { username: "test", password: "Test-Only-Password" },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  const login = await req("login", {
    username: "test",
    password: "Test-Only-Password",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  assert.match(
    login.headers.get("Set-Cookie"),
    /HttpOnly; Secure; SameSite=Strict/,
  );
  assert.equal(
    (await req("labels", undefined, { Cookie: cookie })).status,
    200,
  );
  assert.equal(
    (
      await req("labels", undefined, {
        Cookie: cookie,
        "oai-authenticated-user-id": "owner-b",
      })
    ).status,
    401,
  );
  assert.equal(
    (await req("session", undefined, { "oai-authenticated-user-id": "" }))
      .status,
    401,
  );
  assert.equal(
    (await req("labels", { title: "bad", payload: {} }, { Cookie: cookie }))
      .status,
    400,
  );
  await req("logout", {}, { Cookie: cookie });
  assert.equal(
    (await req("labels", undefined, { Cookie: cookie })).status,
    401,
  );
});

test("complete form flow: login, server save, reload, vector PDF and scanner", async () => {
  const { JSDOM } = await import("jsdom");
  const env = fixture();
  let cookie = "",
    download;
  const create = () => {
    const dom = new JSDOM(
      readFileSync(new URL("../index.html", import.meta.url), "utf8"),
      { url: "https://labels.test", runScripts: "outside-only" },
    );
    const w = dom.window;
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    w.Blob = Blob;
    w.URL.createObjectURL = (b) => {
      download = b;
      return "blob:qa";
    };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {};
    w.fetch = async (path, opts = {}) => {
      const res = await worker.fetch(
        new Request("https://labels.test" + path, {
          ...opts,
          headers: {
            ...opts.headers,
            Origin: "https://labels.test",
            "oai-authenticated-user-id": "qa-owner",
            Cookie: cookie,
          },
        }),
        env,
      );
      if (res.headers.has("Set-Cookie"))
        cookie = res.headers.get("Set-Cookie").split(";")[0];
      return res;
    };
    w.eval(readFileSync(new URL("../dist/client.js", import.meta.url), "utf8"));
    return dom;
  };
  const wait = async (fn) => {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("UI condition timed out");
  };
  let dom = create(),
    w = dom.window,
    d = w.document;
  d.querySelector("[name=username]").value = "test";
  d.querySelector("[name=password]").value = "Test-Only-Password";
  d.querySelector("#login-form").dispatchEvent(
    new w.Event("submit", { bubbles: true, cancelable: true }),
  );
  await wait(
    () => !d.querySelector("#app").hidden && d.querySelector("#preview svg"),
  );
  d.querySelector("#size").value = "250 g";
  d.querySelector("#size").dispatchEvent(
    new w.Event("input", { bubbles: true }),
  );
  d.querySelector("#save").click();
  await wait(() =>
    d.querySelector("#messages").textContent.includes("sauvegardée"),
  );
  assert.equal(d.querySelector("#saved").options.length, 2);
  d.querySelector("#pdf").click();
  await wait(() => !!download);
  assert.equal((await download.text()).slice(0, 4), "%PDF");
  d.querySelector("#scan").value = "AISSA";
  d.querySelector("#scan").dispatchEvent(new w.Event("input"));
  assert.match(d.querySelector("#scan-result").textContent, /correspondante/);
  dom.window.close();
  dom = create();
  w = dom.window;
  d = w.document;
  await wait(
    () =>
      !d.querySelector("#app").hidden &&
      d.querySelector("#saved").options.length === 2,
  );
  d.querySelector("#saved").selectedIndex = 1;
  d.querySelector("#saved").dispatchEvent(new w.Event("change"));
  await wait(() => d.querySelector("#size").value === "250 g");
  assert.equal(d.querySelector("#brand").value, "MIEL AISSA");
  const count = await env.DB.prepare(
    "SELECT count(*) AS total FROM labels",
  ).first();
  assert.equal(count.total, 1);
  d.querySelector("#logout").click();
  await wait(() => cookie === "__Host-label_session=");
  dom.window.close();
});

test("logo visible, preset miel et override du directeur consigné", async () => {
  const { JSDOM } = await import("jsdom");
  const env = fixture();
  let cookie = "";
  const create = () => {
    const dom = new JSDOM(
      readFileSync(new URL("../index.html", import.meta.url), "utf8"),
      { url: "https://labels.test", runScripts: "outside-only" },
    );
    const w = dom.window;
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    w.Blob = Blob;
    w.URL.createObjectURL = () => "blob:qa";
    w.URL.revokeObjectURL = () => {};
    w.fetch = async (path, opts = {}) => {
      const res = await worker.fetch(
        new Request("https://labels.test" + path, {
          ...opts,
          headers: {
            ...opts.headers,
            Origin: "https://labels.test",
            "oai-authenticated-user-id": "qa-owner",
            Cookie: cookie,
          },
        }),
        env,
      );
      if (res.headers.has("Set-Cookie"))
        cookie = res.headers.get("Set-Cookie").split(";")[0];
      return res;
    };
    w.eval(readFileSync(new URL("../dist/client.js", import.meta.url), "utf8"));
    return dom;
  };
  const wait = async (fn) => {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("UI condition timed out");
  };
  let dom = create(),
    w = dom.window,
    d = w.document;
  d.querySelector("[name=username]").value = "test";
  d.querySelector("[name=password]").value = "Test-Only-Password";
  d.querySelector("#login-form").dispatchEvent(
    new w.Event("submit", { bubbles: true, cancelable: true }),
  );
  await wait(
    () => !d.querySelector("#app").hidden && d.querySelector("#preview svg"),
  );
  // Le champ logo est là dès l'ouverture (section 1), outils masqués sans logo.
  assert.ok(d.querySelector("#logo-file"));
  assert.equal(d.querySelector("#logo-tools").hidden, true);
  // Le compte atelier est le directeur : ses réglages sont visibles.
  assert.equal(d.querySelector("#admin-settings").hidden, false);
  // Preset miel : on repart d'ingrédients libres, puis on coche le preset.
  const hp = d.querySelector("#honeyPreset");
  hp.checked = false;
  hp.dispatchEvent(new w.Event("change", { bubbles: true }));
  d.querySelector("#ingredientsFr").value = "Miel, eau";
  d.querySelector("#ingredientsFr").dispatchEvent(
    new w.Event("input", { bubbles: true }),
  );
  hp.checked = true;
  hp.dispatchEvent(new w.Event("change", { bubbles: true }));
  await wait(
    () => d.querySelector("#ingredientsFr").value === "Miel / Honey",
  );
  assert.equal(d.querySelector("#noBestBefore").checked, true);
  await wait(() => d.querySelector("#bestBefore").disabled === true);
  // Sauvegarde, puis override du directeur avec note écrite.
  d.querySelector("#size").value = "250 g";
  d.querySelector("#size").dispatchEvent(
    new w.Event("input", { bubbles: true }),
  );
  d.querySelector("#save").click();
  await wait(() =>
    d.querySelector("#messages").textContent.includes("sauvegardée"),
  );
  await wait(() => d.querySelector("#overrides [data-override]"));
  const row = d.querySelector("#overrides [data-row]");
  row.querySelector("[data-note]").value = "Note de test du directeur";
  row.querySelector("[data-override]").click();
  await wait(() =>
    d.querySelector("#overrides").textContent.includes("contournés"),
  );
  assert.match(
    d.querySelector("#overrides").textContent,
    /Note de test du directeur/,
  );
  assert.match(d.querySelector("#overrides").textContent, /directeur/);
  // Logo posé par l'API (le même payload que le formulaire enverrait) :
  // il doit survivre à la sauvegarde et apparaître dans l'aperçu.
  const { labels } = await (await w.fetch("/api/labels")).json();
  assert.equal(labels.length, 1);
  const savedLabel = labels[0];
  const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const upd = await w.fetch("/api/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: savedLabel.id,
      version: savedLabel.version,
      title: savedLabel.title,
      payload: {
        product: savedLabel.payload.product,
        config: {
          ...savedLabel.payload.config,
          logoImage: TINY_PNG,
          logoRatio: 1,
          logoWidthMm: 30,
          noBestBefore: true,
          bestBefore: "2027-06-30",
        },
      },
    }),
  });
  assert.equal(upd.status, 200);
  dom.window.close();
  dom = create();
  w = dom.window;
  d = w.document;
  await wait(
    () =>
      !d.querySelector("#app").hidden &&
      d.querySelector("#saved").options.length === 2,
  );
  d.querySelector("#saved").selectedIndex = 1;
  d.querySelector("#saved").dispatchEvent(new w.Event("change"));
  await wait(() => d.querySelector("#preview svg image"));
  assert.equal(d.querySelector("#logo-tools").hidden, false);
  assert.ok(
    d.querySelector("#logo-thumb").src.startsWith("data:image/png"),
  );
  // « Sans date d'expiration » : aucune date imprimée malgré le champ rempli.
  assert.ok(
    !d.querySelector("#preview svg").textContent.includes("Meilleur avant"),
  );
  dom.window.close();
});
