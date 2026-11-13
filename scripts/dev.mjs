// Démarrage local : http://localhost:3000 avec un compte jetable, recréé à chaque lancement.
// Jamais en production : le mot de passe s'affiche dans ce terminal.
import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = randomBytes(12).toString("base64url");
const salt = randomBytes(16).toString("hex");
process.env.SC4NNER_USERNAME = "local";
process.env.SC4NNER_SALT = salt;
process.env.SC4NNER_PASSWORD_HASH = pbkdf2Sync(
  password,
  salt,
  100000,
  32,
  "sha256",
).toString("hex");
process.env.SC4NNER_DB_PATH ||= "./data/dev.db";
process.env.TRUSTED_PROXY_HOPS = "0";
delete process.env.APP_BASE_URL;
console.log(`[sc4nner dev] compte local jetable — utilisateur : local · mot de passe : ${password}`);
await import("../server.mjs");
