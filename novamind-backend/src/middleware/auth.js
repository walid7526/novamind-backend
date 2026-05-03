const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
// Import email sécurisé — ne bloque pas si Resend n'est pas configuré
let sendWelcomeEmail = async () => {}
let sendResetPasswordEmail = async () => {}
let sendPasswordChangedEmail = async () => {}
try {
  const emailService = require('../services/email')
  sendWelcomeEmail = emailService.sendWelcomeEmail
  sendResetPasswordEmail = emailService.sendResetPasswordEmail
  sendPasswordChangedEmail = emailService.sendPasswordChangedEmail
} catch(e) {
  console.warn('Service email non disponible:', e.message)
}

// ==============================
// GÉNÈRE LES TOKENS JWT
// ==============================
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

// ==============================
// LOGS SÉCURITÉ
// ==============================
const logSecurityEvent = async (userId, eventType, req, details = {}) => {
  try {
    await query(
      `INSERT INTO security_logs (user_id, event_type, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, eventType, req.ip, req.headers['user-agent'], JSON.stringify(details)]
    );
  } catch (e) {
    console.error('Log sécurité échoué:', e.message);
  }
};

// ==============================
// POST /api/auth/register
// ==============================
router.post('/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
    }

    // Vérifie si l'email existe déjà
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const verifyToken = uuidv4();
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Détermine si c'est le compte administrateur
    const ADMIN_EMAILS_LIST = ['kaddanwalidpro@gmail.com', 'kaddanaminpro@gmail.com']
    const isAdmin = ADMIN_EMAILS_LIST.includes(email.toLowerCase())
    // Les 2 créateurs = rôle admin VIP identique, sans hiérarchie
    const role = isAdmin ? 'admin' : 'user'
    const gear = isAdmin ? 5 : 1
    const title = isAdmin ? 'Legendary Awakening' : 'Sea Rookie'

    const result = await query(
      `INSERT INTO users (email, password_hash, username, role, gear, email_verify_token, email_verify_expires, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, role, gear, username`,
      [email.toLowerCase(), passwordHash, username || email.split('@')[0], role, gear, title, verifyToken, verifyExpires, isAdmin]
    );

    const user = result.rows[0];

    // Envoie email de vérification (sauf administrateur)
    if (!isAdmin) {
      await sendEmail({
        to: email,
        subject: '✉️ Vérifiez votre compte NovaMind',
        template: 'verify-email',
        data: { username: user.username, token: verifyToken, url: `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}` },
      }).catch(console.error);
    }

    const { accessToken, refreshToken } = generateTokens(user.id);

    // Sauvegarde refresh token
    await query(
      `INSERT INTO user_sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshToken, req.ip, req.headers['user-agent'], new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    await logSecurityEvent(user.id, 'REGISTER', req);

    res.status(201).json({
      message: 'Compte créé avec succès',
      user: { id: user.id, email: user.email, role: user.role, gear: user.gear, username: user.username },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Erreur register:', error);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

// ==============================
// POST /api/auth/login
// ==============================
router.post('/login', async (req, res) => {
  try {
    const { email, password, twoFactorCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const result = await query(
      `SELECT id, email, password_hash, role, gear, status, email_verified,
              two_factor_enabled, two_factor_secret, login_attempts, lock_until, username
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];

    // Vérifie si le compte est verrouillé
    if (user.lock_until && new Date() < new Date(user.lock_until)) {
      const remaining = Math.ceil((new Date(user.lock_until) - Date.now()) / 60000);
      return res.status(423).json({ error: `Compte verrouillé. Réessayez dans ${remaining} minutes.` });
    }

    if (user.status === 'banned') return res.status(403).json({ error: 'Compte banni' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Compte suspendu' });

    // Vérifie le mot de passe
    if (!user.password_hash) {
      return res.status(400).json({ error: 'Ce compte utilise une connexion OAuth. Connectez-vous via Google/GitHub.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      const attempts = (user.login_attempts || 0) + 1;
      const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;

      if (attempts >= maxAttempts) {
        const lockUntil = new Date(Date.now() + (parseInt(process.env.LOCK_TIME) || 900000));
        await query('UPDATE users SET login_attempts = $1, lock_until = $2 WHERE id = $3', [attempts, lockUntil, user.id]);
        await logSecurityEvent(user.id, 'ACCOUNT_LOCKED', req, { attempts });
        return res.status(423).json({ error: 'Compte verrouillé pour 15 minutes après trop de tentatives.' });
      }

      await query('UPDATE users SET login_attempts = $1 WHERE id = $2', [attempts, user.id]);
      return res.status(401).json({ error: 'Email ou mot de passe incorrect', attempts_remaining: maxAttempts - attempts });
    }

    // 2FA si activé
    if (user.two_factor_enabled) {
      if (!twoFactorCode) {
        return res.status(200).json({ requires_2fa: true, message: 'Code 2FA requis' });
      }
      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: twoFactorCode,
        window: 2,
      });
      if (!verified) {
        return res.status(401).json({ error: 'Code 2FA invalide' });
      }
    }

    // Reset tentatives de connexion
    await query(
      'UPDATE users SET login_attempts = 0, lock_until = NULL, last_login = NOW() WHERE id = $1',
      [user.id]
    );

    const { accessToken, refreshToken } = generateTokens(user.id);

    await query(
      `INSERT INTO user_sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshToken, req.ip, req.headers['user-agent'], new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    await logSecurityEvent(user.id, 'LOGIN_SUCCESS', req);

    res.json({
      user: { id: user.id, email: user.email, role: user.role, gear: user.gear, username: user.username },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Erreur login:', error);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// ==============================
// POST /api/auth/refresh
// ==============================
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token manquant' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const session = await query(
      'SELECT * FROM user_sessions WHERE refresh_token = $1 AND is_active = true AND expires_at > NOW()',
      [refreshToken]
    );

    if (!session.rows.length) {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }

    const tokens = generateTokens(decoded.userId);

    // Rotation du refresh token
    await query(
      'UPDATE user_sessions SET refresh_token = $1, expires_at = $2 WHERE refresh_token = $3',
      [tokens.refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), refreshToken]
    );

    res.json(tokens);
  } catch (error) {
    res.status(401).json({ error: 'Token invalide' });
  }
});

// ==============================
// POST /api/auth/logout
// ==============================
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('UPDATE user_sessions SET is_active = false WHERE refresh_token = $1', [refreshToken]);
    }
    await logSecurityEvent(req.user.id, 'LOGOUT', req);
    res.json({ message: 'Déconnexion réussie' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la déconnexion' });
  }
});

// ==============================
// POST /api/auth/forgot-password
// ==============================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await query('SELECT id, username FROM users WHERE email = $1', [email?.toLowerCase()]);

    // Toujours renvoyer un succès (sécurité anti-enumération)
    res.json({ message: 'Si cet email existe, vous recevrez un lien de réinitialisation.' });

    if (!result.rows.length) return;

    const user = result.rows[0];
    const resetToken = uuidv4();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await query(
      'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
      [resetToken, resetExpires, user.id]
    );

    await sendEmail({
      to: email,
      subject: '🔑 Réinitialisation de votre mot de passe NovaMind',
      template: 'reset-password',
      data: { username: user.username, url: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}` },
    }).catch(console.error);

    await logSecurityEvent(user.id, 'PASSWORD_RESET_REQUEST', req);
  } catch (error) {
    console.error('Erreur forgot-password:', error);
  }
});

// ==============================
// POST /api/auth/reset-password
// ==============================
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'Token et mot de passe valide requis' });
    }

    const result = await query(
      'SELECT id FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Lien invalide ou expiré' });
    }

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await query(
      'UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
      [passwordHash, result.rows[0].id]
    );

    await logSecurityEvent(result.rows[0].id, 'PASSWORD_RESET_SUCCESS', req);
    res.json({ message: 'Mot de passe réinitialisé avec succès' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la réinitialisation' });
  }
});

// ==============================
// GET /api/auth/verify-email
// ==============================
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    const result = await query(
      'SELECT id FROM users WHERE email_verify_token = $1 AND email_verify_expires > NOW()',
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Lien de vérification invalide ou expiré' });
    }

    await query(
      'UPDATE users SET email_verified = true, email_verify_token = NULL, email_verify_expires = NULL WHERE id = $1',
      [result.rows[0].id]
    );

    res.json({ message: 'Email vérifié avec succès !' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la vérification' });
  }
});

// ==============================
// GET /api/auth/me
// ==============================
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, username, avatar_url, role, gear, status, email_verified,
              two_factor_enabled, preferred_ai_model, theme, language, memory_enabled,
              subscription_status, subscription_ends_at, created_at, last_login
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération du profil' });
  }
});

// ==============================
// POST /api/auth/2fa/enable
// ==============================
router.post('/2fa/enable', authenticate, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `NovaMind (${req.user.email})`,
      length: 32,
    });

    await query('UPDATE users SET two_factor_secret = $1 WHERE id = $2', [secret.base32, req.user.id]);

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode });
  } catch (error) {
    res.status(500).json({ error: 'Erreur activation 2FA' });
  }
});

// ==============================
// POST /api/auth/2fa/confirm
// ==============================
router.post('/2fa/confirm', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const result = await query('SELECT two_factor_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = result.rows[0]?.two_factor_secret;

    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!verified) return res.status(400).json({ error: 'Code invalide' });

    await query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [req.user.id]);
    res.json({ message: '2FA activé avec succès' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur confirmation 2FA' });
  }
});

module.exports = router;
