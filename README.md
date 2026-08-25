# API — Système de paiement Momo Connect

Backend Node.js/Express + PostgreSQL pour le système de paiement. Conçu pour durer :
même base de code que celle qui recevra plus tard les webhooks du partenaire PSP,
donc aucune réécriture à prévoir quand ce partenaire sera actif.

## 1. Installation locale (pour tester)

```bash
cd momoconnect-backend
npm install
cp .env.example .env
# éditez .env : DATABASE_URL, ADMIN_PASSWORD, JWT_SECRET, CORS_ORIGIN
npm start
```

Il vous faut un Postgres accessible (local via Docker, ou directement celui de Railway/Render
en développement — le plus simple pour commencer).

## 2. Déploiement recommandé : Railway

Pourquoi Railway plutôt qu'un plan gratuit qui s'endort : ton site gère du vrai argent, et le
futur webhook du PSP doit pouvoir arriver à tout moment sans que le serveur soit endormi. Un
plan payant modeste (~5 $/mois, "Hobby") est le bon compromis durabilité/coût pour démarrer.

Étapes :
1. Créer un compte Railway, nouveau projet → "Deploy from GitHub repo" (ou upload direct du zip)
2. Ajouter une base "PostgreSQL" au projet (Railway fournit `DATABASE_URL` automatiquement)
3. Dans les variables d'environnement du service : `ADMIN_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN`
   (`PGSSL` n'est pas nécessaire en production, Railway force déjà le SSL)
4. Railway donne une URL du type `momoconnect-api.up.railway.app`
5. Chez Hostinger (zone DNS de momoconnect.fr) : ajouter un enregistrement CNAME
   `api.momoconnect.fr` → l'URL Railway ci-dessus
6. Une fois propagé, l'API répond sur `https://api.momoconnect.fr`

Render fonctionne de façon presque identique si tu préfères.

## 3. Endpoints

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/settings` | non | chave PIX, WhatsApp, taux du jour (public) |
| POST | `/api/demandes` | non | créer une demande (étapes 1+2 du formulaire) |
| GET | `/api/demandes/:reference` | non | suivre une demande / afficher le reçu |
| POST | `/api/demandes/:reference/declare-paid` | non | le client déclare avoir payé |
| POST | `/api/admin/login` | non | `{ "password": "..." }` → `{ "token": "..." }` |
| GET | `/api/admin/demandes` | admin | liste de toutes les demandes |
| POST | `/api/admin/demandes/:reference/confirm` | admin | confirmer un paiement reçu |
| GET/POST | `/api/admin/settings` | admin | lire/modifier chave PIX, WhatsApp, taux |

Pour les routes admin, envoyer `Authorization: Bearer <token>` obtenu via `/api/admin/login`.

## 4. Pourquoi PostgreSQL et pas SQLite

La version précédente utilisait SQLite (un simple fichier). Sur Railway/Render, le système de
fichiers d'un service est éphémère : un redéploiement peut effacer ce fichier et perdre toutes
les demandes. PostgreSQL managé est persistant, sauvegardé, et c'est le standard pour ce genre
de service — donc plus durable, comme demandé.

## 5. Prochaine étape : brancher le frontend

Le composant React du prototype (`momoconnect-payment.jsx`) utilise actuellement
`window.storage` (spécifique aux artefacts Claude). Une fois l'API en ligne sur
`api.momoconnect.fr`, je remplace ces appels par des `fetch()` vers les endpoints ci-dessus —
je peux le faire dès que l'API est déployée et testable.

## 6. Brancher un PSP plus tard (sans tout reprendre)

Quand le partenaire PSP répondra, l'intégration se limite à :
- ajouter une route `POST /api/webhooks/psp` qui reçoit la confirmation de paiement PIX
  (avec le nom/CPF du payeur) et appelle la même logique que `/confirm`
- éventuellement ajouter un appel sortant vers l'API du PSP pour la vérification CPF
  auprès de la Receita Federal

Rien dans la structure actuelle (base de données, routes existantes, authentification admin)
n'a besoin de changer pour ça — c'est exactement le but de l'avoir construit ainsi dès le début.
