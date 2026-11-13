// Point d'entrée Coolify / Docker : `node server.mjs` après `npm run build`.
import worker from "./dist/server/index.js";
import { createApp } from "./server/app.mjs";

const port = Number(process.env.PORT || 3000);
const host = process.env.SC4NNER_HOST || "0.0.0.0";
const app = createApp({
  dbPath: process.env.SC4NNER_DB_PATH || "./data/sc4nner.db",
  worker,
});

app.server.listen(port, host, () => {
  console.log(`[sc4nner] en écoute sur ${host}:${port}`);
  if (!app.accountConfigured)
    console.warn(
      "[sc4nner] compte non configuré : définir SC4NNER_USERNAME, SC4NNER_SALT et SC4NNER_PASSWORD_HASH (voir DEPLOY.md). La connexion répond 503 d'ici là.",
    );
});

for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => app.close().then(() => process.exit(0)));
