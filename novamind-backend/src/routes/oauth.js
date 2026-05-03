const express = require('express')
const router = express.Router()
const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy
const GitHubStrategy = require('passport-github2').Strategy
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { query } = require('../config/database')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
const JWT_SECRET = process.env.JWT_SECRET || 'novamind-secret'

// ==============================
// GÉNÉRATION TOKENS
// ==============================
const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' })
  return { accessToken, refreshToken }
}

// ==============================
// TROUVER OU CRÉER UTILISATEUR OAUTH
// ==============================
const findOrCreateOAuthUser = async ({ provider, providerId, email, name, avatar }) => {
  const providerField = `${provider}_id`

  // Chercher par provider_id
  let result = await query(
    `SELECT * FROM users WHERE ${providerField} = $1`,
    [providerId]
  )

  if (result.rows.length > 0) {
    return result.rows[0]
  }

  // Chercher par email si déjà inscrit
  if (email) {
    result = await query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length > 0) {
      // Lier le compte OAuth à l'email existant
      await query(
        `UPDATE users SET ${providerField} = $1, updated_at = NOW() WHERE id = $2`,
        [providerId, result.rows[0].id]
      )
      return result.rows[0]
    }
  }

  // Créer un nouvel utilisateur
  const ADMIN_EMAILS_LIST = ['kaddanwalidpro@gmail.com', 'kaddanaminpro@gmail.com']
  const isAdminEmail = email === 'kaddanwalidpro@gmail.com'
  const isAdminEmail = ADMIN_EMAILS_LIST.includes(email)
  const randomPassword = await bcrypt.hash(Math.random().toString(36), 12)

  const newUser = await query(
    `INSERT INTO users (email, name, avatar, ${providerField}, password_hash, gear, role, title, email_verified, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW()) RETURNING *`,
    [
      email || `${provider}_${providerId}@novamind.ai`,
      name || 'Utilisateur NovaMind',
      avatar || null,
      providerId,
      randomPassword,
      isAdminEmail ? 5 : 1,
      isAdminEmail ? 'admin' : 'user',
      userTitle,
    ]
  )

  return newUser.rows[0]
}

// ==============================
// GOOGLE STRATEGY
// ==============================
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/oauth/google/callback`,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await findOrCreateOAuthUser({
      provider: 'google',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      name: profile.displayName,
      avatar: profile.photos?.[0]?.value,
    })
    done(null, user)
  } catch (err) {
    done(err, null)
  }
}))

// ==============================
// GITHUB STRATEGY
// ==============================
if (process.env.GITHUB_CLIENT_ID) {
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/oauth/github/callback`,
    scope: ['user:email'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser({
        provider: 'github',
        providerId: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName || profile.username,
        avatar: profile.photos?.[0]?.value,
      })
      done(null, user)
    } catch (err) {
      done(err, null)
    }
  }))
}

passport.serializeUser((user, done) => done(null, user.id))
passport.deserializeUser(async (id, done) => {
  try {
    const result = await query('SELECT * FROM users WHERE id = $1', [id])
    done(null, result.rows[0])
  } catch (err) {
    done(err)
  }
})

// ==============================
// ROUTES GOOGLE
// ==============================
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
)

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}/login?error=google_failed`, session: false }),
  async (req, res) => {
    try {
      const user = req.user
      const { accessToken, refreshToken } = generateTokens(user.id)

      // Sauvegarder refresh token
      await query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
        [user.id, refreshToken]
      ).catch(() => {})

      // Rediriger vers le frontend avec les tokens
      res.redirect(`${FRONTEND_URL}/auth/callback?access_token=${accessToken}&refresh_token=${refreshToken}`)
    } catch (err) {
      res.redirect(`${FRONTEND_URL}/login?error=server_error`)
    }
  }
)

// ==============================
// ROUTES GITHUB
// ==============================
router.get('/github',
  passport.authenticate('github', { scope: ['user:email'], session: false })
)

router.get('/github/callback',
  passport.authenticate('github', { failureRedirect: `${FRONTEND_URL}/login?error=github_failed`, session: false }),
  async (req, res) => {
    try {
      const user = req.user
      const { accessToken, refreshToken } = generateTokens(user.id)

      await query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')',
        [user.id, refreshToken]
      ).catch(() => {})

      res.redirect(`${FRONTEND_URL}/auth/callback?access_token=${accessToken}&refresh_token=${refreshToken}`)
    } catch (err) {
      res.redirect(`${FRONTEND_URL}/login?error=server_error`)
    }
  }
)

module.exports = router
