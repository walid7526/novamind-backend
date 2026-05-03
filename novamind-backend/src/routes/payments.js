const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendPaymentSuccessEmail, sendSubscriptionChangedEmail, sendSubscriptionCancelledEmail } = require('../services/email');

// ==============================
// CONFIG PLANS GEAR
// ==============================
const GEAR_PLANS = {
  2: { name: 'Gear 2 — Plus', price_monthly: 499, price_yearly: 4990 },
  3: { name: 'Gear 3 — Pro', price_monthly: 999, price_yearly: 9990 },
  4: { name: 'Gear 4 — Ultra', price_monthly: 1999, price_yearly: 19990 },
  5: { name: 'Gear 5 — Infinite', price_monthly: 3999, price_yearly: 39990 },
};

const PRICE_IDS = {
  2: { monthly: process.env.STRIPE_GEAR2_MONTHLY, yearly: process.env.STRIPE_GEAR2_YEARLY },
  3: { monthly: process.env.STRIPE_GEAR3_MONTHLY, yearly: process.env.STRIPE_GEAR3_YEARLY },
  4: { monthly: process.env.STRIPE_GEAR4_MONTHLY, yearly: process.env.STRIPE_GEAR4_YEARLY },
  5: { monthly: process.env.STRIPE_GEAR5_MONTHLY, yearly: process.env.STRIPE_GEAR5_YEARLY },
};

// ==============================
// GET /api/payments/plans
// Retourne les plans disponibles
// ==============================
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        gear: 1,
        name: 'Gear 1 — Free',
        price_monthly: 0,
        price_yearly: 0,
        features: ['IA standard', 'Mémoire limitée', 'Historique basique', 'Mode clair/sombre'],
      },
      {
        gear: 2,
        name: 'Gear 2 — Plus',
        price_monthly: 4.99,
        price_yearly: 49.90,
        features: ['Meilleure IA', 'Upload images', 'Meilleure mémoire', 'Analyse captures écran'],
      },
      {
        gear: 3,
        name: 'Gear 3 — Pro',
        price_monthly: 9.99,
        price_yearly: 99.90,
        features: ['Génération images IA', 'Upload documents', 'IA vocale', 'Export avancé', 'Mémoire étendue'],
      },
      {
        gear: 4,
        name: 'Gear 4 — Ultra',
        price_monthly: 19.99,
        price_yearly: 199.90,
        features: ['Modèles IA avancés', 'Multimodal avancé', 'Workspace', 'Mémoire très longue', 'Génération HD/4K'],
      },
      {
        gear: 5,
        name: 'Gear 5 — Infinite',
        price_monthly: 39.99,
        price_yearly: 399.90,
        features: ['Accès IA ultime', 'Contexte quasi illimité', 'Agents IA autonomes', 'Génération apps', 'Automatisations avancées'],
      },
    ],
  });
});

// ==============================
// POST /api/payments/create-checkout
// Crée une session Stripe Checkout
// ==============================
router.post('/create-checkout', authenticate, async (req, res) => {
  try {
    const { gear, billing_period = 'monthly' } = req.body;

    // Les admins n'ont pas besoin de payer
    const ADMIN_ROLES = ['admin', 'admin']
    if (ADMIN_ROLES.includes(req.user.role)) {
      return res.status(400).json({ error: 'Les administrateurs ont accès gratuit à tout' })
    }

    const gearNum = parseInt(gear);
    if (!PRICE_IDS[gearNum]) {
      return res.status(400).json({ error: 'Plan invalide' });
    }

    const priceId = PRICE_IDS[gearNum][billing_period];
    if (!priceId) {
      return res.status(400).json({ error: 'Période de facturation invalide' });
    }

    // Récupère ou crée le client Stripe
    let customerId = req.user.stripe_customer_id;
    const userResult = await query('SELECT stripe_customer_id, email, username FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];

    if (!user.stripe_customer_id) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.username,
        metadata: { user_id: req.user.id },
      });
      customerId = customer.id;
      await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { user_id: req.user.id, gear: gearNum.toString() },
      },
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing`,
      locale: 'fr',
      metadata: { user_id: req.user.id, gear: gearNum.toString() },
    });

    res.json({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error('Erreur checkout Stripe:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la session de paiement' });
  }
});

// ==============================
// POST /api/payments/portal
// Portail de gestion abonnement
// ==============================
router.post('/portal', authenticate, async (req, res) => {
  try {
    const userResult = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.user.id]);
    const customerId = userResult.rows[0]?.stripe_customer_id;

    if (!customerId) {
      return res.status(400).json({ error: 'Aucun abonnement actif' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/settings/subscription`,
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de l\'ouverture du portail' });
  }
});

