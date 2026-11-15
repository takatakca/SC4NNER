# SC4NNER / TAKATAK-V1 bridge

— signé : SOCIO, Agent Lévesque · 2026-11-13

Contrepartie côté V1 à écrire dans `docs/SC4NNER_BRIDGE.md` dans
https://github.com/takatakca/takatak-v1 (copie du pont BEH4VIOR, même
forme, autres noms).

TAKATAK-V1 reste le tableau de bord maître unique pour l'inscription,
l'identité, les abonnements, les droits et la facturation. SC4NNER est
une expérience déployée séparément. Il ne possède jamais l'identité d'un
client et ne prend jamais un paiement. L'inscription se fait sur
takatak.ca (mobile + code SMS) ; SC4NNER ne crée aucun compte et ne
tient aucun annuaire d'utilisateurs.

## Routes dans V1 (à créer, copie du pont BEH4VIOR, PR #285)

- `/dashboard/sc4nner` : entrée du tableau de bord. Ouvre `/auth/start`
  de SC4NNER avec `TAKATAK_SC4NNER_URL` ; montre un état « non
  configuré » véridique quand l'adresse manque.
- `GET /api/experiences/sc4nner/launch?state=<43 caractères base64url>` :
  connexion TAKATAK (avec `next` conservé), synchronisation du profil,
  vérification de l'identité maître active, code de lancement unique de
  90 secondes haché dans `ExperienceLaunchCode`, redirection vers le
  rappel configuré.
- `POST /api/experiences/sc4nner/exchange` : protégé par secret porteur,
  consommation unique et atomique, nouvelle vérification de l'identité.
  Renvoie `{ok:true,session:{masterIdentityId,displayName,productCode:"sc4nner",entitlements:["sc4nner_free"],expiresAt}}`.

Aucune migration V1 attendue : `ExperienceLaunchCode` existe déjà.
Accès gratuit seulement, jusqu'à ce qu'un vrai produit et un vrai prix
existent dans V1.

## Configuration (noms seulement, aucune valeur dans aucun dépôt)

V1 : `TAKATAK_SC4NNER_URL`, `SC4NNER_EXPERIENCE_CALLBACK_URL`,
`TAKATAK_SC4NNER_SERVICE_TOKEN`.
SC4NNER : `TAKATAK_SC4NNER_LAUNCH_URL`,
`TAKATAK_SC4NNER_EXCHANGE_URL`, `TAKATAK_SC4NNER_SERVICE_TOKEN`
(même valeur), `SC4NNER_PRODUCT_CODE` (défaut `sc4nner`),
`SC4NNER_ENTITLEMENT` (défaut `sc4nner_free`).

## Ce côté-ci

- `GET /auth/start` : fabrique un état de 43 caractères, le garde dans
  un cookie HttpOnly court, redirige vers l'adresse de lancement V1.
  Répond 503 tant que le pont n'est pas configuré.
- `GET /auth/callback?code&state` : vérifie l'état contre le cookie,
  échange le code serveur à serveur avec le secret porteur, vérifie
  `productCode` et `sc4nner_free`, puis insère une session dans la base
  locale (propriétaire = `masterIdentityId`, 12 heures au plus) et pose
  le même cookie `__Host-label_session` que la connexion atelier.
- `GET /api/session` : renvoie aussi `via` (`workshop` ou `takatak-v1`)
  et le nom d'affichage V1 quand il y en a un.
- `GET /api/release` : renvoie aussi `takatak` (`ready` ou
  `not_configured`) ; la page n'affiche le bouton TAKATAK que quand le
  pont est prêt.
- Les étiquettes sont isolées par personne connectée : le compte atelier
  voit les étiquettes de l'atelier, chaque compte TAKATAK voit seulement
  les siennes. La connexion atelier reste en place en repli pour le
  propriétaire.

## Ce qui reste dans SC4NNER

Les étiquettes et les vérifications déclarées vivent dans la base
propre de SC4NNER, rattachées à `masterIdentityId`. V1 ne reçoit aucune
donnée d'étiquette : ni nom de produit, ni code-barres, ni vérification.
L'échange ne renvoie que le contexte du compte, rien d'autre.

## Lien inventaire TAKATAK (ajout du 2026-11-14, ordre du propriétaire)

