# PMS-Digital

## Démarrer en local

Le site doit être servi par Node.js (version 22.13 ou plus récente), pas ouvert directement avec `file://`.

1. Copiez `.env.example` vers `.env`.
2. Gardez `PAYDUNYA_MODE=test` pendant les essais et configurez `APP_BASE_URL=http://localhost:3000`.
3. Lancez `npm start`, puis ouvrez `http://localhost:3000`.

Le serveur utilise SQLite intégré à Node.js et crée sa base dans `data/store.sqlite`.

## Comptes et téléchargements

Les comptes sont enregistrés dans SQLite. Les mots de passe doivent contenir au moins 8 caractères, sont dérivés avec scrypt et le navigateur reçoit un cookie de session HttpOnly. Les fichiers ne sont jamais servis depuis un répertoire public.

Pour donner les droits administrateur à un compte existant, définissez `ADMIN_EMAIL` sur son adresse e-mail dans l’environnement du serveur, puis redémarrez-le. Le compte correspondant sera promu au démarrage et pourra se connecter avec son mot de passe habituel. Si le compte n’existe pas encore dans cette base de données, définissez aussi `ADMIN_INITIAL_PASSWORD` avec un nouveau mot de passe privé (8 caractères minimum) : le compte administrateur sera créé au démarrage. Connectez-vous ensuite depuis le bouton « Se connecter ». En local, renseignez ces variables dans `.env` (copié depuis `.env.example`) ; sur un hébergeur, configurez-les dans son gestionnaire de variables d’environnement. Ne partagez pas le mot de passe et ne le placez jamais dans le dépôt.

Ajoutez les fichiers des produits dans `private-downloads`, en utilisant les noms définis dans `server.mjs`. Pour autoriser le paiement d'une commande, chaque fichier sélectionné doit déjà exister. Une fois PayDunya confirmé côté serveur, les liens de téléchargement sont disponibles dans « Mon compte et mes achats ». Les noms et les prix du catalogue sont des exemples à remplacer par vos produits réels.

## PayDunya et mise en production

Créez une application PayDunya Business et effectuez les tests en mode sandbox avant le passage en production. Renseignez les variables suivantes dans le gestionnaire de secrets de l'hébergeur, ou localement dans `.env` pour les essais :

- `PAYDUNYA_MASTER_KEY`
- `PAYDUNYA_PRIVATE_KEY`
- `PAYDUNYA_TOKEN`
- `PAYDUNYA_MODE` (`test` ou `live`)
- `APP_BASE_URL` (URL publique HTTPS en production)

Les clés restent côté serveur : ne les placez jamais dans le HTML, le JavaScript du navigateur, un dépôt public ou une conversation. Déclarez dans le tableau de bord PayDunya l'URL de notification `https://votre-domaine/api/paydunya/callback`. Conservez un volume persistant pour `data/` et sauvegardez la base et les fichiers de livraison.

Le paiement n'est pas activé tant que les clés ne sont pas configurées et les fichiers de livraison absents. La devise de paiement et les prix de démonstration sont en FCFA (XOF) ; la préférence de devise du profil ne convertit pas les prix. Le site et ses libellés restent en français pour le moment, même si une autre langue peut être enregistrée dans les réglages.
