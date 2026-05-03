// ==============================
// ROUTES MÉMOIRE IA
// ==============================
const express = require('express');
const memoryRouter = express.Router();
const adminRouter = express.Router();
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/memory
memoryRouter.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM ai_memories WHERE user_id = $1 ORDER BY importance DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ memories: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur mémoires' });
  }
});

// POST /api/memory
memoryRouter.post('/', authenticate, async (req, res) => {
  try {
    const { content, category, importance = 5 } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenu requis' });

    const result = await query(
      'INSERT INTO ai_memories (user_id, content, category, importance) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, content, category, importance]
    );
    res.status(201).json({ memory: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Erreur création mémoire' });
  }
});

// DELETE /api/memory/:id
memoryRouter.delete('/:id', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM ai_memories WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Mémoire supprimée' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression mémoire' });
  }
});

// DELETE /api/memory/all
memoryRouter.delete('/', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM ai_memories WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'Toutes les mémoires supprimées' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression mémoires' });
  }
});

// ==============================
// ROUTES ADMIN
// ==============================

// GET /api/admin/stats
adminRouter.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users, conversations, messages, subscriptions] = await Promise.all([
      query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = \'active\') as active FROM users'),
      query('SELECT COUNT(*) as total FROM conversations'),
      query('SELECT COUNT(*) as total FROM messages'),
      query(`SELECT gear, COUNT(*) as count FROM users WHERE gear > 1 GROUP BY gear ORDER BY gear`),
    ]);

    res.json({
      users: users.rows[0],
      conversations: conversations.rows[0],
      messages: messages.rows[0],
      subscriptions: subscriptions.rows,
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur stats admin' });
  }
});

// GET /api/admin/users
adminRouter.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status } = req.query;
    const offset = (page - 1) * limit;

    let sql = 'SELECT id, email, username, role, gear, status, email_verified, created_at, last_login FROM users WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (email ILIKE $${params.length} OR username ILIKE $${params.length})`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    res.json({ users: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur liste utilisateurs' });
  }
});

// PATCH /api/admin/users/:id/status
adminRouter.patch('/users/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['active', 'suspended', 'banned'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

    // Protège le compte fondateur
    const target = await query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (target.rows[0]?.role === 'founder') {
      return res.status(403).json({ error: 'Impossible de modifier le compte fondateur' });
    }

    await query('UPDATE users SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: `Compte ${status}` });
  } catch (e) {
    res.status(500).json({ error: 'Erreur modification statut' });
  }
});

// GET /api/admin/logs
adminRouter.get('/logs', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT sl.*, u.email FROM security_logs sl
       LEFT JOIN users u ON sl.user_id = u.id
       ORDER BY sl.created_at DESC LIMIT 100`
    );
    res.json({ logs: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur logs' });
  }
});

// ==============================
// ROUTES UPLOADS (placeholder)
// ==============================
const uploadsRouter = express.Router();
uploadsRouter.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM uploads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ uploads: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur uploads' });
  }
});

module.exports = { memoryRouter, adminRouter, uploadsRouter };
