const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users, convs, msgs, subs] = await Promise.all([
      query(`SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'active') as active,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week
             FROM users`),
      query('SELECT COUNT(*) as total FROM conversations'),
      query('SELECT COUNT(*) as total FROM messages'),
      query('SELECT gear, COUNT(*) as count FROM users WHERE gear > 1 GROUP BY gear ORDER BY gear'),
    ]);
    res.json({ users: users.rows[0], conversations: convs.rows[0], messages: msgs.rows[0], subscriptions: subs.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur stats' });
  }
});

router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status } = req.query;
    const offset = (page - 1) * limit;
    let sql = 'SELECT id, email, username, role, gear, status, email_verified, created_at, last_login FROM users WHERE 1=1';
    const params = [];
    if (search) { params.push(`%${search}%`); sql += ` AND (email ILIKE $${params.length} OR username ILIKE $${params.length})`; }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const result = await query(sql, params);
    res.json({ users: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur liste utilisateurs' });
  }
});

router.patch('/users/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended', 'banned'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
    const target = await query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (target.rows[0]?.role === 'admin') return res.status(403).json({ error: 'Impossible de modifier le administrateur' });
    await query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
    res.json({ message: `Compte mis à jour: ${status}` });
  } catch (e) {
    res.status(500).json({ error: 'Erreur modification statut' });
  }
});

router.get('/logs', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT sl.*, u.email FROM security_logs sl LEFT JOIN users u ON sl.user_id = u.id ORDER BY sl.created_at DESC LIMIT 200`
    );
    res.json({ logs: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erreur logs' });
  }
});

module.exports = router;
