import html from "./index.html";
import client from "./dist/client.js";
import {
  labelConfigInput,
  labelReadiness,
} from "./src/label-config.ts";
import { normalizeGtin } from "./src/validation.ts";
const encoder = new TextEncoder();
const hex = (b) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join(
    "",
  );
const digest = async (v) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(v)));
// base64url sans Buffer : même code sous Node et sous Cloudflare Workers.
const b64url = (bytes) => {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
// PBKDF2 comme la vérification du mot de passe de l'atelier (100 000 tours).
const pbkdf2Hex = async (secret, salt) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
      key,
      256,
    ),
  );
};
// Comparaison sans fuite de temps, même forme que la vérification du mot de passe.
const safeEqualText = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};
// Une adresse TAKATAK V1 : https obligatoire, sauf localhost (essais en local).
const httpsUrl = (raw) => {
  try {
    const u = new URL(raw);
    if (u.username || u.password) return null;
    if (u.protocol === "https:") return u;
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    )
      return u;
  } catch {
    /* pas une adresse */
  }
  return null;
};
const STATE_COOKIE = "__Host-sc4nner_state";
const SESSION_COOKIE = "__Host-label_session";
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const IDENTITY_RE = /^[A-Za-z0-9-]{8,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEmail = (v) =>
  typeof v === "string" && v.trim().length <= 254 && EMAIL_RE.test(v.trim());
function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url),
      path = url.pathname;
    const security = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    };
    if (path === "/")
      return new Response(html, {
        headers: { ...security, "Content-Type": "text/html; charset=utf-8" },
      });
    if (path === "/app.js")
      return new Response(client, {
        headers: {
          ...security,
          "Content-Type": "text/javascript; charset=utf-8",
        },
      });
    if (path === "/robots.txt")
      return new Response("User-agent: *\nDisallow: /");
    if (!path.startsWith("/api/") && !path.startsWith("/auth/"))
      return response({ error: "Introuvable" }, 404);
    // Connexion TAKATAK V1 (même pont que BEH4VIOR) : l'inscription et
    // l'identité restent chez TAKATAK ; ici on ne garde que la session.
    const v1 = {
      launch: httpsUrl(env.TAKATAK_SC4NNER_LAUNCH_URL || ""),
      exchange: httpsUrl(env.TAKATAK_SC4NNER_EXCHANGE_URL || ""),
      token: String(env.TAKATAK_SC4NNER_SERVICE_TOKEN || "").trim(),
      product: String(env.SC4NNER_PRODUCT_CODE || "sc4nner").trim() || "sc4nner",
      entitlement:
        String(env.SC4NNER_ENTITLEMENT || "sc4nner_free").trim() ||
        "sc4nner_free",
    };
    // Lien inventaire TAKATAK : même pont, adresse déduite de l'échange
    // (.../sc4nner/exchange devient .../sc4nner/inventory), sauf adresse
    // explicite de l'hôte. Lecture seule : V1 sert le catalogue, aucune
    // donnée d'étiquette ne part vers V1.
    const inventoryOverride = httpsUrl(
      env.TAKATAK_SC4NNER_INVENTORY_URL || "",
    );
    let inventoryDerived = null;
    if (v1.exchange && /\/exchange\/?$/.test(v1.exchange.pathname)) {
      inventoryDerived = new URL(v1.exchange);
      inventoryDerived.pathname = v1.exchange.pathname.replace(
        /\/exchange\/?$/,
        "/inventory",
      );
      inventoryDerived.search = "";
      inventoryDerived.hash = "";
    }
    v1.inventory = inventoryOverride || inventoryDerived;
    const v1Ready = Boolean(v1.launch && v1.exchange && v1.token.length >= 20);
    const redirectTo = (to, cookies = []) => {
      const headers = new Headers({ Location: to, ...security });
      for (const cookie of cookies) headers.append("Set-Cookie", cookie);
      return new Response(null, { status: 303, headers });
    };
    const clearState = () =>
      `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
    if (path === "/api/health" && req.method === "GET") {
      try {
        await env.DB.prepare("SELECT id FROM labels LIMIT 1").first();
        await env.DB.prepare("SELECT token FROM sessions LIMIT 1").first();
        return response({ ok: true, database: "ready" });
      } catch {
        return response({ ok: false, database: "unavailable" }, 503);
      }
    }
    // Provisionnement d'un compte TAKATAK lié : TAKATAK V1 appelle cet
    // endpoint serveur à serveur (jeton de service) au moment où un compte
    // identifié autorise SC4NNER. On ne crée qu'un LIEN (identité maître +
    // courriel + nom d'affichage) : l'inscription et l'identité restent
    // chez TAKATAK V1, aucun annuaire d'utilisateurs ici. Idempotent : un
    // second appel met à jour le même lien et répond created:false.
    if (path === "/api/provision" && req.method === "POST") {
      if (!env.DB) return response({ error: "Sauvegarde indisponible." }, 503);
      if (v1.token.length < 20)
        return response({ error: "Provisionnement non configuré." }, 503);
      const auth = req.headers.get("Authorization") || "";
      if (
        !auth.startsWith("Bearer ") ||
        !safeEqualText(auth.slice(7).trim(), v1.token)
      )
        return response({ error: "Non autorisé." }, 401);
      let data = null;
      try {
        const raw = await req.text();
        if (raw.length > 4096)
          return response({ error: "Requête trop volumineuse." }, 413);
        data = JSON.parse(raw);
      } catch {
        return response({ error: "JSON invalide." }, 400);
      }
      const masterIdentityId =
        typeof data?.masterIdentityId === "string"
          ? data.masterIdentityId
          : "";
      const email = typeof data?.email === "string" ? data.email.trim() : "";
      const displayName =
        typeof data?.displayName === "string"
          ? data.displayName.slice(0, 80)
          : null;
      if (!IDENTITY_RE.test(masterIdentityId) || !validEmail(email))
        return response({ error: "Compte lié invalide." }, 400);
      if (data.productCode !== undefined && data.productCode !== v1.product)
        return response({ error: "Produit inattendu." }, 400);
      if (data.entitlement !== undefined && data.entitlement !== v1.entitlement)
        return response({ error: "Droit inattendu." }, 400);
      try {
        const existing = await env.DB.prepare(
          "SELECT master_identity_id FROM linked_accounts WHERE master_identity_id=?",
        )
          .bind(masterIdentityId)
          .first();
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO linked_accounts(master_identity_id,email,display_name,product_code,entitlement,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(master_identity_id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,product_code=excluded.product_code,entitlement=excluded.entitlement,updated_at=excluded.updated_at",
        )
          .bind(
            masterIdentityId,
            email,
            displayName,
            v1.product,
            v1.entitlement,
            now,
            now,
          )
          .run();
        return response({ ok: true, provisioned: true, created: !existing });
      } catch {
        return response({ error: "Sauvegarde indisponible." }, 503);
      }
    }
    // Coolify / Node : l'espace vient du serveur (WORKSPACE_ID, voir server/app.mjs).
    // Hébergement Sites : il vient de l'en-tête d'identité posé par la plateforme.
    const owner =
      env.WORKSPACE_ID || req.headers.get("oai-authenticated-user-id");
    if (!owner)
      return response({ error: "Connexion à cet espace privé requise." }, 401);
    if (!env.DB) return response({ error: "Sauvegarde indisponible." }, 503);
    if (
      req.method !== "GET" &&
      (req.headers.get("Origin") !== url.origin ||
        req.headers.get("Sec-Fetch-Site") === "cross-site")
    )
      return response({ error: "Origine refusée." }, 403);
    const cookie = (req.headers.get("Cookie") || "").match(
      /(?:^|;\s*)__Host-label_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const token = cookie ? await digest(cookie) : "";
    // Une session est forgée par le serveur seulement (connexion atelier ou
    // échange TAKATAK V1) : le propriétaire est l'atelier ou une identité V1.
    const sessionRow = token
      ? await env.DB.prepare(
          "SELECT owner, display_name FROM sessions WHERE token=? AND expires>?",
        )
          .bind(token, Date.now())
          .first()
      : null;
    const session =
      sessionRow &&
      (sessionRow.owner === owner || IDENTITY_RE.test(sessionRow.owner))
        ? sessionRow
        : null;
    // Les étiquettes appartiennent à la personne connectée, pas à l'espace.
    const sessionOwner = session ? session.owner : owner;
    try {
      if (path === "/api/session" && req.method === "GET") {
        // Le compte connecté affiche le courriel du compte TAKATAK lié :
        // pour une session TAKATAK V1, on lit le lien provisionné de
        // l'identité (jamais un libellé générique).
        let linkedEmail = null;
        if (session && session.owner !== owner) {
          try {
            const link = await env.DB.prepare(
              "SELECT email FROM linked_accounts WHERE master_identity_id=?",
            )
              .bind(session.owner)
              .first();
            linkedEmail = link?.email ?? null;
          } catch {
            linkedEmail = null;
          }
        }
        return response({
          signedIn: !!session,
          username: session
            ? session.display_name || env.DEMO_USERNAME
            : null,
          email: linkedEmail,
          via: session
            ? session.owner === owner
              ? "workshop"
              : "takatak-v1"
            : null,
          // Rôles du studio : le propriétaire du compte atelier est le
          // directeur (admin) ; une identité TAKATAK V1 est un employé.
          role: session
            ? session.owner === owner
              ? "admin"
              : "employee"
            : null,
        });
      }
      // Connexion TAKATAK V1 : /auth/start lance TAKATAK, /auth/callback
      // échange le code unique contre une session. L'inscription se fait
      // sur takatak.ca (mobile + code SMS) ; ici, on ne crée aucun compte.
      if (path === "/auth/start" && req.method === "GET") {
        if (!v1Ready)
          return response(
            { error: "Connexion TAKATAK non configurée." },
            503,
          );
        const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
        const to = new URL(v1.launch);
        to.searchParams.set("state", state);
        return redirectTo(to.toString(), [
          `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        ]);
      }
      if (path === "/auth/callback" && req.method === "GET") {
        if (!v1Ready) return redirectTo("/?auth=not_configured", [clearState()]);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const expected = (req.headers.get("Cookie") || "").match(
          new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([A-Za-z0-9_-]+)(?:;|$)`),
        )?.[1];
        if (
          !STATE_RE.test(code) ||
          !STATE_RE.test(state) ||
          !expected ||
          !safeEqualText(state, expected)
        )
          return redirectTo("/?auth=invalid", [clearState()]);
        let v1Session = null;
        try {
          const r = await fetch(v1.exchange, {
            method: "POST",
            signal: AbortSignal.timeout(8000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${v1.token}`,
            },
            body: JSON.stringify({ code }),
          });
          const j = r.ok ? await r.json() : null;
          if (j && j.ok === true) v1Session = j.session;
        } catch {
          v1Session = null;
        }
        const until = v1Session ? Date.parse(v1Session.expiresAt) : NaN;
        if (
          !v1Session ||
          v1Session.productCode !== v1.product ||
          !Array.isArray(v1Session.entitlements) ||
          !v1Session.entitlements.includes(v1.entitlement) ||
          typeof v1Session.masterIdentityId !== "string" ||
          !IDENTITY_RE.test(v1Session.masterIdentityId) ||
          !(until > Date.now())
        )
          return redirectTo("/?auth=refused", [clearState()]);
        const expires = Math.min(until, Date.now() + 12 * 60 * 60 * 1000);
        const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
        const name =
          typeof v1Session.displayName === "string"
            ? v1Session.displayName.slice(0, 80)
            : null;
        const statements = [
          env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(
            Date.now(),
          ),
          env.DB.prepare(
            "INSERT INTO sessions(token,owner,display_name,expires) VALUES(?,?,?,?)",
          ).bind(
            await digest(secret),
            v1Session.masterIdentityId,
            name,
            expires,
          ),
        ];
        // Le compte lié est alimenté par la session échangée : si V1 a
        // renvoyé le courriel de l'identité, le lien local le reflète
        // (même upsert que /api/provision, idempotent).
        if (validEmail(v1Session.email)) {
          const now = new Date().toISOString();
          statements.push(
            env.DB.prepare(
              "INSERT INTO linked_accounts(master_identity_id,email,display_name,product_code,entitlement,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(master_identity_id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,product_code=excluded.product_code,entitlement=excluded.entitlement,updated_at=excluded.updated_at",
            ).bind(
              v1Session.masterIdentityId,
              v1Session.email.trim(),
              name,
              v1.product,
              v1.entitlement,
              now,
              now,
            ),
          );
        }
        await env.DB.batch(statements);
        const maxAge = Math.max(1, Math.floor((expires - Date.now()) / 1000));
        return redirectTo("/", [
          clearState(),
          `${SESSION_COOKIE}=${secret}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
        ]);
      }
      let body = null;
      if (req.method === "POST") {
        if (!req.headers.get("Content-Type")?.startsWith("application/json"))
          return response({ error: "JSON requis." }, 415);
        if (Number(req.headers.get("Content-Length") || 0) > 650000)
          return response({ error: "Fichier trop volumineux." }, 413);
        const raw = await req.text();
        if (raw.length > 650000)
          return response({ error: "Fichier trop volumineux." }, 413);
        body = JSON.parse(raw);
      }
      if (path === "/api/login" && req.method === "POST") {
        if (!env.DEMO_PASSWORD_HASH || !env.DEMO_SALT)
          return response({ error: "Compte non configuré." }, 503);
        const limit = await env.DB.prepare(
          "SELECT count,until_at FROM login_limits WHERE owner=?",
        )
          .bind(owner)
          .first();
        if (limit && limit.until_at > Date.now() && limit.count >= 8)
          return response(
            { error: "Trop de tentatives. Réessayez dans 15 minutes." },
            429,
          );
        if (
          typeof body.password !== "string" ||
          body.password.length > 200 ||
          typeof body.username !== "string"
        )
          return response({ error: "Identifiants invalides." }, 400);
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(body.password),
          "PBKDF2",
          false,
          ["deriveBits"],
        );
        const hash = hex(
          await crypto.subtle.deriveBits(
            {
              name: "PBKDF2",
              salt: encoder.encode(env.DEMO_SALT),
              iterations: 100000,
              hash: "SHA-256",
            },
            key,
            256,
          ),
        );
        let diff = hash.length ^ env.DEMO_PASSWORD_HASH.length;
        for (let i = 0; i < hash.length; i++)
          diff |=
            hash.charCodeAt(i) ^ (env.DEMO_PASSWORD_HASH.charCodeAt(i) || 0);
        if (diff || body.username !== env.DEMO_USERNAME) {
          await env.DB.prepare(
            "INSERT INTO login_limits(owner,count,until_at) VALUES(?,1,?) ON CONFLICT(owner) DO UPDATE SET count=CASE WHEN until_at<? THEN 1 ELSE count+1 END,until_at=CASE WHEN until_at<? THEN excluded.until_at ELSE until_at END",
          )
            .bind(owner, Date.now() + 900000, Date.now(), Date.now())
            .run();
          return response(
            { error: "Utilisateur ou mot de passe incorrect." },
            401,
          );
        }
        const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
        await env.DB.batch([
          env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(
            Date.now(),
          ),
          env.DB.prepare("DELETE FROM login_limits WHERE owner=?").bind(owner),
          env.DB.prepare(
            "INSERT INTO sessions(token,owner,expires) VALUES(?,?,?)",
          ).bind(await digest(secret), owner, Date.now() + 28800000),
        ]);
        return response({ ok: true }, 200, {
          "Set-Cookie": `__Host-label_session=${secret}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
        });
      }
      if (!session)
        return response(
          { error: "Connectez-vous pour accéder à vos étiquettes." },
          401,
        );
      if (path === "/api/logout" && req.method === "POST") {
        await env.DB.prepare("DELETE FROM sessions WHERE token=? AND owner=?")
          .bind(token, session.owner)
          .run();
        return response({ ok: true }, 200, {
          "Set-Cookie":
            "__Host-label_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
        });
      }
      if (path === "/api/labels" && req.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id,title,payload,version,updated_at FROM labels WHERE owner=? ORDER BY updated_at DESC LIMIT 200",
        )
          .bind(sessionOwner)
          .all();
        return response({
          labels: results.map((x) => ({
            ...x,
            payload: JSON.parse(x.payload),
          })),
        });
      }
      if (path === "/api/labels" && req.method === "POST") {
        if (
          typeof body.title !== "string" ||
          !body.title.trim() ||
          body.title.length > 160 ||
          !body.payload ||
          typeof body.payload !== "object"
        )
          return response({ error: "Étiquette invalide." }, 400);
        try {
          body.payload.config = labelConfigInput(body.payload.config);
          const p = body.payload.product;
          if (
            !p ||
            typeof p.name !== "string" ||
            !p.name.trim() ||
            p.name.length > 160 ||
            typeof p.sku !== "string" ||
            !p.sku.trim() ||
            p.sku.length > 40 ||
            typeof p.size !== "string" ||
            p.size.length > 80
          )
            return response({ error: "Produit invalide." }, 400);
          if (p.gtin) p.gtin = normalizeGtin(p.gtin);
        } catch {
          return response({ error: "Configuration invalide." }, 400);
        }
        // Les contournements consignés ne changent que par l'endpoint dédié
        // (/api/labels/override) : une sauvegarde ordinaire conserve ceux de
        // la version stockée et ne peut ni en forger ni en effacer.
        if (body.id) {
          const existing = await env.DB.prepare(
            "SELECT payload FROM labels WHERE id=? AND owner=?",
          )
            .bind(body.id, sessionOwner)
            .first();
          let kept = [];
          if (existing) {
            try {
              kept = labelConfigInput(
                JSON.parse(existing.payload).config,
              ).overrides;
            } catch {
              kept = [];
            }
          }
          body.payload.config.overrides = kept;
        } else {
          body.payload.config.overrides = [];
        }
        const id = body.id || crypto.randomUUID();
        if (!/^[a-f0-9-]{36}$/.test(id))
          return response({ error: "Identifiant invalide." }, 400);
        const value = JSON.stringify(body.payload);
        if (value.length > 600000)
          return response({ error: "Étiquette trop volumineuse." }, 413);
        const now = new Date().toISOString();
        if (body.id) {
          const result = await env.DB.prepare(
            "UPDATE labels SET title=?,payload=?,version=version+1,updated_at=? WHERE id=? AND owner=? AND version=?",
          )
            .bind(body.title.trim(), value, now, id, sessionOwner, body.version)
            .run();
          if (!result.meta.changes)
            return response(
              {
                error:
                  "Cette étiquette a changé. Rechargez-la avant de sauvegarder.",
              },
              409,
            );
        } else {
          const n = await env.DB.prepare(
            "SELECT count(*) AS total FROM labels WHERE owner=?",
          )
            .bind(sessionOwner)
            .first();
          if (n.total >= 200)
            return response({ error: "Limite de 200 modèles atteinte." }, 409);
          await env.DB.prepare(
            "INSERT INTO labels(id,owner,title,payload,updated_at) VALUES(?,?,?,?,?)",
          )
            .bind(id, sessionOwner, body.title.trim(), value, now)
            .run();
        }
        const saved = await env.DB.prepare(
          "SELECT id,version,updated_at FROM labels WHERE id=? AND owner=?",
        )
          .bind(id, sessionOwner)
          .first();
        return response({ ok: true, ...saved });
      }
      // Catalogue de l'inventaire TAKATAK de la personne connectée : le
      // studio peut partir d'un produit réel, pour que le code imprimé soit
      // celui de l'inventaire. Le compte atelier n'a pas d'inventaire V1.
      if (path === "/api/inventory/products" && req.method === "GET") {
        if (session.owner === owner)
          return response({
            ok: true,
            linked: false,
            reason: "workshop",
            workspaces: [],
          });
        if (!v1Ready || !v1.inventory)
          return response({
            ok: true,
            linked: false,
            reason: "not_configured",
            workspaces: [],
          });
        let upstream = null;
        try {
          const r = await fetch(v1.inventory, {
            method: "POST",
            signal: AbortSignal.timeout(8000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${v1.token}`,
            },
            body: JSON.stringify({ masterIdentityId: session.owner }),
          });
          if (r.ok) upstream = await r.json();
        } catch {
          upstream = null;
        }
        if (
          !upstream ||
          upstream.ok !== true ||
          !Array.isArray(upstream.workspaces)
        )
          return response(
            { error: "Inventaire TAKATAK injoignable. Réessayez." },
            502,
          );
        return response({
          ok: true,
          linked: upstream.linked === true,
          ...(typeof upstream.reason === "string"
            ? { reason: upstream.reason }
            : {}),
          workspaces: upstream.workspaces,
        });
      }
      // Code maître d'override : seul le directeur (compte atelier) le crée
      // ou le change. Il est conservé haché (PBKDF2 + sel), jamais en clair,
      // et n'est jamais renvoyé par l'API.
      if (path === "/api/override-code" && req.method === "POST") {
        if (session.owner !== owner)
          return response(
            { error: "Réservé au directeur (compte atelier)." },
            403,
          );
        const code = typeof body.code === "string" ? body.code : "";
        if (!/^\d{4}$/.test(code))
          return response(
            { error: "Le code maître doit compter exactement 4 chiffres." },
            400,
          );
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await pbkdf2Hex(code, salt);
        await env.DB.prepare(
          "INSERT INTO settings(key,value) VALUES('override_code',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
          .bind(JSON.stringify({ salt, hash }))
          .run();
        return response({ ok: true });
      }
      // Contournement autorisé d'un prérequis bloquant, consigné avec
      // l'étiquette : directeur = note écrite obligatoire ; employé = code
      // maître vérifié ici, côté serveur. Le prérequis n'est pas effacé : il
      // est marqué « contourné avec autorisation » dans le modèle.
      if (path === "/api/labels/override" && req.method === "POST") {
        const id = typeof body.id === "string" ? body.id : "";
        const issue =
          typeof body.issue === "string" ? body.issue.trim() : "";
        if (!/^[a-f0-9-]{36}$/.test(id) || !issue || issue.length > 300)
          return response({ error: "Contournement invalide." }, 400);
        const row = await env.DB.prepare(
          "SELECT payload,version FROM labels WHERE id=? AND owner=?",
        )
          .bind(id, sessionOwner)
          .first();
        if (!row) return response({ error: "Étiquette introuvable." }, 404);
        let payload;
        try {
          payload = JSON.parse(row.payload);
          payload.config = labelConfigInput(payload.config);
        } catch {
          return response({ error: "Configuration invalide." }, 400);
        }
        const config = payload.config;
        if (!labelReadiness(payload.product, config).includes(issue))
          return response(
            { error: "Ce prérequis ne bloque pas cette étiquette." },
            400,
          );
        if (config.overrides.some((o) => o.issue === issue))
          return response(
            { error: "Prérequis déjà contourné avec autorisation." },
            409,
          );
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (note.length > 600)
          return response({ error: "Note trop longue." }, 400);
        const username = session.display_name || env.DEMO_USERNAME || "";
        const role = session.owner === owner ? "admin" : "employee";
        let entry;
        if (role === "admin") {
          if (!note)
            return response(
              {
                error:
                  "Le directeur doit écrire une note qui justifie le contournement.",
              },
              400,
            );
          entry = {
            issue,
            by: username,
            role,
            method: "note",
            note,
            at: new Date().toISOString(),
          };
        } else {
          const code = typeof body.code === "string" ? body.code : "";
          if (!/^\d{4}$/.test(code))
            return response(
              { error: "Code maître à 4 chiffres requis." },
              400,
            );
          let stored = null;
          try {
            stored = await env.DB.prepare(
              "SELECT value FROM settings WHERE key='override_code'",
            ).first();
          } catch {
            stored = null;
          }
          if (!stored)
            return response(
              {
                error:
                  "Aucun code maître n'a été créé. Le directeur doit d'abord le définir dans les réglages du studio.",
              },
              403,
            );
          let parsed = null;
          try {
            parsed = JSON.parse(stored.value);
          } catch {
            parsed = null;
          }
          const hash = parsed ? await pbkdf2Hex(code, parsed.salt) : "";
          if (!parsed || !safeEqualText(hash, String(parsed.hash || "")))
            return response({ error: "Code maître incorrect." }, 403);
          entry = {
            issue,
            by: username,
            role,
            method: "code",
            note,
            at: new Date().toISOString(),
          };
        }
        config.overrides = [...config.overrides, entry];
        const value = JSON.stringify(payload);
        if (value.length > 600000)
          return response({ error: "Étiquette trop volumineuse." }, 413);
        const result = await env.DB.prepare(
          "UPDATE labels SET payload=?,version=version+1,updated_at=? WHERE id=? AND owner=? AND version=?",
        )
          .bind(value, new Date().toISOString(), id, sessionOwner, row.version)
          .run();
        if (!result.meta.changes)
          return response(
            {
              error:
                "Cette étiquette a changé. Rechargez-la avant de sauvegarder.",
            },
            409,
          );
        return response({
          ok: true,
          version: row.version + 1,
          overrides: config.overrides,
        });
      }
      return response({ error: "Introuvable" }, 404);
    } catch (error) {
      console.error("labels request failed", error?.name);
      return response({ error: "Action impossible. Réessayez." }, 500);
    }
  },
};
