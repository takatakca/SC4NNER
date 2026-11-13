# SC4NNER — mise en ligne

Comment SC4NNER tourne sur notre serveur, et ce qui reste à faire. Les agents n'ont pas d'accès propre à Coolify : le propriétaire ouvre la session, ou fait l'étape lui-même.

## État au 2026-11-12, 23:05 (heure de Montréal)

**En ligne, à une adresse provisoire :** `https://wrvtkwi27yopptbhidsbm3jn.31.220.96.134.sslip.io`

| Élément | État | Preuve |
|---|---|---|
| Application Coolify | Faite : projet **GROUPE TAKATAK**, environnement **production**, serveur **vps1**, nom **sc4nner** | Créée dans la session Coolify du propriétaire |
| Source | `takatakca/SC4NNER`, branche `main`, par la GitHub App ; déploiement à chaque envoi sur `main` | Réglage Coolify « Deploy on push » |
| Stockage persistant | Fait : volume `sc4nner-data` monté sur `/app/data` | Page Persistent Storage |
| Premier déploiement | Réussi, 1 min 10 s, commit `e7af841` | Journal Coolify : contrôle de santé « healthy » |
| Santé, de l'extérieur | `/api/health` répond `{"ok":true,"database":"ready"}`, certificat valide | Lu le 2026-11-13 à 04:03 UTC |
| Variables | `APP_BASE_URL` (l'adresse provisoire) et `TRUSTED_PROXY_HOPS=1` | Page Environment Variables |
| **Compte de l'atelier** | **Pas fait** : `/api/release` dit `"account":"not_configured"`, la connexion répond 503 | Étape 2, propriétaire |
| **Adresse définitive et DNS** | **Pas fait** | Étape 4, ensemble |
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

L'adresse définitive n'est pas encore choisie. Le jour du changement : ajouter le domaine dans Coolify (page Domains de `sc4nner`), mettre `APP_BASE_URL` à la nouvelle adresse, redéployer, puis retirer l'adresse provisoire. Tant que `APP_BASE_URL` ne correspond pas à l'adresse utilisée, les sauvegardes sont refusées (« Origine refusée »).

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

- Brancher la connexion sur TAKATAK V1 (un compte par personne, plusieurs espaces).
- Reprendre les modèles sauvegardés sur l'ancien hébergement, si on veut les garder.
- Le verrou de connexion protège par adresse puis par espace : plusieurs adresses qui se trompent en même temps peuvent bloquer la connexion 15 minutes.
