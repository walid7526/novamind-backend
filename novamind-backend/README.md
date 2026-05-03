# 🧠 NovaMind — Backend API

## Stack
- **Runtime** : Node.js + Express
- **Base de données** : PostgreSQL
- **Cache** : Redis
- **Auth** : JWT + bcrypt + 2FA (TOTP)
- **Paiement** : Stripe
- **IA** : OpenAI, Anthropic, Gemini, Grok, Mistral
- **Temps réel** : Socket.IO

---

## 🚀 Installation

```bash
cd backend
npm install
```

---

## ⚙️ Configuration

Modifie le fichier `.env` avec tes vraies valeurs :

```
DATABASE_URL=postgresql://user:password@localhost:5432/novamind
REDIS_URL=redis://localhost:6379
JWT_SECRET=...change_this...
STRIPE_SECRET_KEY=ta_cle_stripe
OPENAI_API_KEY=ta_cle_openai
...
```

---

## 🗄️ Base de données

### Option recommandée : Supabase (gratuit)
1. Va sur https://supabase.com
2. Crée un projet
3. Va dans SQL Editor
4. Copie-colle le contenu de `src/config/schema.sql`
5. Clique "Run"
6. Récupère ta `DATABASE_URL` dans Settings > Database

### PostgreSQL local
```bash
psql -U postgres -c "CREATE DATABASE novamind;"
psql -U postgres -d novamind -f src/config/schema.sql
```

---

## 💳 Stripe — Créer les produits

1. Va sur https://dashboard.stripe.com
2. Produits > Créer un produit pour chaque Gear :

| Gear | Nom | Prix mensuel | Prix annuel |
|------|-----|-------------|-------------|
| 2 | Gear 2 Plus | 4,99 € | 49,90 € |
| 3 | Gear 3 Pro | 9,99 € | 99,90 € |
| 4 | Gear 4 Ultra | 19,99 € | 199,90 € |
| 5 | Gear 5 Infinite | 39,99 € | 399,90 € |

3. Récupère les Price IDs et mets-les dans `.env`

### Webhook Stripe
```bash
# En local pour tester
stripe listen --forward-to localhost:5000/api/payments/webhook
```

---

## 🤖 Clés IA à obtenir

| Service | URL |
|---------|-----|
| OpenAI | https://platform.openai.com/api-keys |
| Anthropic | https://console.anthropic.com |
| Gemini | https://makersuite.google.com/app/apikey |
| Grok | https://console.x.ai |
| Mistral | https://console.mistral.ai |

---

## ▶️ Démarrage

```bash
# Développement (avec auto-reload)
npm run dev

# Production
npm start
```

Le serveur démarre sur **http://localhost:5000**

---

## 📡 Routes principales

### Auth
```
POST /api/auth/register       — Inscription
POST /api/auth/login          — Connexion
POST /api/auth/refresh        — Refresh token
POST /api/auth/logout         — Déconnexion
POST /api/auth/forgot-password
POST /api/auth/reset-password
GET  /api/auth/verify-email
GET  /api/auth/me             — Profil connecté
POST /api/auth/2fa/enable
POST /api/auth/2fa/confirm
```

### Chat IA
```
GET  /api/chat/models         — Modèles disponibles
POST /api/chat/message        — Envoyer un message
POST /api/chat/message?stream — Streaming SSE
```

### Conversations
```
GET    /api/conversations
GET    /api/conversations/:id
PATCH  /api/conversations/:id/rename
DELETE /api/conversations/:id
PATCH  /api/conversations/:id/archive
POST   /api/conversations/:id/share
GET    /api/conversations/:id/export
```

### Paiement
```
GET  /api/payments/plans
POST /api/payments/create-checkout
POST /api/payments/portal
GET  /api/payments/subscription
POST /api/payments/webhook
```

### Utilisateur
```
GET    /api/users/profile
PATCH  /api/users/profile
PATCH  /api/users/password
GET    /api/users/sessions
DELETE /api/users/sessions/:id
DELETE /api/users/account
GET    /api/users/export
```

### Mémoire IA
```
GET    /api/memory
POST   /api/memory
DELETE /api/memory/:id
DELETE /api/memory
```

### Admin (rôle admin/founder requis)
```
GET   /api/admin/stats
GET   /api/admin/users
PATCH /api/admin/users/:id/status
GET   /api/admin/logs
```

---

## 🌍 Déploiement production

### Render.com (recommandé pour débutant, gratuit)
1. Va sur https://render.com
2. New > Web Service
3. Connecte ton repo GitHub
4. Build command : `npm install`
5. Start command : `npm start`
6. Ajoute tes variables d'environnement

### Railway.app (alternative simple)
1. https://railway.app
2. Deploy from GitHub
3. Add PostgreSQL plugin
4. Add variables d'env

---

## 🔐 Sécurité intégrée
- ✅ Bcrypt (rounds 12) pour les mots de passe
- ✅ JWT access token 15min + refresh token 7j
- ✅ Rate limiting : 500/15min global, 10/15min auth
- ✅ Protection bruteforce (5 tentatives max)
- ✅ 2FA TOTP (Google Authenticator)
- ✅ Helmet.js (headers sécurité)
- ✅ CORS configuré
- ✅ Logs sécurité en base
- ✅ Compte fondateur protégé (kaddanwalidpro@gmail.com)
- ✅ Gear system (accès fonctionnalités par niveau)

---

## 👑 Compte fondateur
L'email `kaddanwalidpro@gmail.com` est automatiquement :
- Gear 5 (accès illimité)
- Rôle `founder`
- Accès admin total
- Aucune limitation IA
- Bypass système de paiement
