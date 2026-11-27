// Démarrage local : http://localhost:3000. La connexion se fait par
// TAKATAK seulement (aucun compte local) ; pour travailler dans le studio
// en local, ce script forge une session d'espace dans la base de dev et
// affiche le cookie à poser dans le navigateur. Jamais en production.
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

process.env.SC4NNER_DB_PATH ||= "./data/dev.db";
process.env.TRUSTED_PROXY_HOPS = "0";
delete process.env.APP_BASE_URL;
await import("../server.mjs");

// La base existe (migrations appliquées au démarrage) : on y pose une
// session du propriétaire de l'espace, comme l'échange TAKATAK V1 le
// ferait pour une identité.
const secret = randomBytes(32).toString("hex");
const token = createHash("sha256").update(secret).digest("hex");
const db = new DatabaseSync(process.env.SC4NNER_DB_PATH);
db.prepare(
  "INSERT INTO sessions(token,owner,display_name,expires) VALUES(?,?,?,?)",
).run(
  token,
  process.env.SC4NNER_WORKSPACE_ID || "sc4nner",
  "Dev local",
  Date.now() + 28800000,
);
db.close();
console.log(
  `[sc4nner dev] session locale — cookie à poser dans le navigateur : __Host-label_session=${secret}`,
);