// ==============================
// GET /api/payments/subscription
// Statut de l'abonnement actuel
// ==============================
router.get('/subscription', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.gear, u.subscription_status, u.subscription_ends_at, u.trial_ends_at,
              s.billing_period, s.amount, s.currency, s.current_period_end
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       WHERE u.id = $1`,
      [req.user.id]
    );

    const data = result.rows[0];
    const isAdmin = ['admin', 'admin'].includes(req.user.role)

    res.json({
      gear: isAdmin ? 5 : data.gear,
      status: isAdmin ? req.user.role : data.subscription_status,
      ends_at: data.subscription_ends_at,
      trial_ends_at: data.trial_ends_at,
      billing_period: data.billing_period,
      amount: data.amount,
      currency: data.currency,
      is_admin: isAdmin,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'abonnement' });
  }
});

// ==============================
// POST /api/payments/webhook
// Webhooks Stripe (events)
// ==============================
router.post('/webhook', async (req, res) => {
  let event;

  try {
    // Si STRIPE_WEBHOOK_SECRET est configuré → vérification signature
    // Sinon → parsing direct (mode développement / sans webhook)
    if (process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_WEBHOOK_SECRET !== 'VOTRE_WEBHOOK_SECRET_STRIPE') {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      // Parsing direct sans vérification signature
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // Abonnement créé ou mis à jour
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;
        const gear = parseInt(subscription.metadata?.gear) || 2;

        if (userId) {
          const gearTitle = {"1":"Sea Rookie","2":"Rookie Pirate","3":"New World Explorer","4":"Haki Awakened","5":"Legendary Awakening"}[gear] || 'Sea Rookie'
          await query(
            `UPDATE users SET
              gear = $1,
              role = CASE WHEN role NOT IN ('admin', 'admin') THEN 'subscriber' ELSE role END,
              title = CASE WHEN role NOT IN ('admin', 'admin') THEN $6 ELSE title END,
              stripe_subscription_id = $2,
              subscription_status = $3,
              subscription_ends_at = to_timestamp($4)
             WHERE id = $5`,
            [gear, subscription.id, subscription.status, subscription.current_period_end, userId, gearTitle]
          );

          await query(
            `INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_customer_id, gear_level, status, billing_period, current_period_start, current_period_end)
             VALUES ($1, $2, $3, $4, $5, 'monthly', to_timestamp($6), to_timestamp($7))
             ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = $5, current_period_end = to_timestamp($7)`,
            [userId, subscription.id, subscription.customer, gear, subscription.status,
             subscription.current_period_start, subscription.current_period_end]
          );
        }
        break;
      }

      // Abonnement annulé
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;

        if (userId) {
          await query(
            `UPDATE users SET
              gear = 1,
              role = CASE WHEN role NOT IN ('admin', 'admin') THEN 'user' ELSE role END,
              title = CASE WHEN role NOT IN ('admin', 'admin') THEN 'Sea Rookie' ELSE title END,
              subscription_status = $1,
              stripe_subscription_id = NULL
             WHERE id = $2`,
            ['canceled', userId]
          );
        }
        break;
      }

      // Paiement réussi
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log(`✅ Paiement reçu: ${invoice.amount_paid / 100}€ - Client: ${invoice.customer}`);
        // Email confirmation paiement
        try {
          const userRes = await query('SELECT email, username, gear FROM users WHERE stripe_customer_id = $1', [invoice.customer]);
          if (userRes.rows[0]) {
            const u = userRes.rows[0];
            await sendPaymentSuccessEmail({
              to: u.email,
              username: u.username,
              gear: u.gear,
              amount: (invoice.amount_paid / 100).toFixed(2),
              billingPeriod: 'monthly',
            });
          }
        } catch(e) { console.error('Email paiement échoué:', e.message); }
        break;
      }

      // Paiement échoué
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log(`❌ Paiement échoué - Client: ${invoice.customer}`);
        // Notifier l'utilisateur par email
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Erreur traitement webhook:', error);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});

module.exports = router;
