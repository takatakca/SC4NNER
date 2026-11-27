# SC4NNER par TAKATAK

**Le studio d'étiquettes de TAKATAK.** Un produit, son code-barres, son étiquette complète prête à imprimer, puis un essai de lecture au scanner. Premier client : MIEL AISSA.

**Dépôt :** takatakca/SC4NNER · **En ligne :** https://sc4nner.takatak.ca (Coolify, depuis le 2026-11-12)  ; compte de l'atelier, adresse définitive et essais d'impression à faire (voir `DEPLOY.md`).

## D'où vient ce code

Ordre du propriétaire, 2026-11-12 : le Label Studio devient son propre programme, SC4NNER.

Le studio a été bâti le 2026-10-20 dans `takatakca/takatak-v1` (PR #218, fusionnée le 2026-11-13 dans `main`, commit `ecc7d481f4a0ad571e97fcb475256458a522f652`), dossier `tools/etiquettes-web`. Ce dépôt reprend ce dossier au complet, ses guides, et ajoute ce qu'il faut pour tourner sur notre serveur Coolify. La correspondance fichier par fichier est dans `docs/ORIGINE.md`.

## Ce que fait l'app

1. **Votre produit** : marque, nom français, format, ingrédients, entreprise, origine, lot, date.
2. **Votre code-barres** : SKU interne en Code 39, ou UPC / EAN de détail — saisi avec ou sans le chiffre de contrôle, qui est calculé ou vérifié (GS1 mod-10). Orientation en échelle pour les pots, résolution 203, 300 ou 600 points par pouce. Le code-barres ou le code QR déjà créé par GS1 peut aussi être téléversé comme image.
3. **Format du pot** : pot rond ou hexagonal. En hexagonal, l'app vérifie que le code-barres tient sur une face plate mesurée et bloque le PDF sinon.
4. **Mentions alimentaires et dossier Québec** : catégorie, couleur, conservation, tableau de valeur nutritive (image approuvée ou exemption notée), rappels sourcés des exigences. Depuis l'ordre du propriétaire du 2026-11-27, ce sont des **points à vérifier facultatifs** : ils ne bloquent ni la sauvegarde, ni l'aperçu, ni le PDF — aucun contournement, aucun code maître.
5. **Studio libre** : chaque élément de l'étiquette — textes, logo, images téléversées, affiche nutritive, code-barres généré ou en image — se pose sur le canevas et se glisse au doigt ou à la souris, se redimensionne et se tourne ; fond de couleur ou image de fond au choix. Les positions sont sauvegardées avec le modèle et respectées dans l'aperçu et le PDF.
6. **Aperçu et impression** : PDF vectoriel à la taille exacte, sans bandeau « épreuve ».
7. **Sauvegarde** : jusqu'à 200 modèles par espace, gardés sur le serveur.
8. **Essai de lecture** : on scanne l'étiquette imprimée, l'app dit si le code lu est le bon.

## Ce qui est vérifié (2026-11-27, en local, Node 24)

- Studio libre, retrait des vérifications obligatoires et GS1 durci (branche `taktak/studio-visuel-canva`) : `npm run typecheck`, `npm run build`, `npm test` : 24 tests sur 24 — dont 5 tests unitaires du moteur (chiffre de contrôle GS1 sur des numéros connus, zones de silence, SVG, éléments posés, rotation), le flux studio complet dans un navigateur simulé (mode libre, fond personnalisé, sauvegarde des positions, relecture, PDF) et la disparition des endpoints de contournement côté serveur.
- Le glisser-déposer a aussi été exercé en navigateur simulé avec coordonnées : un code-barres glissé de (+10 mm, +5 mm) est sauvegardé à sa nouvelle position. Le geste au doigt sur un vrai téléphone reste à essayer par le propriétaire après déploiement.

## Ce qui est vérifié (2026-11-12, en local, Node 22)

- `npm run typecheck`, `npm run build`, `npm test` : 6 tests sur 6.
- Les 2 tests d'origine : connexion, témoin sécurisé, contrôle d'origine, séparation des espaces, déconnexion ; puis le formulaire complet dans un navigateur simulé (connexion, sauvegarde, rechargement, PDF, lecture du SKU).
- Dans un vrai navigateur, en local (`npm run dev`) : connexion, aperçu en mode épreuve, refus de sauvegarder sans poids net, sauvegarde, puis étiquette relue après rechargement de la page.
- Les 4 tests du serveur Node : pages et santé sur une vraie écoute HTTP, étiquettes relues après un redémarrage (base SQLite sur disque), blocage des mauvais mots de passe par adresse, connexion fermée (503) tant que le compte n'est pas configuré.

- Sur GitHub (CI, run 43352787633, commit `b0aa8d3`) : mêmes contrôles, puis l'image Docker est construite, démarrée, et `/api/health` répond dans le conteneur.

## Ce qui n'est pas vérifié

- **L'impression réelle et la lecture réelle** : aucune imprimante, aucun scanner, aucun pot fini n'ont été essayés. C'est la prochaine étape du propriétaire.
- **L'usage réel en ligne** : l'app répond et sa santé est verte, mais personne ne s'y est encore connecté. Le compte de l'atelier n'est pas configuré.
- **La conformité** : l'app rappelle des exigences et note des vérifications déclarées. Elle ne certifie rien. Recette, poids, origine, dimensions et mentions sont à confirmer avant de vendre.

## Limites connues

- **Un déploiement = un espace = un compte.** Le compte est propre à ce déploiement (nom et empreinte du mot de passe dans Coolify). TAKATAK V1 reste l'autorité d'identité ; le branchement à V1 n'est pas fait.
- **Inventaire et stock** : ils vivent dans TAKATAK Dash V1 (`/dashboard/inventory`), pas ici. Voir `docs/TAKATAK_INVENTORY.md`.
- **Modèles déjà sauvegardés sur l'ancien hébergement** (`takatak-etiquettes.takatak-ca.chatgpt.site`) : ils ne sont pas copiés ici.

## Structure

- `index.html`, `client.ts` : l'écran (français).
- `worker.mjs` : les règles du serveur (connexion, sessions de 8 heures, sauvegarde avec numéro de version).
- `server.mjs`, `server/app.mjs` : le serveur Node pour Coolify, base SQLite persistante, `/api/health`, `/api/release`.
- `src/` : le moteur d'étiquettes (codes-barres, mise en page, PDF, exigences du Québec). Même code que `takatak-v1/src/lib/inventory`.
- `drizzle/` : les tables. Appliquées seules au démarrage.
- `tests/` : les deux suites.
- `docs/` : guides MIEL AISSA, dossier Québec, registres vierges, historique. Index : `docs/README.md`.
- `DEPLOY.md` : la mise en ligne, étape par étape. `AGENTS.md` : règles pour les agents. `WORKLOG.md` : journal.

## Développer

```bash
npm ci
npm run build
npm test
npm run dev
```

`npm run dev` ouvre `http://localhost:3000` avec un compte jetable affiché dans le terminal. Avant chaque envoi : `npm run typecheck`, `npm run build`, `npm test`.
