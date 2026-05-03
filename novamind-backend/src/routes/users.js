// ==============================
// ROUTES UTILISATEURS
// ==============================
const express = require('express');
const usersRouter = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/users/profile
usersRouter.get('/profile', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, username, avatar_url, role, gear, theme, language,
              memory_enabled, preferred_ai_model, email_verified,
              two_factor_enabled, subscription_status, created_at, last_login
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Erreur profil' });
  }
});

// PATCH /api/users/profile
usersRouter.patch('/profile', authenticate, async (req, res) => {
  try {
    const { username, theme, language, preferred_ai_model, memory_enabled } = req.body;
    const result = await query(
      `UPDATE users SET
        username = COALESCE($1, username),
        theme = COALESCE($2, theme),
        language = COALESCE($3, language),
        preferred_ai_model = COALESCE($4, preferred_ai_model),
        memory_enabled = COALESCE($5, memory_enabled),
        updated_at = NOW()
       WHERE id = $6 RETURNING id, username, theme, language, preferred_ai_model, memory_enabled`,
      [username, theme, language, preferred_ai_model, memory_enabled, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Erreur mise à jour profil' });
  }
});

// PATCH /api/users/password
usersRouter.patch('/password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Nouveau mot de passe trop court' });
    }

    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isValid = await bcrypt.compare(current_password, userResult.rows[0].password_hash);
    if (!isValid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur changement mot de passe' });
  }
});

// GET /api/users/sessions
usersRouter.get('/sessions', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, device_name, device_type, ip_address, location, created_at, expires_at
       FROM user_sessions WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ sessions: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur sessions' });
  }
});

// DELETE /api/users/sessions/:id
usersRouter.delete('/sessions/:id', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE user_sessions SET is_active = false WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Session révoquée' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur révocation session' });
  }
});

// DELETE /api/users/account
usersRouter.delete('/account', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.json({ message: 'Compte supprimé définitivement' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression compte' });
  }
});

// GET /api/users/export
usersRouter.get('/export', authenticate, async (req, res) => {
  try {
    const user = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const conversations = await query('SELECT * FROM conversations WHERE user_id = $1', [req.user.id]);
    const messages = await query(
      'SELECT m.* FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.user_id = $1',
      [req.user.id]
    );
    const memories = await query('SELECT * FROM ai_memories WHERE user_id = $1', [req.user.id]);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="novamind-export.json"');
    res.json({
      exported_at: new Date().toISOString(),
      user: user.rows[0],
      conversations: conversations.rows,
      messages: messages.rows,
      memories: memories.rows,
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur export données' });
  }
});

module.exports = usersRouter;
