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

Les étiquettes, les produits et les vérifications déclarées vivent dans
la base propre de SC4NNER, rattachées à `masterIdentityId`. V1 ne
reçoit aucune donnée d'étiquette : ni nom de produit, ni code-barres, ni
vérification. L'échange ne renvoie que le contexte du compte, rien
d'autre.

## Point ouvert pour le propriétaire de V1

La session renvoyée par l'échange dure 12 heures, comme BEH4VIOR : un
compte désactivé perd l'accès à SC4NNER en 12 heures au plus. Le nom du
droit (`sc4nner_free`) et le code produit (`sc4nner`) sont à confirmer
côté V1 avant le premier essai réel.