Derrière le studio, le propriétaire veut l'écosystème d'inventaire
complet : produits suivis par code UPC, stock tenu comme une boutique.
Cet inventaire vit dans V1 (`/dashboard/inventory`, PR #218 de V1). Le
lien ajouté ici est en **lecture seule, de V1 vers SC4NNER** :

- V1 publie `POST /api/experiences/sc4nner/inventory` (même jeton de
  service que l'échange) : il résout l'identité maître → profil V1 →
  memberships actifs, et ne sert que les espaces où la permission
  effective `view_inventory` le permet, avec marques et produits (SKU,
  GTIN, prix, quantité, seuil).
- Ici, `GET /api/inventory/products` (session requise) relaie cet appel
  serveur à serveur pour les sessions TAKATAK V1. Le compte atelier
  reçoit `{linked:false, reason:"workshop"}` ; une identité sans
  catalogue lisible reçoit une liste vide ; si V1 ne répond pas, le
  studio répond 502 plutôt qu'un faux catalogue.
- L'adresse du catalogue est déduite de `TAKATAK_SC4NNER_EXCHANGE_URL`
  (`…/sc4nner/exchange` → `…/sc4nner/inventory`) ; la variable
  optionnelle `TAKATAK_SC4NNER_INVENTORY_URL` peut la remplacer.
  **Aucune nouvelle variable obligatoire, aucun redéploiement de
  configuration** : les trois variables du pont suffisent.
- Dans le studio, « Produit de l'inventaire TAKATAK » charge le produit
  choisi dans le formulaire (marque, nom, ingrédients, format, SKU,
  GTIN) et l'étiquette sauvegardée garde la référence
  (`payload.inventory` : produit, espace, entreprise). Le code imprimé
  est donc celui de l'inventaire. Modifier le SKU ou le GTIN à la main
  retire le lien. Les mouvements de stock restent dans V1, derrière
  `manage_inventory` ; SC4NNER ne change aucun stock.

## Point ouvert pour le propriétaire de V1

La session renvoyée par l'échange dure 12 heures, comme BEH4VIOR : un
compte désactivé perd l'accès à SC4NNER en 12 heures au plus. Le nom du
droit (`sc4nner_free`) et le code produit (`sc4nner`) sont à confirmer
côté V1 avant le premier essai réel.

## Provisionnement des comptes liés (ajout du 2026-11-15, ordre du propriétaire)

Constat du propriétaire (2026-11-15 10:51) : le flux arrivait à
l'autorisation sans compte identifié, et `/api/release` répondait
`account: not_configured` alors que le pont TAKATAK était prêt — ce
champ ne parlait que du compte atelier (variables d'environnement),
jamais des comptes TAKATAK. Le chaînon manquant est le
**provisionnement** : quand un compte TAKATAK identifié autorise
SC4NNER, V1 provisionne le compte lié ici, une fois, et l'échange
transporte désormais le courriel de l'identité.

- `POST /api/provision` (serveur à serveur, même jeton de service que
  l'échange, comparaison à temps constant) : corps
  `{ masterIdentityId, email, displayName? }`. Crée ou met à jour le
  lien local dans `linked_accounts` (migration 0003) et répond
  `{ ok:true, provisioned:true, created }`. **Idempotent.** Ce lien
  n'est pas un annuaire : ni mot de passe, ni inscription, ni CRM —
  l'identité reste chez TAKATAK V1 (règle du dépôt).
- Le callback d'échange alimente le même lien quand la session
  échangée porte un courriel valide (auto-réparation si l'appel de
  provisionnement a été manqué).
- `GET /api/session` renvoie en plus `email` : le courriel du compte
  TAKATAK lié à la session (null pour l'atelier ou si aucun lien) ;
  l'en-tête du studio l'affiche comme compte connecté.
- `GET /api/release` reflète l'état réel : `account` vaut `configured`
  si le compte atelier existe OU si au moins un compte TAKATAK est
  lié ; `linkedAccounts` donne le nombre de comptes liés.

Côté V1 (PR compagnon) : l'autorisation devient explicite (page qui
affiche le compte — courriel — avec changement de compte possible,
avant tout code), l'enregistrement « fournisseur » est créé dans la
base principale V1 (source `sc4nner`), puis V1 appelle `/api/provision`.

## Connaissances TAKATAK (Knowledge AI) — arrière-plan du studio

`GET /api/knowledge?q=<texte>&limit=<1..5>` (worker, session du studio
requise — les mêmes comptes que le provisionnement) interroge l'API
publique de recherche de **takatakca/knowledgeAI**
(`GET /api/search`, corpus public curé, résultats avec provenance) et
renvoie `{ ok, total, results: [{ title, section, excerpt, source_url }] }`,
filtré aux sources `github.com/takatakca/knowledgeAI/…`.

Gardes : lecture seule ; seule la requête de l'utilisateur part vers
l'API publique — jamais de donnée client, d'identifiant ni de secret
(l'API est publique, aucune clé) ; le résultat ne remplit **aucun**
champ d'étiquette (règle du dépôt : rien d'inventé sur une étiquette) —
ce sont des références à consulter. Base par défaut
`https://knowledgeai-nu.vercel.app`, surchargeable par la variable
d'environnement `KNOWLEDGE_AI_API_URL`. Tout échec ou délai (> 4 s)
renvoie `{ ok: false, results: [] }` : le studio n'est jamais bloqué.

Reste à faire pour le panneau visible « premium » (étape suivante,
décision de présentation) : un bloc « Connaissances » dans l'interface
du studio qui appelle cet endpoint et affiche titre + extrait + lien
source ; et, côté corpus, des fiches guides/standards « étiquettes »
dans knowledgeAI (la recherche « étiquette » y renvoie aujourd'hui
0 résultat — le corpus couvre les projets de l'écosystème, pas encore
les règles d'étiquetage).
