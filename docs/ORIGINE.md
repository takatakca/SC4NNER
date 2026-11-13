# Origine du code

Source : `takatakca/takatak-v1`, PR #218 « feat(inventory): add owned product, barcode and wraparound label workflow », fusionnée dans `main` le 2026-11-13 à 02:16 UTC, commit `ecc7d481f4a0ad571e97fcb475256458a522f652` (tête de branche `e844321a04fb8ab7830f2f421ea2488ab73a077e`).

## Fichiers repris

| Ici | Dans takatak-v1 | Changement |
|---|---|---|
| `index.html` | `tools/etiquettes-web/index.html` | Titre et bandeau : « SC4NNER par TAKATAK » |
| `client.ts` | `tools/etiquettes-web/client.ts` | Aucun |
| `worker.mjs` | `tools/etiquettes-web/worker.mjs` | L'espace vient du serveur (`WORKSPACE_ID`) quand il est défini, sinon de l'en-tête de l'ancien hébergement |
| `build.mjs` | `tools/etiquettes-web/build.mjs` | Manifeste de l'ancien hébergement retiré ; construction possible sous Windows |
| `src/*.ts` | `tools/etiquettes-web/src/*.ts` | Aucun. Même code que `src/lib/inventory/*.ts` de V1, aux chemins d'import près |
| `drizzle/` | `tools/etiquettes-web/drizzle/` | Aucun |
| `tests/studio.test.mjs` | `tools/etiquettes-web/tests.mjs` | Chemins seulement |
| `docs/MIEL_AISSA_*.md`, `docs/TAKATAK_INVENTORY*.md` | `docs/` | Aucun |
| `docs/registres-quebec/` | `docs/inventory-quebec-templates/` | Aucun |
| `docs/dossier-quebec/` | `public/inventory/` | Aucun |
| `docs/PUBLICATION_SITES_2026-10-20.md` | `tools/etiquettes-web/DEPLOYMENT.md` | Aucun |
| `BRAND.md` | `takatakca/C4ISSE` → `BRAND.md` | Aucun |

## Nouveau dans ce dépôt

`server.mjs`, `server/app.mjs` (serveur Node, base SQLite, `/api/release`, blocage par adresse), `tests/server.test.mjs`, `scripts/hash-password.mjs`, `scripts/dev.mjs`, `Dockerfile`, `tsconfig.json`, `.env.example`, `README.md`, `AGENTS.md`, `DEPLOY.md`, `WORKLOG.md`.

## Resté dans takatak-v1

Le module du tableau de bord n'est pas copié ici, parce qu'il dépend de la connexion, des espaces et de la base de V1 :

- Écrans : `src/app/dashboard/inventory/` (inventaire, `labels`, `labels/setup`, `quebec`).
- Composants : `src/components/inventory/` (`inventory-workspace.tsx`, `label-studio.tsx`, `label-preview.tsx`, `quebec-review.tsx`).
- API : `src/app/api/inventory/` (`products`, `stock`, `labels`).
- Base : `src/lib/db/inventory.ts`, migrations `20261020152736_takatak_inventory` et `20261020154310_inventory_label_layout`.
- Tests : `scripts/inventory-tests.ts`, `scripts/inventory-label-tests.ts`, `scripts/inventory-db-tests.ts`.

La PR #218 indique que ces deux migrations n'ont été appliquées que sur une base locale jetable. Leur application sur la base hébergée de V1 relève du coordinateur de publication de V1.
