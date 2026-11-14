# SC4NNER — mise en ligne

Comment SC4NNER tourne sur notre serveur, et ce qui reste à faire. Les agents n'ont pas d'accès propre à Coolify : le propriétaire ouvre la session, ou fait l'étape lui-même.

## État au 2026-11-13 (dernier contrôle de l'extérieur)

**En ligne :** `https://sc4nner.takatak.ca` (adresse choisie par le propriétaire). L'adresse provisoire `https://wrvtkwi27yopptbhidsbm3jn.31.220.96.134.sslip.io` répond encore.

**Prochaine étape :** le compte de l'atelier (étape 2). Tant qu'il manque, la connexion répond 503.

| Élément | État | Preuve |
|---|---|---|
| Application Coolify | Faite : projet **GROUPE TAKATAK**, environnement **production**, serveur **vps1**, nom **sc4nner** | Créée dans la session Coolify du propriétaire |
| Source | `takatakca/SC4NNER`, branche `main`, par la GitHub App ; déploiement à chaque envoi sur `main` | Réglage Coolify « Deploy on push » |
| Stockage persistant | Fait : volume `sc4nner-data` monté sur `/app/data` | Page Persistent Storage |
| Premier déploiement | Réussi, 1 min 10 s, commit `e7af841` | Journal Coolify : contrôle de santé « healthy » |
| Santé, de l'extérieur | `/api/health` répond `{"ok":true,"database":"ready"}`, certificat valide | Lu le 2026-11-13 à 04:03 UTC |
| Adresse définitive et DNS | Faits par le propriétaire : `sc4nner.takatak.ca` pointe vers vps1, le domaine est dans Coolify, certificat valide, http redirige vers https | `/api/health` 200 et `/api/release` (commit `7b95ce5`) lus sur cette adresse le 2026-11-13 |
| Variables | `APP_BASE_URL=https://sc4nner.takatak.ca` et `TRUSTED_PROXY_HOPS=1`, puis redéploiement | Essai du 2026-11-13 : une écriture sur `sc4nner.takatak.ca` passe le contrôle d'origine (elle répond 503 « Compte non configuré », plus 403) ; une origine étrangère reste refusée (403) |
| **Compte de l'atelier** | **Pas fait** : `/api/release` dit `"account":"not_configured"`, la connexion répond 503 | Étape 2, propriétaire |
| **Connexion TAKATAK V1** | **Code prêt, pas en service** : `/auth/start` + `/auth/callback` branchés sur V1 comme BEH4VIOR (inscription + connexion, une session par personne) ; il manque l'expérience `sc4nner` dans takatak-v1, les 3 variables Coolify et un redéploiement | `docs/TAKATAK_V1_BRIDGE.md`, étape 9 |
| Preuve du volume par une vraie étiquette | Pas faite (il faut le compte d'abord) | Étape 5, points 3 et 4 |
| Essais d'impression | Pas faits | Étape 6 |

**À supprimer dans Coolify :** `sc4nner-ebauche-vps2-A-SUPPRIMER` (même projet). Ébauche créée par erreur sur vps2, jamais déployée, sans volume, passée en « Manual deployments only ». La suppression attend l'accord du propriétaire.

L'ancien studio reste en place sur `https://takatak-etiquettes.takatak-ca.chatgpt.site` (historique : `docs/PUBLICATION_SITES_2026-10-20.md`).

## 1. Créer l'application dans Coolify — fait le 2026-11-12

Pour mémoire, ou pour la refaire ailleurs. Panneau : `https://coolify.takatak.ca`. Les apps TAKATAK vont sur **vps1** ; vps2 porte les sites clients migrés de MochaHost.

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

L'adresse définitive est `https://sc4nner.takatak.ca`. Le DNS et le domaine Coolify sont faits. `APP_BASE_URL` vaut `https://sc4nner.takatak.ca` depuis le 2026-11-13. **Il reste, sans urgence :** retirer l'adresse provisoire de la page Domains de `sc4nner`. Elle répond encore en lecture, mais toute écriture y est refusée. Tant que `APP_BASE_URL` ne correspond pas à l'adresse utilisée, les sauvegardes sont refusées (« Origine refusée »).

Deux faits à connaître avant de décider :

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

- ~~Brancher la connexion sur TAKATAK V1 (un compte par personne, plusieurs espaces).~~ Fait dans le code (PR) : `/auth/start` + `/auth/callback`, sessions par identité, étiquettes isolées par personne. Reste à faire côté propriétaire : voir étape 9.
- Reprendre les modèles sauvegardés sur l'ancien hébergement, si on veut les garder.
- Le verrou de connexion protège par adresse puis par espace : plusieurs adresses qui se trompent en même temps peuvent bloquer la connexion 15 minutes.

## 9. Mettre la connexion TAKATAK en service (propriétaire)

Le code est en place ; il faut encore deux gestes côté propriétaire,
dans cet ordre :

1. **Dans takatak-v1 (Matthieu)** : créer l'expérience `sc4nner`, copie
   du pont BEH4VIOR (`docs/BEH4VIOR_BRIDGE.md` dans takatak-v1) :
   routes `/api/experiences/sc4nner/launch` et `/exchange`, entrée
   `/dashboard/sc4nner`, variables `TAKATAK_SC4NNER_URL`,
   `SC4NNER_EXPERIENCE_CALLBACK_URL` (= `https://sc4nner.takatak.ca/auth/callback`)
   et `TAKATAK_SC4NNER_SERVICE_TOKEN` (secret long, même valeur des
   deux côtés). Confirmer le code produit (`sc4nner`) et le droit
   (`sc4nner_free`) avant le premier essai.
2. **Dans Coolify (app `sc4nner`)** : ajouter les variables
   `TAKATAK_SC4NNER_LAUNCH_URL` (= `https://takatak.ca/api/experiences/sc4nner/launch`),
   `TAKATAK_SC4NNER_EXCHANGE_URL` (= `https://takatak.ca/api/experiences/sc4nner/exchange`)
   et `TAKATAK_SC4NNER_SERVICE_TOKEN` (même valeur que côté V1), puis
   **Redeploy**.
3. **Vérifier** : `https://sc4nner.takatak.ca/api/release` montre
   `"takatak":"ready"`. Se connecter avec un compte TAKATAK de test,
   créer une étiquette, **Sauvegarder**, se déconnecter, se reconnecter :
   l'étiquette est encore là, et un deuxième compte test ne la voit pas.

En attendant, le compte de l'atelier (étape 2) reste le repli : une
fois ses trois variables posées et l'app redéployée, la connexion par
nom d'utilisateur et mot de passe fonctionne pour ce compte unique.
