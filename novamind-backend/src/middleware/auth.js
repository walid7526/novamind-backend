const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

// ==============================
// SYSTÈME DE RÔLES NOVAMIND
// admin = VIP SYSTEM (accès total)
// subscriber = payant par gear
// user = basique gratuit
// ==============================

const ADMIN_EMAILS = [
  'kaddanwalidpro@gmail.com',  // Co-créateur — Admin VIP
  'kaddanaminpro@gmail.com',   // Co-créateur — Admin VIP
]

// Titres One Piece par Gear
const GEAR_TITLES = {
  1: 'Sea Rookie',
  2: 'Rookie Pirate',
  3: 'New World Explorer',
  4: 'Haki Awakened',
  5: 'Legendary Awakening',
}

const getGearTitle = (gear) => GEAR_TITLES[gear] || 'Sea Rookie'

const isAdminEmail = (email) => ADMIN_EMAILS.includes(email?.toLowerCase())

// Vérifie si admin (VIP SYSTEM)
const isAdminRole = (user) =>
  user?.role === 'admin' || user?.role === 'admin' || isAdminEmail(user?.email)


const { query } = require('../config/database');

// ==============================
// VÉRIFIE LE TOKEN JWT
// ==============================
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token manquant ou invalide' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Récupère l'utilisateur en base
    const result = await query(
      'SELECT id, email, role, gear, status, memory_enabled, preferred_ai_model FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Utilisateur introuvable' });
    }

    const user = result.rows[0];

    if (user.status === 'banned') {
      return res.status(403).json({ error: 'Compte banni' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Compte suspendu temporairement' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
};

// ==============================
// VÉRIFIE RÔLE ADMIN
// ==============================
const requireAdmin = (req, res, next) => {
  if (!isAdminRole(req.user)) {
    return res.status(403).json({
      error: 'Accès VIP admin requis.',
      code: 'ADMIN_REQUIRED',
    })
  }
  next()
}

// ==============================
// VÉRIFIE RÔLE FONDATEUR (VIP)
// ==============================
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
};

// ==============================
// VÉRIFIE UN GEAR MINIMUM
// ==============================
const requireGear = (minGear) => (req, res, next) => {
  // Le administrateur bypass tout
  if (req.user.role === 'admin') return next();
  
  if (req.user.gear < minGear) {
    return res.status(403).json({
      error: `Cette fonctionnalité requiert Gear ${minGear} ou supérieur`,
      required_gear: minGear,
      current_gear: req.user.gear,
      code: 'GEAR_REQUIRED',
    });
  }
  next();
};

// ==============================
// AUTH OPTIONNELLE (mode invité)
// ==============================
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      'SELECT id, email, role, gear, status FROM users WHERE id = $1',
      [decoded.userId]
    );
    req.user = result.rows[0] || null;
  } catch {
    req.user = null;
  }
  next();
};

module.exports = { authenticate, requireAdmin, requireAdmin, requireGear, optionalAuth };
