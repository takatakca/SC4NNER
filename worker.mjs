import html from "./index.html";
import client from "./dist/client.js";
import { labelConfigInput } from "./src/label-config.ts";
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
      if (path === "/api/session" && req.method === "GET")
        return response({
          signedIn: !!session,
          username: session
            ? session.display_name || env.DEMO_USERNAME
            : null,
          via: session
            ? session.owner === owner
              ? "workshop"
              : "takatak-v1"
            : null,
        });
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
        await env.DB.batch([
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
        ]);
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
      return response({ error: "Introuvable" }, 404);
    } catch (error) {
      console.error("labels request failed", error?.name);
      return response({ error: "Action impossible. Réessayez." }, 500);
    }
  },
};
