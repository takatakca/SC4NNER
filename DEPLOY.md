# SC4NNER — mise en ligne

Ce qui reste à faire pour que SC4NNER tourne sur notre serveur. Les agents n'ont aucun accès à Coolify : les étapes 1 à 4 sont faites par le propriétaire, ou avec lui.

**État au 2026-11-12 :** code poussé, rien en ligne sur Coolify. L'ancien studio reste en place sur `https://takatak-etiquettes.takatak-ca.chatgpt.site` (historique : `docs/PUBLICATION_SITES_2026-10-20.md`).

## 1. Créer l'application dans Coolify

Panneau : `https://coolify.takatak.ca`.

1. **New resource → Public repository** → `https://github.com/takatakca/SC4NNER` → branche `main`.
2. **Build pack : Dockerfile** (à la racine) → port **3000**.
3. **Persistent Storage** : ajouter un volume monté sur **`/app/data`**. Sans lui, les étiquettes sauvegardées disparaissent à chaque nouvelle version.
4. Le contrôle de santé est déjà dans le Dockerfile (`/api/health`). Ne pas en ajouter un deuxième.

L'image lance la vérification des types, la construction et les tests pendant sa construction. Si un test échoue, Coolify n'a pas d'image à démarrer.

## 2. Le compte de l'atelier

Sur votre ordinateur, dans le dossier du dépôt :

```bash
npm run hash-password -- VOTRE_NOM_UTILISATEUR
```

Le mot de passe est demandé au clavier et ne s'affiche pas. La commande donne trois lignes à coller dans Coolify. Le mot de passe lui-même ne va nulle part ailleurs : ni dans Git, ni dans Coolify.

## 3. Variables d'environnement (Runtime) — noms seulement ici

| Variable | Valeur |
|---|---|
| `APP_BASE_URL` | l'adresse publique exacte, en `https://`, sans barre finale |
| `SC4NNER_USERNAME` | ligne 1 de l'étape 2 |
| `SC4NNER_SALT` | ligne 2 de l'étape 2 |
| `SC4NNER_PASSWORD_HASH` | ligne 3 de l'étape 2 |
| `SC4NNER_WORKSPACE_ID` | facultatif (`sc4nner` par défaut). Ne plus le changer après la première sauvegarde |
| `TRUSTED_PROXY_HOPS` | `1` (le Traefik de Coolify) |

`PORT` et `SC4NNER_DB_PATH` sont déjà fixés dans l'image. `SOURCE_COMMIT` est fourni par Coolify.

## 4. Domaine et DNS — à faire ensemble

L'adresse n'est pas encore choisie. Deux faits à connaître avant de décider :

- `serveur.mielaissa.ca` a été réservé le 2026-10-20 pour l'ancien hébergement. Ses trois enregistrements (un CNAME et deux TXT) n'ont jamais été ajoutés chez MochaHost. Si cette adresse doit pointer vers Coolify, **ne pas** ajouter ces trois enregistrements : il faut un seul enregistrement vers le serveur Coolify.
- Les autres apps de la suite utilisent des sous-domaines de `on2go.ca`. Un sous-domaine de `takatak.ca` est aussi possible.

Avant de toucher au DNS, tester l'app sur le serveur lui-même, comme dans `takatak-v1/docs/COOLIFY_DIRECT_PRODUCTION.md` (étape 5) :

```bash
curl --resolve ADRESSE_CHOISIE:443:IP_DU_SERVEUR_COOLIFY https://ADRESSE_CHOISIE/api/health
```

Ne changer que l'enregistrement de cette adresse. Ne toucher ni aux MX, ni aux serveurs de noms, ni aux autres enregistrements.

## 5. Vérifier la mise en ligne

1. `https://ADRESSE/api/health` répond `{"ok":true,"database":"ready"}`.
2. `https://ADRESSE/api/release` montre le commit de `main` et `"account":"configured"`.
3. Se connecter, créer une étiquette, **Sauvegarder**.
4. Relancer un déploiement dans Coolify, se reconnecter : l'étiquette est encore là. C'est la preuve que le volume `/app/data` tient.

## 6. Essais d'impression (propriétaire)

À faire une fois l'app en ligne. Guide complet : `docs/MIEL_AISSA_START_HERE.md`.

1. Mesurer le vrai pot : périmètre, hauteur utile, largeur d'une face plate si le pot est hexagonal (`docs/MIEL_AISSA_HEX_JAR.md`).
2. Imprimer le PDF **à 100 %**, sans « ajuster à la page ». Mesurer l'étiquette à la règle.
3. Poser l'étiquette sur un pot, lire le code au scanner, puis taper ou scanner le résultat dans « Tester une lecture de scanner ».
4. Noter ici ce qui a été essayé : imprimante, papier, scanner, résultat.

Aucun de ces essais n'a encore été fait.

## 7. Sauvegarde

Toutes les données sont dans le volume `/app/data` (fichier `sc4nner.db` et ses deux fichiers compagnons `-wal` et `-shm`). Copier les trois ensemble, application arrêtée, ou sauvegarder le volume depuis Coolify.

## 8. Ce qui reste (code)

- Brancher la connexion sur TAKATAK V1 (un compte par personne, plusieurs espaces).
- Reprendre les modèles sauvegardés sur l'ancien hébergement, si on veut les garder.
- Le verrou de connexion protège par adresse puis par espace : plusieurs adresses qui se trompent en même temps peuvent bloquer la connexion 15 minutes.
